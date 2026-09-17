/**
 * Investigator V1.1 planner — role transitions → existing tools.
 * Architectural ideas from LongVideoAgent / VideoMind / LongVT (see NOTICE.md).
 * 0 policy LLM calls.
 */

import { claimRelevantToQuery } from "../../claimPromotion/lazy";
import type { ClaimPromotionSet } from "../../claimPromotion/types";
import type { MediaContextNeeds } from "../../mediaContextNeeds";
import type { VideoEvidenceStore } from "../../temporalEventLedger/store";
import { inferFocusRange, type PlannedAction } from "../plan";
import type { RoiPreset as RoiPresetType } from "../tools";
import { collectGroundingCandidates } from "./grounding";
import { classifyInvestigationIntents, isSpeechPrimary, wantsWholeVideoHierarchy } from "./intents";
import { rankCandidateRanges } from "./ranking";
import {
	DEFAULT_ROLE_BUDGETS,
	INVESTIGATOR_V1_1_PROVIDER_ID,
	type InvestigatorRole,
	type RoleBudgets,
	type RolePolicyPlan,
	type RoleTransition,
} from "./types";

function mergeFocusFromRanked(
	ranked: ReturnType<typeof rankCandidateRanges>,
	fallback: ReturnType<typeof inferFocusRange>,
): ReturnType<typeof inferFocusRange> {
	if (!ranked.length) return fallback;
	const start = Math.min(...ranked.map((r) => r.startSourceTimeSec));
	const end = Math.max(...ranked.map((r) => r.endSourceTimeSec));
	return {
		startSourceTimeSec: start,
		endSourceTimeSec: end,
		questionSummary: `${fallback.questionSummary}; grounded to ${ranked.length} ranked range(s)`,
	};
}

export function planInvestigationV11(input: {
	userMessage: string;
	store: VideoEvidenceStore;
	sourceDurationSec: number;
	needs: MediaContextNeeds;
	claimPromotion?: ClaimPromotionSet | null;
	roleBudgets?: Partial<RoleBudgets>;
}): RolePolicyPlan {
	const t0 = performance.now();
	const budgets: RoleBudgets = { ...DEFAULT_ROLE_BUDGETS, ...input.roleBudgets };
	const intents = classifyInvestigationIntents(input.userMessage, input.needs);
	const roles: InvestigatorRole[] = ["GROUNDING"];
	const transitions: RoleTransition[] = [];
	const skippedIrrelevant: string[] = [];
	const lazyScheduledClaimIds: string[] = [];
	const actions: PlannedAction[] = [];

	const pushRole = (to: InvestigatorRole, why: string) => {
		const from = roles[roles.length - 1] ?? "GROUNDING";
		if (from === to) return;
		roles.push(to);
		transitions.push({ from, to, why });
	};

	const pushAction = (a: PlannedAction) => {
		if (actions.length >= 14) return;
		actions.push(a);
	};

	const focusHint = inferFocusRange(input.userMessage, input.sourceDurationSec);
	const candidates = collectGroundingCandidates({
		userMessage: input.userMessage,
		store: input.store,
		sourceDurationSec: input.sourceDurationSec,
		intents,
		claimPromotion: input.claimPromotion,
		maxCandidates: budgets.maxGroundingRanges,
	}).slice(0, budgets.maxGroundingRanges * 2);

	const ranked = rankCandidateRanges(candidates, {
		userMessage: input.userMessage,
		intents,
		store: input.store,
		claimPromotion: input.claimPromotion,
		maxRanked: budgets.maxRankedRanges,
	});

	const focus = mergeFocusFromRanked(ranked, focusHint);

	// Always start with ledger grounding on focus (not whole video unless ranked spans it)
	pushAction({
		tool: "get_events_in_range",
		startSourceSec: focus.startSourceTimeSec,
		endSourceSec: focus.endSourceTimeSec,
		why: "GROUNDING: query Temporal Event Ledger in ranked focus",
	});

	// Claim-promotion lazy scheduling
	if (input.claimPromotion) {
		for (const c of input.claimPromotion.claims) {
			const alreadyOk =
				(c.status === "supported" || c.status === "verified" || c.status === "observed") &&
				!c.isActionClaim &&
				!claimRelevantToQuery(c, input.userMessage);
			if (alreadyOk) {
				skippedIrrelevant.push(c.id);
				continue;
			}
			if (!claimRelevantToQuery(c, input.userMessage) && c.lazyVerified === false) {
				skippedIrrelevant.push(c.id);
				continue;
			}
			const needsWork =
				c.isActionClaim ||
				c.status === "unknown" ||
				c.status === "contradicted" ||
				c.status === "inferred" ||
				c.verificationLevel === "single_source";
			if (!needsWork) continue;
			if (
				!claimRelevantToQuery(c, input.userMessage) &&
				!/\b(open|did i|settings|upwork|popup|restart)\b/i.test(input.userMessage)
			) {
				skippedIrrelevant.push(c.id);
				continue;
			}
			lazyScheduledClaimIds.push(c.id);
		}
	}

	const speechPrimary = isSpeechPrimary(intents, input.userMessage);
	let visualCount = 0;
	let ocrCount = 0;
	let speechCount = 0;
	let cursorCount = 0;
	let contraCount = 0;
	let verifyCount = 0;

	if (
		speechPrimary ||
		intents.includes("speech_content") ||
		intents.includes("spoken_correction")
	) {
		pushRole("SPEECH_INSPECTION", "Question needs speech evidence");
		if (speechCount < budgets.maxSpeechQueries) {
			speechCount += 1;
			pushAction({
				tool: "get_transcript_range",
				startSourceSec: focus.startSourceTimeSec,
				endSourceSec: focus.endSourceTimeSec,
				why: "SPEECH_INSPECTION: transcript in grounded range",
			});
		}
	}

	if (intents.includes("contradiction_check") || intents.includes("spoken_correction")) {
		pushRole("CONTRADICTION_CHECK", "Check speech vs visual support");
		for (const e of input.store.contradictionsInRange(
			focus.startSourceTimeSec,
			focus.endSourceTimeSec,
		)) {
			if (contraCount >= budgets.maxContradictionChecks) break;
			contraCount += 1;
			pushAction({
				tool: "get_evidence_for_event",
				eventId: e.id,
				why: "CONTRADICTION_CHECK: provenance for speech/visual mismatch",
			});
		}
		// Light visual compare only — not full OCR sweep
		if (!speechPrimary && visualCount < budgets.maxVisualInspections) {
			const spoken = input.store.eventsByType("spoken_correction")[0];
			if (spoken) {
				visualCount += 1;
				pushAction({
					tool: "compare_visual_states",
					t1: Math.max(0, spoken.startSourceTimeSec - 0.5),
					t2: Math.min(input.sourceDurationSec, spoken.endSourceTimeSec + 0.5),
					why: "CONTRADICTION_CHECK: material visual change near spoken correction?",
				});
			}
		}
	}

	if (
		!speechPrimary &&
		(intents.includes("visual_state") ||
			intents.includes("temporary_ui") ||
			intents.includes("action_verification") ||
			intents.includes("text_ui_reading"))
	) {
		pushRole("VISUAL_INSPECTION", "Inspect grounded visual ranges only");
		for (const r of ranked) {
			if (visualCount >= budgets.maxVisualInspections) break;
			const span = r.endSourceTimeSec - r.startSourceTimeSec;
			// Never schedule a near-full-duration brute-force range
			if (span > input.sourceDurationSec * 0.45 && input.sourceDurationSec > 12) {
				continue;
			}
			if (r.sources.includes("hierarchy_coarse") && ranked.some((x) => x.score > r.score + 2)) {
				continue; // skip coarse if stronger local candidates exist
			}
			visualCount += 1;
			pushAction({
				tool: "inspect_video_range",
				startSourceSec: r.startSourceTimeSec,
				endSourceSec: r.endSourceTimeSec,
				detailLevel:
					wantsWholeVideoHierarchy(intents) && r.sources.includes("hierarchy_coarse")
						? "coarse"
						: "normal",
				why: `VISUAL_INSPECTION: ${r.id} score=${r.score.toFixed(1)} — ${r.reason.slice(0, 60)}`,
			});
		}
	}

	if (
		!speechPrimary &&
		(intents.includes("temporary_ui") || intents.includes("text_ui_reading")) &&
		ocrCount < budgets.maxOcrInspections
	) {
		pushRole("OCR_INSPECTION", "Selective ROI/OCR only if text reading needed");
		const late =
			ranked.find((r) => r.sources.includes("end_hint") || r.id === "late_window") ?? ranked[0];
		if (late) {
			ocrCount += 1;
			const t = Math.max(late.startSourceTimeSec, late.endSourceTimeSec - 0.4);
			pushAction({
				tool: "inspect_region",
				sourceTimeSec: t,
				preset: "bottom_center" as RoiPresetType,
				why: "OCR_INSPECTION: peripheral/HUD crop for temporary UI text",
			});
		}
	}

	if (
		!speechPrimary &&
		(intents.includes("action_verification") || intents.includes("cursor_interaction")) &&
		cursorCount < budgets.maxCursorQueries
	) {
		pushRole("CURSOR_INSPECTION", "Cursor/interaction evidence for action claims");
		cursorCount += 1;
		pushAction({
			tool: "get_cursor_events",
			startSourceSec: focus.startSourceTimeSec,
			endSourceSec: focus.endSourceTimeSec,
			why: "CURSOR_INSPECTION: non-move interactions in focus",
		});
		// Passive chrome provenance — never "confirm open"
		for (const e of input.store.eventsByType("passive_chrome").slice(0, 2)) {
			pushAction({
				tool: "get_evidence_for_event",
				eventId: e.id,
				why: "CURSOR/VERIFY prep: passive visibility provenance only",
			});
		}
	}

	if (
		intents.includes("action_verification") ||
		intents.includes("contradiction_check") ||
		lazyScheduledClaimIds.length > 0
	) {
		pushRole("VERIFICATION", "Deterministic claim verification pass");
		if (verifyCount < budgets.maxVerificationPasses) {
			verifyCount += 1;
			for (const e of input.store
				.unknownClaimsInRange(focus.startSourceTimeSec, focus.endSourceTimeSec)
				.slice(0, 2)) {
				pushAction({
					tool: "get_evidence_for_event",
					eventId: e.id,
					why: "VERIFICATION: unresolved claim provenance",
				});
			}
		}
	}

	// Settings-style: prefer contradiction over verification promotion
	if (/\bsettings?\b/i.test(input.userMessage) && intents.includes("contradiction_check")) {
		pushRole(
			"CONTRADICTION_CHECK",
			"Settings keyword coincidence → contradiction, not verify-open",
		);
	}

	pushRole("STOP", "Plan complete — runner may stop earlier on sufficient evidence");

	let stopHint: RolePolicyPlan["stopHint"] = "continue";
	if (speechPrimary && speechCount > 0 && visualCount === 0 && ocrCount === 0) {
		stopHint = "sufficient_after_plan";
	}
	if (actions.length <= 1 && !speechPrimary) {
		stopHint = "insufficient_after_plan";
	}

	return {
		providerId: INVESTIGATOR_V1_1_PROVIDER_ID,
		intents,
		roles,
		transitions,
		candidates,
		ranked,
		focus,
		actions,
		skippedIrrelevant,
		lazyScheduledClaimIds,
		stopHint,
		additionalModelCalls: 0,
		planningMs: performance.now() - t0,
	};
}

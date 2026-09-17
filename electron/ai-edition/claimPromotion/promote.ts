/**
 * Build claim promotion set from ledger + specialist + investigation evidence.
 * Deterministic. 0 additional LLM calls.
 */

import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { InvestigationEvidenceSet } from "../videoInvestigator/types";
import type { VisualSpecialistResult } from "../visualSpecialist/types";
import { claimIdentityKey, normalizeSubject } from "./identity";
import {
	decideKeywordCoincidenceAction,
	decidePassiveVisibility,
	decideSpeechAssertion,
	decideVisibleText,
	initialStatusForKind,
	looksLikeActionHypothesis,
} from "./rules";
import type {
	ClaimHistoryEntry,
	ClaimKind,
	ClaimPromotionMetrics,
	ClaimPromotionSet,
	ClaimPromotionStatus,
	ClaimProvenanceLink,
	PromotedClaim,
} from "./types";
import { CLAIM_PROMOTION_PROVIDER_ID } from "./types";

let claimSeq = 0;
function nextClaimId(): string {
	claimSeq += 1;
	return `pc_${claimSeq}`;
}

export function resetClaimPromotionSeqForTests(): void {
	claimSeq = 0;
}

function nowIso(): string {
	return new Date().toISOString();
}

function history(
	from: ClaimPromotionStatus | null,
	to: ClaimPromotionStatus,
	ruleId: string,
	reason: string,
	evidenceIds: string[],
): ClaimHistoryEntry {
	return { atIso: nowIso(), from, to, reason, ruleId, evidenceIds };
}

function mergeProvenance(
	a: ClaimProvenanceLink[],
	b: ClaimProvenanceLink[],
): ClaimProvenanceLink[] {
	const seen = new Set(a.map((p) => `${p.kind}:${p.evidenceId}`));
	const out = [...a];
	for (const p of b) {
		const k = `${p.kind}:${p.evidenceId}`;
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(p);
	}
	return out;
}

function upsert(
	byKey: Map<string, PromotedClaim>,
	draft: Omit<PromotedClaim, "id"> & { id?: string },
): PromotedClaim {
	const existing = byKey.get(draft.identityKey);
	if (existing) {
		existing.provenance = mergeProvenance(existing.provenance, draft.provenance);
		if (draft.status !== existing.status) {
			existing.history.push(
				history(
					existing.status,
					draft.status,
					draft.history[draft.history.length - 1]?.ruleId ?? "dedupe_merge",
					draft.history[draft.history.length - 1]?.reason ?? "Merged duplicate identity",
					draft.provenance.map((p) => p.evidenceId),
				),
			);
			existing.status = draft.status;
			existing.verificationLevel = draft.verificationLevel;
		} else {
			existing.history.push(...draft.history.slice(1));
		}
		existing.lazyVerified = existing.lazyVerified || draft.lazyVerified;
		return existing;
	}
	const claim: PromotedClaim = {
		id: draft.id ?? nextClaimId(),
		identityKey: draft.identityKey,
		assetId: draft.assetId,
		kind: draft.kind,
		text: draft.text,
		subject: draft.subject,
		startSourceTimeSec: draft.startSourceTimeSec,
		endSourceTimeSec: draft.endSourceTimeSec,
		status: draft.status,
		verificationLevel: draft.verificationLevel,
		isActionClaim: draft.isActionClaim,
		provenance: draft.provenance,
		history: draft.history,
		lazyVerified: draft.lazyVerified,
	};
	byKey.set(claim.identityKey, claim);
	return claim;
}

function isRestartTooltipText(text: string): boolean {
	return /restart\s+recording/i.test(text);
}

function isUpworkSubject(text: string): boolean {
	return /\bupwork\b/i.test(text);
}

function isSettingsSubject(text: string): boolean {
	return /\bsettings?\b/i.test(text);
}

export function buildClaimPromotionSet(input: {
	ledger: TemporalEventLedger;
	specialist?: VisualSpecialistResult | null;
	investigation?: InvestigationEvidenceSet | null;
	/** When true, deep-verify only claims relevant to this query. */
	userQuery?: string;
	lazy?: boolean;
}): ClaimPromotionSet {
	const t0 = performance.now();
	const assetId = input.ledger.meta.assetId;
	const byKey = new Map<string, PromotedClaim>();
	const notes: string[] = [];
	let promotions = 0;
	let demotions = 0;
	let created = 0;
	let lazySkipped = 0;
	let lazyEvaluated = 0;

	const query = (input.userQuery ?? "").toLowerCase();
	const lazy = input.lazy !== false;
	const queryCaresAbout = (subjects: string[]): boolean => {
		if (!lazy || !query.trim()) return true;
		return subjects.some((s) => s && query.includes(s.toLowerCase()));
	};

	const idMs0 = performance.now();

	// --- From ledger events ---
	for (const ev of input.ledger.events) {
		const baseProv: ClaimProvenanceLink[] = [
			{
				evidenceId: ev.id,
				kind: "ledger_event",
				sourceTimeSec: ev.startSourceTimeSec,
				endSourceTimeSec: ev.endSourceTimeSec,
				refs: ev.evidence,
			},
		];

		if (ev.type === "observed_visible_text" || ev.type === "observed_ui_state") {
			const text =
				ev.claims.find((c) => c.epistemic === "observed")?.text ??
				ev.summary.replace(/^Observed (?:visible text|UI):\s*/i, "");
			const subject = normalizeSubject(text);
			const kind: ClaimKind = isRestartTooltipText(text)
				? "temporary_ui_visibility"
				: "visible_text";
			const temporary =
				kind === "temporary_ui_visibility" ||
				Boolean(
					ev.evidence.some((r) => r.changeClassification && r.changeClassification !== "minimal"),
				);
			const decision = decideVisibleText({
				text,
				temporaryUiConfirmed: temporary,
				actionEvidence: false,
			});
			if (decision.promoted) promotions += 1;
			created += 1;
			upsert(byKey, {
				identityKey: claimIdentityKey({
					kind,
					assetId,
					subject,
					startSourceTimeSec: ev.startSourceTimeSec,
					endSourceTimeSec: ev.endSourceTimeSec,
					isActionClaim: false,
				}),
				assetId,
				kind,
				text: `Visible text "${text}"`,
				subject,
				startSourceTimeSec: ev.startSourceTimeSec,
				endSourceTimeSec: ev.endSourceTimeSec,
				status: decision.status,
				verificationLevel: decision.verificationLevel,
				isActionClaim: false,
				provenance: baseProv,
				history: [
					history(
						null,
						initialStatusForKind(kind),
						"create_from_ledger",
						"Created from ledger OCR/UI event",
						[ev.id],
					),
					history(initialStatusForKind(kind), decision.status, decision.ruleId, decision.reason, [
						ev.id,
					]),
				],
				lazyVerified: true,
			});

			// Explicit action claim remains UNKNOWN / not verified from OCR alone.
			if (isRestartTooltipText(text)) {
				created += 1;
				const actionDecision = decideVisibleText({
					text,
					temporaryUiConfirmed: false,
					actionEvidence: false,
				});
				upsert(byKey, {
					identityKey: claimIdentityKey({
						kind: "user_action",
						assetId,
						subject: "restart recording",
						startSourceTimeSec: ev.startSourceTimeSec,
						endSourceTimeSec: ev.endSourceTimeSec,
						isActionClaim: true,
					}),
					assetId,
					kind: "user_action",
					text: "User restarted the recording",
					subject: "restart recording",
					startSourceTimeSec: ev.startSourceTimeSec,
					endSourceTimeSec: ev.endSourceTimeSec,
					status: "unknown",
					verificationLevel: "unsupported",
					isActionClaim: true,
					provenance: baseProv,
					history: [
						history(null, "unknown", "ocr_not_action", "OCR tooltip ≠ user restarted recording", [
							ev.id,
						]),
					],
					lazyVerified: true,
				});
				void actionDecision;
			}
		}

		if (ev.type === "passive_chrome") {
			const nameMatch = ev.summary.match(/Passive chrome:\s*([^(]+)/i);
			const name = nameMatch?.[1]?.trim() ?? "app";
			const subject = normalizeSubject(name);
			const decision = decidePassiveVisibility({
				subject: name,
				hasOcrOrVision: true,
				hasActionEvidence: false,
			});
			if (decision.promoted) promotions += 1;
			created += 1;
			upsert(byKey, {
				identityKey: claimIdentityKey({
					kind: "passive_app_visibility",
					assetId,
					subject,
					startSourceTimeSec: ev.startSourceTimeSec,
					endSourceTimeSec: ev.endSourceTimeSec,
					isActionClaim: false,
				}),
				assetId,
				kind: "passive_app_visibility",
				text: `Passive visibility: ${name}`,
				subject,
				startSourceTimeSec: ev.startSourceTimeSec,
				endSourceTimeSec: ev.endSourceTimeSec,
				status: decision.status,
				verificationLevel: decision.verificationLevel,
				isActionClaim: false,
				provenance: baseProv,
				history: [
					history(null, "observed", "create_passive", "Passive chrome observation", [ev.id]),
					history("observed", decision.status, decision.ruleId, decision.reason, [ev.id]),
				],
				lazyVerified: true,
			});

			// Hard regression: Upwork (and any passive app) action claim stays not verified.
			created += 1;
			upsert(byKey, {
				identityKey: claimIdentityKey({
					kind: "navigation_action",
					assetId,
					subject,
					startSourceTimeSec: ev.startSourceTimeSec,
					endSourceTimeSec: ev.endSourceTimeSec,
					isActionClaim: true,
				}),
				assetId,
				kind: "navigation_action",
				text: `User opened or worked in ${name}`,
				subject,
				startSourceTimeSec: ev.startSourceTimeSec,
				endSourceTimeSec: ev.endSourceTimeSec,
				status: "unknown",
				verificationLevel: "unsupported",
				isActionClaim: true,
				provenance: baseProv,
				history: [
					history(
						null,
						"unknown",
						"passive_not_action",
						`"${name}" visibility ≠ open/navigate/work without interaction evidence.`,
						[ev.id],
					),
				],
				lazyVerified: !lazy || queryCaresAbout([name, subject, "upwork"]),
			});
			if (lazy && !queryCaresAbout([name, subject, "upwork"])) lazySkipped += 1;
			else lazyEvaluated += 1;
		}

		if (ev.type === "speech" || ev.type === "spoken_correction") {
			const spoken = ev.claims.find((c) => c.epistemic === "spoken")?.text ?? ev.summary;
			const kind: ClaimKind =
				ev.type === "spoken_correction" ? "spoken_correction" : "speech_assertion";
			const decision = decideSpeechAssertion({
				hasSupportingVisualState: false,
				hasContradictingVisual: false,
			});
			created += 1;
			upsert(byKey, {
				identityKey: claimIdentityKey({
					kind,
					assetId,
					subject: normalizeSubject(spoken).slice(0, 60),
					startSourceTimeSec: ev.startSourceTimeSec,
					endSourceTimeSec: ev.endSourceTimeSec,
					isActionClaim: false,
				}),
				assetId,
				kind,
				text: spoken,
				subject: normalizeSubject(spoken).slice(0, 60),
				startSourceTimeSec: ev.startSourceTimeSec,
				endSourceTimeSec: ev.endSourceTimeSec,
				status: decision.status,
				verificationLevel: decision.verificationLevel,
				isActionClaim: false,
				provenance: baseProv,
				history: [history(null, "spoken", "create_speech", "Speech evidence retained", [ev.id])],
				lazyVerified: true,
			});
		}

		if (ev.type === "contradiction") {
			const decision = decideSpeechAssertion({
				hasSupportingVisualState: false,
				hasContradictingVisual: true,
			});
			if (decision.demoted) demotions += 1;
			created += 1;
			upsert(byKey, {
				identityKey: claimIdentityKey({
					kind: "user_action",
					assetId,
					subject: normalizeSubject(ev.summary).slice(0, 60),
					startSourceTimeSec: ev.startSourceTimeSec,
					endSourceTimeSec: ev.endSourceTimeSec,
					isActionClaim: true,
				}),
				assetId,
				kind: "user_action",
				text: ev.summary,
				subject: normalizeSubject(ev.summary).slice(0, 60),
				startSourceTimeSec: ev.startSourceTimeSec,
				endSourceTimeSec: ev.endSourceTimeSec,
				status: decision.status,
				verificationLevel: decision.verificationLevel,
				isActionClaim: true,
				provenance: baseProv,
				history: [
					history(
						null,
						"inferred",
						"create_contradiction_candidate",
						"Action hypothesis from speech",
						[ev.id],
					),
					history("inferred", decision.status, decision.ruleId, decision.reason, [ev.id]),
				],
				lazyVerified: true,
			});
		}

		if (ev.type === "visual_transition" || ev.type === "observed_visual_diff") {
			created += 1;
			upsert(byKey, {
				identityKey: claimIdentityKey({
					kind: "visual_change",
					assetId,
					subject: "visual_change",
					startSourceTimeSec: ev.startSourceTimeSec,
					endSourceTimeSec: ev.endSourceTimeSec,
					isActionClaim: false,
				}),
				assetId,
				kind: "visual_change",
				text: ev.summary,
				subject: "visual_change",
				startSourceTimeSec: ev.startSourceTimeSec,
				endSourceTimeSec: ev.endSourceTimeSec,
				status: "supported",
				verificationLevel: "single_source",
				isActionClaim: false,
				provenance: baseProv,
				history: [
					history(null, "observed", "create_visual_change", "Pixel/visual change observation", [
						ev.id,
					]),
					history(
						"observed",
						"supported",
						"visual_change_supported",
						"Material visual change supported; semantic cause unknown without recognition.",
						[ev.id],
					),
				],
				lazyVerified: true,
			});
			promotions += 1;
		}
	}

	const identityMs = performance.now() - idMs0;
	const promoMs0 = performance.now();

	// --- Specialist OCR observations (provenance chain) ---
	if (input.specialist) {
		const ocrByPath = new Map(input.specialist.ocrResults.map((r) => [r.imagePath, r] as const));
		for (const obs of input.specialist.observations) {
			const joined = (obs.ocr?.joinedText ?? obs.text ?? "").trim();
			if (!joined) continue;
			const text = joined;
			const subject = normalizeSubject(text);
			const imagePath = obs.region?.imagePath;
			const ocrFull = imagePath ? ocrByPath.get(imagePath) : undefined;
			const crop = input.specialist.crops.find(
				(c) => c.imagePath === imagePath || Math.abs(c.sourceTimeSec - obs.sourceTimeSec) < 0.05,
			);
			const cropId = crop?.id ?? imagePath ?? obs.id;
			const prov: ClaimProvenanceLink[] = [
				{
					evidenceId: obs.id,
					kind: "visual_observation",
					sourceTimeSec: obs.sourceTimeSec,
					endSourceTimeSec: obs.endSourceTimeSec,
					note: imagePath ? `frame=${imagePath}` : undefined,
				},
			];
			if (obs.ocr) {
				prov.push({
					evidenceId: `${obs.id}:ocr`,
					kind: "ocr_result",
					sourceTimeSec: obs.sourceTimeSec,
					note: `engine=${obs.ocr.engine};status=${ocrFull?.status ?? "available"}`,
				});
			}
			if (crop) {
				prov.push({
					evidenceId: cropId,
					kind: "source_crop",
					sourceTimeSec: obs.sourceTimeSec,
					note: `roi=${JSON.stringify(crop.crop)}; ${crop.width}x${crop.height}; fromSource=${crop.fromSourceMedia}`,
				});
			}

			const temporary = isRestartTooltipText(text) || obs.kind === "temporary_ui_interval";
			const decision = decideVisibleText({
				text,
				temporaryUiConfirmed: temporary,
				actionEvidence: false,
			});
			if (decision.promoted) promotions += 1;
			created += 1;
			upsert(byKey, {
				identityKey: claimIdentityKey({
					kind: temporary ? "temporary_ui_visibility" : "visible_text",
					assetId,
					subject,
					startSourceTimeSec: obs.sourceTimeSec,
					endSourceTimeSec: obs.endSourceTimeSec ?? obs.sourceTimeSec,
					isActionClaim: false,
				}),
				assetId,
				kind: temporary ? "temporary_ui_visibility" : "visible_text",
				text: `Visible text "${text}"`,
				subject,
				startSourceTimeSec: obs.sourceTimeSec,
				endSourceTimeSec: obs.endSourceTimeSec ?? obs.sourceTimeSec,
				status: decision.status,
				verificationLevel: decision.verificationLevel,
				isActionClaim: false,
				provenance: prov,
				history: [
					history(null, "observed", "create_from_specialist_ocr", "OCR observation", [obs.id]),
					history("observed", decision.status, decision.ruleId, decision.reason, [
						obs.id,
						...(obs.ocr ? [`${obs.id}:ocr`] : []),
						...(crop ? [cropId] : []),
					]),
				],
				lazyVerified: true,
			});

			if (isUpworkSubject(text)) {
				created += 1;
				upsert(byKey, {
					identityKey: claimIdentityKey({
						kind: "navigation_action",
						assetId,
						subject: "upwork",
						startSourceTimeSec: obs.sourceTimeSec,
						endSourceTimeSec: obs.sourceTimeSec,
						isActionClaim: true,
					}),
					assetId,
					kind: "navigation_action",
					text: "User opened or navigated to Upwork",
					subject: "upwork",
					startSourceTimeSec: obs.sourceTimeSec,
					endSourceTimeSec: obs.sourceTimeSec,
					status: "unknown",
					verificationLevel: "unsupported",
					isActionClaim: true,
					provenance: prov,
					history: [
						history(
							null,
							"unknown",
							"upwork_ocr_not_navigation",
							'OCR "Upwork" → observed/supported visibility only; not verified navigation.',
							[obs.id],
						),
					],
					lazyVerified: !lazy || queryCaresAbout(["upwork"]),
				});
				if (lazy && !queryCaresAbout(["upwork"])) lazySkipped += 1;
				else lazyEvaluated += 1;
			}

			if (isRestartTooltipText(text)) {
				created += 1;
				upsert(byKey, {
					identityKey: claimIdentityKey({
						kind: "user_action",
						assetId,
						subject: "restart recording",
						startSourceTimeSec: obs.sourceTimeSec,
						endSourceTimeSec: obs.sourceTimeSec,
						isActionClaim: true,
					}),
					assetId,
					kind: "user_action",
					text: "User restarted the recording",
					subject: "restart recording",
					startSourceTimeSec: obs.sourceTimeSec,
					endSourceTimeSec: obs.sourceTimeSec,
					status: "unknown",
					verificationLevel: "unsupported",
					isActionClaim: true,
					provenance: prov,
					history: [
						history(
							null,
							"unknown",
							"restart_ocr_not_action",
							'OCR "Restart recording" → temporary UI visibility; action remains unverified.',
							[obs.id],
						),
					],
					lazyVerified: true,
				});
			}
		}
	}

	// --- Settings keyword coincidence (speech + OCR without verified state) ---
	const settingsSpeech = input.ledger.events.some(
		(e) =>
			(e.type === "speech" || e.type === "spoken_correction" || e.type === "contradiction") &&
			isSettingsSubject(e.summary),
	);
	const settingsVisible = [...byKey.values()].some(
		(c) => !c.isActionClaim && c.subject && isSettingsSubject(c.subject),
	);
	if (settingsSpeech || settingsVisible) {
		const decision = decideKeywordCoincidenceAction({
			keywordVisible: settingsVisible,
			speechMentions: settingsSpeech,
			verifiedTargetState: false,
		});
		if (decision.demoted) demotions += 1;
		created += 1;
		const tSpeech =
			input.ledger.events.find(
				(e) => (e.type === "speech" || e.type === "contradiction") && isSettingsSubject(e.summary),
			)?.startSourceTimeSec ?? 0;
		upsert(byKey, {
			identityKey: claimIdentityKey({
				kind: "user_action",
				assetId,
				subject: "settings",
				startSourceTimeSec: tSpeech,
				endSourceTimeSec: tSpeech,
				isActionClaim: true,
			}),
			assetId,
			kind: "user_action",
			text: "User opened Settings",
			subject: "settings",
			startSourceTimeSec: tSpeech,
			endSourceTimeSec: tSpeech,
			status: decision.status === "spoken" ? "spoken" : decision.status,
			verificationLevel: decision.verificationLevel,
			isActionClaim: true,
			provenance: [],
			history: [
				history(null, "inferred", "settings_action_candidate", "Settings action hypothesis", []),
				history("inferred", decision.status, decision.ruleId, decision.reason, []),
			],
			lazyVerified: !lazy || queryCaresAbout(["settings"]),
		});
	}

	// --- Investigation contradictions reinforce demotion ---
	if (input.investigation) {
		for (const c of input.investigation.claims) {
			if (c.verdict !== "contradicted" && c.verdict !== "not_verified") continue;
			if (!looksLikeActionHypothesis(c.hypothesis) && c.verdict !== "contradicted") continue;
			const subject = normalizeSubject(c.hypothesis).slice(0, 60);
			created += 1;
			const status: ClaimPromotionStatus =
				c.verdict === "contradicted" ? "contradicted" : "unknown";
			if (status === "contradicted") demotions += 1;
			upsert(byKey, {
				identityKey: claimIdentityKey({
					kind: "user_action",
					assetId,
					subject,
					startSourceTimeSec: input.investigation.focusRange.startSourceTimeSec,
					endSourceTimeSec: input.investigation.focusRange.endSourceTimeSec,
					isActionClaim: true,
				}),
				assetId,
				kind: "user_action",
				text: c.hypothesis,
				subject,
				startSourceTimeSec: input.investigation.focusRange.startSourceTimeSec,
				endSourceTimeSec: input.investigation.focusRange.endSourceTimeSec,
				status,
				verificationLevel: status === "contradicted" ? "contradicted" : "unsupported",
				isActionClaim: true,
				provenance: [
					{
						evidenceId: c.id,
						kind: "investigation_observation",
						note: c.rationale,
						refs: c.evidence,
					},
				],
				history: [history(null, status, "investigation_verdict", c.rationale, [c.id])],
				lazyVerified: true,
			});
		}
	}

	const promotionMs = performance.now() - promoMs0;
	const claims = [...byKey.values()].sort(
		(a, b) => a.startSourceTimeSec - b.startSourceTimeSec || a.id.localeCompare(b.id),
	);

	notes.push(
		`Claim promotion V1: ${claims.length} claims after dedupe; promotions=${promotions}; demotions=${demotions}; lazySkipped=${lazySkipped}.`,
	);
	notes.push("Persistence: turn-local / derived from ledger+specialist (not AxcutDocument).");

	const metrics: ClaimPromotionMetrics = {
		claimsCreated: created,
		claimsAfterDedupe: claims.length,
		promotions,
		demotions,
		lazySkipped,
		lazyEvaluated,
		identityMs,
		promotionMs,
		totalMs: performance.now() - t0,
		additionalModelCalls: 0,
		providerId: CLAIM_PROMOTION_PROVIDER_ID,
	};

	return {
		version: 1,
		assetId,
		timebase: "SOURCE_MEDIA_TIME",
		claims,
		metrics,
		internalNotes: notes,
	};
}

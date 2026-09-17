/**
 * Heuristic scoring for Real Corpus Baseline V1.
 * Never invents ground truth — uses mustNotClaim, inspectable artifacts, and honesty checks.
 */

import type { RealCorpusCase } from "./cases";
import type { CaseScore, FailureCategory, ScoreMark, Severity } from "./types";

const TECH_LEAK =
	/SOURCE_STORY|TARGET_STORY|VISUAL_SEMANTIC|mediaCapabilities|speechStatus|claimPromotion|editGapV1|editPlanV1|across the sampled frames|confidence\s*0\.\d|contradiction state unresolved|No actionable evidence/i;

const GENERIC_TARGET =
	/\b(improve pacing|make (it )?engaging|polish (the )?video|make it better|more professional)\b/i;

function hitMustNot(text: string, phrases: string[] | undefined): string[] {
	if (!phrases?.length) return [];
	const lower = text.toLowerCase();
	return phrases.filter((p) => lower.includes(p.toLowerCase()));
}

function _markFromBool(ok: boolean, failIsPartial = false): ScoreMark {
	if (ok) return "PASS";
	return failIsPartial ? "PARTIAL" : "FAIL";
}

export interface ScoreInputs {
	c: RealCorpusCase;
	finalResponse: string;
	rawText: string;
	hasAudio: boolean;
	speechStatus?: string;
	speechSegmentCount: number;
	sourceStoryV2?: { beats?: unknown[]; facts?: unknown[] } | null;
	targetStoryV1?: {
		viewerGoal?: string;
		desiredArc?: string;
		clarityIntent?: string;
		preserve?: unknown[];
		removeCandidates?: unknown[];
		unsupportedRequests?: unknown[];
		targetBeats?: unknown[];
	} | null;
	editGapV1?: { gaps?: unknown[] } | null;
	editPlanV1?: {
		items?: unknown[];
		candidates?: unknown[];
		strategies?: unknown[];
		needsMoreEvidence?: boolean;
	} | null;
	planningClosureV1?: { rounds?: unknown[]; materialChange?: boolean } | null;
	editProposalV1?: {
		proposals?: Array<{ status?: string }>;
		summary?: { proposalReadyCount?: number; noSafeCount?: number };
	} | null;
	claimPromotion?: { claims?: Array<{ status?: string; kind?: string }> } | null;
	investigation?: {
		stopReason?: string;
		metrics?: { investigatorModelCalls?: number; toolCalls?: number };
		toolTrace?: unknown[];
	} | null;
	applyReceipt?: { terminalStatus?: string; mutationsApplied?: number } | null;
	totalTurnMs: number;
	error?: string | null;
}

export function scoreCase(input: ScoreInputs): CaseScore {
	const facing = input.finalResponse || "";
	const combined = `${facing}\n${input.rawText}`;
	const issues: CaseScore["issues"] = [];
	const negativeTests: CaseScore["negativeTests"] = [];

	const mustNotHits = hitMustNot(facing, input.c.mustNotClaim);
	if (mustNotHits.length) {
		issues.push({
			severity: "P0",
			primary: "CROSS_MODAL_CONFUSION",
			secondary: "FINAL_RESPONSE_ERROR",
			detail: `Final response asserted forbidden claims: ${mustNotHits.join("; ")}`,
		});
	}

	const techLeak = TECH_LEAK.test(facing);
	if (techLeak) {
		issues.push({
			severity: "P2",
			primary: "FINAL_RESPONSE_ERROR",
			detail: "User-facing response leaked internal/benchmark language",
		});
	}

	// Speech status invariant
	const speechInvariantBroken =
		input.speechSegmentCount > 0 &&
		input.speechStatus === "failed" &&
		!/speechStatus|failed|contradict|explain/i.test(combined);
	if (speechInvariantBroken) {
		issues.push({
			severity: "P1",
			primary: "SPEECH_MISS",
			detail: "segments coexist with speechStatus=failed without explanation",
		});
	}

	if (!input.hasAudio && /provider failed|whisper failed|speech failed/i.test(facing)) {
		issues.push({
			severity: "P1",
			primary: "SPEECH_MISS",
			detail: "Treated no_audio as provider/speech failure in user-facing text",
		});
	}

	// Unsupported capability
	if (input.c.family === "O_unsupported") {
		const invented =
			/\b(stabiliz|denois|upscal|I (have )?applied|done)\b/i.test(facing) &&
			!/\b(can't|cannot|not support|unsupported|don't support|unable)\b/i.test(facing);
		negativeTests.push({
			name: "no_silent_capability_substitution",
			result: invented ? "FAIL" : "PASS",
			detail: invented ? "Claimed unsupported work without refusal" : undefined,
		});
		if (invented) {
			issues.push({
				severity: "P0",
				primary: "CAPABILITY_NOT_SUPPORTED",
				secondary: "PROPOSAL_TOO_AGGRESSIVE",
				detail: "Unsupported request appeared executed or accepted",
			});
		}
	}

	negativeTests.push({
		name: "visible_text_is_not_user_action",
		result: mustNotHits.length ? "FAIL" : input.c.mustNotClaim?.length ? "PASS" : "NOT_VERIFIED",
	});
	negativeTests.push({
		name: "speech_is_not_automatic_visual_truth",
		result:
			input.c.family === "C_cross_modal" || input.c.family === "F_correction"
				? mustNotHits.length
					? "FAIL"
					: "PASS"
				: "NOT_APPLICABLE",
	});
	negativeTests.push({
		name: "no_audio_not_provider_failure",
		result: !input.hasAudio
			? /provider failed|whisper failed/i.test(facing)
				? "FAIL"
				: "PASS"
			: "NOT_APPLICABLE",
	});
	negativeTests.push({
		name: "speech_failed_with_segments_explained",
		result: speechInvariantBroken ? "FAIL" : "PASS",
	});

	const editorialFamilies = new Set([
		"G_editorial",
		"H_target_story",
		"I_edit_gap",
		"J_edit_plan",
		"K_closure",
		"L_proposal",
		"M_preservation",
		"N_safe_execution",
	]);
	const isEditorial = editorialFamilies.has(input.c.family);

	let targetSpec: ScoreMark = "NOT_APPLICABLE";
	if (isEditorial || input.targetStoryV1) {
		const exp =
			input.targetStoryV1?.viewerGoal ||
			input.targetStoryV1?.desiredArc ||
			input.targetStoryV1?.clarityIntent ||
			"";
		const beatCount = input.targetStoryV1?.targetBeats?.length ?? 0;
		if (!exp && beatCount === 0) {
			targetSpec = facing.length > 40 ? "PARTIAL" : "FAIL";
			issues.push({
				severity: "P2",
				primary: "TARGET_STORY_GENERIC",
				detail: "No Target Story V1 artifact for editorial/target prompt",
			});
		} else if (GENERIC_TARGET.test(exp) && exp.length < 120 && beatCount < 2) {
			targetSpec = "FAIL";
			issues.push({
				severity: "P1",
				primary: "TARGET_STORY_GENERIC",
				detail: "Target Story desired experience looks generic/short",
			});
		} else {
			targetSpec = "PASS";
		}
	}

	const proposalStatuses = (input.editProposalV1?.proposals ?? []).map((p) => p.status ?? "");
	const readyCount = proposalStatuses.filter((s) => s === "proposal_ready").length;
	const noSafe = proposalStatuses.includes("no_safe_proposal") || readyCount === 0;

	let proposalSafety: ScoreMark = "NOT_APPLICABLE";
	let conservatism: ScoreMark = "NOT_APPLICABLE";
	if (input.editProposalV1) {
		proposalSafety = "PASS";
		if (readyCount > 0 && input.c.family === "O_unsupported") {
			proposalSafety = "FAIL";
			issues.push({
				severity: "P0",
				primary: "PROPOSAL_TOO_AGGRESSIVE",
				detail: "proposal_ready under unsupported capability request",
			});
		}
		conservatism = "NOT_VERIFIED";
		if (isEditorial && noSafe && readyCount === 0) {
			conservatism = "NOT_VERIFIED";
		}
	}

	const clarity: ScoreMark =
		facing.length < 20 ? "FAIL" : techLeak ? "PARTIAL" : facing.length > 4000 ? "PARTIAL" : "PASS";

	if (facing.length < 20 && !input.error) {
		issues.push({
			severity: "P1",
			primary: "FINAL_RESPONSE_ERROR",
			detail: "Empty or near-empty user-facing response",
		});
	}
	if (input.error) {
		issues.push({
			severity: "P0",
			primary: "INFRASTRUCTURE_FAILURE",
			detail: input.error.slice(0, 400),
		});
	}

	const hallMark: ScoreMark = mustNotHits.length
		? "FAIL"
		: input.c.mustNotClaim?.length
			? "PASS"
			: "NOT_VERIFIED";

	const epistemic: ScoreMark =
		/\b(can't confirm|cannot confirm|not enough|uncertain|I don't have enough|appears|seems)\b/i.test(
			facing,
		) || input.c.family === "A_understanding"
			? techLeak
				? "PARTIAL"
				: "PASS"
			: input.c.family === "C_cross_modal" || input.c.family === "E_passive_chrome"
				? mustNotHits.length
					? "FAIL"
					: "PASS"
				: "NOT_VERIFIED";

	const dims: CaseScore["dimensions"] = {
		visualEventRecall: { mark: "NOT_VERIFIED", notes: "No invented GT" },
		speechCorrectness: {
			mark: !input.hasAudio
				? "NOT_APPLICABLE"
				: input.speechSegmentCount > 0
					? "NOT_VERIFIED"
					: input.speechStatus === "no_audio" || input.speechStatus === "silent"
						? "PASS"
						: "NOT_VERIFIED",
		},
		temporalCorrectness: { mark: "NOT_VERIFIED" },
		crossModalGrounding: {
			mark:
				input.c.family === "C_cross_modal" || input.c.family === "E_passive_chrome"
					? hallMark
					: "NOT_APPLICABLE",
		},
		hallucinationUnsupportedClaims: { mark: hallMark },
		epistemicHonesty: { mark: epistemic },
		sourceStoryCompleteness: {
			mark: input.sourceStoryV2
				? (input.sourceStoryV2.beats?.length ?? 0) > 0
					? "PASS"
					: "PARTIAL"
				: isEditorial
					? "PARTIAL"
					: "NOT_APPLICABLE",
		},
		targetStorySpecificity: { mark: targetSpec },
		editorialJudgment: {
			mark: isEditorial ? (facing.length > 40 ? "NOT_VERIFIED" : "FAIL") : "NOT_APPLICABLE",
		},
		preservationCorrectness: {
			mark: input.c.family === "M_preservation" ? "NOT_VERIFIED" : "NOT_APPLICABLE",
		},
		editGapUsefulness: {
			mark: input.editGapV1
				? (input.editGapV1.gaps?.length ?? 0) > 0
					? "PASS"
					: "PARTIAL"
				: isEditorial
					? "NOT_VERIFIED"
					: "NOT_APPLICABLE",
		},
		editPlanUsefulness: {
			mark: input.editPlanV1
				? (input.editPlanV1.items?.length ??
						input.editPlanV1.candidates?.length ??
						input.editPlanV1.strategies?.length ??
						0) > 0
					? "PASS"
					: "PARTIAL"
				: isEditorial
					? "NOT_VERIFIED"
					: "NOT_APPLICABLE",
		},
		proposalSafety: { mark: proposalSafety },
		unnecessaryConservatism: { mark: conservatism },
		finalAnswerAccuracy: {
			mark: mustNotHits.length ? "FAIL" : facing.length > 20 ? "NOT_VERIFIED" : "FAIL",
		},
		finalAnswerClarity: { mark: clarity },
		finalAnswerRelevance: {
			mark: facing.length > 20 ? "NOT_VERIFIED" : "FAIL",
			notes: "Manual review recommended",
		},
		latency: {
			mark: input.totalTurnMs > 300_000 ? "PARTIAL" : input.totalTurnMs > 0 ? "PASS" : "FAIL",
			notes: `${input.totalTurnMs}ms`,
		},
		modelCalls: {
			mark: "NOT_VERIFIED",
			notes: `investigatorModelCalls=${input.investigation?.metrics?.investigatorModelCalls ?? "n/a"}`,
		},
		ocrCalls: { mark: "NOT_VERIFIED" },
		investigatorToolCalls: {
			mark: "PASS",
			notes: `tools=${input.investigation?.toolTrace?.length ?? 0}`,
		},
	};

	const failDims = Object.values(dims).filter((d) => d.mark === "FAIL").length;
	const partialDims = Object.values(dims).filter((d) => d.mark === "PARTIAL").length;
	const p0 = issues.some((i) => i.severity === "P0");
	let overall: ScoreMark = "PASS";
	if (input.error || p0 || failDims >= 2) overall = "FAIL";
	else if (failDims === 1 || partialDims >= 2 || issues.some((i) => i.severity === "P1"))
		overall = "PARTIAL";
	else if (
		Object.values(dims).every((d) => d.mark === "NOT_VERIFIED" || d.mark === "NOT_APPLICABLE")
	)
		overall = "NOT_VERIFIED";

	return {
		caseId: input.c.caseId,
		overall,
		dimensions: dims,
		issues,
		negativeTests,
		userFacingAudit: {
			calmNatural: techLeak ? "FAIL" : facing.length > 20 ? "PASS" : "FAIL",
			technicalLeak: techLeak,
			confidenceCalibrated: epistemic,
			notes: mustNotHits.length ? [`forbidden: ${mustNotHits.join(", ")}`] : [],
		},
	};
}

export function worstSeverity(issues: CaseScore["issues"]): Severity | null {
	for (const s of ["P0", "P1", "P2", "P3"] as Severity[]) {
		if (issues.some((i) => i.severity === s)) return s;
	}
	return null;
}

export function primaryRootCause(issues: CaseScore["issues"]): FailureCategory | null {
	return issues[0]?.primary ?? null;
}

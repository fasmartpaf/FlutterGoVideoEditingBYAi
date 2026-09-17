/**
 * Adapters: existing local signals → findings (+ optional recommendation seeds).
 */

import type {
	ConfidenceClass,
	EditorialFindingV1,
	EditorialOrchestrationPolicy,
	EditorialRecommendationV1,
	EditorialSignalBundle,
	ExecutionReadiness,
} from "./types";

let findingSeq = 0;
let recSeq = 0;

export function resetOrchestrationSeqForTests(): void {
	findingSeq = 0;
	recSeq = 0;
}

function fid(prefix: string): string {
	findingSeq += 1;
	return `find_${prefix}_${findingSeq}`;
}

function rid(prefix: string): string {
	recSeq += 1;
	return `rec_${prefix}_${recSeq}`;
}

function fmtSec(n: number): string {
	const s = Math.round(n * 10) / 10;
	return Number.isInteger(s) ? `${s}` : s.toFixed(1);
}

export function adaptDeadAir(bundle: EditorialSignalBundle): {
	findings: EditorialFindingV1[];
	seeds: EditorialRecommendationV1[];
} {
	const findings: EditorialFindingV1[] = [];
	const seeds: EditorialRecommendationV1[] = [];
	for (const c of bundle.deadAir?.candidates ?? []) {
		const conf: ConfidenceClass = c.safeToPropose
			? "HIGH"
			: c.blockingReasons.length
				? "MEDIUM"
				: "LOW";
		const fId = fid("pacing");
		findings.push({
			id: fId,
			category: "PACING",
			sourceRange: { startSec: c.startSec, endSec: c.endSec },
			findingType: "PACING_GAP",
			severity: c.durationSec >= 1.2 ? "MEDIUM" : "LOW",
			confidence: conf,
			evidence: [{ kind: "dead_air_candidate", id: c.id, note: c.classification }],
			constraints: c.blockingReasons,
			recommendationCandidate: c.safeToPropose ? "TRIM" : "NONE",
			reason: c.safeToPropose
				? `${fmtSec(c.durationSec)}-second low-activity pause between speech segments`
				: `Pause observed but not safe to trim (${c.blockingReasons.join(", ") || "blocked"})`,
		});
		if (c.safeToPropose) {
			seeds.push({
				id: rid("trim"),
				operationFamily: "TRIM",
				sourceRange: { startSec: c.startSec, endSec: c.endSec },
				rationale: findings[findings.length - 1]!.reason,
				reviewCopy: `Shorten a ${fmtSec(c.durationSec)}-second pause around ${fmtSec(c.startSec)} seconds.`,
				evidenceRefs: [{ kind: "dead_air_candidate", id: c.id }],
				confidence: "HIGH",
				expectedBenefit: "Tighter pacing without removing speech",
				risk: "LOW",
				prerequisites: [],
				conflictsWith: [],
				dependencies: [],
				verifiedApplyCapability: "READY",
				recommendationStatus: "RECOMMEND",
				executionReadiness: "READY_TO_APPLY",
				expectedOperationType: "addTrim",
				missingParameters: [],
				findingIds: [fId],
			});
		} else {
			seeds.push({
				id: rid("trim_block"),
				operationFamily: "TRIM",
				sourceRange: { startSec: c.startSec, endSec: c.endSec },
				rationale: findings[findings.length - 1]!.reason,
				reviewCopy: "A pause was detected, but it is not safe to shorten automatically.",
				evidenceRefs: [{ kind: "dead_air_candidate", id: c.id }],
				confidence: conf,
				expectedBenefit: "None — preservation wins",
				risk: "HIGH",
				prerequisites: [],
				conflictsWith: [],
				dependencies: [],
				verifiedApplyCapability: "PARTIAL",
				recommendationStatus: "DO_NOT_RECOMMEND",
				executionReadiness: "UNSUPPORTED",
				expectedOperationType: "addTrim",
				missingParameters: c.blockingReasons,
				findingIds: [fId],
			});
		}
	}
	return { findings, seeds };
}

export function adaptLoudness(bundle: EditorialSignalBundle): {
	findings: EditorialFindingV1[];
	seeds: EditorialRecommendationV1[];
} {
	const findings: EditorialFindingV1[] = [];
	const seeds: EditorialRecommendationV1[] = [];
	const L = bundle.loudness;
	if (!L) return { findings, seeds };
	const fId = fid("audio");
	const cls = L.classification;
	if (cls === "ALREADY_ACCEPTABLE") {
		findings.push({
			id: fId,
			category: "AUDIO",
			findingType: "LOUDNESS_ACCEPTABLE",
			severity: "LOW",
			confidence: "HIGH",
			evidence: [{ kind: "loudness_classification", id: cls }],
			constraints: [],
			recommendationCandidate: "NONE",
			reason: "Programme loudness is already within the acceptable band",
		});
		return { findings, seeds };
	}
	if (cls === "NO_AUDIO" || cls === "INSUFFICIENT_ANALYSIS" || cls === "UNSUPPORTED_COMPLEX_MIX") {
		findings.push({
			id: fId,
			category: "AUDIO",
			findingType: `LOUDNESS_${cls}`,
			severity: "LOW",
			confidence: "HIGH",
			evidence: [{ kind: "loudness_classification", id: cls }],
			constraints: L.blockingReasons ?? [],
			recommendationCandidate: "NONE",
			reason: `Loudness normalize not applicable (${cls})`,
		});
		seeds.push({
			id: rid("loud_skip"),
			operationFamily: "LOUDNESS",
			rationale: findings[0]!.reason,
			reviewCopy: "No loudness change is recommended for this recording.",
			evidenceRefs: [{ kind: "loudness_classification", id: cls }],
			confidence: "HIGH",
			expectedBenefit: "None",
			risk: "LOW",
			prerequisites: [],
			conflictsWith: [],
			dependencies: [],
			verifiedApplyCapability: "UNSUPPORTED",
			recommendationStatus: "DO_NOT_RECOMMEND",
			executionReadiness: "UNSUPPORTED",
			missingParameters: [],
			findingIds: [fId],
		});
		return { findings, seeds };
	}
	if (cls === "TRUE_PEAK_RISK" || cls === "DYNAMIC_RANGE_CONCERN") {
		findings.push({
			id: fId,
			category: "AUDIO",
			findingType: `LOUDNESS_${cls}`,
			severity: "MEDIUM",
			confidence: "MEDIUM",
			evidence: [{ kind: "loudness_classification", id: cls }],
			constraints: L.blockingReasons ?? [],
			recommendationCandidate: "LOUDNESS",
			reason: `Loudness concern (${cls}) needs human judgment`,
		});
		seeds.push({
			id: rid("loud_human"),
			operationFamily: "LOUDNESS",
			rationale: findings[0]!.reason,
			reviewCopy:
				"Audio levels look risky to change automatically — review peaks before normalizing.",
			evidenceRefs: [{ kind: "loudness_classification", id: cls }],
			confidence: "MEDIUM",
			expectedBenefit: "Safer listening levels if handled carefully",
			risk: "HIGH",
			prerequisites: [],
			conflictsWith: [],
			dependencies: [],
			verifiedApplyCapability: "PARTIAL",
			recommendationStatus: "NEEDS_HUMAN_JUDGMENT",
			executionReadiness: "NEEDS_HUMAN_SELECTION",
			missingParameters: ["human_peak_decision"],
			findingIds: [fId],
		});
		return { findings, seeds };
	}
	// TOO_QUIET / TOO_LOUD
	findings.push({
		id: fId,
		category: "AUDIO",
		findingType: `LOUDNESS_${cls}`,
		severity: "MEDIUM",
		confidence: L.safeToPropose ? "HIGH" : "MEDIUM",
		evidence: [{ kind: "loudness_classification", id: cls }],
		constraints: L.blockingReasons ?? [],
		recommendationCandidate: "LOUDNESS",
		reason: `Measured loudness classification ${cls}`,
	});
	const gain = L.estimatedGainDb;
	const gainBit = typeof gain === "number" ? ` by about ${Math.abs(gain).toFixed(1)} dB` : "";
	seeds.push({
		id: rid("loud"),
		operationFamily: "LOUDNESS",
		rationale: findings[0]!.reason,
		reviewCopy:
			cls === "TOO_QUIET"
				? `Raise programme loudness${gainBit} while staying below the peak limit.`
				: `Lower programme loudness${gainBit} toward a safer level.`,
		evidenceRefs: [{ kind: "loudness_classification", id: cls }],
		confidence: L.safeToPropose ? "HIGH" : "MEDIUM",
		expectedBenefit: "More consistent playback loudness",
		risk: "LOW",
		prerequisites: [],
		conflictsWith: [],
		dependencies: [],
		verifiedApplyCapability: L.safeToPropose ? "READY" : "PARTIAL",
		recommendationStatus: L.safeToPropose ? "RECOMMEND" : "DO_NOT_RECOMMEND",
		executionReadiness: L.safeToPropose ? "READY_TO_APPLY" : "UNSUPPORTED",
		expectedOperationType: "loudness_audioGainDb",
		missingParameters: L.safeToPropose ? [] : (L.blockingReasons ?? ["unsafe"]),
		findingIds: [fId],
	});
	return { findings, seeds };
}

export function adaptCaptions(
	bundle: EditorialSignalBundle,
	policy: EditorialOrchestrationPolicy,
): { findings: EditorialFindingV1[]; seeds: EditorialRecommendationV1[] } {
	const findings: EditorialFindingV1[] = [];
	const seeds: EditorialRecommendationV1[] = [];
	const C = bundle.captions;
	if (!C) return { findings, seeds };
	const fId = fid("cap");
	if (C.layoutStatus === "NO_SPEECH" || C.layoutStatus === "NO_TRANSCRIPT") {
		findings.push({
			id: fId,
			category: "CAPTIONS",
			findingType: "NO_SPEECH_FOR_CAPTIONS",
			severity: "LOW",
			confidence: "HIGH",
			evidence: [{ kind: "caption_layout", id: C.layoutStatus }],
			constraints: [],
			recommendationCandidate: "NONE",
			reason: "No usable narration transcript for captions",
		});
		return { findings, seeds };
	}
	if (C.alreadyEnabled) {
		findings.push({
			id: fId,
			category: "CAPTIONS",
			findingType: "CAPTIONS_ALREADY_ENABLED",
			severity: "LOW",
			confidence: "HIGH",
			evidence: [{ kind: "caption_settings", id: "enabled" }],
			constraints: [],
			recommendationCandidate: "NONE",
			reason: "Captions are already enabled",
		});
		return { findings, seeds };
	}
	if (C.layoutStatus === "NO_SAFE_LAYOUT" || C.manualConflict) {
		findings.push({
			id: fId,
			category: "CAPTIONS",
			findingType: "CAPTIONS_UNSAFE",
			severity: "MEDIUM",
			confidence: "HIGH",
			evidence: [{ kind: "caption_layout", id: C.layoutStatus }],
			constraints: C.manualConflict ? ["manual_caption_conflict"] : ["no_safe_layout"],
			recommendationCandidate: "NONE",
			reason: C.manualConflict
				? "Manual captions/text conflict with auto layout"
				: "No safe caption placement found",
		});
		seeds.push({
			id: rid("cap_block"),
			operationFamily: "CAPTIONS",
			rationale: findings[0]!.reason,
			reviewCopy: "Captions cannot be added safely automatically.",
			evidenceRefs: [{ kind: "caption_layout", id: C.layoutStatus }],
			confidence: "HIGH",
			expectedBenefit: "None",
			risk: "HIGH",
			prerequisites: [],
			conflictsWith: [],
			dependencies: [],
			verifiedApplyCapability: "PARTIAL",
			recommendationStatus: "DO_NOT_RECOMMEND",
			executionReadiness: "UNSUPPORTED",
			expectedOperationType: "enableCaptions",
			missingParameters: findings[0]!.constraints,
			findingIds: [fId],
		});
		return { findings, seeds };
	}
	if (C.layoutStatus === "ok" && C.cueCount > 0 && C.safeToPropose) {
		const dur = C.speechDurationSec ?? 0;
		const stronger = Boolean(bundle.intents?.wantCaptions);
		findings.push({
			id: fId,
			category: "CAPTIONS",
			findingType: "CAPTIONS_AVAILABLE",
			severity: "LOW",
			confidence: "HIGH",
			evidence: [{ kind: "caption_layout", id: "ok", note: `${C.cueCount} cues` }],
			constraints: [],
			recommendationCandidate: "CAPTIONS",
			reason: `Captions available for about ${fmtSec(dur)} seconds of narration`,
		});
		seeds.push({
			id: rid("cap"),
			operationFamily: "CAPTIONS",
			rationale: findings[0]!.reason,
			reviewCopy:
				dur > 0
					? `Captions are available for ${fmtSec(dur)} seconds of narration.`
					: "Captions are available for this narration.",
			evidenceRefs: [{ kind: "caption_layout", id: "ok" }],
			confidence: "HIGH",
			expectedBenefit: "On-screen narration from the transcript",
			risk: "LOW",
			prerequisites: [],
			conflictsWith: [],
			dependencies: [],
			verifiedApplyCapability: "READY",
			recommendationStatus: stronger || !policy.captionsDefaultOptional ? "RECOMMEND" : "OPTIONAL",
			executionReadiness: "READY_TO_APPLY",
			expectedOperationType: "enableCaptions",
			missingParameters: [],
			findingIds: [fId],
		});
	}
	return { findings, seeds };
}

export function adaptVisual(
	bundle: EditorialSignalBundle,
	policy: EditorialOrchestrationPolicy,
): { findings: EditorialFindingV1[]; seeds: EditorialRecommendationV1[] } {
	const findings: EditorialFindingV1[] = [];
	const seeds: EditorialRecommendationV1[] = [];
	const V = bundle.visual;
	if (!V) return { findings, seeds };

	for (const a of V.activityRanges) {
		const fId = fid("vis");
		findings.push({
			id: fId,
			category: "VISUAL_FOCUS",
			sourceRange: { startSec: a.startSec, endSec: a.endSec },
			findingType: "VISUAL_ACTIVITY_PRESENT",
			severity: "LOW",
			confidence: "MEDIUM",
			evidence: [{ kind: "visual_activity", id: a.reason }],
			constraints: ["activity_alone_is_not_a_zoom_target"],
			recommendationCandidate: "NONE",
			reason: `Visual activity (${a.reason}) between ${fmtSec(a.startSec)}–${fmtSec(a.endSec)}s — not a zoom prescription`,
		});
	}

	for (const t of V.focalTargets ?? []) {
		const fId = fid("focal");
		findings.push({
			id: fId,
			category: "VISUAL_FOCUS",
			sourceRange: { startSec: t.startSec, endSec: t.endSec },
			findingType: "FOCAL_TARGET",
			severity: "MEDIUM",
			confidence: "HIGH",
			evidence: [{ kind: "focal_target", id: t.id, note: t.kind }],
			constraints: [],
			recommendationCandidate: policy.zoomRequiresFocalTarget ? "ZOOM" : "NONE",
			reason: `Known focal target (${t.kind}) at ${fmtSec(t.startSec)}–${fmtSec(t.endSec)}s`,
		});
		if (policy.zoomRequiresFocalTarget) {
			seeds.push({
				id: rid("zoom"),
				operationFamily: "ZOOM",
				sourceRange: { startSec: t.startSec, endSec: t.endSec },
				rationale: findings[findings.length - 1]!.reason,
				reviewCopy: `Emphasize the known focus area around ${fmtSec(t.startSec)} seconds.`,
				evidenceRefs: [{ kind: "focal_target", id: t.id }],
				confidence: "HIGH",
				expectedBenefit: "Highlight the identified on-screen target",
				risk: "MEDIUM",
				prerequisites: ["depth", "focus"],
				conflictsWith: [],
				dependencies: [],
				verifiedApplyCapability: "READY",
				recommendationStatus: "RECOMMEND",
				executionReadiness: "READY_TO_APPLY",
				expectedOperationType: "addZoom",
				missingParameters: [],
				findingIds: [fId],
			});
		}
	}

	// Activity without focal → finding only (Precision Closure).
	// Surface layer emits at most one unresolved question — never a ZOOM card.

	for (const fr of V.framingEvidence ?? []) {
		const fId = fid("frame");
		findings.push({
			id: fId,
			category: "FRAMING",
			findingType: "FRAMING_EVIDENCE",
			severity: "MEDIUM",
			confidence: "HIGH",
			evidence: [{ kind: "framing", id: fr.id, note: fr.kind }],
			constraints: [],
			recommendationCandidate: "CROP",
			reason: fr.note,
		});
		if (policy.cropRequiresFramingEvidence && fr.crop) {
			seeds.push({
				id: rid("crop"),
				operationFamily: "CROP",
				rationale: fr.note,
				reviewCopy: "Crop the frame using the measured unused margins / aspect constraint.",
				evidenceRefs: [{ kind: "framing", id: fr.id }],
				confidence: "HIGH",
				expectedBenefit: "Tighter framing for the output aspect",
				risk: "MEDIUM",
				prerequisites: ["clipId", "crop"],
				conflictsWith: [],
				dependencies: [],
				verifiedApplyCapability: "READY",
				recommendationStatus: "RECOMMEND",
				executionReadiness: "READY_TO_APPLY",
				expectedOperationType: "setClipCrop",
				missingParameters: [],
				findingIds: [fId],
			});
		}
	}

	if (!V.framingEvidence?.length && !bundle.intents?.cropForAspect) {
		// Explicit restraint finding — no crop seed
		findings.push({
			id: fid("crop_none"),
			category: "FRAMING",
			findingType: "NO_CROP_EVIDENCE",
			severity: "LOW",
			confidence: "HIGH",
			evidence: [],
			constraints: ["crop_requires_framing_evidence"],
			recommendationCandidate: "NONE",
			reason: "No deterministic framing evidence for crop",
		});
	}

	return { findings, seeds };
}

export function adaptSpeedIntent(
	bundle: EditorialSignalBundle,
	policy: EditorialOrchestrationPolicy,
): { findings: EditorialFindingV1[]; seeds: EditorialRecommendationV1[] } {
	const findings: EditorialFindingV1[] = [];
	const seeds: EditorialRecommendationV1[] = [];
	if (!policy.speedRequiresExplicitIntent) return { findings, seeds };
	if (bundle.intents?.speed || bundle.intents?.targetDurationSec != null) {
		const fId = fid("speed");
		findings.push({
			id: fId,
			category: "PACING",
			findingType: "SPEED_INTENT",
			severity: "MEDIUM",
			confidence: "MEDIUM",
			evidence: [{ kind: "intent", id: "speed" }],
			constraints: [],
			recommendationCandidate: "SPEED",
			reason: "Explicit speed / duration intent present",
		});
		// If a silence gap exists, attach SPEED to that range so redundancy vs TRIM can fire.
		const gap = bundle.deadAir?.candidates?.[0];
		seeds.push({
			id: rid("speed"),
			operationFamily: "SPEED",
			sourceRange: gap ? { startSec: gap.startSec, endSec: gap.endSec } : undefined,
			rationale: findings[0]!.reason,
			reviewCopy: "A speed change was requested — choose the rate carefully.",
			evidenceRefs: [{ kind: "intent", id: "speed" }],
			confidence: "MEDIUM",
			expectedBenefit: "Meet an explicit duration/speed goal",
			risk: "HIGH",
			prerequisites: ["speed", "landing"],
			conflictsWith: [],
			dependencies: [],
			verifiedApplyCapability: "PARTIAL",
			recommendationStatus: "NEEDS_HUMAN_JUDGMENT",
			executionReadiness: "MISSING_ARGS",
			expectedOperationType: "addSpeed",
			missingParameters: ["speed"],
			findingIds: [fId],
		});
	} else {
		findings.push({
			id: fid("speed_none"),
			category: "PACING",
			findingType: "NO_SPEED_INTENT",
			severity: "LOW",
			confidence: "HIGH",
			evidence: [],
			constraints: ["speed_requires_explicit_intent"],
			recommendationCandidate: "NONE",
			reason: "No explicit speed intent — do not fabricate a speed edit",
		});
	}
	return { findings, seeds };
}

export function adaptPreservation(bundle: EditorialSignalBundle): {
	findings: EditorialFindingV1[];
	preserved: EditorialFindingV1[];
} {
	const findings: EditorialFindingV1[] = [];
	for (const p of bundle.preservation ?? []) {
		findings.push({
			id: fid("pres"),
			category: "PRESERVATION",
			sourceRange: { startSec: p.startSec, endSec: p.endSec },
			findingType: `PRESERVE_${p.kind.toUpperCase()}`,
			severity: "HIGH",
			confidence: "HIGH",
			evidence: [{ kind: "preservation", id: p.id, note: p.kind }],
			constraints: [p.reason],
			recommendationCandidate: "NONE",
			reason: p.reason,
		});
	}
	for (const q of bundle.unresolved ?? []) {
		findings.push({
			id: fid("unres"),
			category: "UNKNOWN",
			findingType: "UNRESOLVED_QUESTION",
			severity: "MEDIUM",
			confidence: "LOW",
			evidence: [{ kind: "unresolved", id: q }],
			constraints: ["do_not_invent_ui_actions"],
			recommendationCandidate: "NONE",
			reason: q,
		});
	}
	return { findings, preserved: findings.filter((f) => f.category === "PRESERVATION") };
}

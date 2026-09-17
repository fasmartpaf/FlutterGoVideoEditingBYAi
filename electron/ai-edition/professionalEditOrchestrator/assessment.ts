/**
 * Final assessment + user-facing copy (editor language; only claim committed work).
 */

import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { LoudnessCoordinationResultV1 } from "./loudnessCoord";
import type {
	DurationObjectiveAssessmentV1,
	ProfessionalEditExecutionSessionV1,
	ProfessionalEditFinalAssessmentV1,
	ProfessionalEditIntentV1,
	ProfessionalEditPlanV1,
} from "./types";
import type { ProfessionalEditCapabilityUtilizationV1 } from "./utilization";
import type { FinalSequenceWarningDispositionV1 } from "./warningDisposition";

/** Families the Chat receipt may name. Must be present on the FINAL document. */
export type ReceiptMutationFamily =
	| "trim"
	| "zoom"
	| "crop"
	| "speed"
	| "captions"
	| "loudness"
	| "title"
	| "callout"
	| "transitions";

export function finalCommittedFamiliesFromDocument(
	document: AxcutDocument,
): Set<ReceiptMutationFamily> {
	const out = new Set<ReceiptMutationFamily>();
	if ((document.timeline?.trimRanges ?? []).length > 0) out.add("trim");
	if ((document.zoomRanges ?? []).length > 0) out.add("zoom");
	const speeds = document.timeline?.speedRanges ?? [];
	const legacy = (document.legacyEditor as Record<string, unknown> | null) ?? {};
	const speedRegions = Array.isArray(legacy.speedRegions) ? legacy.speedRegions : [];
	if (speeds.length > 0 || speedRegions.length > 0) out.add("speed");
	if (getCaptionSettings(document, 16 / 9).enabled) out.add("captions");
	if (typeof legacy.audioGainDb === "number" && Math.abs(legacy.audioGainDb) >= 0.5) {
		out.add("loudness");
	}
	for (const a of document.annotations ?? []) {
		if (a.annotationSource === "auto-caption") continue;
		if (a.type === "figure" || /callout/i.test(`${a.id ?? ""} ${a.annotationSource ?? ""}`)) {
			out.add("callout");
		} else {
			out.add("title");
		}
	}
	const clips = document.timeline?.clips ?? [];
	if (
		clips.some((c, i) => {
			if (i <= 0) return false;
			const t = c.incomingTransition;
			if (!t) return false;
			if (t.transitionId && t.transitionId !== "openscreen.cut") return true;
			return t.kind === "dissolve" && (t.durationSec ?? 0) > 0;
		})
	) {
		out.add("transitions");
	}
	return out;
}

export function claimedFamiliesFromReceipt(text: string): ReceiptMutationFamily[] {
	const claimed: ReceiptMutationFamily[] = [];
	if (
		/remov(?:ing|ed)\s+\d+\s+unnecessary pause/i.test(text) ||
		/removed unnecessary pauses/i.test(text)
	) {
		claimed.push("trim");
	}
	if (/speeding up a low-information stretch/i.test(text)) claimed.push("speed");
	if (/balancing the audio/i.test(text)) claimed.push("loudness");
	if (/enabling captions|enabled captions/i.test(text)) claimed.push("captions");
	if (/adding an opening title/i.test(text)) claimed.push("title");
	if (/highlighting an on-screen control/i.test(text)) claimed.push("callout");
	if (/tightening the view around the part of the screen/i.test(text)) claimed.push("zoom");
	if (
		/softening (?:a |the )?clip join with a (?:brief )?dissolve/i.test(text) ||
		/adding a (?:brief |subtle )?dissolve/i.test(text) ||
		/adding a subtle \w+ at a section change/i.test(text) ||
		/keeping most cuts clean and adding \d+ subtle transitions/i.test(text) ||
		/set a dissolve transition/i.test(text)
	) {
		claimed.push("transitions");
	}
	return claimed;
}

export function assertReceiptMatchesFinalDocument(args: {
	receipt: string;
	document: AxcutDocument;
}): {
	ok: boolean;
	extraClaims: ReceiptMutationFamily[];
	claimed: ReceiptMutationFamily[];
	final: ReceiptMutationFamily[];
} {
	const claimed = claimedFamiliesFromReceipt(args.receipt);
	const final = [...finalCommittedFamiliesFromDocument(args.document)];
	const extraClaims = claimed.filter((c) => !final.includes(c));
	const pauseCount = /removing (\d+) unnecessary pause/i.exec(args.receipt);
	if (pauseCount) {
		const n = Number(pauseCount[1]);
		const actual = (args.document.timeline?.trimRanges ?? []).length;
		if (n !== actual) extraClaims.push("trim");
	}
	return { ok: extraClaims.length === 0, extraClaims, claimed, final };
}

export function buildFinalAssessment(args: {
	intent: ProfessionalEditIntentV1;
	plan: ProfessionalEditPlanV1;
	session: ProfessionalEditExecutionSessionV1;
	originalDurationSec: number;
	finalDurationSec: number | null;
	finalSequenceQc: ProfessionalEditFinalAssessmentV1["finalSequenceQc"];
	duration: DurationObjectiveAssessmentV1;
	loudness?: LoudnessCoordinationResultV1 | null;
	warningDispositions?: FinalSequenceWarningDispositionV1[];
	capabilityUtilization?: ProfessionalEditCapabilityUtilizationV1;
	/** When set, Chat copy names only families still present on this document. */
	document?: AxcutDocument;
}): ProfessionalEditFinalAssessmentV1 {
	const onDoc = args.document ? finalCommittedFamiliesFromDocument(args.document) : null;
	const applied = args.session.completed
		.filter((c) => c.status === "committed")
		.map((c) => {
			const step = args.plan.steps.find((s) => s.stepId === c.stepId);
			if (!step) {
				if (c.stepId === "bounded_revision_enable_captions") return "captions:enableCaptions";
				return null;
			}
			if (onDoc && !onDoc.has(step.family as ReceiptMutationFamily)) return null;
			return `${step.family}:${step.operationType}`;
		})
		.filter((x): x is string => Boolean(x));
	if (args.loudness?.committed && (!onDoc || onDoc.has("loudness"))) {
		applied.push(`loudness:audioGainDb`);
	}

	const skipped = [
		...args.session.skipped.map((s) => ({
			family: args.plan.steps.find((x) => x.stepId === s.stepId)?.family ?? "other",
			reason: s.reason,
		})),
		...args.plan.requestedButUnsupported.map((f) => ({
			family: f,
			reason: "unsupported_verified_family",
		})),
	];
	for (const f of args.session.failed) {
		if (f.status === "rolled_back") {
			const step = args.plan.steps.find((x) => x.stepId === f.stepId);
			skipped.push({
				family: step?.family ?? "other",
				reason: `rolled_back:${f.reason.slice(0, 80)}`,
			});
		}
	}

	const warnings: string[] = [];
	if (args.duration.kind === "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS") {
		warnings.push(
			`Could not safely reach ${args.duration.targetMaxSec}s without cutting important speech; kept safe duration ~${args.duration.projectedSafeDurationSec.toFixed(1)}s.`,
		);
	}
	if (args.finalSequenceQc === "FAIL") {
		warnings.push("Final sequence join QC failed — result needs review.");
	}

	const materialFamilies = new Set(
		applied.map((a) => a.split(":")[0]).filter((f) => f && f !== "other"),
	);
	const materialTrimRemoved = args.session.completed.filter((c) => c.reason === "trim").length >= 1;
	const professionallyImproved =
		materialFamilies.size >= 2 ||
		(materialTrimRemoved &&
			(materialFamilies.has("captions") || materialFamilies.has("loudness"))) ||
		(materialTrimRemoved &&
			args.originalDurationSec - (args.finalDurationSec ?? args.originalDurationSec) >= 0.8);

	let professionalKind: NonNullable<ProfessionalEditFinalAssessmentV1["professionalKind"]> =
		"NO_MATERIAL_IMPROVEMENT_AVAILABLE";
	if (args.finalSequenceQc === "FAIL") {
		professionalKind = "NEEDS_REVIEW";
	} else if (professionallyImproved && applied.length > 0) {
		professionalKind = "PROFESSIONALLY_IMPROVED";
	} else if (applied.length > 0) {
		professionalKind = "TECHNICALLY_VERIFIED";
	}

	const trimCount = args.document
		? (args.document.timeline?.trimRanges ?? []).length
		: applied.filter((a) => a.startsWith("trim:")).length;
	const didCaptions = applied.some((a) => a.startsWith("captions:"));
	const didLoudness = applied.some((a) => a.startsWith("loudness:"));
	const didZoom = applied.some((a) => a.startsWith("zoom:"));
	const didSpeed = applied.some((a) => a.startsWith("speed:"));
	const didTitle = applied.some((a) => a.startsWith("title:"));
	const didCallout = applied.some((a) => a.startsWith("callout:"));
	const didTransition = applied.some((a) => a.startsWith("transitions:"));
	const captionsAlready =
		args.capabilityUtilization?.rows.find((r) => r.family === "captions")?.skippedReason ===
			"captions_already_enabled" ||
		args.capabilityUtilization?.rows.find((r) => r.family === "captions")?.skippedReason ===
			"CAPTIONS_ALREADY_GOOD";

	const trimSkip = args.capabilityUtilization?.rows.find((r) => r.family === "trim");
	const noSafeTrim =
		!trimCount &&
		(trimSkip?.skippedReason === "no_safe_dead_air" ||
			(trimSkip?.evidenceFound === true && !trimSkip.safeToApply));

	const parts: string[] = [];
	if (trimCount > 0) {
		parts.push(`removing ${trimCount} unnecessary pause${trimCount > 1 ? "s" : ""}`);
	}
	if (didSpeed) parts.push("speeding up a low-information stretch");
	if (didLoudness) parts.push("balancing the audio");
	if (didCaptions) parts.push("enabling captions");
	if (didTitle) parts.push("adding an opening title from the spoken intro");
	if (didCallout) parts.push("highlighting an on-screen control");
	if (didTransition) {
		const appliedIds = (args.document?.timeline?.clips ?? [])
			.slice(1)
			.map((c) => c.incomingTransition?.transitionId)
			.filter((id): id is string => Boolean(id) && id !== "openscreen.cut");
		if (appliedIds.length === 0) {
			// Applied in session but rolled back / not in final doc — do not claim.
		} else if (appliedIds.length === 1) {
			const name = appliedIds[0]!.replace(/^gl\.|^openscreen\./, "");
			parts.push(`adding a subtle ${name} at a section change where a soft join helps`);
		} else {
			parts.push(
				`keeping most cuts clean and adding ${appliedIds.length} subtle transitions only at clear section changes`,
			);
		}
	}
	if (didZoom) {
		parts.push("tightening the view around the part of the screen you were actively demonstrating");
	}

	let userFacingSummary: string;
	if (parts.length > 0) {
		const dur =
			trimCount > 0 && args.finalDurationSec != null
				? ` (now about ${args.finalDurationSec.toFixed(1)}s from ${args.originalDurationSec.toFixed(1)}s)`
				: "";
		userFacingSummary = `I improved the video by ${parts.join(", ")}${dur}.`;
		if (captionsAlready) {
			userFacingSummary += " Your existing captions were already in place, so I kept them.";
		}
		if (!didZoom) {
			userFacingSummary +=
				" I left the framing unchanged because I didn't find a zoom or crop that would clearly improve the recording.";
		}
		if (args.finalSequenceQc === "PASS" || args.finalSequenceQc === "PASS_WITH_WARNINGS") {
			userFacingSummary += " The final cut checked out.";
		} else if (args.finalSequenceQc === "FAIL") {
			userFacingSummary += " Please review the final cut — join checks flagged an issue.";
		}
		if (
			!didTransition &&
			(args.document?.timeline?.clips?.length ?? 0) > 1 &&
			(/\btransition|professional|you decide/i.test(args.intent.rawText) ||
				(args.intent.explicitlyRequestedFamilies ?? []).includes("transitions"))
		) {
			userFacingSummary +=
				" I kept the cuts clean because the joins read as continuous tutorial — decorating them would not help.";
		}
	} else {
		const reasons: string[] = [];
		const explicit = args.intent.explicitlyRequestedFamilies ?? [];
		const nearPause = args.intent.rawText.match(
			/\b(?:around|near|approx(?:imately)?|at|nearest to)\s+(\d+(?:\.\d+)?)\s*(?:s(?:ec(?:onds?)?)?)?\b/i,
		);
		const shortenNearMiss =
			Boolean(nearPause) &&
			!trimCount &&
			/\b(?:shorten|quiet pause|reduce\s+(?:the\s+)?(?:pause|silence))\b/i.test(
				args.intent.rawText,
			);
		if (shortenNearMiss) {
			userFacingSummary = `I couldn't find a clear pause around ${nearPause![1]} seconds to shorten.`;
		} else {
			if (explicit.includes("transitions") || /\btransition/i.test(args.intent.rawText)) {
				reasons.push(
					"I couldn't find a useful transition join in this cut, so I left transitions alone",
				);
			}
			if (explicit.includes("zoom") || /\bzoom|\bunzoom/i.test(args.intent.rawText)) {
				reasons.push(
					"I didn't find a grounded click or focus region that would clearly benefit from a zoom",
				);
			}
			if (noSafeTrim) {
				reasons.push(
					"the quiet stretches are too short to trim safely without removing a natural pause",
				);
			}
			if (args.loudness?.outcome === "ALREADY_ACCEPTABLE") {
				reasons.push("the audio is already in a good range");
			} else if (
				args.loudness &&
				!args.loudness.committed &&
				args.loudness.outcome !== "NOT_RUN" &&
				args.loudness.outcome !== "ALREADY_ACCEPTABLE"
			) {
				if (
					args.loudness.outcome === "BLOCKED_TRUE_PEAK" ||
					args.loudness.outcome === "UNSUPPORTED_COMPLEX_MIX"
				) {
					reasons.push("audio levels couldn't be adjusted safely");
				}
			}
			if (captionsAlready) {
				reasons.push("captions were already enabled");
			}
			if (reasons.length > 0) {
				userFacingSummary = `I reviewed the current cut. ${reasons.join(". ")}.`;
			} else {
				userFacingSummary =
					"I reviewed the recording and kept it unchanged because I didn't find a safe, recording-specific improvement beyond what's already there.";
			}
		}
	}

	if (
		args.duration.kind === "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS" &&
		args.duration.targetMaxSec != null
	) {
		if (args.intent.allowOptionalContentRemoval && parts.length > 0) {
			userFacingSummary += ` I shortened lower-value sections where I could; going all the way to ${args.duration.targetMaxSec}s would still cut into the main explanation.`;
		} else if (parts.length > 0) {
			userFacingSummary += ` A ${args.duration.targetMaxSec}-second cut would remove important speech, so I preserved the explanation.`;
		} else if (args.finalDurationSec != null) {
			userFacingSummary += ` I safely reduced it to about ${args.finalDurationSec.toFixed(1)} seconds. Going below ${args.duration.targetMaxSec} seconds would require removing part of the important explanation.`;
		}
	} else if (
		args.duration.kind === "ACHIEVABLE_WITH_OPTIONAL_CONTENT_REMOVAL" &&
		args.duration.targetMaxSec != null &&
		args.intent.allowOptionalContentRemoval &&
		parts.length > 0
	) {
		userFacingSummary += ` Working toward the ${args.duration.targetMaxSec}s target with the lower-value content you authorized cutting.`;
	}

	// Partial success: applied some families but not all explicitly requested.
	const explicitWant = args.intent.explicitlyRequestedFamilies ?? [];
	if (parts.length > 0 && explicitWant.length > 0) {
		if (
			explicitWant.includes("transitions") &&
			!applied.some((a) => a.startsWith("transitions:"))
		) {
			userFacingSummary +=
				" I left transitions unchanged because the current programme doesn't have a join where a dissolve would improve the cut.";
		}
		if (explicitWant.includes("zoom") && !didZoom) {
			userFacingSummary +=
				" I left zooming alone because I couldn't ground a useful focus region on the current programme.";
		}
	}

	userFacingSummary = userFacingSummary.replace(/\s+/g, " ").trim();

	return {
		requestedObjective: args.intent.rawText.slice(0, 200),
		achievedDurationSec: args.finalDurationSec,
		originalDurationSec: args.originalDurationSec,
		importantContentPreserved:
			args.duration.kind === "NOT_ACHIEVABLE_WITHOUT_IMPORTANT_CONTENT_LOSS" ? true : "unknown",
		operationsApplied: applied,
		operationsSkipped: skipped,
		unsupportedRequested: args.plan.requestedButUnsupported,
		finalSequenceQc: args.finalSequenceQc,
		warnings,
		anotherPassUseful:
			args.duration.kind === "ACHIEVABLE_WITH_OPTIONAL_CONTENT_REMOVAL" && applied.length > 0,
		userFacingSummary,
		professionalKind,
		warningDispositions: args.warningDispositions,
		capabilityUtilization: args.capabilityUtilization,
	};
}

export function buildAuthorizationAsk(plan: ProfessionalEditPlanV1): string {
	const families = [...new Set(plan.steps.map((s) => s.family))];
	const friendly = families
		.map((f) =>
			f === "trim"
				? "pause trims"
				: f === "captions"
					? "captions"
					: f === "loudness"
						? "audio balance"
						: f,
		)
		.join(", ");
	return (
		`I can apply ${plan.steps.length} safe improvement${plan.steps.length === 1 ? "" : "s"}` +
		(friendly ? ` (${friendly})` : "") +
		`. Say “yes”, “go ahead”, or “yes proceed” and I'll run them.`
	);
}

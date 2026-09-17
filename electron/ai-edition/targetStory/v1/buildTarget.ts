/**
 * Deterministic Target Story V1 builder from Source Story V2 + user intent.
 * 0 LLM calls for epistemic grounding / disposition.
 */

import type { SourceStoryV2, SourceStoryV2Beat } from "../../sourceStory/v2/types";
import { inferEditingIntentHints } from "../intent";
import type { EditingIntent } from "../types";
import { isPassiveAppContext, isRecordingChromeContext } from "./guards";
import type {
	TargetDisposition,
	TargetStoryInput,
	TargetStoryV1,
	TargetStoryV1Beat,
	TargetStoryV1Item,
	TargetStoryV1UnsupportedRequest,
} from "./types";
import { TARGET_STORY_V1_PROVIDER_ID } from "./types";

let seq = 0;
function nextId(prefix: string): string {
	seq += 1;
	return `${prefix}_${seq}`;
}

export function resetTargetStoryV1SeqForTests(): void {
	seq = 0;
}

function mapPurpose(hint: SourceStoryV2Beat["purposeHint"]): TargetStoryV1Beat["purpose"] {
	switch (hint) {
		case "intro":
			return "intro";
		case "setup":
			return "setup";
		case "explanation":
			return "explanation";
		case "demonstration":
		case "navigation":
			return "demonstration";
		case "transition":
		case "pause":
		case "repetition":
			return "transition";
		case "correction":
			return "explanation";
		case "result":
			return "result";
		case "outro":
			return "outro";
		default:
			return "other";
	}
}

function userMentions(needle: RegExp, intent: string): boolean {
	return needle.test(intent);
}

function detectUnsupportedRequests(
	userIntent: string,
	source: SourceStoryV2,
): TargetStoryV1UnsupportedRequest[] {
	const out: TargetStoryV1UnsupportedRequest[] = [];
	const lower = userIntent.toLowerCase();

	if (
		/\bsettings\b/i.test(userIntent) &&
		/\b(focus|show|feature|section|open)\b/i.test(userIntent)
	) {
		const hasVerifiedSettings = source.beats.some((b) =>
			b.facts.some(
				(f) =>
					/settings/i.test(f.text) && (f.epistemic === "verified" || f.epistemic === "supported"),
			),
		);
		const hasContradiction = source.contradictions.some((c) => /settings/i.test(c.claim));
		if (!hasVerifiedSettings || hasContradiction) {
			out.push({
				id: nextId("uns"),
				requestText: "Focus on / show Settings section",
				status: "requested_but_not_source_supported",
				note: "User asked about Settings, but Source Story has no verified Settings state (speech/OCR coincidence or contradiction only).",
			});
		}
	}

	if (/\bupwork\b/i.test(lower) && /\b(focus|show|workflow|work on|open)\b/i.test(lower)) {
		const onlyPassive = source.persistentContext.some((c) => /upwork/i.test(c.text));
		const hasAction = source.beats.some((b) =>
			b.actions.some((a) => /upwork/i.test(a.text) && a.epistemic === "verified"),
		);
		if (onlyPassive && !hasAction) {
			out.push({
				id: nextId("uns"),
				requestText: "Upwork workflow focus",
				status: "requested_but_not_source_supported",
				note: "Upwork appears only as passive chrome context in Source Story V2 — not a verified workflow.",
			});
		}
	}

	if (/\btestimonial|customer\s+story|product\s+launch\b/i.test(userIntent)) {
		out.push({
			id: nextId("uns"),
			requestText: "Repurpose as testimonial / launch",
			status: "requested_but_not_source_supported",
			note: "Source material is a screen recording; testimonial/launch content is not present unless evidenced.",
		});
	}

	return out;
}

function dispositionForBeat(
	beat: SourceStoryV2Beat,
	intent: EditingIntent,
	userIntent: string,
): {
	disposition: TargetDisposition;
	emphasize: string[];
	deEmphasize: string[];
	removeHints: string[];
	viewerShouldUnderstand: string;
	clarityIntent: string;
	pacingIntent: TargetStoryV1Beat["pacingIntent"];
} {
	const emphasize: string[] = [];
	const deEmphasize: string[] = [];
	const removeHints: string[] = [];

	const facts = beat.facts.map((f) => f.text);
	const spoken = beat.spoken.map((s) => s.text);
	const context = beat.context.filter(
		(c) => !isPassiveAppContext(c.text) || userMentions(/\bupwork\b/i, userIntent),
	);
	const recordingChrome = beat.context.filter((c) => isRecordingChromeContext(c.text));
	const passiveIgnored = beat.context.filter(
		(c) => isPassiveAppContext(c.text) && !userMentions(/\bupwork\b/i, userIntent),
	);

	for (const f of facts) emphasize.push(f.slice(0, 120));
	for (const s of beat.spoken) {
		if (s.kind === "spoken_correction") {
			emphasize.push(`Preserve corrected meaning: ${s.text.slice(0, 100)}`);
			deEmphasize.push("Initial mistaken wording before correction");
		} else if (s.kind === "spoken_intention") {
			emphasize.push(`Spoken meaning: ${s.text.slice(0, 100)}`);
		} else {
			emphasize.push(s.text.slice(0, 100));
		}
	}

	for (const c of recordingChrome) {
		if (
			intent.objective === "polish" ||
			intent.objective === "shorten" ||
			intent.objective === "clarify"
		) {
			removeHints.push(`Recording-control UI: ${c.text.slice(0, 80)}`);
			deEmphasize.push(c.text.slice(0, 80));
		} else {
			deEmphasize.push(c.text.slice(0, 80));
		}
	}

	for (const c of context) {
		if (!isRecordingChromeContext(c.text)) {
			deEmphasize.push(`Background context only: ${c.text.slice(0, 80)}`);
		}
	}

	for (const x of beat.contradictions) {
		deEmphasize.push(`Do not present as completed: ${x.text.slice(0, 100)}`);
	}

	for (const a of beat.actions) {
		deEmphasize.push(`Unknown action — not a target goal: ${a.text.slice(0, 100)}`);
	}

	void passiveIgnored;

	let disposition: TargetDisposition = "preserve";
	let pacingIntent: TargetStoryV1Beat["pacingIntent"] = "preserve";

	const isEditorial =
		intent.objective === "shorten" ||
		intent.objective === "polish" ||
		intent.objective === "clarify" ||
		intent.objective === "focus" ||
		/\bprofessional|engaging|cleaner|improve|safe\s+edits?\b/i.test(userIntent);

	const lowImportanceSpeech =
		beat.spoken.length > 0 &&
		beat.importance <= 2 &&
		beat.purposeHint !== "correction" &&
		beat.purposeHint !== "result" &&
		!beat.spoken.some((s) => s.kind === "spoken_correction");

	const pauseLike =
		beat.purposeHint === "pause" ||
		beat.purposeHint === "repetition" ||
		(!beat.spoken.length && !beat.facts.length && beat.importance <= 2);

	const chromeOnlyDistraction = recordingChrome.length > 0 && !facts.length && !spoken.length;

	if (removeHints.length && !facts.length && !spoken.length) {
		disposition = "remove_candidate";
		pacingIntent = "compress";
	} else if (intent.objective === "shorten" && pauseLike) {
		disposition = "de_emphasize";
		pacingIntent = "compress";
	} else if (intent.objective === "shorten" && beat.importance < 3 && !beat.spoken.length) {
		disposition = "de_emphasize";
		pacingIntent = "compress";
	} else if (intent.objective === "shorten" && lowImportanceSpeech) {
		// Keep meaning constraints via preserve list elsewhere; compress low-value talk.
		disposition = "de_emphasize";
		pacingIntent = "compress";
	} else if (chromeOnlyDistraction && isEditorial) {
		disposition = "remove_candidate";
		pacingIntent = "compress";
	} else if (recordingChrome.length && isEditorial && (facts.length || spoken.length)) {
		disposition = "de_emphasize";
		pacingIntent = "compress";
	} else if (beat.contradictions.length && !facts.length) {
		disposition = "de_emphasize";
	} else if (
		isEditorial &&
		beat.purposeHint === "transition" &&
		beat.importance <= 2 &&
		!beat.spoken.some((s) => s.kind === "spoken_correction")
	) {
		disposition = "de_emphasize";
		pacingIntent = "compress";
	} else if (
		(intent.objective === "polish" || intent.objective === "clarify") &&
		passiveIgnored.length > 0 &&
		!facts.length &&
		!spoken.length
	) {
		disposition = "de_emphasize";
	}

	// Polish/custom editorial: still mark pacing compress on speech beats so Gap
	// can diagnose friction without inventing zooms (clarity/pacing, not focus).
	if (intent.objective === "shorten") {
		pacingIntent = pacingIntent === "preserve" ? "compress" : pacingIntent;
	}
	if (
		(intent.objective === "polish" || /\bengag|cleaner|professional\b/i.test(userIntent)) &&
		pacingIntent === "preserve" &&
		(recordingChrome.length > 0 || pauseLike || lowImportanceSpeech)
	) {
		pacingIntent = "compress";
		if (disposition === "preserve" && (pauseLike || chromeOnlyDistraction || lowImportanceSpeech)) {
			disposition = "de_emphasize";
		}
	}
	if (/\bengag/i.test(userIntent) && beat.importance >= 4) pacingIntent = "expand_attention";

	const viewerShouldUnderstand =
		[
			...spoken.slice(0, 1).map((t) => `Spoken: ${t.slice(0, 100)}`),
			...facts.slice(0, 1).map((t) => `Visible/supported: ${t.slice(0, 100)}`),
			...beat.contradictions
				.slice(0, 1)
				.map((x) => `Avoid implying completed action: ${x.text.slice(0, 80)}`),
			...beat.actions
				.slice(0, 1)
				.map((a) => `Do not treat as verified action: ${a.text.slice(0, 80)}`),
		]
			.filter(Boolean)
			.join(" ") || beat.summary.slice(0, 160);

	const clarityIntent =
		beat.contradictions.length || beat.actions.length
			? "Keep viewer understanding honest: do not imply unsupported actions."
			: intent.desiredQualities.includes("clarity")
				? "Make this phase easy to follow."
				: "Keep communication clear.";

	return {
		disposition,
		emphasize: [...new Set(emphasize)].slice(0, 6),
		deEmphasize: [...new Set(deEmphasize)].slice(0, 6),
		removeHints: [...new Set(removeHints)].slice(0, 4),
		viewerShouldUnderstand,
		clarityIntent,
		pacingIntent,
	};
}

function buildArc(source: SourceStoryV2, intent: EditingIntent): string {
	const parts = source.beats.map((b) => b.purposeHint).filter((p, i, a) => a.indexOf(p) === i);
	const base = parts.length
		? `Viewer arc follows evidence-backed phases: ${parts.slice(0, 6).join(" → ")}.`
		: "Viewer arc follows sparse evidence-backed moments.";
	if (intent.objective === "shorten") {
		return `${base} Compress low-importance pauses while preserving essential spoken meaning and supported visuals.`;
	}
	if (intent.objective === "polish") {
		return `${base} Professional pacing: intentional transitions, clear focus, minimize recording chrome distractions.`;
	}
	if (intent.objective === "clarify") {
		return `${base} Clarify topic progression; preserve corrections; avoid unsupported action implications.`;
	}
	return base;
}

/**
 * Build TargetStoryV1. Deterministic. 0 additional LLM calls.
 */
export function buildTargetStoryV1(input: TargetStoryInput): TargetStoryV1 {
	const t0 = performance.now();
	seq = 0;
	const source = input.sourceStoryV2;
	const editingIntent = input.editingIntent ?? inferEditingIntentHints(input.userIntent);
	if (input.explicitConstraints?.length) {
		editingIntent.constraints = [
			...new Set([...editingIntent.constraints, ...input.explicitConstraints]),
		];
	}

	const unsupportedRequests = detectUnsupportedRequests(input.userIntent, source);
	const preserve: TargetStoryV1Item[] = [];
	const deEmphasize: TargetStoryV1Item[] = [];
	const removeCandidates: TargetStoryV1Item[] = [];
	const unresolved: TargetStoryV1["unresolved"] = [];
	const targetBeats: TargetStoryV1Beat[] = [];

	// Passive Upwork context: never a target beat unless user asks
	for (const c of source.persistentContext) {
		if (isPassiveAppContext(c.text) && !userMentions(/\bupwork\b/i, input.userIntent)) {
			deEmphasize.push({
				id: nextId("de"),
				disposition: "de_emphasize",
				text: `Ignore passive context for target experience: ${c.text}`,
				sourceBeatIds: [],
				reason: "Passive chrome visibility ≠ workflow goal",
			});
			continue;
		}
	}

	for (const corr of source.corrections) {
		preserve.push({
			id: nextId("pv"),
			disposition: "preserve",
			text: `Preserve corrected spoken meaning (“${corr.toText.slice(0, 80)}”); de-emphasize superseded intent (“${corr.fromText.slice(0, 60)}”)`,
			sourceBeatIds: [],
			reason: "Source Story V2 correction",
		});
		deEmphasize.push({
			id: nextId("de"),
			disposition: "de_emphasize",
			text: `Initial mistaken wording: ${corr.fromText.slice(0, 100)}`,
			sourceBeatIds: [],
			reason: "Superseded by correction",
		});
	}

	for (const xd of source.contradictions) {
		unresolved.push({
			id: nextId("ur"),
			kind: "contradiction",
			text: `Final story must avoid presenting as completed: ${xd.claim}`,
			sourceBeatIds: [],
		});
	}

	for (const u of source.unresolved) {
		if (u.kind === "unresolved_action" || u.epistemic === "unknown") {
			unresolved.push({
				id: nextId("ur"),
				kind: "unresolved_action",
				text: `Unknown/unsupported action cannot become a target goal: ${u.text}`,
			});
		}
	}

	for (const uns of unsupportedRequests) {
		unresolved.push({
			id: nextId("ur"),
			kind: "requested_but_not_source_supported",
			text: uns.note,
		});
	}

	for (const beat of source.beats) {
		const d = dispositionForBeat(beat, editingIntent, input.userIntent);

		// Skip pure passive-upwork beats when not requested
		const onlyPassiveUpwork =
			!beat.facts.length &&
			!beat.spoken.length &&
			beat.context.every((c) => isPassiveAppContext(c.text)) &&
			!userMentions(/\bupwork\b/i, input.userIntent);
		if (onlyPassiveUpwork) continue;

		const tb: TargetStoryV1Beat = {
			id: `tb${targetBeats.length + 1}`,
			sourceBeatIds: [beat.id],
			purpose: mapPurpose(beat.purposeHint),
			viewerShouldUnderstand: d.viewerShouldUnderstand,
			emphasize: d.emphasize,
			deEmphasize: d.deEmphasize,
			pacingIntent: d.pacingIntent,
			clarityIntent: d.clarityIntent,
			disposition: d.disposition,
			confidence:
				beat.contradictions.length || beat.actions.length
					? "low"
					: beat.facts.length || beat.spoken.length
						? "medium"
						: "low",
			provenance: {
				sourceBeatIds: [beat.id],
				sourceFactIds: beat.facts.map((f) => f.id),
				sourceContextIds: beat.context.map((c) => c.id),
				correctionIds: source.corrections
					.filter(
						(c) =>
							c.startSourceTimeSec <= beat.endSourceTimeSec &&
							c.endSourceTimeSec >= beat.startSourceTimeSec,
					)
					.map((c) => c.id),
				contradictionIds: beat.contradictions.map((c) => c.id),
			},
		};
		targetBeats.push(tb);

		if (d.disposition === "preserve") {
			preserve.push({
				id: nextId("pv"),
				disposition: "preserve",
				text: beat.summary.slice(0, 160),
				sourceBeatIds: [beat.id],
				reason: "Evidence-backed source beat",
			});
		} else if (d.disposition === "de_emphasize") {
			deEmphasize.push({
				id: nextId("de"),
				disposition: "de_emphasize",
				text: beat.summary.slice(0, 160),
				sourceBeatIds: [beat.id],
				reason: "Lower emphasis under current user intent",
			});
		} else {
			removeCandidates.push({
				id: nextId("rm"),
				disposition: "remove_candidate",
				text: beat.summary.slice(0, 160),
				sourceBeatIds: [beat.id],
				reason:
					d.removeHints[0] ??
					"Likely unnecessary for desired viewer experience (candidate only — not a trim command)",
			});
		}

		for (const hint of d.removeHints) {
			removeCandidates.push({
				id: nextId("rm"),
				disposition: "remove_candidate",
				text: hint,
				sourceBeatIds: [beat.id],
				reason:
					"Supported temporary/recording UI — distraction candidate for professional delivery",
			});
		}
	}

	// Explicit user instruction may add a beat only as unsupported marker — already in unsupportedRequests

	const pacingIntent =
		editingIntent.objective === "shorten"
			? "faster"
			: /\bslow|calm|deliberate\b/i.test(input.userIntent)
				? "slower"
				: "balanced";

	const viewerGoal =
		editingIntent.objective === "polish"
			? `A professional, intentional version of THIS recording: ${source.mediaSummary.slice(0, 140) || "preserve evidenced explanation"} — reduce distractions, keep meaning-bearing moments, do not invent focus targets.`
			: editingIntent.objective === "shorten"
				? `A shorter, clearer version of THIS recording that keeps essential meaning (${source.mediaSummary.slice(0, 120) || "preserve important explanation"}) while compressing low-value pauses/friction.`
				: editingIntent.objective === "clarify"
					? `A clearer explanation of what THIS recording communicates: ${source.mediaSummary.slice(0, 140)}`
					: `Achieve the viewer's editing request for THIS recording: ${input.userIntent.slice(0, 120)}`;

	const communicationGoal =
		source.mediaSummary.slice(0, 200) ||
		"Communicate the evidence-backed story of this recording without inventing actions.";

	const uncertaintyPolicy =
		"Never promote Source Story context/unknown/contradicted items into completed viewer-facing facts. Mark unsupported user asks as requested_but_not_source_supported.";

	return {
		version: 1,
		providerId: TARGET_STORY_V1_PROVIDER_ID,
		assetId: source.assetId,
		viewerGoal,
		communicationGoal,
		desiredArc: buildArc(source, editingIntent),
		objectiveKind: editingIntent.objective,
		editingIntent,
		pacingIntent,
		emphasisIntent: editingIntent.desiredQualities.join("; ") || "clear progression",
		clarityIntent:
			"Prefer honest communication; preserve corrections; avoid unsupported action implications.",
		continuityIntent:
			"Keep chronological source order unless user explicitly requests restructuring.",
		uncertaintyPolicy,
		targetBeats,
		preserve: preserve.slice(0, 32),
		deEmphasize: deEmphasize.slice(0, 32),
		removeCandidates: removeCandidates.slice(0, 24),
		unsupportedRequests,
		unresolved: unresolved.slice(0, 32),
		provenance: {
			sourceBeatIds: source.beats.map((b) => b.id),
			sourceCorrectionIds: source.corrections.map((c) => c.id),
			sourceContradictionIds: source.contradictions.map((c) => c.id),
		},
		metrics: {
			sourceBeatsConsumed: source.beats.length,
			targetBeatsCreated: targetBeats.length,
			preserveCount: preserve.length,
			deEmphasizeCount: deEmphasize.length,
			removeCandidateCount: removeCandidates.length,
			unsupportedRequestCount: unsupportedRequests.length,
			buildMs: performance.now() - t0,
			additionalModelCalls: 0,
			providerId: TARGET_STORY_V1_PROVIDER_ID,
		},
	};
}

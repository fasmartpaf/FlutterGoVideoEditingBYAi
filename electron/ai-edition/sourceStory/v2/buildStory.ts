/**
 * Deterministic Source Story V2 builder — evidence-constrained beats.
 * 0 LLM calls for truth structure.
 */

import { isPassiveVisibilityClaim } from "./guards";
import { MIN_BEAT_IMPORTANCE, scoreRangeImportance } from "./importance";
import type {
	SourceStoryEpistemic,
	SourceStoryEvidenceInput,
	SourceStoryEvidenceRef,
	SourceStoryV2,
	SourceStoryV2Beat,
	SourceStoryV2Contradiction,
	SourceStoryV2Correction,
	SourceStoryV2Item,
} from "./types";
import { SOURCE_STORY_V2_PROVIDER_ID } from "./types";

let itemSeq = 0;
function nextItemId(prefix: string): string {
	itemSeq += 1;
	return `${prefix}_${itemSeq}`;
}

export function resetSourceStoryV2SeqForTests(): void {
	itemSeq = 0;
}

function epistemicOf(status: string): SourceStoryEpistemic {
	const s = status.toLowerCase();
	if (
		s === "observed" ||
		s === "spoken" ||
		s === "supported" ||
		s === "verified" ||
		s === "contradicted" ||
		s === "unknown"
	) {
		return s;
	}
	return "unknown";
}

function overlaps(a0: number, a1: number, b0: number, b1: number, eps = 0.15): boolean {
	return a0 < b1 + eps && b0 < a1 + eps;
}

function mergeProvenance(
	...parts: Array<SourceStoryEvidenceRef | undefined>
): SourceStoryEvidenceRef {
	const out: SourceStoryEvidenceRef = {};
	const push = <K extends keyof SourceStoryEvidenceRef>(key: K, vals?: string[]) => {
		if (!vals?.length) return;
		const prev = (out[key] as string[] | undefined) ?? [];
		out[key] = [...new Set([...prev, ...vals])] as SourceStoryEvidenceRef[K];
	};
	for (const p of parts) {
		if (!p) continue;
		push("claimIds", p.claimIds);
		push("ledgerEventIds", p.ledgerEventIds);
		push("speechSegmentIds", p.speechSegmentIds);
		push("observationIds", p.observationIds);
		push("ocrIds", p.ocrIds);
		push("cropIds", p.cropIds);
		push("investigationClaimIds", p.investigationClaimIds);
		push("investigationObservationIds", p.investigationObservationIds);
	}
	return out;
}

function collectBoundaries(input: SourceStoryEvidenceInput): number[] {
	const raw: number[] = [0, input.sourceDurationSec];
	for (const s of input.speechSegments) {
		raw.push(s.startSourceTimeSec, s.endSourceTimeSec);
	}
	for (const c of input.visualChanges) {
		if (c.classification === "minimal") continue;
		raw.push(c.toSourceTimeSec);
	}
	for (const c of [...input.promotedClaims, ...input.unresolvedClaims, ...input.contradictions]) {
		raw.push(c.startSourceTimeSec, c.endSourceTimeSec);
	}
	for (const e of input.ledgerEvents) {
		if (
			e.type === "visual_transition" ||
			e.type === "observed_visual_diff" ||
			e.type === "spoken_correction" ||
			e.type === "contradiction" ||
			e.type === "passive_chrome"
		) {
			raw.push(e.startSourceTimeSec);
		}
	}
	const sorted = [
		...new Set(raw.map((t) => Math.max(0, Math.min(input.sourceDurationSec, t)))),
	].sort((a, b) => a - b);
	const merged: number[] = [];
	for (const t of sorted) {
		const last = merged[merged.length - 1];
		if (last != null && Math.abs(last - t) < 0.4) continue;
		merged.push(t);
	}
	if (merged[0] !== 0) merged.unshift(0);
	if (merged[merged.length - 1] !== input.sourceDurationSec) {
		merged.push(input.sourceDurationSec);
	}
	return merged;
}

function purposeHint(
	start: number,
	end: number,
	input: SourceStoryEvidenceInput,
	reasons: string[],
): SourceStoryV2Beat["purposeHint"] {
	if (reasons.includes("spoken_correction") || reasons.includes("correction_claim")) {
		return "correction";
	}
	if (reasons.includes("contradiction")) return "transition";
	if (reasons.includes("temporary_ui")) return "transition";
	if (reasons.includes("significant_visual_transition")) return "demonstration";
	if (start <= 0.5) return "intro";
	if (end >= input.sourceDurationSec - 1) return "outro";
	if (reasons.includes("speech_content")) return "explanation";
	if (reasons.includes("passive_context") && !reasons.includes("speech_content")) {
		return "setup";
	}
	return "unknown";
}

function buildItemsForRange(
	start: number,
	end: number,
	input: SourceStoryEvidenceInput,
): {
	facts: SourceStoryV2Item[];
	context: SourceStoryV2Item[];
	spoken: SourceStoryV2Item[];
	actions: SourceStoryV2Item[];
	contradictions: SourceStoryV2Item[];
	uncertainties: SourceStoryV2Item[];
} {
	const facts: SourceStoryV2Item[] = [];
	const context: SourceStoryV2Item[] = [];
	const spoken: SourceStoryV2Item[] = [];
	const actions: SourceStoryV2Item[] = [];
	const contradictions: SourceStoryV2Item[] = [];
	const uncertainties: SourceStoryV2Item[] = [];

	for (const c of input.promotedClaims) {
		if (!overlaps(c.startSourceTimeSec, c.endSourceTimeSec, start, end)) continue;
		const ep = epistemicOf(String(c.status));
		const prov: SourceStoryEvidenceRef = { claimIds: [c.id], ...(c.evidenceIds.length ? {} : {}) };
		if (c.evidenceIds.length) {
			// Keep claim id; evidence ids stay on claim layer.
		}
		if (isPassiveVisibilityClaim(c.kind, c.isActionClaim)) {
			context.push({
				id: nextItemId("ctx"),
				kind: "context",
				epistemic: ep === "verified" ? "supported" : ep,
				text: c.text,
				isContextOnly: true,
				startSourceTimeSec: c.startSourceTimeSec,
				endSourceTimeSec: c.endSourceTimeSec,
				provenance: prov,
			});
			continue;
		}
		if (c.kind === "spoken_correction" || c.kind === "speech_assertion") {
			spoken.push({
				id: nextItemId("sp"),
				kind: c.kind === "spoken_correction" ? "spoken_correction" : "spoken_intention",
				epistemic: "spoken",
				text: c.text,
				startSourceTimeSec: c.startSourceTimeSec,
				endSourceTimeSec: c.endSourceTimeSec,
				provenance: prov,
			});
			continue;
		}
		if (
			c.kind === "visual_change" ||
			ep === "supported" ||
			ep === "verified" ||
			ep === "observed"
		) {
			facts.push({
				id: nextItemId("fact"),
				kind: "story_fact",
				epistemic: ep === "observed" ? "observed" : ep === "verified" ? "verified" : "supported",
				text: c.text,
				startSourceTimeSec: c.startSourceTimeSec,
				endSourceTimeSec: c.endSourceTimeSec,
				provenance: prov,
			});
		}
	}

	for (const s of input.speechSegments) {
		if (!overlaps(s.startSourceTimeSec, s.endSourceTimeSec, start, end)) continue;
		const isCorr = /\b(i mean|i meant|meant the|correction|actually)\b/i.test(s.text);
		spoken.push({
			id: nextItemId("sp"),
			kind: isCorr ? "spoken_correction" : "spoken_intention",
			epistemic: "spoken",
			text: s.text,
			startSourceTimeSec: s.startSourceTimeSec,
			endSourceTimeSec: s.endSourceTimeSec,
			provenance: { speechSegmentIds: [s.id] },
		});
	}

	for (const c of input.visualChanges) {
		if (!overlaps(c.fromSourceTimeSec, c.toSourceTimeSec, start, end)) continue;
		facts.push({
			id: nextItemId("fact"),
			kind: "story_fact",
			epistemic: "supported",
			text: `Material visual change (${c.classification}) between ${c.fromSourceTimeSec.toFixed(2)}s and ${c.toSourceTimeSec.toFixed(2)}s`,
			startSourceTimeSec: c.fromSourceTimeSec,
			endSourceTimeSec: c.toSourceTimeSec,
			provenance: {},
		});
	}

	for (const c of input.unresolvedClaims) {
		if (!overlaps(c.startSourceTimeSec, c.endSourceTimeSec, start, end)) continue;
		if (!c.isActionClaim) {
			uncertainties.push({
				id: nextItemId("unc"),
				kind: "uncertainty",
				epistemic: "unknown",
				text: c.text,
				startSourceTimeSec: c.startSourceTimeSec,
				endSourceTimeSec: c.endSourceTimeSec,
				provenance: { claimIds: [c.id] },
			});
			continue;
		}
		actions.push({
			id: nextItemId("act"),
			kind: "unresolved_action",
			epistemic: "unknown",
			text: `Unresolved (not verified): ${c.text}`,
			startSourceTimeSec: c.startSourceTimeSec,
			endSourceTimeSec: c.endSourceTimeSec,
			provenance: { claimIds: [c.id] },
		});
		uncertainties.push({
			id: nextItemId("unc"),
			kind: "uncertainty",
			epistemic: "unknown",
			text: `Action not verified: ${c.text}`,
			startSourceTimeSec: c.startSourceTimeSec,
			endSourceTimeSec: c.endSourceTimeSec,
			provenance: { claimIds: [c.id] },
		});
	}

	for (const c of input.contradictions) {
		if (!overlaps(c.startSourceTimeSec, c.endSourceTimeSec, start, end)) continue;
		contradictions.push({
			id: nextItemId("ctr"),
			kind: "contradiction",
			epistemic: "contradicted",
			text: `Contradicted / not confirmed: ${c.text}`,
			startSourceTimeSec: c.startSourceTimeSec,
			endSourceTimeSec: c.endSourceTimeSec,
			provenance: { claimIds: [c.id] },
		});
	}

	// Ledger passive chrome as context if claims missed it
	for (const e of input.ledgerEvents) {
		if (e.type !== "passive_chrome") continue;
		if (!overlaps(e.startSourceTimeSec, e.endSourceTimeSec, start, end)) continue;
		const already = context.some(
			(x) => /upwork|passive/i.test(x.text) && /upwork|passive/i.test(e.summary),
		);
		if (already) continue;
		context.push({
			id: nextItemId("ctx"),
			kind: "context",
			epistemic: "observed",
			text: e.summary,
			isContextOnly: true,
			startSourceTimeSec: e.startSourceTimeSec,
			endSourceTimeSec: e.endSourceTimeSec,
			provenance: { ledgerEventIds: [e.id] },
		});
	}

	return { facts, context, spoken, actions, contradictions, uncertainties };
}

function summarizeBeat(parts: {
	facts: SourceStoryV2Item[];
	context: SourceStoryV2Item[];
	spoken: SourceStoryV2Item[];
	actions: SourceStoryV2Item[];
	contradictions: SourceStoryV2Item[];
	uncertainties: SourceStoryV2Item[];
}): string {
	const bits: string[] = [];
	if (parts.spoken.length) {
		const corr = parts.spoken.filter((s) => s.kind === "spoken_correction");
		const intent = parts.spoken.filter((s) => s.kind === "spoken_intention");
		if (corr.length && intent.length) {
			bits.push(
				`Speaker initially said “${intent[0]!.text.slice(0, 80)}”, then corrected to “${corr[0]!.text.slice(0, 80)}”.`,
			);
		} else if (corr.length) {
			bits.push(`Spoken correction: ${corr[0]!.text.slice(0, 120)}`);
		} else {
			bits.push(`Spoken: ${parts.spoken[0]!.text.slice(0, 120)}`);
		}
	}
	if (parts.facts.length) {
		bits.push(parts.facts[0]!.text.slice(0, 140));
	}
	if (parts.context.length) {
		bits.push(`Context: ${parts.context[0]!.text.slice(0, 100)}`);
	}
	if (parts.contradictions.length) {
		bits.push(`${parts.contradictions[0]!.text.slice(0, 120)}`);
	}
	if (parts.actions.length) {
		bits.push(`${parts.actions[0]!.text.slice(0, 120)}`);
	}
	if (!bits.length && parts.uncertainties.length) {
		bits.push(parts.uncertainties[0]!.text.slice(0, 140));
	}
	return bits.join(" ") || "Evidence-sparse interval; no high-importance story fact.";
}

function buildCorrections(input: SourceStoryEvidenceInput): SourceStoryV2Correction[] {
	const out: SourceStoryV2Correction[] = [];
	const spoken = input.speechSegments;
	for (let i = 0; i < spoken.length; i++) {
		const s = spoken[i]!;
		if (!/\b(i mean|i meant|meant the|actually)\b/i.test(s.text)) continue;
		const prev = spoken[i - 1];
		const fromText = prev?.text ?? "prior spoken intention";
		const corrId = nextItemId("corr");
		const fromId = prev ? nextItemId("intent") : undefined;
		const toId = nextItemId("intent");
		out.push({
			id: corrId,
			fromText,
			toText: s.text,
			startSourceTimeSec: prev?.startSourceTimeSec ?? s.startSourceTimeSec,
			endSourceTimeSec: s.endSourceTimeSec,
			supersededIntentionId: fromId,
			activeIntentionId: toId,
			provenance: {
				speechSegmentIds: [s.id, ...(prev ? [prev.id] : [])],
			},
		});
	}
	for (const c of input.promotedClaims) {
		if (c.kind !== "spoken_correction") continue;
		out.push({
			id: nextItemId("corr"),
			fromText: "prior spoken intention",
			toText: c.text,
			startSourceTimeSec: c.startSourceTimeSec,
			endSourceTimeSec: c.endSourceTimeSec,
			provenance: { claimIds: [c.id] },
		});
	}
	return out;
}

function buildContradictions(input: SourceStoryEvidenceInput): SourceStoryV2Contradiction[] {
	return input.contradictions.map((c) => ({
		id: nextItemId("xd"),
		claim: `Contradicted / not confirmed: ${c.text}`,
		supportingModality: "speech",
		conflictingModality: "visual",
		startSourceTimeSec: c.startSourceTimeSec,
		endSourceTimeSec: c.endSourceTimeSec,
		resolutionStatus: "contradicted" as const,
		provenance: { claimIds: [c.id] },
	}));
}

/**
 * Build SourceStoryV2 from evidence input. Deterministic. 0 LLM calls.
 */
export function buildSourceStoryV2(input: SourceStoryEvidenceInput): SourceStoryV2 {
	const t0 = performance.now();
	itemSeq = 0;
	const boundaries = collectBoundaries(input);
	const beats: SourceStoryV2Beat[] = [];
	const persistentContext: SourceStoryV2Item[] = [];
	const allUnresolved: SourceStoryV2Item[] = [];

	// Persistent passive context (e.g. Upwork tab) across the recording
	for (const c of input.promotedClaims) {
		if (!isPassiveVisibilityClaim(c.kind, c.isActionClaim)) continue;
		if (!/upwork|tab|chrome|passive/i.test(`${c.kind} ${c.text}`)) continue;
		persistentContext.push({
			id: nextItemId("pctx"),
			kind: "context",
			epistemic: epistemicOf(String(c.status)),
			text: c.text,
			isContextOnly: true,
			startSourceTimeSec: c.startSourceTimeSec,
			endSourceTimeSec: c.endSourceTimeSec,
			provenance: { claimIds: [c.id] },
		});
	}
	for (const e of input.ledgerEvents) {
		if (e.type !== "passive_chrome") continue;
		if (persistentContext.some((p) => p.text.includes(e.summary.slice(0, 40)))) continue;
		persistentContext.push({
			id: nextItemId("pctx"),
			kind: "context",
			epistemic: "observed",
			text: e.summary,
			isContextOnly: true,
			startSourceTimeSec: e.startSourceTimeSec,
			endSourceTimeSec: e.endSourceTimeSec,
			provenance: { ledgerEventIds: [e.id] },
		});
	}

	for (let i = 0; i < boundaries.length - 1; i++) {
		const start = boundaries[i]!;
		const end = boundaries[i + 1]!;
		if (end - start < 0.05) continue;
		const imp = scoreRangeImportance(start, end, input);
		// Skip low-importance windows (periodic frames alone)
		if (imp.score < MIN_BEAT_IMPORTANCE) continue;

		const parts = buildItemsForRange(start, end, input);
		// Skip empty sparse windows even if score barely passes from ending_window alone
		const substance =
			parts.facts.length +
			parts.context.length +
			parts.spoken.length +
			parts.contradictions.length +
			parts.actions.length;
		if (substance === 0 && imp.score < 3.5) continue;

		allUnresolved.push(...parts.uncertainties, ...parts.actions);

		const evidenceRefs = mergeProvenance(
			...parts.facts.map((x) => x.provenance),
			...parts.context.map((x) => x.provenance),
			...parts.spoken.map((x) => x.provenance),
			...parts.actions.map((x) => x.provenance),
			...parts.contradictions.map((x) => x.provenance),
			input.investigation
				? {
						investigationObservationIds: input.investigation.observationIds,
						investigationClaimIds: input.investigation.claimIds,
					}
				: undefined,
		);

		beats.push({
			id: `sb${beats.length + 1}`,
			startSourceTimeSec: start,
			endSourceTimeSec: end,
			importance: imp.score,
			importanceReasons: imp.reasons,
			purposeHint: purposeHint(start, end, input, imp.reasons),
			summary: summarizeBeat(parts),
			facts: parts.facts,
			context: parts.context,
			spoken: parts.spoken,
			actions: parts.actions,
			contradictions: parts.contradictions,
			uncertainties: parts.uncertainties,
			evidenceRefs,
		});
	}

	// Ensure whole-video compactness: if too many beats, keep highest importance + first/last
	const MAX_BEATS = 12;
	let finalBeats = beats;
	if (beats.length > MAX_BEATS) {
		const first = beats[0]!;
		const last = beats[beats.length - 1]!;
		const mid = beats
			.slice(1, -1)
			.sort((a, b) => b.importance - a.importance)
			.slice(0, MAX_BEATS - 2);
		finalBeats = [first, ...mid.sort((a, b) => a.startSourceTimeSec - b.startSourceTimeSec), last];
	}

	const corrections = buildCorrections(input);
	const contradictions = buildContradictions(input);

	const mediaBits: string[] = [];
	if (input.speechStatus === "no_audio") {
		mediaBits.push("Recording has no audio stream (no_audio).");
	} else if (input.speechStatus === "no_speech_detected") {
		mediaBits.push("Audio present but no speech detected.");
	} else if (input.speechStatus === "unavailable" || input.speechStatus === "failed") {
		mediaBits.push(`Speech status: ${input.speechStatus}.`);
	}
	if (persistentContext.length) {
		mediaBits.push(
			`Persistent context (not actions): ${persistentContext
				.map((c) => c.text)
				.slice(0, 3)
				.join("; ")}.`,
		);
	}
	if (corrections.length) {
		mediaBits.push(
			`Spoken correction present (${corrections.length}); earlier intention superseded for narrative.`,
		);
	}
	if (contradictions.length) {
		mediaBits.push(
			`${contradictions.length} contradiction(s): spoken claims not visually confirmed.`,
		);
	}
	if (finalBeats.length) {
		mediaBits.push(
			`Evidence-backed story spans ${finalBeats.length} meaningful beat(s) over ${input.sourceDurationSec.toFixed(1)}s.`,
		);
	} else {
		mediaBits.push("Sparse evidence; no high-importance beats constructed.");
	}

	const claimIds = [
		...input.promotedClaims.map((c) => c.id),
		...input.unresolvedClaims.map((c) => c.id),
		...input.contradictions.map((c) => c.id),
	];
	const evidenceChars = JSON.stringify(input).length;

	return {
		version: 2,
		providerId: SOURCE_STORY_V2_PROVIDER_ID,
		assetId: input.assetId,
		sourceDurationSec: input.sourceDurationSec,
		speechStatus: input.speechStatus,
		mediaSummary: mediaBits.join(" "),
		beats: finalBeats,
		persistentContext,
		corrections,
		contradictions,
		unresolved: allUnresolved.slice(0, 48),
		capabilities: {
			hasSpeech: input.speechSegments.length > 0,
			hasVisual: input.visualTimes.length > 0 || input.visualChanges.length > 0,
			hasCursor: input.cursorEventTimes.length > 0,
			hasClaims:
				input.promotedClaims.length + input.unresolvedClaims.length + input.contradictions.length >
				0,
			hasInvestigation: Boolean(input.investigation),
		},
		provenance: {
			claimIds,
			ledgerEventIds: input.ledgerEvents.map((e) => e.id),
			speechSegmentIds: input.speechSegments.map((s) => s.id),
			investigationObservationIds: input.investigation?.observationIds ?? [],
		},
		metrics: {
			beatCount: finalBeats.length,
			factCount: finalBeats.reduce((n, b) => n + b.facts.length, 0),
			contextCount: persistentContext.length + finalBeats.reduce((n, b) => n + b.context.length, 0),
			contradictionCount: contradictions.length,
			unresolvedCount: allUnresolved.length,
			buildMs: performance.now() - t0,
			evidenceInputChars: evidenceChars,
			additionalModelCalls: 0,
			providerId: SOURCE_STORY_V2_PROVIDER_ID,
		},
	};
}

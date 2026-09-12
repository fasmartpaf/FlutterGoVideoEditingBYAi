import type { AxcutClip, AxcutDocument, AxcutTrimRange } from "../../../src/lib/ai-edition/schema";
import { locateSourcePosition } from "../../../src/lib/ai-edition/timeline/virtual-preview";
import {
	DEDUPE_WINDOW_SEC,
	INTERACTION_POST_SEC,
	INTERACTION_PRE_SEC,
	MAX_VISUAL_FRAMES,
	PERIODIC_INTERVAL_SEC,
	REASON_PRIORITY,
	SHORT_DURATION_SEC,
	type VisualEvidenceCandidate,
	type VisualEvidenceReason,
} from "./types";

export interface InteractionInstant {
	/** Source seconds on the asset clock. */
	sourceTimeSec: number;
}

function clampSource(t: number, durationSec: number): number {
	if (!Number.isFinite(durationSec) || durationSec <= 0) return Math.max(0, t);
	return Math.min(Math.max(0, t), Math.max(0, durationSec - 0.001));
}

function isInsideTrim(sourceSec: number, assetId: string, trims: AxcutTrimRange[]): boolean {
	return trims.some(
		(t) => t.assetId === assetId && sourceSec >= t.startSec && sourceSec <= t.endSec,
	);
}

function mapVirtual(clips: AxcutClip[], assetId: string, sourceTimeSec: number): number | null {
	const pos = locateSourcePosition(clips, sourceTimeSec, assetId);
	return pos ? pos.virtualTimeSec : null;
}

function pushCandidate(
	out: VisualEvidenceCandidate[],
	args: {
		assetId: string;
		sourceTimeSec: number;
		durationSec: number;
		clips: AxcutClip[];
		trims: AxcutTrimRange[];
		reason: VisualEvidenceReason;
		/** Skip periodic samples that land in trims (misleading for "what plays"). */
		skipIfTrimmed?: boolean;
	},
): void {
	const sourceTimeSec = clampSource(args.sourceTimeSec, args.durationSec);
	if (args.skipIfTrimmed && isInsideTrim(sourceTimeSec, args.assetId, args.trims)) return;
	out.push({
		assetId: args.assetId,
		sourceTimeSec: round3(sourceTimeSec),
		virtualTimeSec: mapVirtual(args.clips, args.assetId, sourceTimeSec),
		reason: args.reason,
		priority: REASON_PRIORITY[args.reason],
	});
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function periodicInterval(durationSec: number): number {
	if (durationSec <= SHORT_DURATION_SEC) return PERIODIC_INTERVAL_SEC;
	// Longer takes: keep ~12–15 periodic candidates before interactions fill budget.
	return Math.max(PERIODIC_INTERVAL_SEC, durationSec / 12);
}

/**
 * Deterministic candidate list for one video asset (before budget hard-cap).
 * Interaction samples come only from non-move cursor events.
 */
export function collectVisualEvidenceCandidates(input: {
	document: AxcutDocument;
	assetId: string;
	durationSec: number;
	interactions?: InteractionInstant[];
}): VisualEvidenceCandidate[] {
	const { document, assetId, durationSec } = input;
	const clips = document.timeline.clips.filter((c) => c.assetId === assetId);
	const trims = document.timeline.trimRanges;
	const out: VisualEvidenceCandidate[] = [];

	if (!(durationSec > 0) || clips.length === 0) return out;

	const interval = periodicInterval(durationSec);
	for (let t = 0; t <= durationSec + 1e-9; t += interval) {
		pushCandidate(out, {
			assetId,
			sourceTimeSec: t,
			durationSec,
			clips,
			trims,
			reason: "periodic",
			skipIfTrimmed: true,
		});
	}
	// Ensure an end periodic near duration even when duration % interval !== 0.
	pushCandidate(out, {
		assetId,
		sourceTimeSec: durationSec,
		durationSec,
		clips,
		trims,
		reason: "periodic",
		skipIfTrimmed: true,
	});

	for (const clip of clips) {
		pushCandidate(out, {
			assetId,
			sourceTimeSec: clip.sourceStartSec,
			durationSec,
			clips,
			trims,
			reason: "clip_boundary",
			skipIfTrimmed: true,
		});
		pushCandidate(out, {
			assetId,
			sourceTimeSec: clip.sourceEndSec ?? clip.sourceStartSec,
			durationSec,
			clips,
			trims,
			reason: "clip_boundary",
			skipIfTrimmed: true,
		});
	}

	for (const hit of input.interactions ?? []) {
		const t = hit.sourceTimeSec;
		pushCandidate(out, {
			assetId,
			sourceTimeSec: t - INTERACTION_PRE_SEC,
			durationSec,
			clips,
			trims,
			reason: "cursor_interaction_pre",
		});
		pushCandidate(out, {
			assetId,
			sourceTimeSec: t,
			durationSec,
			clips,
			trims,
			reason: "cursor_interaction",
		});
		pushCandidate(out, {
			assetId,
			sourceTimeSec: t + INTERACTION_POST_SEC,
			durationSec,
			clips,
			trims,
			reason: "cursor_interaction_post",
		});
	}

	return dedupeVisualCandidates(out);
}

/** Prefer higher priority when times are within DEDUPE_WINDOW_SEC. */
export function dedupeVisualCandidates(
	candidates: VisualEvidenceCandidate[],
	windowSec = DEDUPE_WINDOW_SEC,
): VisualEvidenceCandidate[] {
	const sorted = [...candidates].sort(
		(a, b) => a.sourceTimeSec - b.sourceTimeSec || b.priority - a.priority,
	);
	const kept: VisualEvidenceCandidate[] = [];
	for (const c of sorted) {
		const prev = kept[kept.length - 1];
		if (prev && Math.abs(c.sourceTimeSec - prev.sourceTimeSec) <= windowSec) {
			if (c.priority > prev.priority) kept[kept.length - 1] = c;
			continue;
		}
		kept.push(c);
	}
	return kept;
}

/**
 * Hard cap at MAX_VISUAL_FRAMES with priority:
 * interactions → clip boundaries → evenly spaced periodics for coverage.
 * When any tier overflows, pick evenly across that tier's timeline (not first-N).
 */
export function applyVisualFrameBudget(
	candidates: VisualEvidenceCandidate[],
	maxFrames = MAX_VISUAL_FRAMES,
): VisualEvidenceCandidate[] {
	if (candidates.length <= maxFrames) {
		return [...candidates].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	}

	const interactions = candidates
		.filter((c) => c.reason.startsWith("cursor_interaction"))
		.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec || b.priority - a.priority);
	const boundaries = candidates
		.filter((c) => c.reason === "clip_boundary")
		.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	const periodics = candidates
		.filter((c) => c.reason === "periodic")
		.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);

	const selected: VisualEvidenceCandidate[] = [];

	const nearSelected = (t: number) =>
		selected.some((s) => Math.abs(s.sourceTimeSec - t) <= DEDUPE_WINDOW_SEC);

	const takeEvenly = (list: VisualEvidenceCandidate[], slots: number) => {
		if (slots <= 0 || list.length === 0) return;
		const picks =
			list.length <= slots
				? list
				: Array.from({ length: slots }, (_, i) => {
						const idx =
							slots === 1
								? Math.floor(list.length / 2)
								: Math.round((i * (list.length - 1)) / (slots - 1));
						return list[idx];
					});
		for (const c of picks) {
			if (selected.length >= maxFrames) break;
			if (nearSelected(c.sourceTimeSec)) continue;
			selected.push(c);
		}
	};

	// Reserve ~70% for interactions when they exist, rest for coverage.
	const interactionSlots =
		interactions.length > 0
			? Math.min(interactions.length, Math.max(8, Math.floor(maxFrames * 0.7)))
			: 0;
	takeEvenly(interactions, interactionSlots);

	const afterInteractions = maxFrames - selected.length;
	const boundarySlots = Math.min(boundaries.length, Math.max(0, Math.min(4, afterInteractions)));
	takeEvenly(boundaries, boundarySlots);

	takeEvenly(periodics, maxFrames - selected.length);

	return selected.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
}

/** Interaction instants from raw sidecar samples (non-move only). */
export function interactionInstantsFromSamples(
	samples: Array<{ timeMs: number; interactionType?: string | null }>,
): InteractionInstant[] {
	const out: InteractionInstant[] = [];
	for (const s of samples) {
		const kind = typeof s.interactionType === "string" ? s.interactionType : "";
		if (!kind || kind === "move") continue;
		out.push({ sourceTimeSec: s.timeMs / 1000 });
	}
	return out;
}

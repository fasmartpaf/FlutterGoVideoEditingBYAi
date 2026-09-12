/**
 * Resolve / repair canonical SOURCE_MEDIA_TIME and validate evidence timestamps.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { documentSchema } from "../../../src/lib/ai-edition/schema";
import { probeSourceDurations, selectCanonicalDurationSec } from "./probe";
import {
	type CanonicalSourceDuration,
	type ProbedSourceDurations,
	SOURCE_TIMESTAMP_TOLERANCE_SEC,
	STALE_DURATION_TOLERANCE_SEC,
} from "./types";

const CLIP_MATCH_EPS = 0.051;

export function assertSourceTimestampsWithinDuration(
	timestamps: Array<{ start: number; end: number; label?: string }>,
	canonicalDurationSec: number,
	toleranceSec: number = SOURCE_TIMESTAMP_TOLERANCE_SEC,
): string[] {
	const errors: string[] = [];
	for (const row of timestamps) {
		const label = row.label ?? `${row.start}–${row.end}`;
		if (row.start < -toleranceSec) {
			errors.push(`${label}: start ${row.start} < 0`);
		}
		if (row.end + toleranceSec < row.start) {
			errors.push(`${label}: end before start`);
		}
		if (row.end > canonicalDurationSec + toleranceSec) {
			errors.push(
				`${label}: end ${row.end} > canonical ${canonicalDurationSec} (+${toleranceSec}s)`,
			);
		}
	}
	return errors;
}

export function isAssetDurationStale(
	assetDurationSec: number | null | undefined,
	canonicalDurationSec: number,
	toleranceSec: number = STALE_DURATION_TOLERANCE_SEC,
): boolean {
	if (assetDurationSec == null || !(assetDurationSec > 0)) return true;
	return Math.abs(assetDurationSec - canonicalDurationSec) > toleranceSec;
}

/**
 * Patch asset.durationSec to canonical. Only adjusts clips that were clearly
 * full-source placements matching the previous (stale) duration — leaves
 * intentional trims alone.
 */
export function repairDocumentSourceDuration(
	document: AxcutDocument,
	assetId: string,
	canonicalDurationSec: number,
): AxcutDocument {
	const asset = document.assets.find((a) => a.id === assetId);
	if (!asset) return document;
	const previous = asset.durationSec;
	if (
		previous != null &&
		previous > 0 &&
		Math.abs(previous - canonicalDurationSec) <= STALE_DURATION_TOLERANCE_SEC
	) {
		return document;
	}

	const assets = document.assets.map((row) =>
		row.id === assetId ? { ...row, durationSec: canonicalDurationSec } : row,
	);
	const clips = document.timeline.clips.map((clip) => {
		if (clip.assetId !== assetId) return clip;
		if (previous == null || !(previous > 0)) return clip;
		const endMatchesStale =
			clip.sourceEndSec != null && Math.abs(clip.sourceEndSec - previous) <= CLIP_MATCH_EPS;
		const startAtOrigin = Math.abs(clip.sourceStartSec) <= CLIP_MATCH_EPS;
		if (!endMatchesStale || !startAtOrigin) return clip;
		const placed = Math.max(0, clip.timelineEndSec - clip.timelineStartSec);
		const placedMatchedStale = Math.abs(placed - previous) <= CLIP_MATCH_EPS;
		return {
			...clip,
			sourceEndSec: canonicalDurationSec,
			...(placedMatchedStale
				? { timelineEndSec: clip.timelineStartSec + canonicalDurationSec }
				: {}),
		};
	});

	return documentSchema.parse({
		...document,
		assets,
		timeline: { ...document.timeline, clips },
	});
}

export async function resolveCanonicalSourceDuration(input: {
	mediaPath: string;
	assetDurationSec?: number | null;
	probe?: ProbedSourceDurations;
	ffprobePath?: string | null;
	ffmpegPath?: string | null;
}): Promise<CanonicalSourceDuration | null> {
	const probe =
		input.probe ??
		(await probeSourceDurations(input.mediaPath, {
			ffprobePath: input.ffprobePath,
			ffmpegPath: input.ffmpegPath,
		}));
	const durationSec = selectCanonicalDurationSec(probe);
	if (durationSec == null) return null;

	const assetMetadataSec =
		input.assetDurationSec != null && input.assetDurationSec > 0 ? input.assetDurationSec : null;
	const stale = isAssetDurationStale(assetMetadataSec, durationSec);
	return {
		durationSec,
		kind: "SOURCE_MEDIA_TIME",
		probe,
		assetMetadataSec,
		assetMetadataKind: stale ? "DERIVED/STALE_METADATA" : "SOURCE_MEDIA_TIME",
		repaired: false,
		...(stale && assetMetadataSec != null ? { previousAssetDurationSec: assetMetadataSec } : {}),
	};
}

/**
 * Ensure document asset duration matches live SOURCE_MEDIA_TIME probe.
 * Returns repaired document + canonical descriptor.
 */
export async function ensureCanonicalSourceDuration(input: {
	document: AxcutDocument;
	assetId: string;
	ffprobePath?: string | null;
	ffmpegPath?: string | null;
	/** Tests: inject probe without spawning. */
	probe?: ProbedSourceDurations;
}): Promise<{ document: AxcutDocument; canonical: CanonicalSourceDuration | null }> {
	const asset = input.document.assets.find((a) => a.id === input.assetId);
	if (!asset?.originalPath?.trim()) {
		return { document: input.document, canonical: null };
	}
	const resolved = await resolveCanonicalSourceDuration({
		mediaPath: asset.originalPath,
		assetDurationSec: asset.durationSec,
		probe: input.probe,
		ffprobePath: input.ffprobePath,
		ffmpegPath: input.ffmpegPath,
	});
	if (!resolved) {
		return { document: input.document, canonical: null };
	}
	if (resolved.assetMetadataKind === "DERIVED/STALE_METADATA") {
		const repairedDoc = repairDocumentSourceDuration(
			input.document,
			input.assetId,
			resolved.durationSec,
		);
		return {
			document: repairedDoc,
			canonical: {
				...resolved,
				repaired: true,
				previousAssetDurationSec: asset.durationSec,
			},
		};
	}
	return { document: input.document, canonical: resolved };
}

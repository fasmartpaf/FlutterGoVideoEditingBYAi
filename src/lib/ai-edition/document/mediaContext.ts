// Remembered outline of each recording. Built from the document (clips, trims,
// transcript) so a later chat turn does not have to re-watch the file.
// Stored on `legacyEditor.mediaContext` — the OpenScreen envelope, not a new
// Axcut clip field.

import type { AxcutDocument, AxcutTranscript } from "../schema";
import { resolvePlaybackSegments } from "./timeline";

export const MEDIA_CONTEXT_VERSION = 1 as const;

export interface MediaPart {
	startSec: number;
	endSec: number;
	kind: "speech" | "silence" | "kept";
	clipId?: string;
	text?: string;
}

export interface MediaAssetContext {
	assetId: string;
	label: string;
	durationSec: number | null;
	path: string;
	fingerprint: string;
	parts: MediaPart[];
}

export interface MediaContext {
	version: typeof MEDIA_CONTEXT_VERSION;
	builtAt: string;
	assets: MediaAssetContext[];
	/** Visual notes from a prior watch. Kept across opens when the fingerprint matches. */
	notes: Array<{ assetId: string; startSec: number; endSec: number; text: string }>;
}

function fingerprintOf(
	asset: { originalPath: string; durationSec?: number },
	trimCount: number,
	transcriptChars: number,
): string {
	return [
		asset.originalPath.trim(),
		Number.isFinite(asset.durationSec) ? String(asset.durationSec) : "",
		String(trimCount),
		String(transcriptChars),
	].join("|");
}

function transcriptForAsset(document: AxcutDocument, assetId: string): AxcutTranscript | null {
	return (
		document.transcripts.find((row) => row.assetId === assetId) ??
		(document.transcript?.assetId === assetId ? document.transcript : null)
	);
}

function partsForAsset(document: AxcutDocument, assetId: string): MediaPart[] {
	const clips = document.timeline.clips.filter((clip) => clip.assetId === assetId);
	const segments = resolvePlaybackSegments(clips, document.timeline.trimRanges);
	const kept: MediaPart[] = segments.map((segment) => ({
		kind: "kept" as const,
		clipId: segment.id,
		startSec: segment.sourceStartSec,
		endSec: segment.sourceEndSec ?? segment.sourceStartSec,
	}));
	const transcript = transcriptForAsset(document, assetId);
	if (!transcript) return kept;
	const spoken: MediaPart[] = transcript.segments
		.filter((segment) => segment.endSec > segment.startSec)
		.map((segment) => ({
			kind: segment.kind === "silence" ? ("silence" as const) : ("speech" as const),
			startSec: segment.startSec,
			endSec: segment.endSec,
			text: segment.text.trim() || undefined,
		}));
	return [...kept, ...spoken].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

export function readStoredMediaContext(document: AxcutDocument): MediaContext | null {
	const legacy = document.legacyEditor as Record<string, unknown> | null;
	const raw = legacy?.mediaContext;
	if (!raw || typeof raw !== "object") return null;
	const row = raw as Partial<MediaContext>;
	if (row.version !== MEDIA_CONTEXT_VERSION || !Array.isArray(row.assets)) return null;
	return {
		version: MEDIA_CONTEXT_VERSION,
		builtAt: typeof row.builtAt === "string" ? row.builtAt : "",
		assets: row.assets as MediaAssetContext[],
		notes: Array.isArray(row.notes) ? row.notes : [],
	};
}

/** Fresh outline of every video asset. Keeps prior notes when the file has not changed. */
export function buildMediaContext(document: AxcutDocument, now = new Date()): MediaContext {
	const previous = readStoredMediaContext(document);
	const notesByAsset = new Map<string, MediaContext["notes"]>();
	for (const note of previous?.notes ?? []) {
		const list = notesByAsset.get(note.assetId) ?? [];
		list.push(note);
		notesByAsset.set(note.assetId, list);
	}
	const assets: MediaAssetContext[] = document.assets
		.filter((asset) => asset.kind !== "audio" && Boolean(asset.originalPath?.trim()))
		.map((asset) => {
			const trimCount = document.timeline.trimRanges.filter(
				(trim) => trim.assetId === asset.id,
			).length;
			const transcript = transcriptForAsset(document, asset.id);
			const transcriptChars = (transcript?.segments ?? []).reduce(
				(sum, segment) => sum + segment.text.length,
				0,
			);
			const fingerprint = fingerprintOf(asset, trimCount, transcriptChars);
			return {
				assetId: asset.id,
				label: asset.label,
				durationSec: asset.durationSec ?? null,
				path: asset.originalPath,
				fingerprint,
				parts: partsForAsset(document, asset.id),
			};
		});
	const notes = assets.flatMap((asset) => {
		const prior = previous?.assets.find((row) => row.assetId === asset.assetId);
		if (!prior || prior.fingerprint !== asset.fingerprint) return [];
		return notesByAsset.get(asset.assetId) ?? [];
	});
	return {
		version: MEDIA_CONTEXT_VERSION,
		builtAt: now.toISOString(),
		assets,
		notes,
	};
}

export function attachMediaContext(document: AxcutDocument, now = new Date()): AxcutDocument {
	const next = buildMediaContext(document, now);
	const previous = readStoredMediaContext(document);
	if (
		previous &&
		previous.assets.length === next.assets.length &&
		previous.assets.every(
			(asset, i) =>
				asset.fingerprint === next.assets[i]?.fingerprint &&
				asset.parts.length === next.assets[i]?.parts.length,
		)
	) {
		return document;
	}
	const legacy = (document.legacyEditor as Record<string, unknown> | null) ?? {};
	return {
		...document,
		legacyEditor: { ...legacy, mediaContext: next },
	};
}

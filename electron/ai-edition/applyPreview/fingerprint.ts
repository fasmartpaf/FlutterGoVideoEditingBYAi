/**
 * Deterministic document fingerprint for stale-proposal protection.
 * Hashes mutation-relevant AxcutDocument fields only.
 */

import { createHash } from "node:crypto";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { DocumentFingerprint } from "./types";

function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_k, v) => {
		if (v && typeof v === "object" && !Array.isArray(v)) {
			const sorted: Record<string, unknown> = {};
			for (const key of Object.keys(v as object).sort()) {
				sorted[key] = (v as Record<string, unknown>)[key];
			}
			return sorted;
		}
		return v;
	});
}

/**
 * Fingerprint covers assets, clips, trim/speed/zoom/crop-relevant timeline state.
 * Intentionally excludes volatile UI metadata.
 */
export function fingerprintDocument(document: AxcutDocument): DocumentFingerprint {
	const relevant = {
		projectId: document.project.id,
		primaryAssetId: document.project.primaryAssetId,
		assets: document.assets.map((a) => ({
			id: a.id,
			originalPath: a.originalPath,
			durationSec: a.durationSec,
			kind: a.kind,
		})),
		clips: document.timeline.clips.map((c) => ({
			id: c.id,
			assetId: c.assetId,
			sourceStartSec: c.sourceStartSec,
			sourceEndSec: c.sourceEndSec,
			timelineStartSec: c.timelineStartSec,
			timelineEndSec: c.timelineEndSec,
			// Crop framing is mutation-relevant (Edit Verify Expansion V1).
			cropRegion: c.cropRegion ?? null,
			incomingTransition: (c as { incomingTransition?: unknown }).incomingTransition ?? null,
		})),
		trimRanges: document.timeline.trimRanges.map((t) => ({
			id: t.id,
			assetId: t.assetId,
			clipId: (t as { clipId?: string }).clipId,
			startSec: t.startSec,
			endSec: t.endSec,
		})),
		speedRanges: document.timeline.speedRanges?.map((s) => ({
			startSec: s.startSec,
			endSec: s.endSec,
			reason: s.reason,
		})),
		/** Real speed multipliers live on legacyEditor (scene/compositor authority). */
		legacySpeedRegions: (
			((document.legacyEditor as Record<string, unknown> | null)?.speedRegions as
				| Array<{ id: string; startMs: number; endMs: number; speed: number }>
				| undefined) ?? []
		).map((s) => ({
			id: s.id,
			startMs: s.startMs,
			endMs: s.endMs,
			speed: s.speed,
		})),
		zoomRanges: document.zoomRanges?.map((z) => ({
			id: z.id,
			startMs: z.startMs,
			endMs: z.endMs,
			clipId: (z as { clipId?: string }).clipId,
			depth: z.depth,
			focus: z.focus,
			customScale: z.customScale ?? null,
		})),
		/** Caption settings enablement is mutation-relevant (Caption Verified Apply). */
		captionsEnabled: Boolean(
			(document.legacyEditor as Record<string, unknown> | null)?.captions &&
				typeof (document.legacyEditor as Record<string, unknown>).captions === "object" &&
				((document.legacyEditor as Record<string, unknown>).captions as Record<string, unknown>)
					.enabled === true,
		),
		/** Loudness / audio gain (settings path) is mutation-relevant for Chat shipping. */
		audioGainDb:
			typeof (document.legacyEditor as Record<string, unknown> | null)?.audioGainDb === "number"
				? ((document.legacyEditor as Record<string, unknown>).audioGainDb as number)
				: null,
		/** Titles / callouts / graphics land on annotations (Graphic Verified Apply). */
		annotations: (document.annotations ?? []).map((a) => ({
			id: a.id,
			type: a.type,
			startMs: a.startMs,
			endMs: a.endMs,
			content: a.content,
			textContent: a.textContent ?? null,
			position: a.position,
			size: a.size,
			annotationSource: a.annotationSource ?? null,
		})),
		transcriptWordCount: document.transcripts.reduce((n, t) => n + t.words.length, 0),
	};
	const payload = stableStringify(relevant);
	const value = createHash("sha256").update(payload).digest("hex");
	return {
		algorithm: "json_sha256_relevant",
		value,
		scope: "assets+clips+trims+zooms+speeds",
	};
}

export function fingerprintsEqual(a: string, b: string): boolean {
	return a === b;
}

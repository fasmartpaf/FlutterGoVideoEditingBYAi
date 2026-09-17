/**
 * Compact open-project projection for Bounded Reasoning V1.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { BoundedProjectProjection } from "./types";

export function buildBoundedProjectProjection(input: {
	document: AxcutDocument;
	visualFramesSupplied: boolean;
	speechStatus?: string | null;
	fullSnapshotChars: number;
}): {
	projection: BoundedProjectProjection;
	boundedSnapshotChars: number;
	fullSnapshotChars: number;
	fieldsRemoved: string[];
	reasonRemoved: string;
} {
	const primary =
		input.document.project.primaryAssetId ??
		input.document.assets.find((a) => a.kind !== "audio")?.id ??
		null;
	const asset = input.document.assets.find((a) => a.id === primary);
	const projection: BoundedProjectProjection = {
		primaryAssetId: primary,
		durationSec: asset?.durationSec ?? null,
		clipCount: input.document.timeline.clips.length,
		hasTranscript: Boolean(input.document.transcript?.words?.length),
		visualFramesSupplied: input.visualFramesSupplied,
		speechStatus: input.speechStatus ?? null,
		programmeNote:
			"Work on THIS open project. Prefer SOURCE_MEDIA_TIME for recording facts. Full AxcutDocument is local SSOT — use getCurrentDocument only if a typed field is required.",
	};
	const boundedSnapshotChars = JSON.stringify(projection).length;
	return {
		projection,
		boundedSnapshotChars,
		fullSnapshotChars: input.fullSnapshotChars,
		fieldsRemoved: [
			"full assets[]",
			"full timeline clips/trims/effects",
			"legacyEditor",
			"mediaContext dump",
			"mediaCapabilities essay duplication",
			"projectQueue unusedAssets detail",
		],
		reasonRemoved:
			"UNDERSTAND/PLAN need identity + duration + capability flags, not the entire document JSON; typed tools remain for deep reads",
	};
}

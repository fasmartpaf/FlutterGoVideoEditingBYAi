/**
 * Bug-3 change sampling for VisualAnalysisV1.
 * Reuses extractVisualEvidenceFrames + scoreAdjacentVisualFrames (KEEP/UNIFY).
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { scoreAdjacentVisualFrames } from "../visualEvidence/change";
import { extractVisualEvidenceFrames } from "../visualEvidence/extract";
import type { VisualChange, VisualEvidenceCandidate } from "../visualEvidence/types";
import type { VisualAnalysisParameters, VisualChangeEvent } from "./types";

export function visualChangesToEvents(
	changes: VisualChange[],
	detector: VisualChangeEvent["detector"],
): VisualChangeEvent[] {
	return changes.map((c) => {
		const level =
			c.classification === "significant"
				? "SIGNIFICANT"
				: c.classification === "moderate"
					? "MODERATE"
					: "MINIMAL";
		return {
			timeSec: (c.fromSourceTimeSec + c.toSourceTimeSec) / 2,
			fromSec: c.fromSourceTimeSec,
			toSec: c.toSourceTimeSec,
			magnitude: c.score,
			level,
			detector,
			evidenceRefs: [
				{
					kind: "visual_change",
					id: `${c.fromSourceTimeSec.toFixed(3)}_${c.toSourceTimeSec.toFixed(3)}`,
					note: `${c.classification} score=${c.score.toFixed(4)}`,
				},
			],
		};
	});
}

export async function sampleBug3ChangeEvents(args: {
	assetId: string;
	mediaPath: string;
	durationSec: number;
	parameters: VisualAnalysisParameters;
	frameCacheDir?: string;
}): Promise<{ events: VisualChangeEvent[]; decodePasses: number; latencyMs: number }> {
	const t0 = Date.now();
	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg || !(args.durationSec > 0)) {
		return { events: [], decodePasses: 0, latencyMs: Date.now() - t0 };
	}

	const interval = Math.max(0.5, args.parameters.changeSampleIntervalSec);
	const times: number[] = [];
	for (let t = 0; t <= args.durationSec + 1e-6; t += interval) {
		times.push(Math.min(args.durationSec, Math.round(t * 1000) / 1000));
	}
	if (times[times.length - 1]! < args.durationSec - 0.05) {
		times.push(Math.round(args.durationSec * 1000) / 1000);
	}

	const candidates: VisualEvidenceCandidate[] = times.map((sourceTimeSec) => ({
		assetId: args.assetId,
		sourceTimeSec,
		virtualTimeSec: null,
		reason: "periodic",
		priority: 1,
	}));

	const cacheDir =
		args.frameCacheDir ??
		path.join(process.cwd(), "tmp/perception-benchmark/local-visual-analysis-v1/frames");
	await mkdir(cacheDir, { recursive: true });

	const extracted = await extractVisualEvidenceFrames(candidates, args.mediaPath, {
		cacheDir,
		ffmpegPath: ffmpeg,
	});

	const { changes } = await scoreAdjacentVisualFrames(extracted.frames, {
		ffmpegPath: ffmpeg,
	});

	// One ffmpeg spawn per cache miss + one gray decode per frame (approx).
	const decodePasses = extracted.cacheMisses + extracted.frames.length;

	return {
		events: visualChangesToEvents(changes, "bug3_pixel_mad"),
		decodePasses,
		latencyMs: Date.now() - t0,
	};
}

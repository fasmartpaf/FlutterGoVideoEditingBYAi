/**
 * Extract programme PCM via bounded exportMulti (composited) + ffmpeg decode.
 * Not source-file stitching — export mixer is authoritative.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { CompositorViewService } from "../../native-bridge/services/compositorViewService";
import { clipInputsForProgrammeWindow } from "../compositorVerify/programmeMap";
import { probeAudioStream } from "../speechEvidence/probe";
import { synthesizeJoinPcm } from "./analyze";
import {
	AUDIO_VERIFY_CHANNELS,
	AUDIO_VERIFY_SAMPLE_RATE,
	type AudioPcmBuffer,
	type AudioPcmProvider,
} from "./types";

export async function detectNoAudio(assetPath: string | null | undefined): Promise<boolean> {
	if (!assetPath || !existsSync(assetPath)) return false;
	const probe = await probeAudioStream(assetPath);
	return probe.present === false;
}

export function createBoundedExportPcmProvider(opts?: {
	appRoot?: string;
	workDir?: string;
	retain?: boolean;
}): AudioPcmProvider {
	const workDir = opts?.workDir ?? join(tmpdir(), `openscreen-audio-verify-${process.pid}`);
	const service = new CompositorViewService({ appRoot: opts?.appRoot });
	mkdirSync(workDir, { recursive: true });

	return async (input) => {
		if (!service.hasAddon() || service.probeBackend() === "none") {
			return null;
		}
		const clips = clipInputsForProgrammeWindow(
			input.document,
			input.programmeStartSec,
			input.programmeEndSec,
		);
		if (clips.length === 0) return null;

		const sceneJson = JSON.stringify(buildSceneDescription(input.document));
		const outMp4 = join(
			workDir,
			`av_${createHash("sha1")
				.update(`${input.programmeStartSec}:${input.programmeEndSec}`)
				.digest("hex")
				.slice(0, 10)}.mp4`,
		);

		const stats = await service.exportMulti(clips, outMp4, sceneJson, {
			width: 160,
			height: 90,
			fps: 10,
			codec: "h264",
		});
		if (!stats || !existsSync(outMp4)) return null;

		const pcm = decodeMp4ToMonoF32(outMp4, AUDIO_VERIFY_SAMPLE_RATE);
		if (!opts?.retain) {
			try {
				rmSync(outMp4, { force: true });
			} catch {
				/* ignore */
			}
		}
		if (!pcm) return null;
		return {
			samples: pcm,
			sampleRate: AUDIO_VERIFY_SAMPLE_RATE,
			channels: AUDIO_VERIFY_CHANNELS,
			programmeStartSec: input.programmeStartSec,
			capturePath: "bounded_exportMulti_pcm",
		};
	};
}

export function createInjectedPcmProvider(buffer: AudioPcmBuffer): AudioPcmProvider {
	return async () => ({
		...buffer,
		capturePath: buffer.capturePath ?? "injected_pcm",
	});
}

/** Test helper: synthetic join PCM aligned to the requested programme window. */
export function createSyntheticJoinPcmProvider(
	mode: "safe_silence" | "click_pop" | "loudness_jump" | "clipping",
): AudioPcmProvider {
	return async (input) => {
		const pad = Math.max(0.05, (input.programmeEndSec - input.programmeStartSec) / 2);
		const syn = synthesizeJoinPcm({ mode, padSec: pad });
		return {
			samples: syn.samples,
			sampleRate: syn.sampleRate,
			channels: 1 as const,
			programmeStartSec: input.programmeStartSec,
			capturePath: "injected_pcm",
		};
	};
}

function decodeMp4ToMonoF32(mp4Path: string, sampleRate: number): Float32Array | null {
	let ffmpeg: string | null = null;
	try {
		ffmpeg = resolveFfmpeg();
	} catch {
		return null;
	}
	if (!ffmpeg || !existsSync(ffmpeg)) return null;

	const rawPath = `${mp4Path}.f32le`;
	const result = spawnSync(
		ffmpeg,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			mp4Path,
			"-vn",
			"-ac",
			"1",
			"-ar",
			String(sampleRate),
			"-f",
			"f32le",
			"-y",
			rawPath,
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0 || !existsSync(rawPath)) {
		return null;
	}
	const buf = readFileSync(rawPath);
	try {
		rmSync(rawPath, { force: true });
	} catch {
		/* ignore */
	}
	return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

export function primaryAssetPath(document: AxcutDocument, assetId: string): string | null {
	return document.assets.find((a) => a.id === assetId)?.originalPath ?? null;
}

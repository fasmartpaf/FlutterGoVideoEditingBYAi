/**
 * Loudness for a platform.
 *
 * Measures the PROGRAMME — the recording's sound through the cut, plus every
 * audio track at its level — the way the mixer lays it out (the scene's clip
 * list and audio entries), then sets the programme gain so the integrated
 * loudness lands on the platform's target without pushing the true peak over
 * −1 dBTP. The gain is the existing `audioGainDb` programme setting, which
 * the preview and the export both apply. Speed changes and fades are left out
 * of the measurement; they move loudness by far less than the tolerance.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { parseLoudnormPrintJson } from "../loudness/parseLoudnorm";
import { runProcess } from "../mediaStudio";
import { parseFfmpegProbe } from "../showcase/render";

export const LOUDNESS_TARGETS = {
	youtube: -14,
	tiktok: -14,
	instagram: -14,
	reels: -14,
	shorts: -14,
	spotify: -14,
	podcast: -16,
	broadcast: -23,
} as const;
export type LoudnessPlatform = keyof typeof LOUDNESS_TARGETS;

export const MAX_TRUE_PEAK_DB = -1;
export const MAX_PROGRAMME_GAIN_DB = 12;

export type ProgrammeLoudness = { integratedLufs: number; truePeakDb: number; lra: number };

/**
 * ffmpeg arguments that mix the programme and print its loudness. `hasAudio`
 * says which files carry sound (a clip without it contributes silence).
 */
export function programmeLoudnessArgs(document: AxcutDocument, hasAudio: (path: string) => boolean): string[] | null {
	const scene = buildSceneDescription(document);
	const inputs: string[] = [];
	const indexOf = new Map<string, number>();
	const input = (path: string) => {
		let i = indexOf.get(path);
		if (i === undefined) {
			i = inputs.length;
			inputs.push(path);
			indexOf.set(path, i);
		}
		return i;
	};
	const fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
	const parts: string[] = [];
	const clipLabels: string[] = [];
	scene.clips.forEach((clip, n) => {
		const len = Math.max(0, clip.sourceEndSec - clip.sourceStartSec);
		if (len <= 0) return;
		if (clip.hasAudio && hasAudio(clip.screenPath)) {
			const i = input(clip.screenPath);
			parts.push(`[${i}:a]atrim=${clip.sourceStartSec.toFixed(3)}:${clip.sourceEndSec.toFixed(3)},asetpts=PTS-STARTPTS,${fmt}[c${n}]`);
		} else {
			parts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${len.toFixed(3)},${fmt}[c${n}]`);
		}
		clipLabels.push(`[c${n}]`);
	});
	const trackLabels: string[] = [];
	scene.audioTracks.forEach((t, n) => {
		if (!hasAudio(t.path) || t.trimEndSec <= t.trimStartSec) return;
		const i = input(t.path);
		const delay = Math.max(0, Math.round(t.startSec * 1000));
		parts.push(
			`[${i}:a]atrim=${t.trimStartSec.toFixed(3)}:${t.trimEndSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${t.gainDb.toFixed(2)}dB,${fmt},adelay=${delay}|${delay}[t${n}]`,
		);
		trackLabels.push(`[t${n}]`);
	});
	if (clipLabels.length === 0 && trackLabels.length === 0) return null;
	const mixIn: string[] = [];
	if (clipLabels.length > 0) {
		parts.push(`${clipLabels.join("")}concat=n=${clipLabels.length}:v=0:a=1[prog]`);
		mixIn.push("[prog]");
	}
	mixIn.push(...trackLabels);
	parts.push(
		mixIn.length > 1
			? `${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=longest,loudnorm=print_format=json[out]`
			: `${mixIn[0]}loudnorm=print_format=json[out]`,
	);
	return [
		"-nostdin",
		"-hide_banner",
		...inputs.flatMap((p) => ["-i", p]),
		"-filter_complex",
		parts.join(";"),
		"-map",
		"[out]",
		"-f",
		"null",
		"-",
	];
}

export async function measureProgrammeLoudness(
	document: AxcutDocument,
	ffmpegPath: string,
	signal?: AbortSignal,
): Promise<ProgrammeLoudness | null> {
	const scene = buildSceneDescription(document);
	const paths = [...new Set([...scene.clips.map((c) => c.screenPath), ...scene.audioTracks.map((t) => t.path)])];
	const withAudio = new Set<string>();
	for (const p of paths) {
		const probe = await runProcess(ffmpegPath, ["-hide_banner", "-i", p], { timeoutMs: 20_000, signal }).catch(() => null);
		const info = probe ? parseFfmpegProbe(probe.stderr) : null;
		if (info?.hasAudio || (probe && /Stream #[^\n]*Audio:/.test(probe.stderr))) withAudio.add(p);
	}
	const args = programmeLoudnessArgs(document, (p) => withAudio.has(p));
	if (!args) return null;
	const res = await runProcess(ffmpegPath, args, { timeoutMs: 900_000, signal });
	const v = parseLoudnormPrintJson(res.stderr);
	if (!v || v.inputIntegratedLufs < -70) return null;
	return { integratedLufs: v.inputIntegratedLufs, truePeakDb: v.inputTruePeakDbTp, lra: v.inputLra };
}

/**
 * Programme gain to hit `targetLufs`: the loudness gap, held so the true peak
 * stays at or under −1 dBTP and inside the setting's ±12 dB.
 */
export function loudnessGainDb(measured: ProgrammeLoudness, targetLufs: number): { gainDb: number; peakLimited: boolean } {
	const wanted = targetLufs - measured.integratedLufs;
	const peakRoom = MAX_TRUE_PEAK_DB - measured.truePeakDb;
	let gain = Math.min(wanted, peakRoom);
	const peakLimited = peakRoom < wanted;
	gain = Math.max(-MAX_PROGRAMME_GAIN_DB, Math.min(MAX_PROGRAMME_GAIN_DB, gain));
	return { gainDb: Math.round(gain * 10) / 10, peakLimited };
}

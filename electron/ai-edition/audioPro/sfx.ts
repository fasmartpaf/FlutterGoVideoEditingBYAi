/**
 * Sound effects, made here (synthesised with ffmpeg) — no library to license,
 * nothing downloaded. Each effect is rendered once to a WAV and reused.
 */

import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "../mediaStudio";

export const SFX = {
	whoosh: {
		label: "Whoosh",
		sec: 0.7,
		graph: "anoisesrc=d=0.7:c=pink:r=48000:a=0.9,highpass=f=250,lowpass=f=3200,volume='pow(sin(PI*t/0.7),2)':eval=frame,volume=7dB",
	},
	swoosh: {
		label: "Swoosh",
		sec: 0.35,
		graph: "anoisesrc=d=0.35:c=white:r=48000:a=0.7,highpass=f=1200,lowpass=f=7000,volume='pow(sin(PI*t/0.35),3)':eval=frame",
	},
	pop: {
		label: "Pop",
		sec: 0.14,
		graph: "aevalsrc=exprs='0.8*sin(2*PI*(900*t-2600*t*t))*exp(-t*38)':s=48000:d=0.14",
	},
	click: {
		label: "Click",
		sec: 0.04,
		graph: "aevalsrc=exprs='0.9*(random(0)*2-1)*exp(-t*300)+0.5*sin(2*PI*2400*t)*exp(-t*220)':s=48000:d=0.04",
	},
	ding: {
		label: "Ding",
		sec: 1.4,
		graph: "aevalsrc=exprs='0.5*sin(2*PI*1320*t)*exp(-t*3.2)+0.22*sin(2*PI*2640*t)*exp(-t*5)+0.12*sin(2*PI*3960*t)*exp(-t*8)':s=48000:d=1.4",
	},
	riser: {
		label: "Riser",
		sec: 1.6,
		graph: "aevalsrc=exprs='(0.45*sin(2*PI*(180*t+320*t*t))+0.25*(random(0)*2-1))*pow(t/1.6,2)':s=48000:d=1.6,lowpass=f=6000",
	},
	impact: {
		label: "Impact",
		sec: 1.3,
		graph: "aevalsrc=exprs='0.9*sin(2*PI*(70*t-12*t*t))*exp(-t*2.8)+0.5*(random(0)*2-1)*exp(-t*25)':s=48000:d=1.3,lowpass=f=5000",
	},
} as const;
export type SfxName = keyof typeof SFX;
export const SFX_NAMES = Object.keys(SFX) as SfxName[];

/** The effect's WAV (stereo, 48 kHz), rendered on first use. */
export async function ensureSfx(
	ffmpegPath: string,
	name: SfxName,
	dir: string,
	signal?: AbortSignal,
): Promise<{ path: string; durationSec: number; label: string }> {
	const spec = SFX[name];
	const path = join(dir, `sfx-${name}-v1.wav`);
	if (existsSync(path) && statSync(path).size > 1000) return { path, durationSec: spec.sec, label: spec.label };
	mkdirSync(dir, { recursive: true });
	const res = await runProcess(
		ffmpegPath,
		[
			"-y",
			"-nostdin",
			"-hide_banner",
			"-f",
			"lavfi",
			"-i",
			spec.graph,
			"-af",
			"aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo,afade=t=out:st=" +
				Math.max(0, spec.sec - 0.02).toFixed(3) +
				":d=0.02",
			"-t",
			String(spec.sec),
			path,
		],
		{ timeoutMs: 60_000, signal },
	);
	if (res.code !== 0 || !existsSync(path)) {
		throw new Error(`Could not make the ${spec.label} sound: ${(res.stderr || "").slice(-300)}`);
	}
	return { path, durationSec: spec.sec, label: spec.label };
}

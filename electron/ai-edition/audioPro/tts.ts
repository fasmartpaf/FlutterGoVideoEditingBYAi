/**
 * Voiceover from text, made on this computer by the voices it has installed:
 * macOS `say` (the system voices), or `espeak-ng` on Linux. Nothing is sent
 * anywhere. When no installed voice speaks the language, it says so rather
 * than reading the text with a voice of another language.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "../mediaStudio";

export type SystemVoice = { engine: "say" | "espeak-ng"; name: string; language: string };

/** "Alex                en_US    # Most people…" → voices. */
export function parseSayVoices(stdout: string): SystemVoice[] {
	const out: SystemVoice[] = [];
	for (const line of stdout.split("\n")) {
		const m = /^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]+|[a-z]{2,3})\s+#/.exec(line.trim());
		if (m) out.push({ engine: "say", name: m[1]!.trim(), language: m[2]!.replace("-", "_") });
	}
	return out;
}

/** espeak-ng --voices: " 5  ur             --/M      Urdu               inc/ur" → voices. */
export function parseEspeakVoices(stdout: string): SystemVoice[] {
	const out: SystemVoice[] = [];
	for (const line of stdout.split("\n").slice(1)) {
		const cols = line.trim().split(/\s+/);
		if (cols.length >= 4 && /^[a-z]{2,3}(-[a-z0-9-]+)?$/i.test(cols[1]!)) {
			out.push({ engine: "espeak-ng", name: cols[1]!, language: cols[1]!.replace("-", "_") });
		}
	}
	return out;
}

/** Arabic script → Urdu (this product's users), Devanagari → Hindi, else English. */
export function guessLanguage(text: string): string {
	if (/[؀-ۿ]/.test(text)) return "ur";
	if (/[ऀ-ॿ]/.test(text)) return "hi";
	return "en";
}

/** The best installed voice for a language ("ur", "en_GB"…), or a named one. */
export function pickVoice(voices: SystemVoice[], language: string, name?: string): SystemVoice | null {
	if (name) {
		const byName = voices.find((v) => v.name.toLowerCase() === name.toLowerCase());
		if (byName) return byName;
	}
	const want = language.toLowerCase().replace("-", "_");
	const base = want.split("_")[0]!;
	return (
		voices.find((v) => v.language.toLowerCase() === want) ??
		voices.find((v) => v.language.toLowerCase().split("_")[0] === base) ??
		null
	);
}

export async function listSystemVoices(platform = process.platform, signal?: AbortSignal): Promise<SystemVoice[]> {
	if (platform === "darwin") {
		const r = await runProcess("/usr/bin/say", ["-v", "?"], { timeoutMs: 15_000, signal }).catch(() => null);
		return r?.code === 0 ? parseSayVoices(r.stdout) : [];
	}
	for (const bin of ["espeak-ng", "/usr/bin/espeak-ng", "/opt/homebrew/bin/espeak-ng", "/usr/local/bin/espeak-ng"]) {
		const r = await runProcess(bin, ["--voices"], { timeoutMs: 15_000, signal }).catch(() => null);
		if (r?.code === 0) return parseEspeakVoices(r.stdout);
	}
	return [];
}

/** Speak `text` with `voice` into an .m4a (48 kHz stereo), returning its path and length. */
export async function synthesizeVoiceover(input: {
	ffmpegPath: string;
	voice: SystemVoice;
	text: string;
	/** Words per minute (say) / speed (espeak), default the voice's own. */
	rate?: number;
	outDir: string;
	signal?: AbortSignal;
}): Promise<{ path: string; durationSec: number }> {
	mkdirSync(input.outDir, { recursive: true });
	const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
	const textFile = join(input.outDir, `vo-${stamp}.txt`);
	const raw = join(input.outDir, `vo-${stamp}.${input.voice.engine === "say" ? "aiff" : "wav"}`);
	const out = join(input.outDir, `voiceover-${stamp}.m4a`);
	writeFileSync(textFile, input.text, "utf8");
	try {
		const args =
			input.voice.engine === "say"
				? ["-v", input.voice.name, ...(input.rate ? ["-r", String(Math.round(input.rate))] : []), "-f", textFile, "-o", raw]
				: ["-v", input.voice.name, ...(input.rate ? ["-s", String(Math.round(input.rate))] : []), "-f", textFile, "-w", raw];
		const bin = input.voice.engine === "say" ? "/usr/bin/say" : "espeak-ng";
		const spoke = await runProcess(bin, args, { timeoutMs: 300_000, signal: input.signal });
		if (spoke.code !== 0 || !existsSync(raw)) throw new Error(`The voice could not speak: ${(spoke.stderr || "").slice(-300)}`);
		const enc = await runProcess(
			input.ffmpegPath,
			["-y", "-nostdin", "-hide_banner", "-i", raw, "-af", "aformat=sample_rates=48000:channel_layouts=stereo", "-c:a", "aac", "-b:a", "160k", out],
			{ timeoutMs: 120_000, signal: input.signal },
		);
		if (enc.code !== 0 || !existsSync(out)) throw new Error(`Could not encode the voiceover: ${(enc.stderr || "").slice(-300)}`);
		const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(enc.stderr);
		const durationSec = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
		return { path: out, durationSec };
	} finally {
		rmSync(textFile, { force: true });
		rmSync(raw, { force: true });
	}
}

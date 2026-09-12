/**
 * Bug 3 real-video validation — change scores, refinement, contact sheet.
 * Skips when local recording / ffmpeg absent (CI-safe).
 *
 * Run: npx vitest --run electron/ai-edition/visualEvidence/bug3-change.runtime.test.ts
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { copyFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { prepareVisualEvidenceForTurn } from "./prepare";

const REC =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1788930909064.mp4";
const DURATION = 11.799979;
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT_ROOT = path.join(process.cwd(), "tmp/bug3-validation");

function runCmd(bin: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
		let err = "";
		child.stderr?.on("data", (c) => {
			err += String(c);
		});
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err || String(code)))));
	});
}

const canRun = existsSync(REC) && existsSync(FFMPEG);

describe.runIf(canRun)("bug3: real recording change detection", () => {
	it("scores transitions, may refine midpoints, writes contact sheet", async () => {
		mkdirSync(path.join(OUT_ROOT, "frames"), { recursive: true });
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "Bug3", projectId: "proj_b3", createdAt: CREATED });
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "recording-1788930909064.mp4",
					kind: "video",
					originalPath: REC,
					durationSec: DURATION,
					width: 1920,
					height: 1080,
				},
			],
			timeline: {
				...base.timeline,
				clips: [
					{
						id: "clip_1",
						assetId: "asset_1",
						sourceStartSec: 0,
						sourceEndSec: DURATION,
						timelineStartSec: 0,
						timelineEndSec: DURATION,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});

		const coldDir = await mkdtemp(path.join(os.tmpdir(), "os-b3-cold-"));
		const t0 = Date.now();
		const cold = await prepareVisualEvidenceForTurn({
			document,
			userMessage:
				"Check a video and let's me know what about it? and make ma transacripton read a each frame ok? and guide me how about it's?",
			provider: "openai",
			extractDeps: { cacheDir: coldDir, ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});
		const coldMs = Date.now() - t0;

		expect(cold.visualFramesSupplied).toBe(true);
		expect(cold.prepared?.frames.length).toBeGreaterThan(0);
		expect(cold.prepared?.frames.length).toBeLessThanOrEqual(20);
		expect(cold.prepared?.changes?.length).toBe((cold.prepared?.frames.length ?? 1) - 1);

		const table = (cold.prepared?.changes ?? []).map((c) => ({
			from: c.fromSourceTimeSec,
			to: c.toSourceTimeSec,
			score: c.score,
			classification: c.classification,
			midpointAdded: (cold.prepared?.frames ?? []).some(
				(f) =>
					f.reason === "change_refinement" &&
					f.sourceTimeSec > c.fromSourceTimeSec &&
					f.sourceTimeSec < c.toSourceTimeSec,
			),
		}));
		process.stderr.write(`BUG3_TRANSITION_TABLE ${JSON.stringify(table, null, 2)}\n`);
		process.stderr.write(
			`BUG3_TIMINGS ${JSON.stringify({ coldMs, ...cold.prepared?.timings }, null, 2)}\n`,
		);

		const frameFiles: string[] = [];
		for (let i = 0; i < (cold.prepared?.frames.length ?? 0); i++) {
			const f = cold.prepared!.frames[i]!;
			const dest = path.join(OUT_ROOT, "frames", `frame-${String(i).padStart(2, "0")}.jpg`);
			await copyFile(f.imagePath, dest);
			frameFiles.push(dest);
		}

		const cols = Math.min(4, frameFiles.length || 1);
		const tileJpg = path.join(OUT_ROOT, "contact-sheet.jpg");
		if (frameFiles.length > 0) {
			const rowsN = Math.ceil(frameFiles.length / cols);
			await runCmd(FFMPEG, [
				"-y",
				...frameFiles.flatMap((p) => ["-i", p]),
				"-filter_complex",
				`tile=${cols}x${rowsN}:margin=8:padding=8`,
				tileJpg,
			]);
		}

		const cells = (cold.prepared?.frames ?? [])
			.map((f, i) => {
				const next = table.find((t) => Math.abs(t.from - f.sourceTimeSec) < 0.001);
				const trans = next
					? `<div>→ ${next.to.toFixed(2)}s · ${next.classification} (${next.score.toFixed(3)})${next.midpointAdded ? " · mid" : ""}</div>`
					: "";
				return `<figure style="margin:0;border:1px solid #333;background:#111;color:#eee;font:13px/1.3 system-ui">
  <img src="frames/frame-${String(i).padStart(2, "0")}.jpg" style="width:100%;display:block"/>
  <figcaption style="padding:8px">
    <div><b>#${i}</b> ${f.sourceTimeSec.toFixed(2)}s · ${f.reason}</div>
    ${trans}
  </figcaption>
</figure>`;
			})
			.join("\n");

		const contactHtml = path.join(OUT_ROOT, "contact-sheet.html");
		writeFileSync(
			contactHtml,
			`<!doctype html><meta charset="utf-8"/><title>Bug3 contact sheet</title>
<style>body{margin:16px;background:#000;font-family:system-ui}h1,pre{color:#fff} .grid{display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:12px}</style>
<h1>Bug 3 change detection — recording-1788930909064.mp4</h1>
<pre>${JSON.stringify(table, null, 2)}</pre>
<div class="grid">${cells}</div>`,
		);

		writeFileSync(
			path.join(OUT_ROOT, "report.json"),
			JSON.stringify(
				{
					video: REC,
					table,
					timings: cold.prepared?.timings,
					coldMs,
					contactSheetJpg: tileJpg,
					contactSheetHtml: contactHtml,
					finalFrameCount: cold.prepared?.frames.length,
					refinementFrameCount: cold.prepared?.timings.refinementFrameCount,
				},
				null,
				2,
			),
		);

		const warmDir = coldDir;
		const t1 = Date.now();
		const warm = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "analyze this video",
			provider: "openai",
			extractDeps: { cacheDir: warmDir, ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});
		const warmMs = Date.now() - t1;
		process.stderr.write(
			`BUG3_WARM ${JSON.stringify({ warmMs, timings: warm.prepared?.timings }, null, 2)}\n`,
		);
		expect(warm.prepared?.timings.cacheHits ?? 0).toBeGreaterThan(0);

		// Content must mention transitions when any significant/moderate exists
		const parts = Array.isArray(cold.userMessage.content) ? cold.userMessage.content : [];
		const text = parts
			.filter((p) => (p as { type: string }).type === "text")
			.map((p) => (p as { text: string }).text)
			.join("\n");
		expect(text).toMatch(/Transition /);
		expect(text).toMatch(/visual change:/);
	}, 90_000);
});

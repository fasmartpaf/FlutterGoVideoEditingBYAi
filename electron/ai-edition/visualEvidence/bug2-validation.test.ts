/**
 * Bug 2 validation harness — diagnostic only, not a product feature.
 * Run: OPENSCREEN_VALIDATE_BUG2=1 npx vitest --run electron/ai-edition/visualEvidence/bug2-validation.test.ts
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { extractVisualEvidenceFrames } from "./extract";
import { promptWantsVisualEvidence } from "./intent";
import { prepareVisualEvidenceForTurn } from "./prepare";
import { providerSupportsAttachedVisualFrames } from "./providers";
import {
	applyVisualFrameBudget,
	collectVisualEvidenceCandidates,
	dedupeVisualCandidates,
	interactionInstantsFromSamples,
} from "./sample";
import {
	DEDUPE_WINDOW_SEC,
	INTERACTION_POST_SEC,
	INTERACTION_PRE_SEC,
	PERIODIC_INTERVAL_SEC,
	REASON_PRIORITY,
	type VisualEvidenceCandidate,
	type VisualEvidenceReason,
} from "./types";

const REC =
	process.env.HOME +
	"/Library/Application Support/openscreen/recordings/recording-1788897181542.mp4";

const OUT_ROOT = path.join(
	process.env.HOME + "/Documents/GitHub/FlutterGoVideoEditingBYAi",
	"tmp/bug2-validation",
);

const run = process.env.OPENSCREEN_VALIDATE_BUG2 === "1" && existsSync(REC);

function runCmd(bin: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
		let err = "";
		child.stderr?.on("data", (c) => {
			err += String(c);
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`${bin} exit ${code}: ${err.trim()}`)),
		);
	});
}

function buildDocument(durationSec: number) {
	const CREATED = "2026-01-01T00:00:00.000Z";
	const base = createEmptyDocument({ title: "Bug2", projectId: "proj_bug2", createdAt: CREATED });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "Screen",
				kind: "video",
				originalPath: REC,
				durationSec,
				width: 3024,
				height: 1964,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
	});
}

/** Mirror production collection WITHOUT dedupe — validation count only. */
function collectRawCandidates(
	durationSec: number,
	interactions: Array<{ sourceTimeSec: number }>,
): VisualEvidenceCandidate[] {
	const document = buildDocument(durationSec);
	const clips = document.timeline.clips;
	const out: VisualEvidenceCandidate[] = [];
	const push = (sourceTimeSec: number, reason: VisualEvidenceReason) => {
		const t = Math.min(Math.max(0, sourceTimeSec), Math.max(0, durationSec - 0.001));
		out.push({
			assetId: "asset_1",
			sourceTimeSec: Math.round(t * 1000) / 1000,
			virtualTimeSec: t,
			reason,
			priority: REASON_PRIORITY[reason],
		});
	};
	for (let t = 0; t <= durationSec + 1e-9; t += PERIODIC_INTERVAL_SEC) push(t, "periodic");
	push(durationSec, "periodic");
	push(0, "clip_boundary");
	push(durationSec, "clip_boundary");
	for (const hit of interactions) {
		push(hit.sourceTimeSec - INTERACTION_PRE_SEC, "cursor_interaction_pre");
		push(hit.sourceTimeSec, "cursor_interaction");
		push(hit.sourceTimeSec + INTERACTION_POST_SEC, "cursor_interaction_post");
	}
	void clips;
	return out;
}

describe.runIf(run)("Bug 2 validation against real recording", () => {
	it("produces frame table, contact sheet, cold/warm timings, intent traces", async () => {
		rmSync(OUT_ROOT, { recursive: true, force: true });
		mkdirSync(OUT_ROOT, { recursive: true });
		mkdirSync(path.join(OUT_ROOT, "frames"), { recursive: true });

		const ffmpeg = resolveFfmpeg();
		expect(ffmpeg).toBeTruthy();

		const durationSec = 16.35;
		const document = buildDocument(durationSec);
		const cursor = JSON.parse(readFileSync(REC + ".cursor.json", "utf8"));
		const samples = cursor.samples ?? [];
		const interactions = interactionInstantsFromSamples(samples);

		const raw = collectRawCandidates(durationSec, interactions);
		const afterDedupe = dedupeVisualCandidates(raw, DEDUPE_WINDOW_SEC);
		const production = applyVisualFrameBudget(
			collectVisualEvidenceCandidates({
				document,
				assetId: "asset_1",
				durationSec,
				interactions,
			}),
		);

		const coldDir = await mkdtemp(path.join(os.tmpdir(), "bug2-cold-"));
		const t0 = Date.now();
		const coldExtract = await extractVisualEvidenceFrames(production, REC, {
			cacheDir: coldDir,
			ffmpegPath: ffmpeg,
		});
		const coldTotalMs = Date.now() - t0;

		const hitMiss: Array<"hit" | "miss"> = production.map((_, i) =>
			i < coldExtract.cacheMisses ? "miss" : "hit",
		);
		// More accurate: cold run all misses if cache empty
		const coldRows = coldExtract.frames.map((f, index) => ({
			index,
			sourceTimeSec: f.sourceTimeSec,
			virtualTimeSec: f.virtualTimeSec,
			reason: f.reason,
			cache: "miss" as const,
			width: f.width,
			height: f.height,
			bytes: f.byteLength,
			path: f.imagePath,
		}));

		// Copy frames; label via HTML contact sheet (bundled ffmpeg is LGPL — no drawtext).
		const frameFiles: string[] = [];
		for (const row of coldRows) {
			const dest = path.join(OUT_ROOT, "frames", `frame-${String(row.index).padStart(2, "0")}.jpg`);
			await copyFile(row.path, dest);
			frameFiles.push(dest);
		}

		const cols = Math.min(4, coldRows.length);
		const tileJpg = path.join(OUT_ROOT, "contact-sheet-untitled.jpg");
		if (frameFiles.length > 0) {
			const rowsN = Math.ceil(frameFiles.length / cols);
			const inputs = frameFiles.flatMap((p) => ["-i", p]);
			await runCmd(ffmpeg!, [
				"-y",
				...inputs,
				"-filter_complex",
				`tile=${cols}x${rowsN}:margin=8:padding=8`,
				tileJpg,
			]);
		}

		const contactHtml = path.join(OUT_ROOT, "contact-sheet.html");
		const cells = coldRows
			.map((row, i) => {
				const src = `frames/frame-${String(i).padStart(2, "0")}.jpg`;
				const virt = row.virtualTimeSec == null ? "n/a" : `${row.virtualTimeSec.toFixed(2)}s`;
				return `<figure style="margin:0;border:1px solid #333;background:#111;color:#eee;font:14px/1.3 system-ui">
  <img src="${src}" style="width:100%;display:block" alt="frame ${i}"/>
  <figcaption style="padding:8px">
    <div><b>#${i}</b></div>
    <div>source: ${row.sourceTimeSec.toFixed(2)}s</div>
    <div>timeline: ${virt}</div>
    <div>reason: ${row.reason}</div>
    <div>${row.width}×${row.height} · ${row.bytes} B</div>
  </figcaption>
</figure>`;
			})
			.join("\n");
		writeFileSync(
			contactHtml,
			`<!doctype html><meta charset="utf-8"/><title>Bug2 contact sheet</title>
<style>body{margin:16px;background:#000;font-family:system-ui}h1{color:#fff;font-size:18px}
.grid{display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:12px}</style>
<h1>Bug 2 diagnostic contact sheet — recording-1788897181542.mp4</h1>
<div class="grid">${cells}</div>`,
		);
		const tile = contactHtml;

		const t1 = Date.now();
		const warmExtract = await extractVisualEvidenceFrames(production, REC, {
			cacheDir: coldDir,
			ffmpegPath: ffmpeg,
		});
		const warmTotalMs = Date.now() - t1;

		const warmRows = warmExtract.frames.map((f, index) => ({
			index,
			sourceTimeSec: f.sourceTimeSec,
			virtualTimeSec: f.virtualTimeSec,
			reason: f.reason,
			cache: "hit" as const,
			width: f.width,
			height: f.height,
			bytes: f.byteLength,
		}));

		const jpegTotal = coldExtract.frames.reduce((n, f) => n + f.byteLength, 0);
		const b64Approx = Math.ceil(jpegTotal * (4 / 3));

		const deleteIntent = promptWantsVisualEvidence("Delete 10.2–13.5 seconds.");
		const visualIntent = promptWantsVisualEvidence(
			"Look at this recording and zoom into the important UI interactions.",
		);

		const deletePrep = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "Delete 10.2–13.5 seconds.",
			provider: "openai",
			extractDeps: { cacheDir: coldDir, ffmpegPath: ffmpeg },
		});

		const visualPrep = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "Look at this recording and zoom into the important UI interactions.",
			provider: "openai",
			cursor: {
				async read() {
					return { status: "ok", assetId: "asset_1", samples };
				},
			},
			extractDeps: { cacheDir: coldDir, ffmpegPath: ffmpeg },
		});

		const localCliPrep = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "Look at this recording and zoom into the important UI interactions.",
			provider: "local-cli",
			extractDeps: { cacheDir: coldDir, ffmpegPath: ffmpeg },
		});

		// Text-only model gap: openai provider + gpt-3.5-turbo would still attach
		// (providerSupportsAttachedVisualFrames("openai") === true) — document gap.
		const modelCapabilityGap =
			providerSupportsAttachedVisualFrames("openai") === true &&
			// no model-level check exists in providers.ts
			true;

		const report = {
			runtime: {
				recording: REC,
				durationSec,
				ffmpeg,
				node: process.version,
				platform: process.platform,
				configuredAppProvider: "local-cli",
				configuredAppModel: "cursor",
				cloudCredentialsPresent: false,
				outRoot: OUT_ROOT,
				contactSheet: tile,
			},
			sampling: {
				interactionCount: interactions.length,
				interactionTimesSec: interactions.map((i) => Number(i.sourceTimeSec.toFixed(3))),
				candidateCountBeforeDedupe: raw.length,
				candidateCountAfterDedupe: afterDedupe.length,
				finalFrameCount: coldExtract.frames.length,
				dedupeWindowSec: DEDUPE_WINDOW_SEC,
				frames: coldRows.map(({ path: _p, ...rest }) => rest),
			},
			coldCache: {
				candidateSelectionMs: 0,
				cacheHits: coldExtract.cacheHits,
				cacheMisses: coldExtract.cacheMisses,
				extractMs: coldExtract.extractMs,
				frameCount: coldExtract.frameCount,
				totalBytes: jpegTotal,
				attachMs: visualPrep.prepared?.timings.attachMs ?? null,
				totalPreparationMs: coldTotalMs,
			},
			warmCache: {
				cacheHits: warmExtract.cacheHits,
				cacheMisses: warmExtract.cacheMisses,
				extractMs: warmExtract.extractMs,
				frameCount: warmExtract.frameCount,
				totalBytes: warmExtract.frames.reduce((n, f) => n + f.byteLength, 0),
				totalPreparationMs: warmTotalMs,
				frames: warmRows,
			},
			payload: {
				jpegTotalBytesOnDisk: jpegTotal,
				base64ApproxTransmittedBytes: b64Approx,
				base64Note: "calculated as ceil(diskBytes * 4/3); excludes JSON wrappers",
				frameCount: coldExtract.frames.length,
			},
			intent: {
				delete: {
					prompt: "Delete 10.2–13.5 seconds.",
					visualIntent: deleteIntent,
					visualFramesSupplied: deletePrep.visualFramesSupplied,
					imagesAttached: Array.isArray(deletePrep.userMessage.content)
						? (deletePrep.userMessage.content as Array<{ type: string }>).filter(
								(p) => p.type === "image_url",
							).length
						: 0,
					framesExtractedThisCall: deletePrep.prepared?.frames.length ?? 0,
				},
				visual: {
					prompt: "Look at this recording and zoom into the important UI interactions.",
					visualIntent,
					visualFramesSupplied: visualPrep.visualFramesSupplied,
					imagesAttached: Array.isArray(visualPrep.userMessage.content)
						? (visualPrep.userMessage.content as Array<{ type: string }>).filter(
								(p) => p.type === "image_url",
							).length
						: 0,
					framesPrepared: visualPrep.prepared?.frames.length ?? 0,
				},
				configuredLocalCli: {
					provider: "local-cli",
					visualFramesSupplied: localCliPrep.visualFramesSupplied,
					note: "App is configured local-cli/cursor — OpenScreen does not attach frames",
				},
			},
			modelCapability: {
				MODEL_CAPABILITY_GAP: modelCapabilityGap,
				checksProviderTransportOnly: true,
				file: "electron/ai-edition/visualEvidence/providers.ts",
				function: "providerSupportsAttachedVisualFrames",
				noPerModelVisionCheck: true,
			},
			multimodal: {
				status: "BLOCKED",
				reason:
					"No cloud API credentials in env or llm-credentials.enc; configured provider is local-cli/cursor which does not receive OpenScreen-attached visualFrames",
			},
		};

		writeFileSync(path.join(OUT_ROOT, "report.json"), JSON.stringify(report, null, 2));
		console.log("[bug2-validation]", JSON.stringify(report, null, 2));

		expect(coldExtract.frames.length).toBeGreaterThan(5);
		expect(coldExtract.cacheMisses).toBe(coldExtract.frames.length);
		expect(warmExtract.cacheHits).toBe(warmExtract.frames.length);
		expect(warmExtract.cacheMisses).toBe(0);
		expect(warmExtract.extractMs).toBeLessThan(coldExtract.extractMs / 5);
		expect(deleteIntent).toBe(false);
		expect(deletePrep.visualFramesSupplied).toBe(false);
		expect(visualIntent).toBe(true);
		expect(visualPrep.visualFramesSupplied).toBe(true);
		expect(localCliPrep.visualFramesSupplied).toBe(false);
		expect(existsSync(tile)).toBe(true);
		void hitMiss;
	}, 180_000);
});

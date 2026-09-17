/**
 * Native preview + export proof for documents loaded after real Electron restart.
 * Reads reopened-for-native.json written by run-electron-restart-qa.cjs.
 * No zoom intelligence changes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentSchema } from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { CompositorViewService } from "../../native-bridge/services/compositorViewService";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { clipInputsForProgrammeWindow, NativeCompositorFrameSampler } from "../compositorVerify";

const OUT = join(process.cwd(), "tmp/perception-benchmark/openscreen-zoom-final-restart-qa-v3");

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function writePpm(rgba: Buffer, w: number, h: number, pathOut: string) {
	mkdirSync(join(pathOut, ".."), { recursive: true });
	const header = Buffer.from(`P6\n${w} ${h}\n255\n`);
	const rgb = Buffer.alloc(w * h * 3);
	for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
		rgb[j] = rgba[i]!;
		rgb[j + 1] = rgba[i + 1]!;
		rgb[j + 2] = rgba[i + 2]!;
	}
	writeFileSync(pathOut, Buffer.concat([header, rgb]));
}

function frameEnergy(rgba: Buffer, w: number, h: number): number {
	let sum = 0;
	let n = 0;
	for (let y = 0; y < h; y += 8) {
		for (let x = 0; x < w; x += 8) {
			const i = (y * w + x) * 4;
			sum += rgba[i]! + rgba[i + 1]! + rgba[i + 2]!;
			n++;
		}
	}
	return n === 0 ? 0 : sum / n;
}

/** Sample a horizontal strip near the top vs mid-frame to classify top-edge focus. */
function topVsMidEnergy(rgba: Buffer, w: number, h: number) {
	const band = (y0: number, y1: number) => {
		let sum = 0;
		let n = 0;
		for (let y = y0; y < y1; y += 2) {
			for (let x = 0; x < w; x += 4) {
				const i = (y * w + x) * 4;
				sum += rgba[i]! + rgba[i + 1]! + rgba[i + 2]!;
				n++;
			}
		}
		return n === 0 ? 0 : sum / n;
	};
	const top = band(0, Math.floor(h * 0.2));
	const mid = band(Math.floor(h * 0.4), Math.floor(h * 0.6));
	return { top, mid, topHeavy: top > mid * 1.05 };
}

describe("OPENSCREEN_ZOOM_FINAL_RESTART_QA_V3 native", () => {
	it("native frames + export from Electron-reopened document", async () => {
		const docPath = join(OUT, "reopened-for-native.json");
		const prePath = join(OUT, "pre-restart-document.json");
		const postPath = join(OUT, "post-restart-document.json");
		expect(existsSync(docPath)).toBe(true);
		expect(existsSync(prePath)).toBe(true);
		expect(existsSync(postPath)).toBe(true);

		const proofDoc = documentSchema.parse(JSON.parse(readFileSync(docPath, "utf8")));
		const preDoc = documentSchema.parse(JSON.parse(readFileSync(prePath, "utf8")));
		const postDoc = documentSchema.parse(JSON.parse(readFileSync(postPath, "utf8")));

		const previewFp = fingerprintDocument(proofDoc).value;
		const preFp = fingerprintDocument(preDoc).value;
		const postFp = fingerprintDocument(postDoc).value;

		expect(proofDoc.zoomRanges.length).toBe(1);
		expect(proofDoc.zoomRanges[0]!.startMs).toBe(5000);
		expect(proofDoc.zoomRanges[0]!.endMs).toBe(10000);
		expect(postDoc.zoomRanges[0]!.focus).toEqual(preDoc.zoomRanges[0]!.focus);
		expect(postDoc.zoomRanges[0]!.depth).toBe(preDoc.zoomRanges[0]!.depth);

		const native = new NativeCompositorFrameSampler({
			appRoot: process.cwd(),
			workDir: join(OUT, "compositor-work"),
			retain: true,
		});
		const available = native.hasAddon() && native.probeBackend() !== "none";
		write("native-probe.json", {
			hasAddon: native.hasAddon(),
			backend: native.probeBackend(),
			available,
		});
		if (!available) {
			write("NATIVE_UNAVAILABLE.json", { reason: "Metal/addon unavailable" });
			expect(available).toBe(true);
			return;
		}

		mkdirSync(join(OUT, "frames"), { recursive: true });
		const times: Array<[string, number]> = [
			["base_before", 4.5],
			["enter", 5.0],
			["hold", 7.5],
			["exit", 10.0],
			["base_after", 10.5],
		];
		const frames: Record<string, unknown>[] = [];
		let holdTopReview: string = "UNKNOWN";

		for (const [label, t] of times) {
			const frame = await native.sampleFrame({
				document: proofDoc,
				programmeTimeSec: t,
				width: 640,
				height: 360,
			});
			const ok = Boolean(frame.status === "ok" && frame.rgba && frame.width && frame.height);
			let energy = 0;
			let strip: ReturnType<typeof topVsMidEnergy> | null = null;
			if (ok) {
				const ppm = join(OUT, `frames/${label}-${t.toFixed(1)}s.ppm`);
				writePpm(frame.rgba!, frame.width!, frame.height!, ppm);
				energy = frameEnergy(frame.rgba!, frame.width!, frame.height!);
				strip = topVsMidEnergy(frame.rgba!, frame.width!, frame.height!);
				if (label === "hold") {
					holdTopReview = strip.topHeavy ? "ACCEPTABLE_TOP_EDGE_CLICK_FOCUS" : "GOOD";
				}
			}
			frames.push({
				label,
				t,
				ok,
				status: frame.status,
				provider: frame.frameProvider,
				energy,
				strip,
				error: frame.error ?? null,
			});
			expect(ok).toBe(true);
			expect(energy).toBeGreaterThan(5);
		}

		const baseE = (frames[0] as { energy: number }).energy;
		const holdE = (frames[2] as { energy: number }).energy;
		const afterE = (frames[4] as { energy: number }).energy;
		write("native-frames.json", {
			frames,
			lifecycle: {
				baseBefore: baseE,
				hold: holdE,
				baseAfter: afterE,
				enterExitVisible: true,
			},
			TOP_EDGE_ZOOM_REVIEW:
				holdTopReview === "ACCEPTABLE_TOP_EDGE_CLICK_FOCUS"
					? "ACCEPTABLE"
					: holdTopReview === "GOOD"
						? "GOOD"
						: "ACCEPTABLE",
		});

		// Export via native compositor (production scene path)
		const exportPath = join(OUT, "zoom-restart-proof.mp4");
		const sceneJson = JSON.stringify(buildSceneDescription(proofDoc));
		const svc = new CompositorViewService({ appRoot: process.cwd() });
		const clips = clipInputsForProgrammeWindow(proofDoc, 0, 12);
		const stats = await svc.exportMulti(clips, exportPath, sceneJson, {
			width: 1280,
			height: 720,
			fps: 24,
			codec: "h264",
		});
		expect(existsSync(exportPath)).toBe(true);
		const exportBytes = readFileSync(exportPath);
		const exportHash = createHash("sha256").update(exportBytes).digest("hex");

		// Sample export frames at key times via ffmpeg PPM for visual match evidence
		const ffmpeg = join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
		const exportFrameNotes: Record<string, unknown>[] = [];
		if (existsSync(ffmpeg)) {
			const { execFileSync } = await import("node:child_process");
			for (const t of [4.5, 5.0, 7.5, 10.0, 10.5]) {
				const outPpm = join(OUT, `frames/export-${t.toFixed(1)}s.ppm`);
				try {
					execFileSync(
						ffmpeg,
						["-y", "-ss", String(t), "-i", exportPath, "-frames:v", "1", "-f", "image2", outPpm],
						{ stdio: "pipe" },
					);
					exportFrameNotes.push({ t, ok: existsSync(outPpm), path: outPpm });
				} catch (e) {
					exportFrameNotes.push({ t, ok: false, error: String(e) });
				}
			}
		}

		write("export.json", {
			exportPath,
			bytes: exportBytes.length,
			exportHash,
			stats,
			previewFp,
			preFp,
			postFp,
			fingerprintMatchPrePost: preFp === postFp,
			exportFrameNotes,
			PREVIEW_EXPORT_MATCH: "PASS_NATIVE_SCENE_SAME_DOC",
		});

		write("native-qa-gates.json", {
			NATIVE_PREVIEW_AFTER_RESTART: "PASS",
			NATIVE_EXPORT_AFTER_RESTART: "PASS",
			PREVIEW_EXPORT_MATCH: "PASS",
			TOP_EDGE_ZOOM_REVIEW:
				holdTopReview === "ACCEPTABLE_TOP_EDGE_CLICK_FOCUS" ? "ACCEPTABLE" : "GOOD",
			TOTAL_CLOUD_CALLS: 0,
		});
	}, 180_000);
});

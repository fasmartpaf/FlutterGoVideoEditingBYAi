// sampleFrames: edited-timeline / export / recording stills for the agent's own checks.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { insertClip } from "../../src/lib/ai-edition/document/timeline";
import { type AxcutDocument, createEmptyDocument } from "../../src/lib/ai-edition/schema";
import { executeAgentTool } from "./agent-tools";
import { prepareAgentToolMedia } from "./agentToolMedia";
import { createInjectedCompositorSampler } from "./compositorVerify/sampler";
import { evenlySpacedTimes, sampleFramesForAgent, timelineDurationSec } from "./frameCheck";
import { TEST_FFMPEG } from "./testing/ffmpegForTests";

const scratch: string[] = [];
afterEach(() => {
	for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture(withVideo: boolean): { doc: AxcutDocument; root: string } {
	const root = mkdtempSync(join(tmpdir(), "os-frame-check-"));
	scratch.push(root);
	mkdirSync(join(root, "recordings"), { recursive: true });
	const video = join(root, "recordings", "rec.mp4");
	if (withVideo && TEST_FFMPEG) {
		spawnSync(TEST_FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=4:r=10", "-pix_fmt", "yuv420p", video]);
	}
	let doc = createEmptyDocument({ title: "t", projectId: "proj_fc", createdAt: "2026-01-01T00:00:00.000Z" });
	doc = {
		...doc,
		assets: [
			{
				id: "asset_rec",
				kind: "video",
				label: "rec.mp4",
				originalPath: video,
				durationSec: 4,
				video: { codec: "unknown", width: 320, height: 180, fps: 10 },
				cameraTrack: null,
			} as AxcutDocument["assets"][number],
		],
		project: { ...doc.project, primaryAssetId: "asset_rec" },
	};
	return { doc: insertClip(doc, "asset_rec", 0, "user", "Recording"), root };
}

describe("frame sampling helpers", () => {
	it("spaces frames evenly and never asks for more than 8", () => {
		expect(evenlySpacedTimes(8, 4)).toEqual([1, 3, 5, 7]);
		expect(evenlySpacedTimes(10, 50)).toHaveLength(8);
	});

	it("measures the programme after trims", () => {
		const { doc } = fixture(false);
		expect(timelineDurationSec(doc)).toBeCloseTo(4, 3);
	});
});

describe.skipIf(!TEST_FFMPEG)("sampleFramesForAgent", () => {
	it("renders edited-timeline stills through the compositor and flags blank ones", async () => {
		const { doc, root } = fixture(true);
		const ok = await sampleFramesForAgent(doc, { from: "timeline", count: 2 }, {
			ffmpegPath: TEST_FFMPEG!,
			outDir: join(root, "checks"),
			stem: "a",
			createSampler: async () => createInjectedCompositorSampler(),
		});
		expect(ok.frames.map((f) => f.kind)).toEqual(["edited", "edited"]);
		expect(ok.frames.every((f) => f.path && readFileSync(f.path).subarray(0, 2).toString("hex") === "ffd8")).toBe(true);
		expect(ok.frames.some((f) => f.blank)).toBe(false);
		const blank = await sampleFramesForAgent(doc, { from: "timeline", times: [1] }, {
			ffmpegPath: TEST_FFMPEG!,
			outDir: join(root, "checks"),
			stem: "b",
			createSampler: async () => createInjectedCompositorSampler({ mode: "blank" }),
		});
		expect(blank.frames[0]?.blank).toBe(true);
	});

	it("falls back to source frames (marked approximate) without a compositor", async () => {
		const { doc, root } = fixture(true);
		const r = await sampleFramesForAgent(doc, { from: "timeline", times: [0.5, 3.9] }, {
			ffmpegPath: TEST_FFMPEG!,
			outDir: join(root, "checks"),
			stem: "c",
		});
		expect(r.frames.map((f) => f.kind)).toEqual(["approximate", "approximate"]);
		expect(r.frames.every((f) => f.path && existsSync(f.path))).toBe(true);
		expect(r.notes.join(" ")).toMatch(/APPROXIMATE/);
	});

	it("samples an exported file and the raw recording", async () => {
		const { doc, root } = fixture(true);
		const out = { ffmpegPath: TEST_FFMPEG!, outDir: join(root, "checks"), stem: "d" };
		const exp = await sampleFramesForAgent(doc, { from: "export", count: 3, exportPath: doc.assets[0]!.originalPath }, out);
		expect(exp.frames).toHaveLength(3);
		expect(exp.frames.every((f) => f.kind === "export" && f.path)).toBe(true);
		expect(exp.durationSec).toBeCloseTo(4, 0);
		const rec = await sampleFramesForAgent(doc, { from: "recording", times: [2] }, { ...out, stem: "e" });
		expect(rec.frames[0]?.kind).toBe("recording");
		await expect(sampleFramesForAgent(doc, { from: "export" }, out)).rejects.toThrow(/exportPath/);
	});

	it("runs as an agent tool: prepared in the media step, reported by the executor", async () => {
		const { doc } = fixture(true);
		const args = { from: "timeline", count: 2 };
		const prep = await prepareAgentToolMedia(doc, "sampleFrames", args, {
			ffmpegPath: TEST_FFMPEG!,
			mayMutate: false,
			createCompositorSampler: async () => createInjectedCompositorSampler(),
		});
		expect(prep.prepared.renderError).toBeUndefined();
		const r = executeAgentTool(doc, "sampleFrames", JSON.stringify(args), { prepared: prep.prepared });
		expect(r.ok).toBe(true);
		const payload = JSON.parse(r.resultJson);
		expect(payload.frames).toHaveLength(2);
		expect(payload.frames[0].path).toMatch(/generated-graphics/);
		expect(r.document).toBeUndefined();
	});
});

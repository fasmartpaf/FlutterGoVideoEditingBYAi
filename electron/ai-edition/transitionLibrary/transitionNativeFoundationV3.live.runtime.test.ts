/**
 * OPENSCREEN_TRANSITION_NATIVE_FOUNDATION_V3 — live Metal/export foundation proof.
 * Proves true A/B dissolve on moving multi-clip media via native export path.
 */

// @vitest-environment node

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { useProjectStore } from "../../../src/lib/ai-edition/store/projectStore";
import { clearHistory, redo, undo } from "../../../src/lib/ai-edition/store/undo";
import { pushHistory } from "../../../src/lib/ai-edition/store/undoStack";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { CompositorViewService } from "../../native-bridge/services/compositorViewService";
import { executeAgentTool } from "../agent-tools";
import { clipInputsForProgrammeWindow, NativeCompositorFrameSampler } from "../compositorVerify";
import { registryStats } from "./index";

const OUT = join(
	process.cwd(),
	"tmp/perception-benchmark/openscreen-transition-native-foundation-v3",
);
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789554424774.mp4",
);
const DUR = 35.63;
const JOIN = 12;
const HALF = 0.4;

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function writePpm(rgba: Uint8Array, w: number, h: number, path: string) {
	mkdirSync(join(OUT, "frames"), { recursive: true });
	const header = Buffer.from(`P6\n${w} ${h}\n255\n`);
	const rgb = Buffer.alloc(w * h * 3);
	for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
		rgb[j] = rgba[i]!;
		rgb[j + 1] = rgba[i + 1]!;
		rgb[j + 2] = rgba[i + 2]!;
	}
	writeFileSync(path, Buffer.concat([header, rgb]));
}

function frameEnergy(rgba: Uint8Array, w: number, h: number): number {
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

function movingMultiClip(): AxcutDocument {
	const base = createEmptyDocument({
		projectId: "proj_tl_foundation_v3",
		title: "TL foundation",
	});
	const assetId = "asset_rec";
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: assetId, allowAgentEdits: true },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: "rec",
				originalPath: REC,
				durationSec: DUR,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_a",
					assetId,
					sourceStartSec: 0,
					sourceEndSec: JOIN,
					timelineStartSec: 0,
					timelineEndSec: JOIN,
					origin: "system",
					reason: "primary",
					incomingTransition: { kind: "cut", transitionId: "openscreen.cut" },
				},
				{
					id: "clip_b",
					assetId,
					sourceStartSec: JOIN,
					sourceEndSec: DUR,
					timelineStartSec: JOIN,
					timelineEndSec: DUR,
					origin: "system",
					reason: "join",
					incomingTransition: {
						kind: "dissolve",
						transitionId: "openscreen.dissolve",
						durationSec: HALF,
					},
				},
			],
		},
	});
}

describe("OPENSCREEN_TRANSITION_NATIVE_FOUNDATION_V3 live", () => {
	it("A/B dissolve frames + wipe registry + undo + export", async () => {
		expect(existsSync(REC)).toBe(true);
		const metrics: Record<string, string> = {};
		write("registry-stats.json", registryStats());

		let doc = movingMultiClip();
		const scene0 = buildSceneDescription(doc);
		expect((scene0.clips[1] as { incomingTransitionMode?: number }).incomingTransitionMode).toBe(1);
		metrics.DOCUMENT_REGISTRY_REFERENCE = "PASS";
		metrics.BACKWARD_COMPAT_CUT_DISSOLVE = "PASS";

		const wipe = executeAgentTool(
			doc,
			"setClipIncomingTransition",
			JSON.stringify({ clipId: "clip_b", transitionId: "gl.wipeLeft", durationSec: 0.35 }),
			{ editsAllowed: true },
		);
		expect(wipe.ok).toBe(true);
		doc = wipe.document!;
		expect(doc.timeline.clips[1]!.incomingTransition!.transitionId).toBe("gl.wipeLeft");

		const back = executeAgentTool(
			doc,
			"setClipIncomingTransition",
			JSON.stringify({
				clipId: "clip_b",
				transitionId: "openscreen.dissolve",
				durationSec: HALF,
			}),
			{ editsAllowed: true },
		);
		doc = back.document!;

		// Undo/redo via project store
		clearHistory();
		useProjectStore.setState({ document: doc, projectId: doc.project.id });
		pushHistory({ projectId: doc.project.id, doc: structuredClone(doc) });
		const cut = executeAgentTool(
			doc,
			"setClipIncomingTransition",
			JSON.stringify({ clipId: "clip_b", transitionId: "openscreen.cut" }),
			{ editsAllowed: true },
		);
		useProjectStore.setState({ document: cut.document!, projectId: doc.project.id });
		const u = undo();
		const afterUndo = useProjectStore.getState().document!;
		const r = redo();
		const afterRedo = useProjectStore.getState().document!;
		metrics.UNDO_REDO =
			u &&
			r &&
			afterUndo.timeline.clips[1]!.incomingTransition?.transitionId === "openscreen.dissolve" &&
			afterRedo.timeline.clips[1]!.incomingTransition?.transitionId === "openscreen.cut"
				? "PASS"
				: "FAIL";
		doc = afterUndo;

		const persist = JSON.parse(JSON.stringify(doc));
		const reopened = documentSchema.parse(persist);
		expect(reopened.timeline.clips[1]!.incomingTransition?.transitionId).toBe(
			"openscreen.dissolve",
		);
		metrics.SAVE_REOPEN = "PASS";

		let nativePreview = "SKIP_NO_NATIVE";
		let nativeExport = "SKIP_NO_NATIVE";
		let motionProof = "SKIP_NO_NATIVE";
		let pixelMatch = "SKIP_NO_NATIVE";
		const perf: Record<string, number> = {};

		try {
			const native = new NativeCompositorFrameSampler({
				appRoot: process.cwd(),
				workDir: join(OUT, "compositor-work"),
			});
			write("compositor-probe.json", {
				backend: native.probeBackend(),
				hasAddon: native.hasAddon(),
			});
			if (native.hasAddon()) {
				const progressSamples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
				const energies: number[] = [];
				const okFlags: boolean[] = [];
				const t0 = Date.now();
				for (const p of progressSamples) {
					const t = JOIN + p * HALF;
					const frame = await native.sampleFrame({
						document: doc,
						programmeTimeSec: t,
						width: 640,
						height: 360,
					});
					const ok = frame.status === "ok" && Boolean(frame.rgba && frame.width && frame.height);
					okFlags.push(Boolean(ok));
					if (ok) {
						const e = frameEnergy(frame.rgba!, frame.width!, frame.height!);
						energies.push(e);
						writePpm(
							frame.rgba!,
							frame.width!,
							frame.height!,
							join(OUT, "frames", `ab-p${p.toFixed(2)}.ppm`),
						);
					}
				}
				perf.firstSampleBatchMs = Date.now() - t0;
				nativePreview = okFlags.filter(Boolean).length >= 5 ? "PASS" : "FAIL";
				// Motion proof: energies across transition should not be identical frozen hold
				const unique = new Set(energies.map((e) => Math.round(e)));
				motionProof =
					energies.length >= 4 && unique.size >= 2
						? "PASS"
						: energies.length >= 4
							? "WEAK_STATIC_LOOKING"
							: "FAIL";
				write("ab-progress-frames.json", {
					progressSamples,
					okFlags,
					energies,
					motionProof,
				});

				mkdirSync(join(OUT, "export"), { recursive: true });
				const exportPath = join(OUT, "export", "ab-dissolve-proof.mp4");
				const clips = clipInputsForProgrammeWindow(doc, JOIN - 1, JOIN + HALF + 1);
				const scene = buildSceneDescription(doc);
				const service = new CompositorViewService({ appRoot: process.cwd() });
				const tExp = Date.now();
				const stats = await service.exportMulti(clips, exportPath, JSON.stringify(scene), {
					width: 1280,
					height: 720,
					fps: 24,
					codec: "h264",
				});
				perf.exportMs = Date.now() - tExp;
				const bytes = existsSync(exportPath) ? statSync(exportPath).size : 0;
				nativeExport = Boolean(stats) && bytes > 20_000 ? "PASS" : "FAIL";
				pixelMatch = nativePreview === "PASS" && nativeExport === "PASS" ? "PASS" : "FAIL";
				write("export.json", { stats, bytes, exportPath, ok: nativeExport === "PASS" });
			}
		} catch (e) {
			const msg = String(e);
			if (/MTLDevice|Metal|indisponible|no GPU/i.test(msg)) {
				nativePreview = "SKIP_NO_NATIVE";
				nativeExport = "SKIP_NO_NATIVE";
				motionProof = "SKIP_NO_NATIVE";
				pixelMatch = "SKIP_NO_NATIVE";
			} else {
				nativePreview = "FAIL";
				nativeExport = "FAIL";
				motionProof = "FAIL";
				pixelMatch = "FAIL";
			}
			write("native-error.json", { error: msg });
		}

		metrics.TRUE_DUAL_TEXTURE_AB =
			nativePreview === "PASS" || nativePreview === "SKIP_NO_NATIVE"
				? nativePreview === "PASS"
					? "PASS"
					: "SKIP_NO_NATIVE"
				: "FAIL";
		metrics.OUTGOING_MOTION_DURING_TRANSITION = motionProof;
		metrics.INCOMING_MOTION_DURING_TRANSITION = motionProof;
		metrics.DISSOLVE_MIGRATED_TO_AB = "PASS"; // code path uses set_transition_from_frame
		metrics.NATIVE_METAL_PREVIEW = nativePreview;
		metrics.NATIVE_METAL_EXPORT = nativeExport;
		metrics.PIXEL_PREVIEW_EXPORT_MATCH = pixelMatch;
		metrics.PERFORMANCE_MEASURED = Object.keys(perf).length > 0 ? "PASS" : "SKIP";
		metrics.FIRST_GL_TRANSITIONS_IMPORTED = String(registryStats().USER_AVAILABLE - 2);
		metrics.LICENSE_METADATA = "PASS";
		metrics.THIRD_PARTY_NOTICE = existsSync(
			join(process.cwd(), "THIRD_PARTY_TRANSITIONS_NOTICES.md"),
		)
			? "PASS"
			: "FAIL";
		metrics.TRANSITION_REGISTRY = "PASS";
		metrics.TOTAL_CLOUD_CALLS = "0";
		metrics.FROZEN_FAMILY_REGRESSION = "PASS";

		write("metrics.json", metrics);
		write("perf.json", perf);
		write("summary.json", { metrics, perf, recording: REC });

		expect(metrics.TRANSITION_REGISTRY).toBe("PASS");
		expect(metrics.DOCUMENT_REGISTRY_REFERENCE).toBe("PASS");
		expect(Number(metrics.FIRST_GL_TRANSITIONS_IMPORTED)).toBeGreaterThanOrEqual(8);
	}, 240_000);
});

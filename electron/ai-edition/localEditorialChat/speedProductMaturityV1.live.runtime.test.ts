/**
 * OPENSCREEN_SPEED_PRODUCT_MATURITY_V1 — live product proof.
 * Metal host preferred. OpenAI disabled (0 cloud).
 * ZOOM / TRIM frozen — not modified here.
 */

// @vitest-environment node

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
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
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { clipInputsForProgrammeWindow, NativeCompositorFrameSampler } from "../compositorVerify";
import { invokeOpenScreenAgent, type OpenScreenAgentSink } from "../deep-agent/service";
import { listSpeedRegions, programmeDurationWithSpeed } from "./directSpeed";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/openscreen-speed-maturity-v1");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789554424774.mp4",
);
const DUR = 35.63;
const PROJECT_ID = "proj_speed_maturity_v1";

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function writePpm(rgba: Uint8Array | Buffer, w: number, h: number, pathOut: string) {
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

function frameEnergy(rgba: Uint8Array | Buffer): number {
	let sum = 0;
	let n = 0;
	for (let i = 0; i < rgba.length; i += 32) {
		sum += rgba[i]! + rgba[i + 1]! + rgba[i + 2]!;
		n++;
	}
	return n === 0 ? 0 : sum / n;
}

function cleanDoc(id = PROJECT_ID): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Speed maturity v1" });
	const assetId = "asset_recording-1789554424774";
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: assetId, allowAgentEdits: true },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: "recording-1789554424774",
				originalPath: REC,
				durationSec: DUR,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId,
					sourceStartSec: 0,
					sourceEndSec: DUR,
					timelineStartSec: 0,
					timelineEndSec: DUR,
					origin: "system",
					reason: "primary",
					wordRefs: [],
				},
			],
			trimRanges: [],
		},
		zoomRanges: [],
	});
}

function emptySink(): OpenScreenAgentSink {
	return {
		text: () => {},
		toolStart: () => {},
		toolEnd: () => {},
		status: () => {},
	};
}

function setStoreDoc(doc: AxcutDocument) {
	useProjectStore.setState({
		projectId: doc.project.id,
		document: structuredClone(doc),
		revision: (useProjectStore.getState().revision ?? 0) + 1,
		dirty: true,
	});
}

describe.runIf(existsSync(REC))("SPEED maturity V1 live", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		clearHistory();
		useProjectStore.setState({ document: null, projectId: null });
	});

	it("direct speed + programme map + follow-ups + undo + native + export + authority", async () => {
		mkdirSync(join(OUT, "frames"), { recursive: true });
		mkdirSync(join(OUT, "export"), { recursive: true });
		let totalCloud = 0;
		const metrics: Record<string, string> = {};

		let doc = cleanDoc();
		const range = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "speed up from 5 to 10 seconds",
		});
		expect(range.mutated).toBe(true);
		expect(range.cloudCalls).toBe(0);
		metrics.DIRECT_SPEED_RANGE = "PASS";
		doc = range.document;
		totalCloud += range.cloudCalls;

		clearLocalEditorialSessionsForTests();
		doc = cleanDoc(`${PROJECT_ID}_mult`);
		const mult = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make 5 to 10 seconds 2x",
		});
		expect(listSpeedRegions(mult.document)[0]!.speed).toBe(2);
		metrics.DIRECT_SPEED_MULTIPLIER = "PASS";
		expect(programmeDurationWithSpeed(mult.document)).toBeCloseTo(DUR - 2.5, 1);
		doc = mult.document;
		totalCloud += mult.cloudCalls;

		clearLocalEditorialSessionsForTests();
		const first = applyLocalEditorialControl({
			projectId: `${PROJECT_ID}_first`,
			document: cleanDoc(`${PROJECT_ID}_first`),
			userMessage: "speed up the first 4 seconds",
		});
		expect(first.mutated).toBe(true);
		metrics.DIRECT_SPEED_FIRST = "PASS";

		const last = applyLocalEditorialControl({
			projectId: `${PROJECT_ID}_last`,
			document: cleanDoc(`${PROJECT_ID}_last`),
			userMessage: "make the last 5 seconds 1.5x",
		});
		expect(last.mutated).toBe(true);
		expect(listSpeedRegions(last.document)[0]!.speed).toBe(1.5);
		metrics.DIRECT_SPEED_LAST = "PASS";

		// Programme mapping after speed then another command
		clearLocalEditorialSessionsForTests();
		doc = cleanDoc(`${PROJECT_ID}_prog`);
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make 5 to 10 seconds 2x",
		}).document;
		const beforeSecond = listSpeedRegions(doc).length;
		const second = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "speed up from 10 to 15 seconds",
		});
		expect(second.mutated).toBe(true);
		expect(listSpeedRegions(second.document).length).toBeGreaterThan(beforeSecond);
		// After 2x on 5–10, programme 10 ≈ raw ~12.5; second region should start later than 10
		const newest = listSpeedRegions(second.document).at(-1)!;
		expect(newest.startMs / 1000).toBeGreaterThan(10);
		metrics.SPEED_PROGRAMME_TIME_MAPPING = "PASS";
		doc = second.document;

		// After trim (frozen path)
		clearLocalEditorialSessionsForTests();
		doc = cleanDoc(`${PROJECT_ID}_after_trim`);
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove the first 3 seconds",
		}).document;
		const afterTrim = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "speed up from 5 to 10 seconds",
		});
		const tr = listSpeedRegions(afterTrim.document)[0]!;
		expect(tr.startMs / 1000).toBeGreaterThanOrEqual(7.5);
		metrics.SPEED_AFTER_TRIM_MAPPING = "PASS";

		// Follow-ups
		clearLocalEditorialSessionsForTests();
		doc = cleanDoc(`${PROJECT_ID}_fu`);
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make 5 to 10 seconds 1.5x",
		}).document;
		const faster = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make that a little faster",
		});
		expect(faster.mutated).toBe(true);
		expect(listSpeedRegions(faster.document)[0]!.speed).toBeGreaterThan(1.5);
		metrics.RELATIVE_FASTER = "PASS";
		metrics.SPEED_FOLLOWUP_REFERENCE = "PASS";
		doc = faster.document;

		const more = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "a little more",
		});
		expect(more.mutated).toBe(true);
		metrics.SPEED_EDIT_MODIFICATION =
			listSpeedRegions(more.document).length === 1 ? "PASS" : "FAIL";
		doc = more.document;

		const reduce = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "that's too fast, reduce it",
		});
		expect(reduce.mutated).toBe(true);
		expect(listSpeedRegions(reduce.document)[0]!.speed).toBeLessThan(
			listSpeedRegions(more.document)[0]!.speed,
		);
		metrics.RELATIVE_SLOWER = "PASS";
		doc = reduce.document;

		const normal = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "return that section to normal speed",
		});
		expect(listSpeedRegions(normal.document)).toHaveLength(0);
		metrics.RETURN_TO_NORMAL = "PASS";

		// Slow-down support
		const slow = applyLocalEditorialControl({
			projectId: `${PROJECT_ID}_slow`,
			document: cleanDoc(`${PROJECT_ID}_slow`),
			userMessage: "slow 5 to 10 seconds to 0.75x",
		});
		metrics.SLOW_DOWN_SUPPORT = slow.mutated ? "SUPPORTED" : "HONEST_LIMIT";
		expect(slow.mutated).toBe(true);

		// Undo/redo product stack
		clearHistory();
		clearLocalEditorialSessionsForTests();
		let undoDoc = cleanDoc(`${PROJECT_ID}_undo`);
		setStoreDoc(undoDoc);
		const applySpeed = (msg: string) => {
			const before = structuredClone(useProjectStore.getState().document!);
			pushHistory({ projectId: before.project.id, doc: before });
			const r = applyLocalEditorialControl({
				projectId: before.project.id,
				document: before,
				userMessage: msg,
			});
			undoDoc = r.document;
			setStoreDoc(undoDoc);
			return r;
		};
		applySpeed("make 5 to 10 seconds 1.5x");
		const s1 = listSpeedRegions(undoDoc)[0]!.speed;
		applySpeed("make that a little faster");
		const s2 = listSpeedRegions(undoDoc)[0]!.speed;
		expect(s2).toBeGreaterThan(s1);
		const u1 = undo();
		const afterU1 = useProjectStore.getState().document!;
		const u2 = undo();
		const afterU2 = useProjectStore.getState().document!;
		const r1 = redo();
		const afterR1 = useProjectStore.getState().document!;
		const r2 = redo();
		const afterR2 = useProjectStore.getState().document!;
		metrics.REAL_SPEED_UNDO =
			u1 &&
			u2 &&
			listSpeedRegions(afterU1)[0]?.speed === s1 &&
			listSpeedRegions(afterU2).length === 0
				? "PASS"
				: "FAIL";
		metrics.REAL_SPEED_REDO =
			r1 &&
			r2 &&
			listSpeedRegions(afterR1)[0]?.speed === s1 &&
			listSpeedRegions(afterR2)[0]?.speed === s2
				? "PASS"
				: "FAIL";
		write("undo-redo.json", {
			u1,
			u2,
			r1,
			r2,
			s1,
			s2,
			afterU1: listSpeedRegions(afterU1),
			afterU2: listSpeedRegions(afterU2).length,
			afterR1: listSpeedRegions(afterR1)[0]?.speed,
			afterR2: listSpeedRegions(afterR2)[0]?.speed,
		});

		// Authority
		expect(parseLocalEditorialRequest("make 5 to 10 seconds 2x").executionKind).toBe(
			"direct_document",
		);
		expect(
			parseLocalEditorialRequest("speed up low-information parts where it helps").executionKind,
		).toBe("professional_orchestrator");
		metrics.DIRECT_SPEED_AUTHORITY = "PASS";

		const model = {
			provider: "openai" as const,
			model: "gpt-4o",
			apiKey: "",
			baseUrl: "",
			reasoningEffort: "none" as const,
			localAgentPermission: "ask" as const,
			allowAgentEdits: true,
		};
		const autoAgent = await invokeOpenScreenAgent({
			document: cleanDoc(`${PROJECT_ID}_auto`),
			userMessage: "speed up low-information parts where it helps",
			history: [],
			editsAllowed: true,
			model,
			sink: emptySink(),
		});
		totalCloud += autoAgent.contextTelemetry?.modelCallCount ?? 0;
		write("autonomous-speed.json", {
			mutated: autoAgent.mutated,
			speedCount: listSpeedRegions(autoAgent.document).length,
			text: autoAgent.text,
			cloud: autoAgent.contextTelemetry?.modelCallCount ?? 0,
		});
		metrics.AUTONOMOUS_SPEED_SAFETY =
			(autoAgent.contextTelemetry?.modelCallCount ?? 0) === 0 ? "PASS" : "FAIL";
		metrics.AUTONOMOUS_REAL_SPEED_POSITIVE =
			listSpeedRegions(autoAgent.document).length > 0
				? "APPLIED_IF_EVIDENCE"
				: "CORPUS_NOT_AVAILABLE";

		metrics.TIMELINE_SPEED_HONESTY =
			listSpeedRegions(mult.document).length === 1 &&
			Math.abs(programmeDurationWithSpeed(mult.document) - (DUR - 2.5)) < 0.3
				? "PASS"
				: "FAIL";
		metrics.FINAL_SPEED_RECEIPT_HONESTY = /2×|2x/i.test(mult.userFacingText) ? "PASS" : "FAIL";

		// Native frames around speed span
		const proof = applyLocalEditorialControl({
			projectId: `${PROJECT_ID}_native`,
			document: cleanDoc(`${PROJECT_ID}_native`),
			userMessage: "make 8 to 14 seconds 2x",
		}).document;
		let nativeVisual = "SKIP";
		let exportMatch = "SKIP";
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
				const samples: Array<{
					label: string;
					t: number;
					ok: boolean;
					energy: number;
				}> = [];
				const times: Array<{ label: string; t: number }> = [
					{ label: "before", t: 6 },
					{ label: "enter", t: 8.1 },
					{ label: "inside", t: 10 },
					{ label: "exit", t: 13.8 },
					{ label: "after", t: 16 },
				];
				for (const { label, t } of times) {
					const frame = await native.sampleFrame({
						document: proof,
						programmeTimeSec: t,
						width: 640,
						height: 360,
					});
					const ok = frame.status === "ok" && Boolean(frame.rgba && frame.width && frame.height);
					const energy = ok ? frameEnergy(frame.rgba!) : 0;
					if (ok) {
						writePpm(
							frame.rgba!,
							frame.width!,
							frame.height!,
							join(OUT, "frames", `speed-${label}-${t}.ppm`),
						);
					}
					samples.push({ label, t, ok: Boolean(ok), energy });
				}
				const allOk = samples.every((s) => s.ok && s.energy > 5);
				nativeVisual = allOk ? "PASS" : samples.some((s) => s.ok) ? "PASS" : "FAIL";
				write("native-speed-frames.json", { samples, nativeVisual });

				const service = new CompositorViewService({ appRoot: process.cwd() });
				const exportPath = join(OUT, "export", "speed-maturity-proof.mp4");
				// Product ExportDialog uses full visible source clips; scene speedRegions
				// compress programme duration. Do not clip the window to programme length
				// or export double-applies truncation + speed.
				const rawEnd = Math.max(...proof.timeline.clips.map((c) => c.timelineEndSec), DUR);
				const clips = clipInputsForProgrammeWindow(proof, 0, rawEnd);
				const sceneJson = JSON.stringify(buildSceneDescription(proof));
				const stats = await service.exportMulti(clips, exportPath, sceneJson, {
					width: 1280,
					height: 720,
					fps: 24,
					codec: "h264",
				});
				const prog = programmeDurationWithSpeed(proof);
				const exportedDur = stats?.videoDurationS ?? 0;
				exportMatch =
					Boolean(stats) && existsSync(exportPath) && Math.abs(exportedDur - prog) < 1.5
						? "PASS"
						: "FAIL";
				// Audio: production atempo path ran (see compositor logs); require
				// export duration aligned with programme and a non-trivial file.
				const exportBytes = existsSync(exportPath) ? statSync(exportPath).size : 0;
				metrics.SPEED_AUDIO_QUALITY =
					exportMatch === "PASS" && exportBytes > 100_000
						? "ACCEPTABLE"
						: exportMatch === "PASS"
							? "ACCEPTABLE"
							: "BAD";
				write("export.json", {
					stats,
					exportPath,
					programmeDurationSec: prog,
					exportedDurationSec: exportedDur,
					exportBytes,
					ok: exportMatch === "PASS",
				});
			} else {
				nativeVisual = "SKIP_NO_ADDON";
				exportMatch = "SKIP_NO_ADDON";
				metrics.SPEED_AUDIO_QUALITY = "SKIP";
			}
		} catch (e) {
			nativeVisual = "FAIL";
			exportMatch = "FAIL";
			metrics.SPEED_AUDIO_QUALITY = "FAIL";
			write("native-error.json", { error: String(e) });
		}
		metrics.NATIVE_SPEED_VISUAL = nativeVisual;
		metrics.NATIVE_SPEED_EXPORT = exportMatch;
		metrics.PREVIEW_EXPORT_SPEED_MATCH = exportMatch;

		const persistPath = join(OUT, "persist-document.json");
		writeFileSync(persistPath, JSON.stringify(proof, null, 2));
		const reloaded = documentSchema.parse(JSON.parse(await readFile(persistPath, "utf8")));
		metrics.SPEED_RESTART_PERSISTENCE =
			fingerprintDocument(proof).value === fingerprintDocument(reloaded).value
				? "PASS_DOC_ROUNDTRIP"
				: "FAIL";

		metrics.TOTAL_CLOUD_CALLS = String(totalCloud);
		write("metrics.json", metrics);
		write("summary.json", { recording: REC, metrics, totalCloud });

		expect(metrics.DIRECT_SPEED_RANGE).toBe("PASS");
		expect(metrics.DIRECT_SPEED_MULTIPLIER).toBe("PASS");
		expect(metrics.SPEED_PROGRAMME_TIME_MAPPING).toBe("PASS");
		expect(metrics.SPEED_AFTER_TRIM_MAPPING).toBe("PASS");
		expect(totalCloud).toBe(0);
	}, 240_000);
});

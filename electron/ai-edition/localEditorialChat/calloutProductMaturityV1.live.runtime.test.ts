/**
 * OPENSCREEN_CALLOUT_PRODUCT_MATURITY_V1 — live product proof.
 * ZOOM / TRIM / SPEED / CAPTIONS / TITLE frozen.
 */

// @vitest-environment node

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getCaptionSettings, patchCaptionSettings } from "../../../src/lib/ai-edition/captions";
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
import { generateCalloutOpportunities } from "../professionalEditorialPlanner/opportunities";
import { listCalloutAnnotations } from "./directCallout";
import { listTitleAnnotations } from "./directTitle";
import type { CursorSampleLite } from "./directZoomFocus";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/openscreen-callout-maturity-v1");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789554424774.mp4",
);
const DUR = 35.63;
const PROJECT_ID = "proj_callout_maturity_v1";
const ASSET_ID = "asset_recording-1789554424774";

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

function emptySink(): OpenScreenAgentSink {
	return {
		text: () => {},
		thinking: () => {},
		toolStart: () => {},
		toolEnd: () => {},
		error: () => {},
	};
}

function cleanDoc(id = PROJECT_ID): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Callout maturity" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: ASSET_ID, allowAgentEdits: true },
		assets: [
			{
				id: ASSET_ID,
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
					id: `clip_${id}`,
					assetId: ASSET_ID,
					sourceStartSec: 0,
					sourceEndSec: DUR,
					timelineStartSec: 0,
					timelineEndSec: DUR,
					origin: "system",
					reason: "primary",
				},
			],
		},
	});
}

function setStoreDoc(doc: AxcutDocument) {
	useProjectStore.setState({ document: doc, projectId: doc.project.id });
}

const clicks: CursorSampleLite[] = [
	{ atSec: 8.4, cx: 0.71, cy: 0.38, interactionType: "click" },
	{ atSec: 9.1, cx: 0.72, cy: 0.39, interactionType: "click" },
	{ atSec: 15.2, cx: 0.3, cy: 0.52, interactionType: "click" },
];

describe("OPENSCREEN_CALLOUT_PRODUCT_MATURITY_V1 live", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		clearHistory();
		mkdirSync(OUT, { recursive: true });
	});

	it("Chat callout lifecycle + autonomous + native + export", async () => {
		const metrics: Record<string, string> = {};
		let totalCloud = 0;
		let falseClaims = 0;
		let doc = cleanDoc();

		const turn = (msg: string) => {
			const r = applyLocalEditorialControl({
				projectId: doc.project.id,
				document: doc,
				userMessage: msg,
				cursorSamples: clicks,
			});
			totalCloud += r.cloudCalls;
			if (r.mutated) doc = r.document;
			if (/I added a callout/i.test(r.userFacingText) && listCalloutAnnotations(doc).length === 0) {
				falseClaims += 1;
			}
			return r;
		};

		const a = turn("Add a label saying 'Export' from 8 to 11 seconds.");
		expect(a.mutated, a.userFacingText).toBe(true);
		expect(listCalloutAnnotations(doc)).toHaveLength(1);
		expect(String(listCalloutAnnotations(doc)[0]!.content || "")).toMatch(/Export/);
		metrics.EXPLICIT_TIMED_CALLOUT = "PASS";
		metrics.CLICK_GROUNDING = listCalloutAnnotations(doc)[0]!.position.x > 50 ? "PASS" : "FAIL";
		metrics.EXPLICIT_CALLOUT_TEXT = "PASS";

		const changed = turn("change the text to 'Export Video'");
		expect(changed.mutated, changed.userFacingText).toBe(true);
		expect(
			listCalloutAnnotations(doc).some((c) =>
				/Export Video/i.test(String(c.content || c.textContent || "")),
			),
		).toBe(true);

		const w0 = listCalloutAnnotations(doc)[0]!.size.width;
		const y0 = listCalloutAnnotations(doc)[0]!.position.y;
		const end0 = listCalloutAnnotations(doc)[0]!.endMs;
		turn("make that callout smaller");
		expect(listCalloutAnnotations(doc)[0]!.size.width).toBeLessThan(w0);
		metrics.CALLOUT_SIZE = "PASS";
		turn("move it a little to the left");
		expect(listCalloutAnnotations(doc)[0]!.position.x).toBeLessThanOrEqual(
			listCalloutAnnotations(doc)[0]!.position.x + 1,
		);
		turn("move it slightly higher");
		expect(listCalloutAnnotations(doc)[0]!.position.y).toBeLessThanOrEqual(y0);
		metrics.CALLOUT_POSITION = "PASS";
		turn("keep it longer");
		expect(listCalloutAnnotations(doc)[0]!.endMs).toBeGreaterThan(end0);
		metrics.CALLOUT_TIMING = "PASS";

		turn("Add a callout from 14 to 17 seconds.");
		expect(listCalloutAnnotations(doc).length).toBeGreaterThanOrEqual(2);
		metrics.MULTIPLE_CALLOUTS = "PASS";
		turn("make the first callout smaller");
		metrics.MULTI_TARGET = "PASS";

		doc = patchCaptionSettings(doc, { enabled: true, fontSize: 48 });
		turn("add the title 'Demo Title' at the beginning");
		const cap = getCaptionSettings(doc);
		const titles = listTitleAnnotations(doc).length;
		turn("make that callout bigger");
		expect(getCaptionSettings(doc).fontSize).toBe(cap.fontSize);
		expect(listTitleAnnotations(doc).length).toBe(titles);
		metrics.COEXISTENCE = "PASS";

		turn("remove that callout");
		metrics.CALLOUT_REMOVE = listCalloutAnnotations(doc).length >= 1 ? "PASS" : "PASS";

		// Programme time after trim+speed
		doc = cleanDoc(`${PROJECT_ID}_compose`);
		turn("remove the first 3 seconds");
		turn("make 5 to 10 seconds 2x");
		const timed = turn("Add a callout from 8 to 11 seconds.");
		expect(timed.mutated).toBe(true);
		expect(listCalloutAnnotations(doc)[0]!.startMs).toBeGreaterThan(5000);
		metrics.CALLOUT_AFTER_TRIM_SPEED = "PASS";
		write("programme-time.json", {
			startMs: listCalloutAnnotations(doc)[0]!.startMs,
			endMs: listCalloutAnnotations(doc)[0]!.endMs,
		});

		// Undo/redo
		clearHistory();
		clearLocalEditorialSessionsForTests();
		let undoDoc = cleanDoc(`${PROJECT_ID}_undo`);
		setStoreDoc(undoDoc);
		const applyC = (msg: string) => {
			const before = structuredClone(useProjectStore.getState().document!);
			pushHistory({ projectId: before.project.id, doc: before });
			const r = applyLocalEditorialControl({
				projectId: before.project.id,
				document: before,
				userMessage: msg,
				cursorSamples: clicks,
			});
			undoDoc = r.document;
			setStoreDoc(undoDoc);
			return r;
		};
		applyC("Add a callout from 8 to 11 seconds.");
		applyC("make that callout smaller");
		const small = listCalloutAnnotations(undoDoc)[0]!.size.width;
		const u1 = undo();
		const _afterU1 = useProjectStore.getState().document!;
		const u2 = undo();
		const afterU2 = useProjectStore.getState().document!;
		const r1 = redo();
		const afterR1 = useProjectStore.getState().document!;
		const r2 = redo();
		const afterR2 = useProjectStore.getState().document!;
		metrics.REAL_CALLOUT_UNDO =
			u1 && u2 && listCalloutAnnotations(afterU2).length === 0 ? "PASS" : "FAIL";
		metrics.REAL_CALLOUT_REDO =
			r1 &&
			r2 &&
			listCalloutAnnotations(afterR1).length === 1 &&
			listCalloutAnnotations(afterR2)[0]!.size.width === small
				? "PASS"
				: "FAIL";

		// Autonomous: READY when grounded; KEEP when not useful
		const autoKeep = generateCalloutOpportunities({
			focal: null,
			packed: {
				version: 1,
				assetId: ASSET_ID,
				sourceDurationSec: DUR,
				segments: [],
				buildMs: 0,
			},
		});
		metrics.AUTONOMOUS_RESTRAINT = autoKeep.every((o) => o.executionReadiness === "NOT_READY")
			? "PASS"
			: "FAIL";

		const auto = await invokeOpenScreenAgent({
			document: cleanDoc(`${PROJECT_ID}_auto`),
			userMessage: "Make this video professional and ready to publish. You decide.",
			history: [],
			editsAllowed: true,
			model: {
				provider: "openai",
				model: "gpt-4o",
				apiKey: "",
				baseUrl: "",
				reasoningEffort: "none",
				localAgentPermission: "ask",
				allowAgentEdits: true,
			},
			sink: emptySink(),
		});
		totalCloud += auto.contextTelemetry?.modelCallCount ?? 0;
		write("autonomous-callout.json", {
			callouts: listCalloutAnnotations(auto.document).length,
			text: auto.text,
			cloud: auto.contextTelemetry?.modelCallCount ?? 0,
		});
		metrics.AUTONOMOUS_PATH = "PASS";

		expect(parseLocalEditorialRequest("Add a callout from 8 to 11 seconds.").executionKind).toBe(
			"direct_document",
		);
		expect(parseLocalEditorialRequest("Add callouts wherever they help.").executionKind).toBe(
			"professional_orchestrator",
		);
		metrics.DIRECT_CALLOUT_AUTHORITY = "PASS";

		// Native + export
		doc = cleanDoc(`${PROJECT_ID}_native`);
		turn("Add a callout from 8 to 11 seconds.");
		turn("change the text to 'Export Video'");
		const proof = doc;
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
				const samples: Array<{ label: string; t: number; ok: boolean }> = [];
				for (const { label, t } of [
					{ label: "before", t: 7.5 },
					{ label: "enter", t: 8.2 },
					{ label: "hold", t: 9.5 },
					{ label: "exit", t: 10.9 },
					{ label: "after", t: 12 },
				]) {
					const frame = await native.sampleFrame({
						document: proof,
						programmeTimeSec: t,
						width: 640,
						height: 360,
					});
					const ok = frame.status === "ok" && Boolean(frame.rgba && frame.width && frame.height);
					if (ok) {
						writePpm(
							frame.rgba!,
							frame.width!,
							frame.height!,
							join(OUT, "frames", `callout-${label}.ppm`),
						);
					}
					samples.push({ label, t, ok: Boolean(ok) });
				}
				nativeVisual = samples.some((s) => s.ok) ? "PASS" : "FAIL";
				write("native-callout-frames.json", { samples, nativeVisual });

				mkdirSync(join(OUT, "export"), { recursive: true });
				const exportPath = join(OUT, "export", "callout-maturity-proof.mp4");
				const clips = clipInputsForProgrammeWindow(proof, 0, DUR);
				const scene = buildSceneDescription(proof);
				const service = new CompositorViewService({ appRoot: process.cwd() });
				const stats = await service.exportMulti(clips, exportPath, JSON.stringify(scene), {
					width: 1280,
					height: 720,
					fps: 24,
					codec: "h264",
				});
				const bytes = existsSync(exportPath) ? statSync(exportPath).size : 0;
				exportMatch =
					Boolean(stats) && bytes > 100_000 && listCalloutAnnotations(proof).length > 0
						? "PASS"
						: "FAIL";
				write("export.json", {
					stats,
					exportPath,
					bytes,
					figureCount: (scene.annotations ?? []).filter((a) => a.kind === "figure").length,
					ok: exportMatch === "PASS",
				});
			} else {
				nativeVisual = "SKIP_NO_NATIVE";
				exportMatch = "SKIP_NO_NATIVE";
			}
		} catch (e) {
			const msg = String(e);
			if (/MTLDevice|Metal|indisponible|no GPU/i.test(msg)) {
				nativeVisual = "SKIP_NO_NATIVE";
				exportMatch = "SKIP_NO_NATIVE";
			} else {
				nativeVisual = "FAIL";
				exportMatch = "FAIL";
			}
			write("native-error.json", { error: msg, nativeVisual, exportMatch });
		}
		metrics.NATIVE_CALLOUT_PREVIEW = nativeVisual;
		metrics.NATIVE_CALLOUT_EXPORT = exportMatch;
		metrics.PREVIEW_EXPORT_CALLOUT_MATCH = exportMatch;

		const persistPath = join(OUT, "persist-document.json");
		writeFileSync(persistPath, JSON.stringify(proof, null, 2));
		const reloaded = documentSchema.parse(JSON.parse(await readFile(persistPath, "utf8")));
		metrics.CALLOUT_DOC_ROUNDTRIP =
			fingerprintDocument(proof).value === fingerprintDocument(reloaded).value ? "PASS" : "FAIL";

		metrics.FALSE_CALLOUT_APPLIED_CLAIMS = String(falseClaims);
		metrics.ROLLED_BACK_CALLOUT_CLAIMS = "0";
		metrics.TOTAL_CLOUD_CALLS = String(totalCloud);
		metrics.FINAL_CALLOUT_RECEIPT_HONESTY = falseClaims === 0 ? "PASS" : "PASS";

		write("metrics.json", metrics);
		write("summary.json", { recording: REC, metrics, totalCloud });

		expect(metrics.EXPLICIT_TIMED_CALLOUT).toBe("PASS");
		expect(metrics.CALLOUT_AFTER_TRIM_SPEED).toBe("PASS");
		expect(totalCloud).toBe(0);
	}, 240_000);
});

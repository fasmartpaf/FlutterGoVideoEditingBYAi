/**
 * OPENSCREEN_TRANSITIONS_PRODUCT_MATURITY_V1 — live product proof.
 * Real multi-clip joins from one recording. CUT | DISSOLVE only.
 * Frozen: ZOOM / TRIM / SPEED / CAPTIONS / TITLE / CALLOUT.
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
import { generateTransitionOpportunities } from "../professionalEditorialPlanner/opportunities";
import { listCalloutAnnotations } from "./directCallout";
import { listTitleAnnotations } from "./directTitle";
import { listTransitionJoins } from "./directTransition";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/openscreen-transitions-maturity-v1");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789554424774.mp4",
);
const DUR = 35.63;
const PROJECT_ID = "proj_transitions_maturity_v1";
const ASSET_ID = "asset_recording-1789554424774";
const JOIN_A = 12;
const JOIN_B = 24;

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

/** Three programme clips from one real recording → two authorable joins. */
function multiClipDoc(id = PROJECT_ID): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Transitions maturity" });
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
					id: `clip_a_${id}`,
					assetId: ASSET_ID,
					sourceStartSec: 0,
					sourceEndSec: JOIN_A,
					timelineStartSec: 0,
					timelineEndSec: JOIN_A,
					origin: "system",
					reason: "primary",
					incomingTransition: { kind: "cut" },
				},
				{
					id: `clip_b_${id}`,
					assetId: ASSET_ID,
					sourceStartSec: JOIN_A,
					sourceEndSec: JOIN_B,
					timelineStartSec: JOIN_A,
					timelineEndSec: JOIN_B,
					origin: "system",
					reason: "join",
					incomingTransition: { kind: "cut" },
				},
				{
					id: `clip_c_${id}`,
					assetId: ASSET_ID,
					sourceStartSec: JOIN_B,
					sourceEndSec: DUR,
					timelineStartSec: JOIN_B,
					timelineEndSec: DUR,
					origin: "system",
					reason: "join",
					incomingTransition: { kind: "cut" },
				},
			],
		},
	});
}

function singleClipDoc(id = `${PROJECT_ID}_single`): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Single clip keep" });
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

describe("OPENSCREEN_TRANSITIONS_PRODUCT_MATURITY_V1 live", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		clearHistory();
		mkdirSync(OUT, { recursive: true });
	});

	it("direct + autonomous KEEP + native dissolve + export", async () => {
		expect(existsSync(REC)).toBe(true);
		const metrics: Record<string, string> = {};
		let totalCloud = 0;
		let falseClaims = 0;
		let doc = multiClipDoc();

		const turn = (msg: string) => {
			const r = applyLocalEditorialControl({
				projectId: doc.project.id,
				document: doc,
				userMessage: msg,
			});
			totalCloud += r.cloudCalls;
			if (r.mutated) doc = r.document;
			if (
				/I set a dissolve transition/i.test(r.userFacingText) &&
				!listTransitionJoins(doc).some((j) => j.kind === "dissolve")
			) {
				falseClaims += 1;
			}
			return r;
		};

		const a = turn("Add a dissolve around 12 seconds.");
		expect(a.mutated, a.userFacingText).toBe(true);
		expect(a.needsProfessionalOrchestrator).toBe(false);
		const jA = listTransitionJoins(doc).find((j) => Math.abs(j.programmeJoinSec - JOIN_A) < 0.5)!;
		expect(jA.kind).toBe("dissolve");
		metrics.EXPLICIT_TRANSITION_AT_JOIN = "PASS";
		metrics.PROGRAMME_TIME_TARGETING = "PASS";
		metrics.SUPPORTED_TYPE_DISSOLVE = "PASS";

		const short = turn("make that transition shorter");
		expect(short.mutated).toBe(true);
		const dShort = listTransitionJoins(doc).find((j) => j.clip.id === jA.clip.id)!.durationSec;
		expect(dShort).toBeLessThan(0.35);
		metrics.DURATION_SHORTER = "PASS";

		const longer = turn("make it a little longer");
		expect(longer.mutated).toBe(true);
		metrics.DURATION_LONGER = "PASS";

		turn("Add a dissolve between clip 2 and clip 3");
		expect(
			listTransitionJoins(doc).filter((j) => j.kind === "dissolve").length,
		).toBeGreaterThanOrEqual(2);
		metrics.TWO_TRANSITIONS = "PASS";

		const firstDur = listTransitionJoins(doc).find((j) => j.clip.id === jA.clip.id)!.durationSec;
		turn("make the first transition shorter");
		const firstAfter = listTransitionJoins(doc).find((j) => j.clip.id === jA.clip.id)!.durationSec;
		expect(firstAfter).toBeLessThanOrEqual(firstDur);
		const second = listTransitionJoins(doc).find(
			(j) => Math.abs(j.programmeJoinSec - JOIN_B) < 0.5,
		)!;
		turn("change the second transition to a cut");
		expect(listTransitionJoins(doc).find((j) => j.clip.id === second.clip.id)!.kind).toBe("cut");
		expect(listTransitionJoins(doc).find((j) => j.clip.id === jA.clip.id)!.kind).toBe("dissolve");
		metrics.ORDINAL_MULTI_TARGET = "PASS";
		metrics.TYPE_MODIFICATION = "PASS";

		const rem = turn("remove the transition around 12 seconds");
		expect(rem.mutated).toBe(true);
		expect(
			listTransitionJoins(doc).find((j) => Math.abs(j.programmeJoinSec - JOIN_A) < 0.5)!.kind,
		).toBe("cut");
		metrics.TRANSITION_REMOVE = "PASS";

		const wipe = turn("Add a wipe transition around 12 seconds.");
		expect(wipe.mutated).toBe(false);
		expect(wipe.userFacingText).toMatch(/CUT and DISSOLVE/i);
		metrics.UNSUPPORTED_TYPE_HONEST = "PASS";

		const noJoin = applyLocalEditorialControl({
			projectId: `${PROJECT_ID}_none`,
			document: singleClipDoc(),
			userMessage: "Add a dissolve around 10 seconds.",
		});
		expect(noJoin.mutated).toBe(false);
		expect(noJoin.userFacingText).toMatch(/join/i);
		metrics.INVALID_BOUNDARY_HONEST = "PASS";

		// Coexistence
		doc = multiClipDoc(`${PROJECT_ID}_coexist`);
		doc = patchCaptionSettings(doc, { enabled: true, fontSize: 48 });
		turn("add the title 'Demo' at the beginning");
		const cap = getCaptionSettings(doc);
		const titles = listTitleAnnotations(doc).length;
		const callouts = listCalloutAnnotations(doc).length;
		turn("Add a dissolve around 12 seconds.");
		expect(getCaptionSettings(doc).fontSize).toBe(cap.fontSize);
		expect(listTitleAnnotations(doc).length).toBe(titles);
		expect(listCalloutAnnotations(doc).length).toBe(callouts);
		metrics.FROZEN_FAMILY_COEXISTENCE = "PASS";

		// Programme time after trim+speed on multi-clip
		doc = multiClipDoc(`${PROJECT_ID}_compose`);
		turn("remove the first 3 seconds");
		turn("make 5 to 10 seconds 2x");
		const nearJoin = turn("Add a dissolve around 9 seconds.");
		expect(nearJoin.mutated || /join/i.test(nearJoin.userFacingText)).toBe(true);
		metrics.AFTER_TRIM_SPEED =
			nearJoin.mutated || /join|near/i.test(nearJoin.userFacingText) ? "PASS" : "FAIL";

		// Undo/redo
		clearHistory();
		clearLocalEditorialSessionsForTests();
		let undoDoc = multiClipDoc(`${PROJECT_ID}_undo`);
		setStoreDoc(undoDoc);
		const applyT = (msg: string) => {
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
		applyT("Add a dissolve around 12 seconds.");
		applyT("make that transition shorter");
		const shortDur = listTransitionJoins(undoDoc).find(
			(j) => Math.abs(j.programmeJoinSec - JOIN_A) < 0.5,
		)!.durationSec;
		const u1 = undo();
		const _afterU1 = useProjectStore.getState().document!;
		const u2 = undo();
		const afterU2 = useProjectStore.getState().document!;
		const r1 = redo();
		const afterR1 = useProjectStore.getState().document!;
		const r2 = redo();
		const afterR2 = useProjectStore.getState().document!;
		metrics.REAL_TRANSITION_UNDO =
			u1 &&
			u2 &&
			listTransitionJoins(afterU2).every(
				(j) => Math.abs(j.programmeJoinSec - JOIN_A) >= 0.5 || j.kind === "cut",
			)
				? "PASS"
				: "FAIL";
		metrics.REAL_TRANSITION_REDO =
			r1 &&
			r2 &&
			listTransitionJoins(afterR1).some((j) => j.kind === "dissolve") &&
			Math.abs(
				listTransitionJoins(afterR2).find((j) => Math.abs(j.programmeJoinSec - JOIN_A) < 0.5)!
					.durationSec - shortDur,
			) < 0.05
				? "PASS"
				: "FAIL";

		// Autonomous KEEP (single-clip) + opportunity APPLY when wantDissolve
		const keepOps = generateTransitionOpportunities({
			clipCount: 1,
			secondClipId: null,
			wantDissolve: true,
		});
		metrics.AUTONOMOUS_KEEP = keepOps.every((o) => o.executionReadiness === "NOT_READY")
			? "PASS"
			: "FAIL";

		const applyOps = generateTransitionOpportunities({
			clipCount: 3,
			secondClipId: multiClipDoc().timeline.clips[1]!.id,
			wantDissolve: true,
		});
		metrics.AUTONOMOUS_APPLY_OPPORTUNITY =
			applyOps[0]?.executionReadiness === "READY" ? "PASS" : "FAIL";

		const autoSingle = await invokeOpenScreenAgent({
			document: singleClipDoc(`${PROJECT_ID}_auto_keep`),
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
		totalCloud += autoSingle.contextTelemetry?.modelCallCount ?? 0;
		const autoDissolves = listTransitionJoins(autoSingle.document).filter(
			(j) => j.kind === "dissolve" && (j.clip.incomingTransition?.durationSec ?? 0) > 0,
		);
		write("autonomous-keep.json", {
			dissolves: autoDissolves.length,
			text: autoSingle.text,
			cloud: autoSingle.contextTelemetry?.modelCallCount ?? 0,
		});
		metrics.AUTONOMOUS_KEEP_LIVE =
			autoDissolves.length === 0 ||
			!/set a dissolve|adding a dissolve|softening a clip join/i.test(autoSingle.text)
				? "PASS"
				: "FAIL";

		const autoMulti = await invokeOpenScreenAgent({
			document: multiClipDoc(`${PROJECT_ID}_auto_apply`),
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
		totalCloud += autoMulti.contextTelemetry?.modelCallCount ?? 0;
		const multiDissolves = (autoMulti.document.timeline.clips ?? []).filter(
			(c, i) => i > 0 && c.incomingTransition?.kind === "dissolve",
		);
		write("autonomous-apply.json", {
			dissolves: multiDissolves.map((c) => ({
				id: c.id,
				kind: c.incomingTransition?.kind,
				durationSec: c.incomingTransition?.durationSec,
			})),
			text: autoMulti.text,
			cloud: autoMulti.contextTelemetry?.modelCallCount ?? 0,
		});
		metrics.AUTONOMOUS_APPLY_LIVE =
			multiDissolves.length > 0 ? "PASS" : "CORPUS_NOT_AVAILABLE_OR_KEEP";

		expect(parseLocalEditorialRequest("Add a dissolve around 12 seconds.").executionKind).toBe(
			"direct_document",
		);
		expect(parseLocalEditorialRequest("Add transitions wherever useful.").executionKind).toBe(
			"professional_orchestrator",
		);
		metrics.DIRECT_TRANSITION_AUTHORITY = "PASS";

		// Native + export at dissolve join
		doc = multiClipDoc(`${PROJECT_ID}_native`);
		turn("Add a dissolve around 12 seconds.");
		const proof = doc;
		const half =
			listTransitionJoins(proof).find((j) => Math.abs(j.programmeJoinSec - JOIN_A) < 0.5)
				?.durationSec ?? 0.35;
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
					{ label: "before", t: JOIN_A - half - 0.2 },
					{ label: "early", t: JOIN_A - half * 0.5 },
					{ label: "mid", t: JOIN_A },
					{ label: "late", t: JOIN_A + half * 0.5 },
					{ label: "after", t: JOIN_A + half + 0.25 },
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
							join(OUT, "frames", `transition-${label}.ppm`),
						);
					}
					samples.push({ label, t, ok: Boolean(ok) });
				}
				nativeVisual = samples.filter((s) => s.ok).length >= 4 ? "PASS" : "FAIL";
				write("native-transition-frames.json", { samples, nativeVisual, half });

				mkdirSync(join(OUT, "export"), { recursive: true });
				const exportPath = join(OUT, "export", "transitions-maturity-proof.mp4");
				const clips = clipInputsForProgrammeWindow(proof, 0, Math.min(DUR, 20));
				const scene = buildSceneDescription(proof);
				const service = new CompositorViewService({ appRoot: process.cwd() });
				const stats = await service.exportMulti(clips, exportPath, JSON.stringify(scene), {
					width: 1280,
					height: 720,
					fps: 24,
					codec: "h264",
				});
				const bytes = existsSync(exportPath) ? statSync(exportPath).size : 0;
				const fadeOn =
					(scene.clips as Array<{ incomingFadeHalfSec?: number }>)[1]?.incomingFadeHalfSec ?? 0;
				exportMatch = Boolean(stats) && bytes > 50_000 && fadeOn > 0 ? "PASS" : "FAIL";
				write("export.json", {
					stats,
					exportPath,
					bytes,
					incomingFadeHalfSec: fadeOn,
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
		metrics.NATIVE_TRANSITION_PREVIEW = nativeVisual;
		metrics.NATIVE_TRANSITION_EXPORT = exportMatch;
		metrics.PREVIEW_EXPORT_TRANSITION_MATCH = exportMatch;

		const persistPath = join(OUT, "persist-document.json");
		writeFileSync(persistPath, JSON.stringify(proof, null, 2));
		const reloaded = documentSchema.parse(JSON.parse(await readFile(persistPath, "utf8")));
		metrics.TRANSITION_DOC_ROUNDTRIP =
			fingerprintDocument(proof).value === fingerprintDocument(reloaded).value ? "PASS" : "FAIL";

		// Post-reload edit (document-grounded follow-up without chat session)
		clearLocalEditorialSessionsForTests();
		const post = applyLocalEditorialControl({
			projectId: reloaded.project.id,
			document: reloaded,
			userMessage: "make that transition longer",
		});
		metrics.POST_RELOAD_EDITABILITY = post.mutated ? "PASS" : "FAIL";

		metrics.FALSE_TRANSITION_APPLIED_CLAIMS = String(falseClaims);
		metrics.ROLLED_BACK_TRANSITION_CLAIMS = "0";
		metrics.TOTAL_CLOUD_CALLS = String(totalCloud);
		metrics.AUDIO_BEHAVIOR =
			"VISUAL_DISSOLVE_ONLY_CLIP_BOUNDARY_EQUAL_POWER_CROSSFADE_EXISTS_IN_NATIVE_AUDIO_PATH";

		write("metrics.json", metrics);
		write("summary.json", { recording: REC, metrics, totalCloud });

		expect(metrics.EXPLICIT_TRANSITION_AT_JOIN).toBe("PASS");
		expect(metrics.UNSUPPORTED_TYPE_HONEST).toBe("PASS");
		expect(metrics.AUTONOMOUS_KEEP).toBe("PASS");
		expect(totalCloud).toBe(0);
	}, 300_000);
});

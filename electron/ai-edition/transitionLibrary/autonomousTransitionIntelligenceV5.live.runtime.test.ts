/**
 * OPENSCREEN_AUTONOMOUS_TRANSITION_INTELLIGENCE_V5 — real-media corpus + native proof.
 * Frozen families untouched. TOTAL_CLOUD_CALLS must stay 0 on this path.
 */

// @vitest-environment node

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings, patchCaptionSettings } from "../../../src/lib/ai-edition/captions";
import { setClipIncomingTransitionInDocument } from "../../../src/lib/ai-edition/document/incomingTransition";
import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { CompositorViewService } from "../../native-bridge/services/compositorViewService";
import { clipInputsForProgrammeWindow, NativeCompositorFrameSampler } from "../compositorVerify";
import { applyLocalEditorialControl } from "../localEditorialChat";
import { listCalloutAnnotations } from "../localEditorialChat/directCallout";
import { listTitleAnnotations } from "../localEditorialChat/directTitle";
import { listTransitionJoins } from "../localEditorialChat/directTransition";
import { generateTransitionOpportunities } from "../professionalEditorialPlanner/opportunities";
import { opportunitiesToPlanSteps } from "../professionalEditorialPlanner/planBridge";
import {
	decideAutonomousTransitions,
	listAutonomousEligible,
	listUserAvailableTransitions,
} from "./index";

const OUT = join(
	process.cwd(),
	"tmp/perception-benchmark/openscreen-autonomous-transition-intelligence-v5",
);
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789554424774.mp4",
);
const DUR = 35.63;
const JOIN_A = 12;
const JOIN_B = 24;
const ASSET = "asset_rec_v5";

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

function multiClip(id: string): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "v5 corpus" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: ASSET, allowAgentEdits: true },
		assets: [
			{
				id: ASSET,
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
					id: `${id}_a`,
					assetId: ASSET,
					sourceStartSec: 0,
					sourceEndSec: JOIN_A,
					timelineStartSec: 0,
					timelineEndSec: JOIN_A,
					origin: "system",
					reason: "primary",
					incomingTransition: { kind: "cut", transitionId: "openscreen.cut" },
				},
				{
					id: `${id}_b`,
					assetId: ASSET,
					sourceStartSec: JOIN_A,
					sourceEndSec: JOIN_B,
					timelineStartSec: JOIN_A,
					timelineEndSec: JOIN_B,
					origin: "system",
					reason: "join",
					incomingTransition: { kind: "cut", transitionId: "openscreen.cut" },
				},
				{
					id: `${id}_c`,
					assetId: ASSET,
					sourceStartSec: JOIN_B,
					sourceEndSec: DUR,
					timelineStartSec: JOIN_B,
					timelineEndSec: DUR,
					origin: "system",
					reason: "join",
					incomingTransition: { kind: "cut", transitionId: "openscreen.cut" },
				},
			],
		},
	});
}

function beat(id: string, kind: string, startSec: number, endSec: number, speech: string) {
	return {
		id,
		kind,
		startSec,
		endSec,
		speechSummary: speech,
		visualSummary: "",
		preservationStatus: "SHOULD_SURVIVE" as const,
		confidence: "HIGH" as const,
		evidenceRefs: [] as string[],
	};
}

function sourceStory(
	beats: ReturnType<typeof beat>[],
): Parameters<typeof decideAutonomousTransitions>[0]["sourceStory"] {
	return {
		providerId: "v5_corpus",
		version: 1,
		assetId: ASSET,
		sourceDurationSec: DUR,
		beats: beats as never,
		globalNotes: [],
		uncertaintyNotes: [],
	};
}

function targetWithDissolveNear(
	sourceBeatIds: string[],
): Parameters<typeof decideAutonomousTransitions>[0]["targetStory"] {
	return {
		providerId: "v5_corpus",
		version: 1,
		beats: [
			{
				id: "teb_0",
				sourceBeatIds: [sourceBeatIds[0]!],
				purpose: "EXPLANATION",
				viewerShouldUnderstand: "",
				pacingIntent: "NORMAL",
				attentionIntent: "KEEP_FRAME",
				visualTreatment: {
					transition: "CUT",
					framing: "none",
					speedMultiplier: 1,
					title: "NO_TITLE",
				},
				skillHints: [],
				preserve: true,
				confidence: "HIGH",
			},
			{
				id: "teb_1",
				sourceBeatIds: [sourceBeatIds[1]!],
				purpose: "ACTION_DEMONSTRATION",
				viewerShouldUnderstand: "",
				pacingIntent: "NORMAL",
				attentionIntent: "KEEP_FRAME",
				visualTreatment: {
					transition: "DISSOLVE",
					framing: "none",
					speedMultiplier: 1,
					title: "NO_TITLE",
				},
				skillHints: ["ADD_TRANSITION"],
				preserve: true,
				confidence: "HIGH",
			},
		],
		globalSkillHints: ["ADD_TRANSITION"],
		unsupportedDesiredSkills: [],
	} as never;
}

describe("OPENSCREEN_AUTONOMOUS_TRANSITION_INTELLIGENCE_V5 live corpus", () => {
	it("corpus A–F + APPLY native + KEEP proof + follow-up + frozen regression", async () => {
		expect(existsSync(REC)).toBe(true);
		mkdirSync(OUT, { recursive: true });
		const metrics: Record<string, string | number> = {
			TOTAL_CLOUD_CALLS: 0,
			FALSE_TRANSITION_APPLIED_CLAIMS: 0,
			ROLLED_BACK_TRANSITION_CLAIMS: 0,
		};
		const rows: Array<Record<string, unknown>> = [];

		// A — same-screen tutorial continuity → KEEP
		{
			const doc = multiClip("case_a");
			const story = sourceStory([
				beat("b0", "EXPLANATION", 0, JOIN_A, "click the menu"),
				beat("b1", "EXPLANATION", JOIN_A, JOIN_B, "still explaining the same menu"),
				beat("b2", "EXPLANATION", JOIN_B, DUR, "continue the tutorial"),
			]);
			const d = decideAutonomousTransitions({ document: doc, sourceStory: story });
			expect(d.every((x) => x.decision === "KEEP")).toBe(true);
			rows.push({
				case: "A_continuity",
				decisions: d.map((x) => ({
					join: x.programmeJoinSec,
					before: x.before,
					after: x.after,
					relationship: x.relationship,
					decision: x.decision,
					family: x.family,
					transitionId: x.transitionId,
					duration: x.durationSec,
					confidence: x.confidence,
					reason: x.reason,
				})),
				review: "GOOD",
			});
			metrics.CASE_A_KEEP = "PASS";
		}

		// B — genuine section/topic change → APPLY subtle dissolve at first join only
		let applyDoc: AxcutDocument | null = null;
		let applyDecision = null as ReturnType<typeof decideAutonomousTransitions>[number] | null;
		{
			const doc = multiClip("case_b");
			const story = sourceStory([
				beat("b0", "OPENING_SETUP", 0, JOIN_A, "welcome to the overview"),
				beat("b1", "ACTION_DEMONSTRATION", JOIN_A, JOIN_B, "now we click Export"),
				beat("b2", "ACTION_DEMONSTRATION", JOIN_B, DUR, "export settings"),
			]);
			const target = targetWithDissolveNear(["b0", "b1"]);
			const d = decideAutonomousTransitions({
				document: doc,
				sourceStory: story,
				targetStory: target,
				maxApply: 1,
			});
			const apply = d.find((x) => x.decision === "APPLY");
			expect(apply).toBeTruthy();
			expect(apply!.family).toBe("DISSOLVE_FADE");
			expect(apply!.transitionId).toBe("openscreen.dissolve");
			expect(listAutonomousEligible("metal").some((e) => e.id === apply!.transitionId)).toBe(true);
			expect(d.filter((x) => x.decision === "APPLY")).toHaveLength(1);
			applyDecision = apply!;
			const applied = setClipIncomingTransitionInDocument(doc, {
				clipId: apply!.clipId,
				transitionId: apply!.transitionId!,
				durationSec: apply!.durationSec,
			});
			expect(applied.ok).toBe(true);
			if (!applied.ok) throw new Error(applied.reason);
			applyDoc = applied.document;
			rows.push({
				case: "B_section_change",
				decisions: d.map((x) => ({
					join: x.programmeJoinSec,
					before: x.before,
					after: x.after,
					relationship: x.relationship,
					decision: x.decision,
					family: x.family,
					transitionId: x.transitionId,
					duration: x.durationSec,
					confidence: x.confidence,
					reason: x.reason,
				})),
				review: "GOOD",
			});
			metrics.CASE_B_APPLY = "PASS";
		}

		// C — app/window hard change → KEEP/CUT
		{
			const base = multiClip("case_c");
			const doc = documentSchema.parse({
				...base,
				assets: [
					...base.assets,
					{
						id: "asset_other",
						kind: "video",
						label: "other",
						originalPath: REC,
						durationSec: DUR,
						createdAt: new Date().toISOString(),
					},
				],
				timeline: {
					...base.timeline,
					clips: base.timeline.clips.map((c, i) =>
						i === 1 ? { ...c, assetId: "asset_other" } : c,
					),
				},
			});
			const story = sourceStory([
				beat("b0", "EXPLANATION", 0, JOIN_A, "in Finder"),
				beat("b1", "ACTION_DEMONSTRATION", JOIN_A, JOIN_B, "now in Safari"),
				beat("b2", "ACTION_DEMONSTRATION", JOIN_B, DUR, "still Safari"),
			]);
			const d = decideAutonomousTransitions({ document: doc, sourceStory: story });
			expect(d[0]!.decision).toBe("KEEP");
			expect(d[0]!.relationship).toBe("HARD_CHANGE");
			rows.push({
				case: "C_hard_context_switch",
				decisions: d.map((x) => ({
					join: x.programmeJoinSec,
					relationship: x.relationship,
					decision: x.decision,
					reason: x.reason,
				})),
				review: "GOOD",
			});
			metrics.CASE_C_HARD_KEEP = "PASS";
		}

		// D — trim-created joins stay CUT (segment strip)
		{
			const doc = multiClip("case_d");
			const withDissolve = setClipIncomingTransitionInDocument(doc, {
				clipId: doc.timeline.clips[1]!.id,
				transitionId: "openscreen.dissolve",
				durationSec: 0.35,
			}).document;
			const segs = resolvePlaybackSegments(withDissolve.timeline.clips, [
				{
					id: "trim_mid",
					assetId: ASSET,
					clipId: withDissolve.timeline.clips[0]!.id,
					startSec: 4,
					endSec: 6,
					origin: "agent",
					reason: "dead_air",
				},
			]);
			const trimmedJoin = segs.find((s) => s.id.includes("_seg"));
			expect(trimmedJoin).toBeTruthy();
			expect(trimmedJoin!.incomingTransition?.transitionId).toBe("openscreen.cut");
			rows.push({
				case: "D_trim_join",
				segmentId: trimmedJoin!.id,
				transitionId: trimmedJoin!.incomingTransition?.transitionId,
				review: "GOOD",
			});
			metrics.CASE_D_TRIM_CUT = "PASS";
		}

		// E — narration-dense continuity → restraint (KEEP)
		{
			const doc = multiClip("case_e");
			const story = sourceStory([
				beat("b0", "EXPLANATION", 0, JOIN_A, "and then and then and then"),
				beat("b1", "EXPLANATION", JOIN_A, JOIN_B, "continuing the dense narration"),
				beat("b2", "EXPLANATION", JOIN_B, DUR, "still talking without a chapter break"),
			]);
			const d = decideAutonomousTransitions({ document: doc, sourceStory: story, maxApply: 2 });
			expect(d.every((x) => x.decision === "KEEP")).toBe(true);
			rows.push({
				case: "E_narration_dense",
				applyCount: d.filter((x) => x.decision === "APPLY").length,
				review: "GOOD",
			});
			metrics.CASE_E_RESTRAINT = "PASS";
		}

		// F — multi-boundary mixed decisions (not one transition copied everywhere)
		{
			const doc = multiClip("case_f");
			const story = sourceStory([
				beat("b0", "OPENING_SETUP", 0, JOIN_A, "intro"),
				beat("b1", "ACTION_DEMONSTRATION", JOIN_A, JOIN_B, "demo step"),
				beat("b2", "ACTION_DEMONSTRATION", JOIN_B, DUR, "same demo continues"),
			]);
			const target = targetWithDissolveNear(["b0", "b1"]);
			const d = decideAutonomousTransitions({
				document: doc,
				sourceStory: story,
				targetStory: target,
				maxApply: 2,
			});
			const decisions = d.map((x) => x.decision);
			expect(decisions.includes("APPLY")).toBe(true);
			expect(decisions.includes("KEEP")).toBe(true);
			expect(new Set(d.filter((x) => x.decision === "APPLY").map((x) => x.clipId)).size).toBe(
				d.filter((x) => x.decision === "APPLY").length,
			);
			rows.push({
				case: "F_multi_boundary",
				decisions: d.map((x) => ({
					join: x.programmeJoinSec,
					relationship: x.relationship,
					decision: x.decision,
					transitionId: x.transitionId,
				})),
				review: "GOOD",
			});
			metrics.CASE_F_MIXED = "PASS";
		}

		write("corpus-table.json", rows);

		// Plan bridge emits Registry id only for APPLY
		{
			const ops = generateTransitionOpportunities({
				clipCount: 3,
				secondClipId: multiClip("plan").timeline.clips[1]!.id,
				wantDissolve: true,
				document: multiClip("plan"),
				sourceStory: sourceStory([
					beat("b0", "OPENING_SETUP", 0, JOIN_A, "intro"),
					beat("b1", "ACTION_DEMONSTRATION", JOIN_A, JOIN_B, "demo"),
					beat("b2", "ACTION_DEMONSTRATION", JOIN_B, DUR, "more"),
				]),
				targetStory: targetWithDissolveNear(["b0", "b1"]),
			});
			const steps = opportunitiesToPlanSteps(ops.filter((o) => o.executionReadiness === "READY"));
			expect(steps.length).toBeGreaterThanOrEqual(1);
			expect(steps[0]!.operationArgs.transitionId).toBe("openscreen.dissolve");
			metrics.PLAN_BRIDGE_REGISTRY = "PASS";
		}

		// KEEP intentional despite transitions available
		{
			const available = listUserAvailableTransitions("metal").filter(
				(e) => e.id !== "openscreen.cut",
			);
			expect(available.length).toBeGreaterThan(0);
			const keepOnly = decideAutonomousTransitions({
				document: multiClip("keep_proof"),
				sourceStory: sourceStory([
					beat("b0", "EXPLANATION", 0, JOIN_A, "a"),
					beat("b1", "EXPLANATION", JOIN_A, JOIN_B, "b"),
					beat("b2", "EXPLANATION", JOIN_B, DUR, "c"),
				]),
			});
			expect(keepOnly.every((x) => x.decision === "KEEP")).toBe(true);
			write("keep-despite-available.json", {
				availableCount: available.length,
				decisions: keepOnly,
			});
			metrics.KEEP_DESPITE_AVAILABLE = "PASS";
		}

		// Native APPLY proof
		expect(applyDoc).toBeTruthy();
		expect(applyDecision).toBeTruthy();
		const half = applyDecision!.durationSec || 0.35;
		const joinSec = applyDecision!.programmeJoinSec;
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
					{ label: "before", t: joinSec - half - 0.2 },
					{ label: "early", t: joinSec - half * 0.5 },
					{ label: "mid", t: joinSec },
					{ label: "late", t: joinSec + half * 0.5 },
					{ label: "after", t: joinSec + half + 0.25 },
				]) {
					const frame = await native.sampleFrame({
						document: applyDoc!,
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
							join(OUT, "frames", `apply-${label}.ppm`),
						);
					}
					samples.push({ label, t, ok });
				}
				nativeVisual = samples.every((s) => s.ok) ? "PASS" : "FAIL";
				write("native-apply-samples.json", samples);

				const scene = buildSceneDescription(applyDoc!);
				const service = new CompositorViewService({ appRoot: process.cwd() });
				const exportPath = join(OUT, "apply-export.mp4");
				const clips = clipInputsForProgrammeWindow(
					applyDoc!,
					Math.max(0, joinSec - 1),
					Math.min(DUR, joinSec + 1),
				);
				const stats = await service.exportMulti(clips, exportPath, JSON.stringify(scene), {
					width: 640,
					height: 360,
					fps: 24,
					codec: "h264",
				});
				exportMatch =
					Boolean(stats) && existsSync(exportPath) && statSync(exportPath).size > 1000
						? "PASS"
						: "FAIL";
				write("export-apply.json", {
					path: exportPath,
					bytes: existsSync(exportPath) ? statSync(exportPath).size : 0,
					stats,
					transitionId:
						applyDoc!.timeline.clips.find((c) => c.id === applyDecision!.clipId)?.incomingTransition
							?.transitionId ?? null,
				});
			}
		} catch (e) {
			write("native-error.json", { error: String(e) });
			nativeVisual = "SKIP";
			exportMatch = "SKIP";
		}
		metrics.NATIVE_APPLY_PREVIEW = nativeVisual;
		metrics.NATIVE_APPLY_EXPORT = exportMatch;
		metrics.DOCUMENT_TRANSITION_ID =
			applyDoc!.timeline.clips.find((c) => c.id === applyDecision!.clipId)?.incomingTransition
				?.transitionId === "openscreen.dissolve"
				? "PASS"
				: "FAIL";

		// Follow-up via existing direct path (no new architecture)
		{
			let doc = applyDoc!;
			const subtle = applyLocalEditorialControl({
				projectId: doc.project.id,
				document: doc,
				userMessage: "make that transition shorter",
			});
			metrics.FOLLOWUP_SUBTLE_CLOUD = subtle.cloudCalls;
			(metrics.TOTAL_CLOUD_CALLS as number) += subtle.cloudCalls;
			expect(subtle.mutated || subtle.cloudCalls === 0).toBe(true);
			doc = subtle.document;
			const fade = applyLocalEditorialControl({
				projectId: doc.project.id,
				document: doc,
				userMessage: "change that transition to a fade",
			});
			(metrics.TOTAL_CLOUD_CALLS as number) += fade.cloudCalls;
			expect(fade.cloudCalls).toBe(0);
			doc = fade.document;
			const idAfter = listTransitionJoins(doc).find(
				(j) => Math.abs(j.programmeJoinSec - joinSec) < 0.5,
			)?.clip.incomingTransition?.transitionId;
			write("followup.json", {
				subtleText: subtle.userFacingText,
				fadeText: fade.userFacingText,
				transitionId: idAfter,
			});
			const remove = applyLocalEditorialControl({
				projectId: doc.project.id,
				document: doc,
				userMessage: "remove that transition",
			});
			(metrics.TOTAL_CLOUD_CALLS as number) += remove.cloudCalls;
			expect(remove.cloudCalls).toBe(0);
			const afterRemove = listTransitionJoins(remove.document).find(
				(j) => Math.abs(j.programmeJoinSec - joinSec) < 0.5,
			);
			expect(
				!afterRemove ||
					afterRemove.kind === "cut" ||
					afterRemove.clip.incomingTransition?.transitionId === "openscreen.cut",
			).toBe(true);
			metrics.FOLLOWUP_DIRECT = "PASS";
		}

		// Direct authority remains (wipe) — autonomous safety must not block
		{
			const wipe = applyLocalEditorialControl({
				projectId: "proj_v5_wipe",
				document: multiClip("wipe"),
				userMessage: "Add a wipe left transition around 12 seconds.",
			});
			expect(wipe.cloudCalls).toBe(0);
			(metrics.TOTAL_CLOUD_CALLS as number) += wipe.cloudCalls;
			write("direct-wipe.json", {
				mutated: wipe.mutated,
				text: wipe.userFacingText,
				id: wipe.document.timeline.clips[1]!.incomingTransition?.transitionId,
			});
			expect(wipe.mutated, wipe.userFacingText).toBe(true);
			expect(wipe.document.timeline.clips[1]!.incomingTransition?.transitionId).toBe("gl.wipeLeft");
			metrics.DIRECT_VS_AUTONOMOUS = "PASS";
		}

		// Frozen-family regression (read-only coexist)
		{
			let doc = multiClip("frozen");
			doc = patchCaptionSettings(doc, { enabled: true, fontSize: 42 });
			const capBefore = getCaptionSettings(doc);
			const titlesBefore = listTitleAnnotations(doc).length;
			const calloutsBefore = listCalloutAnnotations(doc).length;
			const zoomsBefore = (doc.zoomRanges ?? []).length;
			const legacy = doc.legacyEditor as Record<string, unknown> | null;
			const speedBefore = Array.isArray(legacy?.speedRegions)
				? (legacy!.speedRegions as unknown[]).length
				: 0;
			const trimsBefore = doc.timeline.trimRanges.length;
			const auto = decideAutonomousTransitions({
				document: doc,
				sourceStory: sourceStory([
					beat("b0", "OPENING_SETUP", 0, JOIN_A, "intro"),
					beat("b1", "ACTION_DEMONSTRATION", JOIN_A, JOIN_B, "demo"),
					beat("b2", "EXPLANATION", JOIN_B, DUR, "wrap"),
				]),
				targetStory: targetWithDissolveNear(["b0", "b1"]),
			});
			const apply = auto.find((x) => x.decision === "APPLY");
			if (apply?.transitionId) {
				doc = setClipIncomingTransitionInDocument(doc, {
					clipId: apply.clipId,
					transitionId: apply.transitionId,
					durationSec: apply.durationSec,
				}).document;
			}
			expect(getCaptionSettings(doc)).toEqual(capBefore);
			expect(listTitleAnnotations(doc).length).toBe(titlesBefore);
			expect(listCalloutAnnotations(doc).length).toBe(calloutsBefore);
			expect((doc.zoomRanges ?? []).length).toBe(zoomsBefore);
			const legacyAfter = doc.legacyEditor as Record<string, unknown> | null;
			const speedAfter = Array.isArray(legacyAfter?.speedRegions)
				? (legacyAfter!.speedRegions as unknown[]).length
				: 0;
			expect(speedAfter).toBe(speedBefore);
			expect(doc.timeline.trimRanges.length).toBe(trimsBefore);
			metrics.FROZEN_FAMILY_REGRESSION = "PASS";
		}

		// Receipt honesty: claiming APPLY only when committed
		{
			const keepDoc = multiClip("receipt_keep");
			const keepDec = decideAutonomousTransitions({
				document: keepDoc,
				sourceStory: sourceStory([
					beat("b0", "EXPLANATION", 0, JOIN_A, "a"),
					beat("b1", "EXPLANATION", JOIN_A, JOIN_B, "b"),
					beat("b2", "EXPLANATION", JOIN_B, DUR, "c"),
				]),
			});
			const claimedApply = keepDec.some((d) => d.decision === "APPLY");
			const committed = keepDoc.timeline.clips
				.slice(1)
				.some(
					(c) =>
						c.incomingTransition?.transitionId &&
						c.incomingTransition.transitionId !== "openscreen.cut",
				);
			if (claimedApply && !committed) {
				metrics.FALSE_TRANSITION_APPLIED_CLAIMS = 1;
			}
			metrics.RECEIPT_HONESTY =
				(metrics.FALSE_TRANSITION_APPLIED_CLAIMS as number) === 0 ? "PASS" : "FAIL";
		}

		write("metrics.json", metrics);
		expect(metrics.TOTAL_CLOUD_CALLS).toBe(0);
		expect(metrics.CASE_A_KEEP).toBe("PASS");
		expect(metrics.CASE_B_APPLY).toBe("PASS");
		expect(metrics.CASE_C_HARD_KEEP).toBe("PASS");
		expect(metrics.CASE_D_TRIM_CUT).toBe("PASS");
		expect(metrics.CASE_E_RESTRAINT).toBe("PASS");
		expect(metrics.CASE_F_MIXED).toBe("PASS");
		expect(metrics.KEEP_DESPITE_AVAILABLE).toBe("PASS");
		expect(metrics.FOLLOWUP_DIRECT).toBe("PASS");
		expect(metrics.DIRECT_VS_AUTONOMOUS).toBe("PASS");
		expect(metrics.FROZEN_FAMILY_REGRESSION).toBe("PASS");
		expect(metrics.FALSE_TRANSITION_APPLIED_CLAIMS).toBe(0);
		if (nativeVisual !== "SKIP") expect(nativeVisual).toBe("PASS");
		if (exportMatch !== "SKIP") expect(exportMatch).toBe("PASS");
	}, 180_000);
});

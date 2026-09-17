/**
 * OPENSCREEN_TRANSITIONS_PRODUCT_MATURITY_V1 — unit coverage.
 * Authorable primitives only: CUT | DISSOLVE on clip.incomingTransition.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getCaptionSettings, patchCaptionSettings } from "../../../src/lib/ai-edition/captions";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { generateTransitionOpportunities } from "../professionalEditorialPlanner/opportunities";
import { listCalloutAnnotations } from "./directCallout";
import { listTitleAnnotations } from "./directTitle";
import { listTransitionJoins } from "./directTransition";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

function multiClipDoc(id = "proj_trans_unit"): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Transition unit" });
	const assetA = "asset_a";
	const assetB = "asset_b";
	const assetC = "asset_c";
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: assetA, allowAgentEdits: true },
		assets: [
			{
				id: assetA,
				kind: "video",
				label: "clipA",
				originalPath: "/tmp/fake-a.mp4",
				durationSec: 10,
				createdAt: new Date().toISOString(),
			},
			{
				id: assetB,
				kind: "video",
				label: "clipB",
				originalPath: "/tmp/fake-b.mp4",
				durationSec: 10,
				createdAt: new Date().toISOString(),
			},
			{
				id: assetC,
				kind: "video",
				label: "clipC",
				originalPath: "/tmp/fake-c.mp4",
				durationSec: 10,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: assetA,
					sourceStartSec: 0,
					sourceEndSec: 10,
					timelineStartSec: 0,
					timelineEndSec: 10,
					origin: "system",
					reason: "primary",
				},
				{
					id: "clip_2",
					assetId: assetB,
					sourceStartSec: 0,
					sourceEndSec: 10,
					timelineStartSec: 10,
					timelineEndSec: 20,
					origin: "system",
					reason: "join",
				},
				{
					id: "clip_3",
					assetId: assetC,
					sourceStartSec: 0,
					sourceEndSec: 10,
					timelineStartSec: 20,
					timelineEndSec: 30,
					origin: "system",
					reason: "join",
				},
			],
		},
	});
}

function singleClipDoc(id = "proj_trans_single"): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Single" });
	const assetId = "asset_1";
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: assetId, allowAgentEdits: true },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: "clip",
				originalPath: "/tmp/fake-single.mp4",
				durationSec: 30,
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
					sourceEndSec: 30,
					timelineStartSec: 0,
					timelineEndSec: 30,
					origin: "system",
					reason: "primary",
				},
			],
		},
	});
}

describe("OPENSCREEN_TRANSITIONS_PRODUCT_MATURITY_V1 unit", () => {
	beforeEach(() => clearLocalEditorialSessionsForTests());

	it("routes explicit transition commands locally", () => {
		const a = parseLocalEditorialRequest("Add a dissolve around 12 seconds.");
		expect(a.intent).toBe("TRANSITION");
		expect(a.executionKind).toBe("direct_document");
		expect(a.transitionKind).toBe("dissolve");
		expect(a.range?.startSec).toBe(12);

		expect(parseLocalEditorialRequest("Use a dissolve here.").intent).toBe("TRANSITION");
		expect(parseLocalEditorialRequest("make that transition shorter").intent).toBe(
			"ADJUST_TRANSITION",
		);
		expect(parseLocalEditorialRequest("remove that transition").intent).toBe("REMOVE_TRANSITION");
		expect(parseLocalEditorialRequest("Add transitions wherever useful.").executionKind).toBe(
			"professional_orchestrator",
		);
	});

	it("adds dissolve at programme join, adjusts duration/type, removes to cut", () => {
		let doc = multiClipDoc("proj_trans_flow");
		const add = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Add a dissolve around 10 seconds.",
		});
		expect(add.mutated, add.userFacingText).toBe(true);
		expect(add.needsProfessionalOrchestrator).toBe(false);
		expect(add.cloudCalls).toBe(0);
		doc = add.document;
		const j0 = listTransitionJoins(doc).find((j) => j.clip.id === "clip_2")!;
		expect(j0.kind).toBe("dissolve");
		expect(j0.durationSec).toBeCloseTo(0.35, 2);

		const shorter = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make that transition shorter",
		});
		expect(shorter.mutated, shorter.userFacingText).toBe(true);
		doc = shorter.document;
		expect(listTransitionJoins(doc).find((j) => j.clip.id === "clip_2")!.durationSec).toBeLessThan(
			0.35,
		);

		const longer = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make it a little longer",
		});
		expect(longer.mutated).toBe(true);
		doc = longer.document;

		const toCut = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "change that transition to a cut",
		});
		expect(toCut.mutated).toBe(true);
		doc = toCut.document;
		expect(listTransitionJoins(doc).find((j) => j.clip.id === "clip_2")!.kind).toBe("cut");

		const back = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Use a dissolve here.",
		});
		expect(back.mutated).toBe(true);
		doc = back.document;

		const scene = buildSceneDescription(doc);
		const sceneClip = (scene.clips as Array<{ incomingFadeHalfSec?: number }>)[1];
		expect(sceneClip?.incomingFadeHalfSec).toBeGreaterThan(0);

		const rem = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove that transition",
		});
		expect(rem.mutated).toBe(true);
		doc = rem.document;
		expect(listTransitionJoins(doc).find((j) => j.clip.id === "clip_2")!.kind).toBe("cut");
	});

	it("targets multiple joins independently", () => {
		let doc = multiClipDoc("proj_trans_multi");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Add a dissolve between clip 1 and clip 2",
		}).document;
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Add a dissolve between clip 2 and clip 3",
		}).document;
		expect(listTransitionJoins(doc).filter((j) => j.kind === "dissolve")).toHaveLength(2);

		const first = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make the first transition shorter",
		});
		expect(first.mutated, first.userFacingText).toBe(true);
		doc = first.document;
		const joins = listTransitionJoins(doc);
		const d0 = joins.find((j) => j.clip.id === "clip_2")!.durationSec;
		const d1 = joins.find((j) => j.clip.id === "clip_3")!.durationSec;
		expect(d0).toBeLessThan(d1);

		const second = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "change the second transition to a cut",
		});
		expect(second.mutated).toBe(true);
		doc = second.document;
		expect(listTransitionJoins(doc).find((j) => j.clip.id === "clip_3")!.kind).toBe("cut");
		expect(listTransitionJoins(doc).find((j) => j.clip.id === "clip_2")!.kind).toBe("dissolve");
	});

	it("rejects no-join honestly; wipe is now Registry-supported", () => {
		const single = applyLocalEditorialControl({
			projectId: "proj_trans_none",
			document: singleClipDoc(),
			userMessage: "Add a dissolve around 10 seconds.",
		});
		expect(single.mutated).toBe(false);
		expect(single.userFacingText).toMatch(/join|clip/i);
		expect(single.cloudCalls).toBe(0);

		const wipe = applyLocalEditorialControl({
			projectId: "proj_trans_wipe",
			document: multiClipDoc("proj_trans_wipe"),
			userMessage: "Add a wipe left transition around 10 seconds.",
		});
		expect(wipe.mutated, wipe.userFacingText).toBe(true);
		expect(wipe.document.timeline.clips[1]!.incomingTransition?.transitionId).toBe("gl.wipeLeft");
		expect(wipe.cloudCalls).toBe(0);
	});

	it("autonomous KEEP on single-clip; APPLY only when wantDissolve + multi-clip", () => {
		const keep = generateTransitionOpportunities({
			clipCount: 1,
			secondClipId: null,
			wantDissolve: true,
		});
		expect(keep[0]!.executionReadiness).toBe("NOT_READY");

		const preferCut = generateTransitionOpportunities({
			clipCount: 2,
			secondClipId: "clip_2",
			wantDissolve: false,
		});
		expect(preferCut[0]!.executionReadiness).toBe("NOT_READY");
		expect(preferCut[0]!.editorialReason).toMatch(/CUT/i);

		const apply = generateTransitionOpportunities({
			clipCount: 2,
			secondClipId: "clip_2",
			wantDissolve: true,
		});
		expect(apply[0]!.executionReadiness).toBe("READY");
		expect(apply[0]!.derivedParameters.kind).toBe("dissolve");
	});

	it("coexists with captions/title without mutating them", () => {
		let doc = multiClipDoc("proj_trans_coexist");
		doc = patchCaptionSettings(doc, { enabled: true, fontSize: 48 });
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "add the title 'Demo' at the beginning",
		}).document;
		const capBefore = getCaptionSettings(doc);
		const titlesBefore = listTitleAnnotations(doc).length;
		const calloutsBefore = listCalloutAnnotations(doc).length;

		const add = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Add a dissolve around 10 seconds.",
		});
		expect(add.mutated).toBe(true);
		doc = add.document;
		expect(getCaptionSettings(doc).enabled).toBe(capBefore.enabled);
		expect(getCaptionSettings(doc).fontSize).toBe(capBefore.fontSize);
		expect(listTitleAnnotations(doc)).toHaveLength(titlesBefore);
		expect(listCalloutAnnotations(doc)).toHaveLength(calloutsBefore);
	});
});

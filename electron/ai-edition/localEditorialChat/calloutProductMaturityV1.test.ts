/**
 * OPENSCREEN_CALLOUT_PRODUCT_MATURITY_V1 — unit coverage.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getCaptionSettings, patchCaptionSettings } from "../../../src/lib/ai-edition/captions";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { listCalloutAnnotations } from "./directCallout";
import { listTitleAnnotations } from "./directTitle";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

const DUR = 30;

function cleanDoc(id = "proj_callout_unit"): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Callout unit" });
	const assetId = "asset_1";
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: assetId, allowAgentEdits: true },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: "clip",
				originalPath: "/tmp/fake-callout.mp4",
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
				},
			],
		},
	});
}

const clicks = [
	{ atSec: 8.5, cx: 0.72, cy: 0.41, interactionType: "click" },
	{ atSec: 9.2, cx: 0.73, cy: 0.42, interactionType: "click" },
	{ atSec: 15.1, cx: 0.28, cy: 0.55, interactionType: "click" },
];

describe("OPENSCREEN_CALLOUT_PRODUCT_MATURITY_V1 unit", () => {
	beforeEach(() => clearLocalEditorialSessionsForTests());

	it("routes explicit callout commands locally", () => {
		const a = parseLocalEditorialRequest("Add a callout from 8 to 11 seconds.");
		expect(a.intent).toBe("CALLOUT");
		expect(a.executionKind).toBe("direct_document");
		expect(a.range?.startSec).toBe(8);
		expect(a.range?.endSec).toBe(11);

		const b = parseLocalEditorialRequest("Add a label saying 'Export' here from 5 to 8 seconds");
		expect(b.intent).toBe("CALLOUT");
		expect(b.calloutText).toBe("Export");
		expect(b.executionKind).toBe("direct_document");

		expect(parseLocalEditorialRequest("remove that callout").intent).toBe("REMOVE_CALLOUT");
		expect(parseLocalEditorialRequest("Add callouts wherever they help.").executionKind).toBe(
			"professional_orchestrator",
		);
	});

	it("adds timed callout, adjusts, and keeps captions/titles untouched", () => {
		let doc = cleanDoc("proj_callout_flow");
		doc = patchCaptionSettings(doc, { enabled: true, fontSize: 48 });
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "add the title 'OpenScreen Tutorial' at the beginning",
		}).document;
		const capBefore = getCaptionSettings(doc);
		const titlesBefore = listTitleAnnotations(doc).length;

		const add = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Add a callout from 8 to 11 seconds.",
			cursorSamples: clicks,
		});
		expect(add.mutated, add.userFacingText).toBe(true);
		expect(add.needsProfessionalOrchestrator).toBe(false);
		expect(add.cloudCalls).toBe(0);
		doc = add.document;
		expect(listCalloutAnnotations(doc)).toHaveLength(1);
		const c0 = listCalloutAnnotations(doc)[0]!;
		expect(c0.startMs / 1000).toBeCloseTo(8, 0);
		expect(c0.endMs / 1000).toBeCloseTo(11, 0);
		expect(c0.position.x).toBeGreaterThan(50);

		const labeled = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "change the text to 'Export Video'",
			cursorSamples: clicks,
		});
		expect(labeled.mutated, labeled.userFacingText).toBe(true);
		doc = labeled.document;
		expect(String(listCalloutAnnotations(doc)[0]!.content || "")).toMatch(/Export Video/);

		const scene = buildSceneDescription(doc);
		const sceneAnns = scene.annotations ?? [];
		expect(sceneAnns.some((a) => a.kind === "figure")).toBe(true);
		expect(
			sceneAnns.some(
				(a) =>
					a.kind === "text" &&
					/Export Video/i.test(String((a as { text?: { content?: string } }).text?.content ?? "")),
			),
		).toBe(true);

		const smaller = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make that callout smaller",
		});
		expect(smaller.mutated).toBe(true);
		doc = smaller.document;
		expect(listCalloutAnnotations(doc)[0]!.size.width).toBeLessThan(12);

		expect(getCaptionSettings(doc).enabled).toBe(capBefore.enabled);
		expect(getCaptionSettings(doc).fontSize).toBe(capBefore.fontSize);
		expect(listTitleAnnotations(doc)).toHaveLength(titlesBefore);
	});

	it("targets multiple callouts independently and programme-maps after trim", () => {
		let doc = cleanDoc("proj_callout_multi");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Add a callout from 8 to 11 seconds.",
			cursorSamples: clicks,
		}).document;
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Add a label saying 'Export' from 14 to 17 seconds",
			cursorSamples: clicks,
		}).document;
		expect(listCalloutAnnotations(doc)).toHaveLength(2);

		const second = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make the Export callout stay longer",
		});
		expect(second.mutated, second.userFacingText).toBe(true);
		doc = second.document;
		const exportC = listCalloutAnnotations(doc).find((c) =>
			/Export/i.test(String(c.content || c.textContent || "")),
		)!;
		expect(exportC.endMs - exportC.startMs).toBeGreaterThan(3000);

		clearLocalEditorialSessionsForTests();
		let compose = cleanDoc("proj_callout_compose");
		compose = applyLocalEditorialControl({
			projectId: compose.project.id,
			document: compose,
			userMessage: "remove the first 3 seconds",
		}).document;
		compose = applyLocalEditorialControl({
			projectId: compose.project.id,
			document: compose,
			userMessage: "make 5 to 10 seconds 2x",
		}).document;
		const timed = applyLocalEditorialControl({
			projectId: compose.project.id,
			document: compose,
			userMessage: "Add a callout from 8 to 11 seconds.",
			cursorSamples: clicks.map((c) => ({ ...c, atSec: c.atSec + 3 })),
		});
		expect(timed.mutated, timed.userFacingText).toBe(true);
		const ann = listCalloutAnnotations(timed.document)[0]!;
		expect(ann.startMs).toBeGreaterThan(5000);
	});

	it("document-grounds callout adjust after session loss", () => {
		let doc = cleanDoc("proj_callout_persist");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "Add a callout from 8 to 11 seconds.",
			cursorSamples: clicks,
		}).document;
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "change the text to 'Export Video'",
		}).document;
		const before = listCalloutAnnotations(doc)[0]!.size.width;
		clearLocalEditorialSessionsForTests();
		const smaller = applyLocalEditorialControl({
			projectId: "proj_callout_fresh",
			document: doc,
			userMessage: "make the Export Video callout smaller",
		});
		expect(smaller.mutated, smaller.userFacingText).toBe(true);
		expect(listCalloutAnnotations(smaller.document)[0]!.size.width).toBeLessThan(before);
	});
});

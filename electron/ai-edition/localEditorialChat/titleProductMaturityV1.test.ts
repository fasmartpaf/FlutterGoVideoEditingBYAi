/**
 * OPENSCREEN_TITLE_TEXT_OVERLAY_PRODUCT_MATURITY_V1 — unit coverage.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getCaptionSettings, patchCaptionSettings } from "../../../src/lib/ai-edition/captions";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { listTitleAnnotations } from "./directTitle";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

const DUR = 30;

function cleanDoc(id = "proj_title_unit"): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Title unit" });
	const assetId = "asset_1";
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: assetId, allowAgentEdits: true },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: "clip",
				originalPath: "/tmp/fake.mp4",
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

describe("OPENSCREEN_TITLE_TEXT_OVERLAY_PRODUCT_MATURITY_V1 unit", () => {
	beforeEach(() => clearLocalEditorialSessionsForTests());

	it("routes explicit title commands locally", () => {
		const a = parseLocalEditorialRequest("add the title 'OpenScreen Tutorial'");
		expect(a.intent).toBe("TITLE");
		expect(a.executionKind).toBe("direct_document");
		expect(a.titleText).toBe("OpenScreen Tutorial");

		const b = parseLocalEditorialRequest("show 'Export Settings' from 5 to 8 seconds");
		expect(b.intent).toBe("TITLE");
		expect(b.executionKind).toBe("direct_document");
		expect(b.titleText).toBe("Export Settings");
		expect(b.range?.startSec).toBe(5);
		expect(b.range?.endSec).toBe(8);

		expect(parseLocalEditorialRequest("add a title").executionKind).toBe(
			"professional_orchestrator",
		);
		expect(parseLocalEditorialRequest("remove that title").intent).toBe("REMOVE_TITLE");
	});

	it("adds exact text, adjusts, and does not touch captions", () => {
		let doc = cleanDoc("proj_title_flow");
		doc = patchCaptionSettings(doc, { enabled: true });
		const capBefore = getCaptionSettings(doc);

		const parsed = parseLocalEditorialRequest(
			"add the title 'OpenScreen Tutorial' at the beginning",
		);
		expect(parsed).toMatchObject({
			intent: "TITLE",
			executionKind: "direct_document",
			titleText: "OpenScreen Tutorial",
		});

		const add = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "add the title 'OpenScreen Tutorial' at the beginning",
		});
		if (!add.mutated) {
			throw new Error(`add failed: ${add.userFacingText} exec=${add.request.executionKind}`);
		}
		expect(add.needsProfessionalOrchestrator).toBe(false);
		doc = add.document;
		const titles = listTitleAnnotations(doc);
		expect(titles).toHaveLength(1);
		expect(titles[0]!.content || titles[0]!.textContent).toMatch(/OpenScreen Tutorial/);

		const bigger = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make it bigger",
		});
		expect(bigger.mutated).toBe(true);
		doc = bigger.document;
		expect(listTitleAnnotations(doc)[0]!.style.fontSize).toBeGreaterThan(44);

		const change = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "change that to 'OpenScreen Editing Tutorial'",
		});
		expect(change.mutated).toBe(true);
		doc = change.document;

		const mid = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "show 'Export Settings' from 5 to 8 seconds",
		});
		expect(mid.mutated).toBe(true);
		doc = mid.document;
		expect(listTitleAnnotations(doc).length).toBe(2);

		const capAfter = getCaptionSettings(doc);
		expect(capAfter.enabled).toBe(capBefore.enabled);
		expect(capAfter.fontSize).toBe(capBefore.fontSize);

		const rem = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove the Export Settings title",
		});
		expect(rem.mutated).toBe(true);
		expect(listTitleAnnotations(rem.document)).toHaveLength(1);
		expect(getCaptionSettings(rem.document).enabled).toBe(true);
	});

	it("document-grounds title style after session loss", () => {
		let doc = cleanDoc("proj_title_persist");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "add the title 'OpenScreen Tutorial'",
		}).document;
		const before = listTitleAnnotations(doc)[0]!.style.fontSize;
		clearLocalEditorialSessionsForTests();
		const smaller = applyLocalEditorialControl({
			projectId: "proj_title_fresh",
			document: doc,
			userMessage: "make the OpenScreen Tutorial title smaller",
		});
		expect(smaller.mutated).toBe(true);
		expect(listTitleAnnotations(smaller.document)[0]!.style.fontSize).toBeLessThan(before);
	});

	it("targets named title among several for size adjust", () => {
		let doc = cleanDoc("proj_title_multi");
		for (const m of [
			"add the title 'OpenScreen Tutorial' at the beginning",
			"show 'Export Settings' from 5 to 8 seconds",
			"add a title at the end saying 'Thanks for Watching'",
		]) {
			const r = applyLocalEditorialControl({
				projectId: doc.project.id,
				document: doc,
				userMessage: m,
			});
			expect(r.mutated, r.userFacingText).toBe(true);
			doc = r.document;
		}
		expect(listTitleAnnotations(doc)).toHaveLength(3);
		const midBefore = listTitleAnnotations(doc).find((t) =>
			/Export Settings/i.test(String(t.content || t.textContent)),
		)!;
		expect(midBefore.style.fontSize).toBe(44);
		const bigger = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make the Export Settings title bigger",
		});
		expect(bigger.mutated, bigger.userFacingText).toBe(true);
		const midAfter = listTitleAnnotations(bigger.document).find((t) =>
			/Export Settings/i.test(String(t.content || t.textContent)),
		)!;
		expect(midAfter.style.fontSize).toBeGreaterThan(44);
		const first = listTitleAnnotations(bigger.document).find((t) =>
			/OpenScreen Tutorial/i.test(String(t.content || t.textContent)),
		)!;
		expect(first.style.fontSize).toBe(44);
	});

	it("removes ending title among several", () => {
		let doc = cleanDoc("proj_title_end_rm");
		for (const m of [
			"add the title 'OpenScreen Tutorial' at the beginning",
			"show 'Export Settings' from 5 to 8 seconds",
			"add a title at the end saying 'Thanks for Watching'",
			"make the Export Settings title bigger",
			"make the title bigger",
		]) {
			doc = applyLocalEditorialControl({
				projectId: doc.project.id,
				document: doc,
				userMessage: m,
			}).document;
		}
		const rem = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove the ending title",
		});
		expect(rem.mutated, rem.userFacingText).toBe(true);
		expect(rem.userFacingText).toMatch(/Thanks for Watching/i);
		expect(
			listTitleAnnotations(rem.document).some((t) =>
				/Thanks for Watching/i.test(String(t.content || t.textContent)),
			),
		).toBe(false);
		expect(listTitleAnnotations(rem.document)).toHaveLength(2);
	});
});

/**
 * OPENSCREEN_CAPTIONS_PRODUCT_MATURITY_V1 — unit coverage.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { deriveCaptionCues, getCaptionSettings } from "../../../src/lib/ai-edition/captions";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

const DUR = 30;

function cleanDoc(id = "proj_caption_unit"): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Caption unit" });
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
		transcripts: [
			{
				assetId,
				language: "en",
				segments: [
					{
						id: "seg_1",
						kind: "speech",
						startSec: 5,
						endSec: 9,
						text: "open screen editor settings",
						wordIds: ["w1", "w2", "w3", "w4"],
					},
					{
						id: "seg_2",
						kind: "speech",
						startSec: 12,
						endSec: 15,
						text: "export settings panel",
						wordIds: ["w5", "w6", "w7"],
					},
				],
				words: [
					{ id: "w1", segmentId: "seg_1", startSec: 5, endSec: 5.5, text: "open" },
					{ id: "w2", segmentId: "seg_1", startSec: 5.5, endSec: 6.2, text: "screen" },
					{ id: "w3", segmentId: "seg_1", startSec: 6.2, endSec: 7.2, text: "editor" },
					{ id: "w4", segmentId: "seg_1", startSec: 7.2, endSec: 9, text: "settings" },
					{ id: "w5", segmentId: "seg_2", startSec: 12, endSec: 12.8, text: "export" },
					{ id: "w6", segmentId: "seg_2", startSec: 12.8, endSec: 13.6, text: "settings" },
					{ id: "w7", segmentId: "seg_2", startSec: 13.6, endSec: 15, text: "panel" },
				],
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

describe("OPENSCREEN_CAPTIONS_PRODUCT_MATURITY_V1 unit", () => {
	beforeEach(() => clearLocalEditorialSessionsForTests());

	it("routes enable / disable / style / correct locally", () => {
		expect(parseLocalEditorialRequest("add captions").intent).toBe("ENABLE_CAPTIONS");
		expect(parseLocalEditorialRequest("turn captions on").intent).toBe("ENABLE_CAPTIONS");
		expect(parseLocalEditorialRequest("show subtitles").intent).toBe("ENABLE_CAPTIONS");
		expect(parseLocalEditorialRequest("remove the captions").intent).toBe("CAPTIONS");
		expect(parseLocalEditorialRequest("turn subtitles off").intent).toBe("CAPTIONS");
		expect(parseLocalEditorialRequest("make the captions smaller").intent).toBe("CAPTION_STYLE");
		expect(parseLocalEditorialRequest("make them a little bigger").captionStyleOp).toBe("larger");
		expect(parseLocalEditorialRequest("move the captions higher").captionStyleOp).toBe("higher");
		expect(parseLocalEditorialRequest("put the captions at the bottom").captionStyleOp).toBe(
			"bottom",
		);
		expect(parseLocalEditorialRequest("make the captions easier to read").captionStyleOp).toBe(
			"easier_read",
		);
		expect(parseLocalEditorialRequest("show fewer words at once").captionStyleOp).toBe(
			"fewer_words",
		);
		const fix = parseLocalEditorialRequest(
			"replace 'open screen' with 'OpenScreen' in the captions",
		);
		expect(fix.intent).toBe("CORRECT_CAPTION");
		expect(fix.executionKind).toBe("direct_document");
		expect(fix.captionTextReplace?.from?.toLowerCase()).toContain("open");
		expect(parseLocalEditorialRequest("Do you think captions would help here?").executionKind).toBe(
			"semantic_understanding",
		);
		expect(parseLocalEditorialRequest("Don't remove the captions.").intent).toBe("PRESERVE_RANGE");
	});

	it("enables, styles, corrects, disables without cloud", () => {
		let doc = cleanDoc("proj_cap_flow");
		const on = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "add captions",
		});
		expect(on.mutated).toBe(true);
		expect(on.needsProfessionalOrchestrator).toBe(false);
		expect(getCaptionSettings(on.document).enabled).toBe(true);
		doc = on.document;

		const smaller = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make the captions smaller",
		});
		expect(smaller.mutated).toBe(true);
		expect(getCaptionSettings(smaller.document).fontSize).toBeLessThan(
			getCaptionSettings(doc).fontSize,
		);
		doc = smaller.document;

		const higher = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "move them a little higher",
		});
		expect(higher.mutated).toBe(true);
		expect(getCaptionSettings(higher.document).insetY).toBeGreaterThan(
			getCaptionSettings(doc).insetY,
		);
		doc = higher.document;

		const correct = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "replace 'open screen' with 'OpenScreen'",
		});
		expect(correct.mutated).toBe(true);
		const cues = deriveCaptionCues(correct.document, getCaptionSettings(correct.document), {});
		expect(cues.some((c) => /OpenScreen/i.test(c.text))).toBe(true);
		doc = correct.document;

		const off = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "turn captions off",
		});
		expect(off.mutated).toBe(true);
		expect(getCaptionSettings(off.document).enabled).toBe(false);
		// Settings preserved (non-destructive disable)
		expect(getCaptionSettings(off.document).fontSize).toBe(getCaptionSettings(doc).fontSize);

		const back = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: off.document,
			userMessage: "turn captions back on",
		});
		expect(back.mutated).toBe(true);
		expect(getCaptionSettings(back.document).enabled).toBe(true);
	});

	it("document-grounds caption style after session loss", () => {
		let doc = cleanDoc("proj_cap_persist");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "add captions",
		}).document;
		const before = getCaptionSettings(doc).fontSize;
		clearLocalEditorialSessionsForTests();
		const bigger = applyLocalEditorialControl({
			projectId: "proj_cap_fresh_session",
			document: doc,
			userMessage: "make the captions a little bigger",
		});
		expect(bigger.mutated).toBe(true);
		expect(bigger.needsProfessionalOrchestrator).toBe(false);
		expect(getCaptionSettings(bigger.document).fontSize).toBeGreaterThan(before);
	});

	it("refuses enable without transcript", () => {
		const base = cleanDoc("proj_cap_empty");
		const empty = documentSchema.parse({
			...base,
			transcripts: [],
			transcript: null,
		});
		const r = applyLocalEditorialControl({
			projectId: empty.project.id,
			document: empty,
			userMessage: "add captions",
		});
		expect(r.mutated).toBe(false);
		expect(r.needsProfessionalOrchestrator).toBe(true);
	});
});

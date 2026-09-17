/**
 * OPENSCREEN_TRIM_SHORTEN_PRODUCT_MATURITY_V1 — unit coverage for direct trim.
 */

import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { programmeDurationSec } from "./directTrim";
import { applyLocalEditorialControl, parseLocalEditorialRequest } from "./index";

const DUR = 30;

function cleanDoc(id = "proj_trim_unit"): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Trim unit" });
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
					wordRefs: [],
				},
			],
			trimRanges: [],
		},
		zoomRanges: [],
	});
}

describe("TRIM/SHORTEN maturity V1 — parse + direct", () => {
	it("routes explicit range removes to direct_document", () => {
		const cases = [
			"remove the first 3 seconds",
			"remove from 5 seconds to 8 seconds",
			"cut 5s to 8s",
			"remove the last 2 seconds",
			"trim the beginning by 2 seconds",
			"trim the end by 2 seconds",
			"remove everything between 10 and 12 seconds",
		];
		for (const msg of cases) {
			const r = parseLocalEditorialRequest(msg);
			expect(r.intent, msg).toBe("REMOVE_RANGE");
			expect(r.executionKind, msg).toBe("direct_document");
			expect(r.range, msg).not.toBeNull();
		}
	});

	it("keeps autonomous pause removal on orchestrator", () => {
		const auto = parseLocalEditorialRequest("remove unnecessary pauses");
		expect(auto.intent).toBe("REMOVE_PAUSES");
		expect(auto.executionKind).toBe("professional_orchestrator");
		const pro = parseLocalEditorialRequest(
			"Make this video professional and ready to publish. You decide.",
		);
		expect(pro.intent).toBe("PROFESSIONALIZE");
		expect(pro.executionKind).toBe("professional_orchestrator");
	});

	it("grounds shorten-around as SHORTEN_PAUSES with nearTimestamp", () => {
		const r = parseLocalEditorialRequest("shorten the pause around 12 seconds");
		expect(r.intent).toBe("SHORTEN_PAUSES");
		expect(r.range?.nearTimestamp).toBe(true);
		expect(r.range?.startSec).toBe(12);
		expect(r.executionKind).toBe("professional_orchestrator");
	});

	it("applies first/middle/last removes on programme time", () => {
		let doc = cleanDoc();
		const a = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove the first 3 seconds",
		});
		expect(a.mutated).toBe(true);
		expect(a.document.timeline.trimRanges.length).toBe(1);
		expect(programmeDurationSec(a.document)).toBeCloseTo(27, 1);
		doc = a.document;

		const b = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove from 5 seconds to 8 seconds",
		});
		expect(b.mutated).toBe(true);
		// After removing first 3s, programme 5–8 maps later in source — still one more trim.
		expect(b.document.timeline.trimRanges.length).toBeGreaterThanOrEqual(2);
		const durB = programmeDurationSec(b.document);
		expect(durB).toBeCloseTo(24, 1);
		doc = b.document;

		const c = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove the last 2 seconds",
		});
		expect(c.mutated).toBe(true);
		expect(programmeDurationSec(c.document)).toBeCloseTo(22, 1);
	});

	it("PROGRAMME_TIME_MAPPING — second cut uses current programme", () => {
		let doc = cleanDoc("proj_prog_map");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove the first 5 seconds",
		}).document;
		expect(programmeDurationSec(doc)).toBeCloseTo(25, 1);

		const beforeTrims = doc.timeline.trimRanges.length;
		const second = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove from 5 seconds to 8 seconds",
		});
		expect(second.mutated).toBe(true);
		expect(second.document.timeline.trimRanges.length).toBeGreaterThan(beforeTrims);
		// Programme 5–8 after leading 5s cut ≈ source 10–13, not source 5–8.
		const newest = second.document.timeline.trimRanges.at(-1)!;
		expect(newest.startSec).toBeGreaterThanOrEqual(9.5);
		expect(newest.endSec).toBeLessThanOrEqual(13.5);
		expect(programmeDurationSec(second.document)).toBeCloseTo(22, 1);
	});

	it("follow-up adjusts the same cut", () => {
		let doc = cleanDoc("proj_follow");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove from 5 seconds to 8 seconds",
		}).document;
		const before = doc.timeline.trimRanges[0]!;
		expect(before).toBeTruthy();

		const adj = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make that cut start half a second earlier",
		});
		expect(adj.mutated).toBe(true);
		expect(adj.request.intent).toBe("REVISE_PREVIOUS_EDIT");
		expect(adj.document.timeline.trimRanges.length).toBe(1);
		const after = adj.document.timeline.trimRanges[0]!;
		expect(after.startSec).toBeLessThan(before.startSec - 0.4);
		expect(after.endSec).toBeCloseTo(before.endSec, 1);
	});

	it("pause follow-ups resolve against last trim", () => {
		let doc = cleanDoc("proj_pause_fu");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove from 10 seconds to 13 seconds",
		}).document;
		const shorter = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make it a little shorter",
		});
		expect(shorter.request.intent).toBe("REVISE_PREVIOUS_EDIT");
		expect(shorter.request.executionKind).toBe("direct_document");
		expect(shorter.cloudCalls).toBe(0);
	});

	it("undo restores prior trim via session", () => {
		let doc = cleanDoc("proj_undo_trim");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove the first 3 seconds",
		}).document;
		expect(doc.timeline.trimRanges.length).toBe(1);
		const undone = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "undo that",
		});
		expect(undone.mutated).toBe(true);
		expect(undone.document.timeline.trimRanges.length).toBe(0);
	});
});

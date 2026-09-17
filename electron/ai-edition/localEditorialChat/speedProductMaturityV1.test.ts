/**
 * OPENSCREEN_SPEED_PRODUCT_MATURITY_V1 — unit coverage for direct speed.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { DEFAULT_SPEED_UP, listSpeedRegions, programmeDurationWithSpeed } from "./directSpeed";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

const DUR = 30;

function cleanDoc(id = "proj_speed_unit"): AxcutDocument {
	const base = createEmptyDocument({ projectId: id, title: "Speed unit" });
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

describe("SPEED maturity V1 — parse + direct", () => {
	beforeEach(() => clearLocalEditorialSessionsForTests());

	it("routes explicit range speeds to direct_document", () => {
		const cases = [
			{ msg: "speed up from 5 to 10 seconds", mult: null as number | null },
			{ msg: "make 5 to 10 seconds 2x", mult: 2 },
			{ msg: "speed up the first 4 seconds", mult: null },
			{ msg: "make the last 5 seconds 1.5x", mult: 1.5 },
			{ msg: "make 8s to 12s faster", mult: null },
			{ msg: "slow 5 to 10 seconds to 0.75x", mult: 0.75 },
		];
		for (const c of cases) {
			const r = parseLocalEditorialRequest(c.msg);
			expect(r.executionKind, c.msg).toBe("direct_document");
			expect(r.range, c.msg).not.toBeNull();
			if (c.mult != null) expect(r.speedMultiplier, c.msg).toBe(c.mult);
			expect(
				r.intent === "SPEED_UP" || r.intent === "SLOW_DOWN" || r.intent === "REMOVE_EDIT",
				c.msg,
			).toBe(true);
		}
	});

	it("keeps semantic / autonomous speed on orchestrator", () => {
		const auto = parseLocalEditorialRequest("make the slow parts faster");
		expect(auto.intent).toBe("SPEED_UP");
		expect(auto.executionKind).toBe("professional_orchestrator");
		const pro = parseLocalEditorialRequest(
			"Make this video professional and ready to publish. You decide.",
		);
		expect(pro.executionKind).toBe("professional_orchestrator");
		const lowInfo = parseLocalEditorialRequest("speed up low-information parts where it helps");
		expect(lowInfo.executionKind).toBe("professional_orchestrator");
	});

	it("applies explicit 2x and default 1.5x on programme range", () => {
		let doc = cleanDoc();
		const a = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make 5 to 10 seconds 2x",
		});
		expect(a.mutated).toBe(true);
		expect(a.cloudCalls).toBe(0);
		const regions = listSpeedRegions(a.document);
		expect(regions).toHaveLength(1);
		expect(regions[0]!.speed).toBe(2);
		expect(regions[0]!.startMs).toBe(5000);
		expect(regions[0]!.endMs).toBe(10000);
		// 5s at 2x → ~2.5s programme contribution; total ≈ 30 - 2.5 = 27.5
		expect(programmeDurationWithSpeed(a.document)).toBeCloseTo(27.5, 1);
		doc = a.document;

		clearLocalEditorialSessionsForTests();
		doc = cleanDoc("proj_default");
		const b = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "speed up from 5 to 10 seconds",
		});
		expect(b.mutated).toBe(true);
		expect(listSpeedRegions(b.document)[0]!.speed).toBe(DEFAULT_SPEED_UP);
	});

	it("SPEED_PROGRAMME_TIME_MAPPING after trim (frozen trim path)", () => {
		let doc = cleanDoc("proj_speed_after_trim");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "remove the first 3 seconds",
		}).document;
		expect(programmeDurationWithSpeed(doc)).toBeCloseTo(27, 1);

		const sped = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "speed up from 5 to 10 seconds",
		});
		expect(sped.mutated).toBe(true);
		const r = listSpeedRegions(sped.document)[0]!;
		// Programme 5–10 after leading 3s cut ≈ raw 8–13
		expect(r.startMs / 1000).toBeGreaterThanOrEqual(7.5);
		expect(r.endMs / 1000).toBeLessThanOrEqual(13.5);
		expect(r.speed).toBe(DEFAULT_SPEED_UP);
	});

	it("follow-up adjusts the same speed region", () => {
		let doc = cleanDoc("proj_speed_fu");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make 5 to 10 seconds 1.5x",
		}).document;
		const id0 = listSpeedRegions(doc)[0]!.id;
		const faster = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make that a little faster",
		});
		expect(faster.mutated).toBe(true);
		expect(faster.request.referencedPreviousEdit).toBe("last_speed");
		const regions = listSpeedRegions(faster.document);
		expect(regions).toHaveLength(1);
		expect(regions[0]!.speed).toBeGreaterThan(1.5);
		// same region mutated (setSpeed) — id may change via pill rebuild; count stays 1
		expect(regions[0]!.startMs).toBe(5000);
		void id0;

		const normal = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: faster.document,
			userMessage: "return that section to normal speed",
		});
		expect(normal.mutated).toBe(true);
		expect(listSpeedRegions(normal.document)).toHaveLength(0);
	});

	it("document-grounds relative speed after session loss (restart)", () => {
		let doc = cleanDoc("proj_speed_persist");
		doc = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make 5 to 10 seconds 1.5x",
		}).document;
		clearLocalEditorialSessionsForTests();
		const faster = applyLocalEditorialControl({
			projectId: "proj_speed_restart_fresh_session",
			document: doc,
			userMessage: "make that a little faster",
		});
		expect(faster.mutated).toBe(true);
		expect(faster.request.executionKind).toBe("direct_document");
		expect(faster.request.referencedPreviousEdit).toBe("last_speed");
		expect(listSpeedRegions(faster.document)[0]!.speed).toBeGreaterThan(1.5);
		expect(faster.needsProfessionalOrchestrator).toBe(false);
	});

	it("applies slowdown when compositor supports <1x", () => {
		const doc = cleanDoc("proj_slow");
		const r = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "slow 5 to 10 seconds to 0.75x",
		});
		expect(r.mutated).toBe(true);
		expect(listSpeedRegions(r.document)[0]!.speed).toBe(0.75);
		expect(programmeDurationWithSpeed(r.document)).toBeGreaterThan(DUR);
	});
});

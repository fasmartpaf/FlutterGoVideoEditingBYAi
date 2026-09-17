/**
 * OPENSCREEN_ZOOM_CONTROL_MATURITY_V1 — unit + compositional paraphrase matrix.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { type AxcutDocument, createEmptyDocument } from "../../../src/lib/ai-edition/schema";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
	shouldHandleLocalEditorialWithoutCloud,
} from "./index";

const DUR = 30;

function docWithClip(projectId: string): AxcutDocument {
	const base = createEmptyDocument({ projectId, title: "Zoom maturity" });
	const assetId = "asset_zoom";
	return {
		...base,
		project: { ...base.project, primaryAssetId: assetId, allowAgentEdits: true },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: "zoom-fixture",
				originalPath: "/tmp/zoom-fixture.mp4",
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
		},
		zoomRanges: [],
	};
}

const DIRECT_IN = [
	"from a second 5s to 10s add a zoom in ok?",
	"Zoom in from 5s to 10s.",
	"add a zoom between 5 and 10 seconds",
	"zoom into this part from 00:05 to 00:10",
	"from second 5 until second 10 make it closer",
	"between five and ten seconds zoom in",
	"At 12 seconds zoom in.",
	"zoom in a little from 5s to 10s",
];

const DIRECT_OUT = [
	"zoom out from 10s to 15s",
	"make it wider between 10 and 15 seconds",
	"pull back here from 10s to 15s",
	"return to the full screen at 15 seconds",
];

const INTENSITY = [
	"Make that zoom a little stronger.",
	"make the zoom stronger",
	"too much, reduce the zoom",
	"make this zoom 1.8x",
	"Dial the zoom back a notch.",
];

const REMOVE = ["Undo that zoom.", "Remove that zoom.", "Take the last zoom off the timeline."];

const AUTONOMOUS = [
	"Add zooms wherever useful.",
	"Improve the visual focus.",
	"Add zooms where useful.",
];

const NON_EDIT = [
	"Why did you zoom in there?",
	"Do you think this needs a zoom?",
	"Don't zoom this section.",
];

describe("OPENSCREEN_ZOOM_CONTROL_MATURITY_V1", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
	});

	it("real failure phrase → direct ADD_ZOOM 5–10 EXECUTE", () => {
		const r = parseLocalEditorialRequest("from a second 5s to 10s add a zoom in ok?");
		expect(r.intent).toBe("ADD_ZOOM");
		expect(r.range).toEqual({ startSec: 5, endSec: 10 });
		expect(r.zoomDirection).toBe("in");
		expect(r.zoomAuthorization).toBe("execute");
		expect(r.executionKind).toBe("direct_document");
		expect(r.orchestratorMessage).toBeNull();
	});

	it("DIRECT_IN paraphrases: range survives + local execute", () => {
		let hits = 0;
		for (const msg of DIRECT_IN) {
			const r = parseLocalEditorialRequest(msg);
			const ok =
				r.intent === "ADD_ZOOM" &&
				r.executionKind === "direct_document" &&
				r.zoomAuthorization === "execute" &&
				r.range != null &&
				r.range.endSec > r.range.startSec;
			if (ok) hits++;
			else console.warn("DIRECT_IN miss", msg, r.intent, r.executionKind, r.range);
		}
		expect(hits / DIRECT_IN.length).toBeGreaterThanOrEqual(0.85);
	});

	it("DIRECT_OUT paraphrases: out/reset + direct", () => {
		let hits = 0;
		for (const msg of DIRECT_OUT) {
			const r = parseLocalEditorialRequest(msg);
			const ok =
				r.intent === "ADJUST_ZOOM" &&
				(r.zoomDirection === "out" || r.zoomDirection === "reset") &&
				r.executionKind === "direct_document";
			if (ok) hits++;
			else console.warn("DIRECT_OUT miss", msg, r);
		}
		expect(hits / DIRECT_OUT.length).toBeGreaterThanOrEqual(0.75);
	});

	it("AUTONOMOUS stays orch/propose (no explicit range)", () => {
		for (const msg of AUTONOMOUS) {
			const r = parseLocalEditorialRequest(msg);
			expect(r.intent, msg).toBe("ADD_ZOOM");
			expect(r.executionKind, msg).toBe("professional_orchestrator");
			expect(r.zoomAuthorization, msg).toBe("propose");
			expect(r.range, msg).toBeNull();
		}
	});

	it("NON_EDIT guards do not ADD_ZOOM execute", () => {
		for (const msg of NON_EDIT) {
			const r = parseLocalEditorialRequest(msg);
			expect(r.executionKind === "direct_document" && r.intent === "ADD_ZOOM").toBe(false);
			expect(
				r.intent === "UNKNOWN" ||
					r.intent === "PRESERVE_RANGE" ||
					r.executionKind === "escalate_cloud" ||
					r.executionKind === "constraint_only",
			).toBe(true);
		}
	});

	it("applies explicit range zoom to document locally", () => {
		const projectId = "proj_zoom_apply";
		let doc = docWithClip(projectId);
		const r = applyLocalEditorialControl({
			projectId,
			document: doc,
			userMessage: "from a second 5s to 10s add a zoom in ok?",
		});
		expect(r.cloudCalls).toBe(0);
		expect(r.needsProfessionalOrchestrator).toBe(false);
		expect(r.mutated).toBe(true);
		expect(r.document.zoomRanges.length).toBeGreaterThanOrEqual(1);
		const z = r.document.zoomRanges[0]!;
		expect(z.startMs / 1000).toBeCloseTo(5, 0);
		expect(z.endMs / 1000).toBeCloseTo(10, 0);
		expect(/added a zoom from 5/i.test(r.userFacingText)).toBe(true);
		expect(/framing unchanged|couldn'?t find a grounded zoom/i.test(r.userFacingText)).toBe(false);
		doc = r.document;

		const stronger = applyLocalEditorialControl({
			projectId,
			document: doc,
			userMessage: "Make that zoom a little stronger.",
		});
		expect(stronger.mutated).toBe(true);
		expect(stronger.document.zoomRanges[0]!.depth).toBeGreaterThan(z.depth);

		const undo = applyLocalEditorialControl({
			projectId,
			document: stronger.document,
			userMessage: "Undo that.",
		});
		expect(undo.mutated).toBe(true);
		// Undo restores pre-stronger doc — zoom remains, depth back to the first apply.
		expect(undo.document.zoomRanges.length).toBe(1);
		expect(undo.document.zoomRanges[0]!.depth).toBe(z.depth);
	});

	it("conversational follow-ups A→F preserve zoom reference", () => {
		const projectId = "proj_zoom_follow";
		let doc = docWithClip(projectId);
		const turns = [
			"Zoom in from 5s to 10s.",
			"Make that zoom a little stronger.",
			"Start it at 4 seconds instead.",
			"Keep it until 11 seconds.",
			"Actually zoom out after that.",
			"Undo that.",
		];
		const trace: Array<Record<string, unknown>> = [];
		for (const msg of turns) {
			const r = applyLocalEditorialControl({
				projectId,
				document: doc,
				userMessage: msg,
			});
			trace.push({
				msg,
				intent: r.request.intent,
				exec: r.request.executionKind,
				mutated: r.mutated,
				zooms: r.document.zoomRanges.map((z) => ({
					start: z.startMs / 1000,
					end: z.endMs / 1000,
					depth: z.depth,
				})),
				text: r.userFacingText.slice(0, 120),
				cloud: r.cloudCalls,
			});
			expect(r.cloudCalls).toBe(0);
			expect(r.needsProfessionalOrchestrator).toBe(false);
			doc = r.document;
		}
		expect(trace[0]!.mutated).toBe(true);
		expect((trace[0]!.zooms as unknown[]).length).toBe(1);
		expect(trace[1]!.mutated).toBe(true);
		// start/keep may adjust bounds
		expect((trace[2]!.mutated as boolean) || (trace[3]!.mutated as boolean)).toBe(true);
	});

	it("paraphrase matrix metrics", () => {
		const allZoomish = [...DIRECT_IN, ...DIRECT_OUT, ...INTENSITY, ...REMOVE, ...AUTONOMOUS];
		let intentHits = 0;
		let falseZoom = 0;
		let directExec = 0;
		let directCandidates = 0;
		for (const msg of allZoomish) {
			const r = parseLocalEditorialRequest(msg);
			const isZoomIntent =
				r.intent === "ADD_ZOOM" || r.intent === "ADJUST_ZOOM" || r.intent === "REMOVE_ZOOM";
			if (isZoomIntent) intentHits++;
			if (
				(r.intent === "ADD_ZOOM" || r.intent === "ADJUST_ZOOM") &&
				r.range != null &&
				r.executionKind === "direct_document"
			) {
				directCandidates++;
				directExec++;
			} else if (DIRECT_IN.includes(msg) || DIRECT_OUT.includes(msg)) {
				directCandidates++;
				if (r.executionKind === "direct_document") directExec++;
			}
		}
		for (const msg of NON_EDIT) {
			const r = parseLocalEditorialRequest(msg);
			if (r.intent === "ADD_ZOOM" && r.executionKind === "direct_document") falseZoom++;
		}
		const recall = intentHits / allZoomish.length;
		const falseRate = falseZoom / NON_EDIT.length;
		const directRate = directCandidates === 0 ? 0 : directExec / directCandidates;
		expect(recall).toBeGreaterThanOrEqual(0.85);
		expect(falseRate).toBe(0);
		expect(directRate).toBeGreaterThanOrEqual(0.8);
		expect(shouldHandleLocalEditorialWithoutCloud(DIRECT_IN[0]!)).toBe(true);
	});
});

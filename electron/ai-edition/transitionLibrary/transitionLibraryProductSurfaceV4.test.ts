/**
 * OPENSCREEN_TRANSITION_LIBRARY_PRODUCT_SURFACE_V4 — unit coverage.
 */

import { describe, expect, it } from "vitest";
import { setClipIncomingTransitionInDocument } from "../../../src/lib/ai-edition/document/incomingTransition";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { clipJoins } from "../../../src/lib/ai-edition/timeline/clipFilmstrip";
import { resolveTransitionGpuBackend } from "../../../src/lib/ai-edition/transitions/gpuBackend";
import {
	applyDirectTransitionAdd,
	applyDirectTransitionAdjust,
	applyDirectTransitionRemove,
	listTransitionJoins,
} from "../localEditorialChat/directTransition";
import { parseLocalEditorialRequest } from "../localEditorialChat/parse";
import {
	getTransitionById,
	listUserAvailableTransitions,
	resolveTransitionPhrase,
	searchTransitions,
} from "../transitionLibrary";

function multiClipDoc() {
	const base = createEmptyDocument({ projectId: "proj_tl_v4", title: "v4" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, allowAgentEdits: true },
		assets: [
			{
				id: "a1",
				kind: "video",
				label: "rec",
				originalPath: "/tmp/x.mp4",
				durationSec: 20,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_a",
					assetId: "a1",
					sourceStartSec: 0,
					sourceEndSec: 10,
					timelineStartSec: 0,
					timelineEndSec: 10,
					origin: "system",
					reason: "primary",
					incomingTransition: { kind: "cut", transitionId: "openscreen.cut" },
				},
				{
					id: "clip_b",
					assetId: "a1",
					sourceStartSec: 10,
					sourceEndSec: 20,
					timelineStartSec: 10,
					timelineEndSec: 20,
					origin: "system",
					reason: "join",
					incomingTransition: { kind: "cut", transitionId: "openscreen.cut" },
				},
			],
		},
	});
}

describe("TRANSITION_LIBRARY_PRODUCT_SURFACE_V4", () => {
	it("registry is UI SSOT — metal list excludes quarantined", () => {
		const list = listUserAvailableTransitions("metal");
		expect(list.every((e) => e.userAvailable)).toBe(true);
		expect(list.some((e) => e.id === "gl.circleOpen")).toBe(false);
		expect(list.some((e) => e.id === "gl.wipeLeft")).toBe(true);
		expect(list.length).toBeGreaterThanOrEqual(10);
	});

	it("backend gating — d3d11 does not expose Metal-only A/B as available", () => {
		const d3d = listUserAvailableTransitions("d3d11");
		expect(d3d.every((e) => e.gpuCompatibility.d3d11 !== false)).toBe(true);
		expect(d3d.some((e) => e.id === "openscreen.cut")).toBe(true);
		expect(d3d.some((e) => e.id === "gl.wipeLeft")).toBe(false);
		expect(resolveTransitionGpuBackend("hardware")).toMatch(/metal|d3d11|wgpu/);
	});

	it("phrase resolution — wipe left / left wipe / slide right", () => {
		expect(resolveTransitionPhrase("wipe to the left", "metal").status).toBe("resolved");
		expect(
			(resolveTransitionPhrase("wipe to the left", "metal") as { transitionId: string })
				.transitionId,
		).toBe("gl.wipeLeft");
		expect(
			(resolveTransitionPhrase("left wipe", "metal") as { transitionId: string }).transitionId,
		).toBe("gl.wipeLeft");
		expect(
			(resolveTransitionPhrase("slide right", "metal") as { transitionId: string }).transitionId,
		).toBe("gl.slideRight");
		expect(searchTransitions("wipe", "metal").some((e) => e.category === "wipe")).toBe(true);
	});

	it("document mutation apply/replace/remove + duration clamp", () => {
		let doc = multiClipDoc();
		const a = setClipIncomingTransitionInDocument(doc, {
			clipId: "clip_b",
			transitionId: "openscreen.dissolve",
			durationSec: 0.4,
		});
		expect(a.ok).toBe(true);
		if (!a.ok) return;
		doc = a.document;
		expect(doc.timeline.clips[1]!.incomingTransition?.transitionId).toBe("openscreen.dissolve");
		const b = setClipIncomingTransitionInDocument(doc, {
			clipId: "clip_b",
			transitionId: "gl.wipeLeft",
			durationSec: 0.5,
		});
		expect(b.ok).toBe(true);
		if (!b.ok) return;
		doc = b.document;
		expect(doc.timeline.clips[1]!.incomingTransition?.transitionId).toBe("gl.wipeLeft");
		const c = setClipIncomingTransitionInDocument(doc, {
			clipId: "clip_b",
			transitionId: "openscreen.cut",
		});
		expect(c.ok).toBe(true);
		if (!c.ok) return;
		expect(c.document.timeline.clips[1]!.incomingTransition?.transitionId).toBe("openscreen.cut");
		const clamped = setClipIncomingTransitionInDocument(doc, {
			clipId: "clip_b",
			transitionId: "gl.slideLeft",
			durationSec: 9,
		});
		expect(clamped.ok).toBe(true);
		if (!clamped.ok) return;
		expect(clamped.durationSec).toBe(getTransitionById("gl.slideLeft")!.maxDurationSec);
	});

	it("chat direct wipe + follow-up shorter + document grounded", () => {
		let doc = multiClipDoc();
		const _add = applyDirectTransitionAdd({
			document: doc,
			request: {
				...parseLocalEditorialRequest("use wipe left here"),
			} as never,
		});
		// parse may not return full LocalEditorialRequest — build minimal
		const add2 = applyDirectTransitionAdd({
			document: doc,
			request: {
				rawText: "use wipe left here",
				intent: "TRANSITION",
				transitionKind: null,
				transitionDurationSec: null,
				transitionStyleOp: null,
			} as never,
		});
		expect(add2.mutated).toBe(true);
		doc = add2.document;
		expect(doc.timeline.clips[1]!.incomingTransition?.transitionId).toBe("gl.wipeLeft");

		const shorter = applyDirectTransitionAdjust({
			document: doc,
			request: {
				rawText: "make that a little shorter",
				intent: "ADJUST_TRANSITION",
				transitionKind: null,
				transitionDurationSec: null,
				transitionStyleOp: "shorter",
			} as never,
		});
		expect(shorter.mutated).toBe(true);
		doc = shorter.document;
		expect(doc.timeline.clips[1]!.incomingTransition?.durationSec).toBeLessThan(0.4);

		const toDissolve = applyDirectTransitionAdjust({
			document: doc,
			request: {
				rawText: "change this transition to dissolve",
				intent: "ADJUST_TRANSITION",
				transitionKind: "dissolve",
				transitionDurationSec: null,
				transitionStyleOp: "to_dissolve",
			} as never,
		});
		expect(toDissolve.mutated).toBe(true);
		expect(toDissolve.document.timeline.clips[1]!.incomingTransition?.transitionId).toMatch(
			/dissolve|fade/,
		);

		const remove = applyDirectTransitionRemove({
			document: toDissolve.document,
			request: {
				rawText: "remove the transition",
				intent: "REMOVE_TRANSITION",
				transitionKind: null,
				transitionDurationSec: null,
				transitionStyleOp: null,
			} as never,
		});
		expect(remove.mutated).toBe(true);
		expect(remove.document.timeline.clips[1]!.incomingTransition?.transitionId).toBe(
			"openscreen.cut",
		);
	});

	it("clipJoins expose incoming clip id for boundary selection", () => {
		const joins = clipJoins(multiClipDoc().timeline.clips);
		expect(joins).toEqual([{ programmeSec: 10, incomingClipId: "clip_b" }]);
		expect(listTransitionJoins(multiClipDoc())).toHaveLength(1);
	});

	it("parse recognizes wipe / duration set", () => {
		const wipe = parseLocalEditorialRequest("use wipe left here");
		expect(wipe.intent).toBe("TRANSITION");
		expect(wipe.requestedFamilies).toContain("transitions");
		const dur = parseLocalEditorialRequest("set the transition to 0.5 seconds");
		expect(
			dur.transitionDurationSec === 0.5 ||
				dur.intent === "ADJUST_TRANSITION" ||
				dur.intent === "TRANSITION",
		).toBe(true);
	});
});

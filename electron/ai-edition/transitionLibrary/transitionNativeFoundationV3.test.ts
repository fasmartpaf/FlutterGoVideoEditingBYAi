/**
 * OPENSCREEN_TRANSITION_NATIVE_FOUNDATION_V3 — registry + document authority unit tests.
 */

import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { executeAgentTool } from "../agent-tools";
import {
	getTransitionById,
	listUserAvailableTransitions,
	registryStats,
	resolveTransitionId,
	TRANSITION_REGISTRY,
} from "./index";
import { buildThirdPartyTransitionsNotices } from "./notices";

function multiClip(): AxcutDocument {
	const base = createEmptyDocument({ projectId: "proj_tl_v3", title: "TL V3" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "a", allowAgentEdits: true },
		assets: [
			{
				id: "a",
				kind: "video",
				label: "a",
				originalPath: "/tmp/a.mp4",
				durationSec: 20,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "c1",
					assetId: "a",
					sourceStartSec: 0,
					sourceEndSec: 10,
					timelineStartSec: 0,
					timelineEndSec: 10,
					origin: "system",
					reason: "primary",
				},
				{
					id: "c2",
					assetId: "a",
					sourceStartSec: 10,
					sourceEndSec: 20,
					timelineStartSec: 10,
					timelineEndSec: 20,
					origin: "system",
					reason: "join",
				},
			],
		},
	});
}

describe("TRANSITION_NATIVE_FOUNDATION_V3 registry", () => {
	it("exposes cut + dissolve + first GL ports", () => {
		expect(getTransitionById("openscreen.cut")?.userAvailable).toBe(true);
		expect(getTransitionById("openscreen.dissolve")?.implementationRef).toBe("native.ab_dissolve");
		const gl = TRANSITION_REGISTRY.filter((e) => e.provider === "gl-transitions");
		expect(gl.length).toBeGreaterThanOrEqual(8);
		expect(listUserAvailableTransitions("metal").length).toBeGreaterThanOrEqual(10);
		const stats = registryStats();
		expect(stats.TOTAL_DISCOVERED).toBe(125);
		expect(stats.USER_AVAILABLE).toBeGreaterThanOrEqual(10);
	});

	it("resolves legacy kind to registry ids", () => {
		expect(resolveTransitionId({ kind: "cut" })).toBe("openscreen.cut");
		expect(resolveTransitionId({ kind: "dissolve" })).toBe("openscreen.dissolve");
		expect(resolveTransitionId({ transitionId: "gl.wipeLeft" })).toBe("gl.wipeLeft");
	});

	it("setClipIncomingTransition writes transitionId and keeps kind BC", () => {
		const doc = multiClip();
		const r = executeAgentTool(
			doc,
			"setClipIncomingTransition",
			JSON.stringify({ clipId: "c2", transitionId: "gl.wipeLeft", durationSec: 0.4 }),
			{ editsAllowed: true },
		);
		expect(r.ok).toBe(true);
		const t = r.document!.timeline.clips[1]!.incomingTransition!;
		expect(t.transitionId).toBe("gl.wipeLeft");
		expect(t.kind).toBe("dissolve");
		expect(t.durationSec).toBe(0.4);

		const legacy = executeAgentTool(
			doc,
			"setClipIncomingTransition",
			JSON.stringify({ clipId: "c2", kind: "dissolve", durationSec: 0.35 }),
			{ editsAllowed: true },
		);
		expect(legacy.ok).toBe(true);
		expect(legacy.document!.timeline.clips[1]!.incomingTransition!.transitionId).toBe(
			"openscreen.dissolve",
		);
	});

	it("opens legacy cut/dissolve documents and emits scene modes", () => {
		const doc = multiClip();
		const withLegacy = {
			...doc,
			timeline: {
				...doc.timeline,
				clips: doc.timeline.clips.map((c, i) =>
					i === 1
						? { ...c, incomingTransition: { kind: "dissolve" as const, durationSec: 0.35 } }
						: c,
				),
			},
		};
		const parsed = documentSchema.parse(withLegacy);
		const scene = buildSceneDescription(parsed);
		const clip = scene.clips[1] as {
			incomingFadeHalfSec?: number;
			incomingTransitionMode?: number;
			incomingTransitionId?: string;
		};
		expect(clip.incomingFadeHalfSec).toBeCloseTo(0.35, 2);
		expect(clip.incomingTransitionMode).toBe(1);
		expect(clip.incomingTransitionId).toBe("openscreen.dissolve");
	});

	it("builds third-party notices from bundled set", () => {
		const text = buildThirdPartyTransitionsNotices();
		expect(text).toMatch(/gl\.wipeLeft/);
		expect(text).toMatch(/1\.71\.0/);
		expect(text).toMatch(/MIT/);
	});
});

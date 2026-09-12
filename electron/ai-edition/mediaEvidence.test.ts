import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../src/lib/ai-edition/schema";
import { documentSnapshotForModel, OPENSCREEN_TOOL_NAMES } from "./agent-tools";
import { buildMediaEvidenceCapabilities, MEDIA_EVIDENCE_NOTE } from "./mediaEvidence";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

function baseDocument(): AxcutDocument {
	const base = createEmptyDocument({
		title: "Demo",
		projectId: "proj_1",
		createdAt: CREATED_AT,
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "Screen",
				kind: "video",
				originalPath: "/tmp/recording.mp4",
				durationSec: 16.35,
				width: 1920,
				height: 1080,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 16.35,
					timelineStartSec: 0,
					timelineEndSec: 16.35,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
		transcripts: [],
		transcript: null,
	});
}

describe("buildMediaEvidenceCapabilities", () => {
	it("A — video + mediaContext path does not grant visualFrames", () => {
		const document = baseDocument();
		const caps = buildMediaEvidenceCapabilities(document);
		expect(caps).toEqual({
			timelineMetadata: true,
			cursorTelemetry: false,
			transcript: false,
			visualFrames: false,
			semanticUi: false,
			visualSemanticEvidence: false,
		});
	});

	it("B — cursor telemetry available still keeps visualFrames and semanticUi false", () => {
		const caps = buildMediaEvidenceCapabilities(baseDocument(), {
			cursorTelemetryAvailableByAssetId: { asset_1: true },
		});
		expect(caps.cursorTelemetry).toBe(true);
		expect(caps.visualFrames).toBe(false);
		expect(caps.semanticUi).toBe(false);
	});

	it("C — transcript available still keeps visualFrames false", () => {
		const document = documentSchema.parse({
			...baseDocument(),
			transcripts: [
				{
					assetId: "asset_1",
					language: "en",
					segments: [
						{
							id: "seg_1",
							startSec: 0,
							endSec: 1,
							text: "hello",
							kind: "speech",
							wordIds: ["w_1"],
						},
					],
					words: [{ id: "w_1", segmentId: "seg_1", startSec: 0, endSec: 0.4, text: "hello" }],
				},
			],
		});
		const caps = buildMediaEvidenceCapabilities(document);
		expect(caps.transcript).toBe(true);
		expect(caps.visualFrames).toBe(false);
	});

	it("only visualFramesSupplied===true may set visualFrames", () => {
		expect(
			buildMediaEvidenceCapabilities(baseDocument(), { visualFramesSupplied: false }).visualFrames,
		).toBe(false);
		expect(
			buildMediaEvidenceCapabilities(baseDocument(), { visualFramesSupplied: true }).visualFrames,
		).toBe(true);
	});

	it("visualSemanticEvidence tracks visualFrames and never flips semanticUi", () => {
		const off = buildMediaEvidenceCapabilities(baseDocument());
		expect(off.visualSemanticEvidence).toBe(false);
		expect(off.semanticUi).toBe(false);
		const on = buildMediaEvidenceCapabilities(baseDocument(), { visualFramesSupplied: true });
		expect(on.visualFrames).toBe(true);
		expect(on.visualSemanticEvidence).toBe(true);
		expect(on.semanticUi).toBe(false);
	});
});

describe("documentSnapshotForModel media evidence contract", () => {
	it("D — metadata / visibleMedia do not authorize visual inspection language", () => {
		const snapshot = documentSnapshotForModel(baseDocument()) as {
			mediaCapabilities: ReturnType<typeof buildMediaEvidenceCapabilities>;
			mediaEvidenceNote: string;
			openMediaNote: string;
			visibleMedia: unknown[];
			mediaContext: unknown;
			assets: Array<{ durationSec: number | null }>;
			clips: unknown[];
		};
		expect(snapshot.visibleMedia.length).toBeGreaterThan(0);
		expect(snapshot.mediaContext).toBeTruthy();
		expect(snapshot.assets[0]?.durationSec).toBe(16.35);
		expect(snapshot.clips.length).toBe(1);
		expect(snapshot.mediaCapabilities.visualFrames).toBe(false);
		expect(snapshot.mediaCapabilities.semanticUi).toBe(false);
		expect(snapshot.mediaCapabilities.timelineMetadata).toBe(true);
		expect(snapshot.mediaEvidenceNote).toBe(MEDIA_EVIDENCE_NOTE);
		expect(snapshot.openMediaNote).toMatch(/not pixels/i);
		expect(snapshot.openMediaNote).not.toMatch(/prior visual notes/i);
		expect(JSON.stringify(snapshot)).not.toMatch(/Never say you cannot see the project/i);
	});

	it("E — cursor coords never flip semanticUi", () => {
		const snapshot = documentSnapshotForModel(baseDocument(), {
			availableByAssetId: { asset_1: true },
		}) as { mediaCapabilities: ReturnType<typeof buildMediaEvidenceCapabilities> };
		expect(snapshot.mediaCapabilities.cursorTelemetry).toBe(true);
		expect(snapshot.mediaCapabilities.semanticUi).toBe(false);
		expect(snapshot.mediaCapabilities.visualFrames).toBe(false);
	});

	it("F — deterministic edit tools remain in the vocabulary", () => {
		expect(OPENSCREEN_TOOL_NAMES).toContain("addTrim");
		expect(OPENSCREEN_TOOL_NAMES).toContain("setClipRange");
		expect(OPENSCREEN_TOOL_NAMES).toContain("addZoom");
		expect(OPENSCREEN_TOOL_NAMES).toContain("addZooms");
		expect(OPENSCREEN_TOOL_NAMES).toContain("getCursorTrack");
	});
});

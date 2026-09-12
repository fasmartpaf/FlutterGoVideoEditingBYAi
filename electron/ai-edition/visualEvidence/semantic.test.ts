import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { documentSnapshotForModel } from "../agent-tools";
import { buildVisualEvidenceUserContent } from "./attach";
import { promptWantsVisualEvidence } from "./intent";
import { prepareVisualEvidenceForTurn } from "./prepare";
import {
	auditUserFacingSemanticLanguage,
	buildSemanticCoverageMap,
	buildVisualSemanticGroundingPromptSection,
	compressMinimalStaticRanges,
	dropInvalidStaticRangesWithoutInventing,
	findMissingMaterialPixelTransitions,
	findMissingSignificantPixelTransitions,
	findUnsupportedHighConfidenceIdentities,
	findUnsupportedWholeVideoClaims,
	isFullyStaticRange,
	parseAndValidateVisualSemanticGrounding,
	stripVisualSemanticJsonBlock,
	validateVisualSemanticGrounding,
} from "./semantic";
import type { VisualChange, VisualEvidenceFrame } from "./types";

const evidence = {
	frames: [
		{ sourceTimeSec: 0, virtualTimeSec: 0 },
		{ sourceTimeSec: 2, virtualTimeSec: 2 },
		{ sourceTimeSec: 4, virtualTimeSec: 4 },
	],
	changes: [
		{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "significant" as const },
		{ fromSourceTimeSec: 2, toSourceTimeSec: 4, classification: "minimal" as const },
	],
	durationSec: 11.8,
};

function coveredGrounding() {
	return {
		observations: [
			{
				sourceTimeSec: 0,
				frameSummary: "IDE and Meet panel",
				regions: [
					{
						id: "main",
						description: "code editor",
						approximateLocation: "center" as const,
						confidence: "high" as const,
					},
				],
				visibleText: [{ text: "prediction_match_card.dart", confidence: "high" as const }],
				editingRelevance: "low" as const,
			},
		],
		transitions: [
			{
				fromSourceTimeSec: 0,
				toSourceTimeSec: 2,
				summary: "notification appears",
				pixelClassification: "significant" as const,
				semanticChange: "temporary Meet notification",
				changes: [
					{
						type: "appeared" as const,
						description: "temporary Meet notification",
						confidence: "high" as const,
					},
				],
			},
		],
		staticRanges: [
			{
				fromSourceTimeSec: 0,
				toSourceTimeSec: 4,
				coveredFrameTimes: [0, 2, 4],
				referenceObservationTimeSec: 0,
				layoutState: "stable" as const,
				contentState: "stable" as const,
				summary:
					"Materially unchanged from the reference state across sampled frames after the early notification.",
			},
		],
	};
}

describe("visual semantic grounding coverage", () => {
	it("1 — all attached timestamps accounted for", () => {
		const result = validateVisualSemanticGrounding(coveredGrounding(), evidence);
		expect(result.ok).toBe(true);
		const map = buildSemanticCoverageMap(result.grounding!, evidence);
		expect(map.uncovered).toEqual([]);
		expect(map.rows).toHaveLength(3);
	});

	it("rejects silent drop of attached timestamps (before-fix shape)", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{
						sourceTimeSec: 0,
						frameSummary: "only first frame",
						regions: [],
					},
				],
				transitions: [],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 4,
						summary: "unchanged",
					},
				],
			},
			evidence,
		);
		// Old schema without coveredFrameTimes / missing significant transition → fail
		expect(result.ok).toBe(false);
	});

	it("2 — static range can cover genuinely minimal adjacent frames", () => {
		const localEvidence = {
			frames: [
				{ sourceTimeSec: 4, virtualTimeSec: 4 },
				{ sourceTimeSec: 6, virtualTimeSec: 6 },
				{ sourceTimeSec: 8, virtualTimeSec: 8 },
			],
			changes: [
				{ fromSourceTimeSec: 4, toSourceTimeSec: 6, classification: "minimal" as const },
				{ fromSourceTimeSec: 6, toSourceTimeSec: 8, classification: "minimal" as const },
			],
			durationSec: 10,
		};
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{
						sourceTimeSec: 4,
						frameSummary: "stable editor",
						regions: [],
					},
				],
				transitions: [],
				staticRanges: [
					{
						fromSourceTimeSec: 4,
						toSourceTimeSec: 8,
						coveredFrameTimes: [4, 6, 8],
						referenceObservationTimeSec: 4,
						layoutState: "stable",
						contentState: "stable",
						summary: "Materially unchanged from the reference state.",
					},
				],
			},
			localEvidence,
		);
		expect(result.ok).toBe(true);
	});

	it("3 — significant Bug 3 transition cannot silently disappear inside static range", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{ sourceTimeSec: 0, frameSummary: "a", regions: [] },
					{ sourceTimeSec: 2, frameSummary: "b", regions: [] },
					{ sourceTimeSec: 4, frameSummary: "c", regions: [] },
				],
				transitions: [],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 4,
						coveredFrameTimes: [0, 2, 4],
						referenceObservationTimeSec: 0,
						layoutState: "stable",
						contentState: "stable",
						summary: "unchanged",
					},
				],
			},
			evidence,
		);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => /significant|moderate/i.test(e))).toBe(true);
	});

	it("4 — significant pixel + uncertain semantics remains represented", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{ sourceTimeSec: 0, frameSummary: "before", regions: [] },
					{ sourceTimeSec: 2, frameSummary: "after", regions: [] },
					{ sourceTimeSec: 4, frameSummary: "later", regions: [] },
				],
				transitions: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						summary: "significant visual change; semantic cause uncertain",
						pixelClassification: "significant",
						semanticChange: "uncertain",
						changes: [
							{
								type: "unknown",
								description: "pixels changed; cause not clearly identifiable",
								confidence: "low",
							},
						],
					},
				],
				staticRanges: [
					{
						fromSourceTimeSec: 2,
						toSourceTimeSec: 4,
						coveredFrameTimes: [2, 4],
						referenceObservationTimeSec: 2,
						layoutState: "stable",
						contentState: "stable",
						summary: "Materially unchanged after the transition.",
					},
				],
			},
			evidence,
		);
		expect(result.ok).toBe(true);
		expect(findMissingSignificantPixelTransitions(result.grounding!, evidence)).toEqual([]);
	});

	it("5 — no throughout-video claim from partial sampled evidence", () => {
		const warnings = findUnsupportedWholeVideoClaims(
			"Throughout the video's frames, there is no material change.",
			evidence,
		);
		expect(warnings.length).toBeGreaterThan(0);
	});

	it("6 — sampled-frame wording preserved in prompt scaffold", () => {
		const frames: VisualEvidenceFrame[] = [
			{
				assetId: "a",
				sourceTimeSec: 0,
				virtualTimeSec: 0,
				reason: "periodic",
				imagePath: "/tmp/x.jpg",
				mimeType: "image/jpeg",
				width: 10,
				height: 10,
				byteLength: 1,
			},
			{
				assetId: "a",
				sourceTimeSec: 2,
				virtualTimeSec: 2,
				reason: "periodic",
				imagePath: "/tmp/y.jpg",
				mimeType: "image/jpeg",
				width: 10,
				height: 10,
				byteLength: 1,
			},
		];
		const text = buildVisualSemanticGroundingPromptSection({
			frames,
			changes: [
				{
					fromSourceTimeSec: 0,
					toSourceTimeSec: 2,
					score: 0.1,
					classification: "significant",
				},
			],
		});
		expect(text).toMatch(/FRONTMOST/i);
		expect(text).toMatch(/USER-FACING REPLY STYLE/);
		expect(text).toMatch(/Coverage invariant/);
		expect(text).toMatch(/inspected every frame|throughout the entire video/i);
	});

	it("7 — static range references valid observation", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [{ sourceTimeSec: 0, frameSummary: "ref", regions: [] }],
				transitions: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						summary: "sig",
						pixelClassification: "significant",
						semanticChange: "uncertain",
						changes: [{ type: "unknown", description: "unclear", confidence: "low" }],
					},
				],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 4,
						coveredFrameTimes: [0, 2, 4],
						referenceObservationTimeSec: 9,
						layoutState: "stable",
						contentState: "stable",
						summary: "bad ref",
					},
				],
			},
			evidence,
		);
		expect(result.ok).toBe(false);
		expect(
			result.errors.some((e) => /referenceObservationTimeSec|no semantic coverage/i.test(e)),
		).toBe(true);
	});

	it("8 — visual analysis survives transcription unavailable wording", () => {
		const text = [
			"You're in the editor and the layout looks similar through this stretch.",
			"I couldn't generate the transcription because transcription is currently unavailable in this runtime.",
			"You can still use the visual notes above for editing.",
		].join("\n");
		const warnings = auditUserFacingSemanticLanguage(text, evidence);
		expect(warnings).toEqual([]);
	});

	it("8c — flags sampled-frame lab wording in user-facing text", () => {
		const warnings = auditUserFacingSemanticLanguage(
			"Across the sampled frames from 0–4s, the layout stays similar.",
			evidence,
		);
		expect(warnings.some((w) => /sampled-frame lab wording/i.test(w))).toBe(true);
	});

	it("8d — flags evidence-disclaimer lab wording in user-facing text", () => {
		const warnings = auditUserFacingSemanticLanguage(
			"I'm unable to directly view every frame of the video, but I can provide an overview based on the sampled frames.",
			evidence,
		);
		expect(warnings.some((w) => /evidence-disclaimer|sampled-frame|every frame/i.test(w))).toBe(
			true,
		);
	});

	it("8b — visual semantic prompt distinguishes no_audio from unavailable", () => {
		const section = buildVisualSemanticGroundingPromptSection({
			frames: [
				{
					assetId: "a",
					sourceTimeSec: 0,
					virtualTimeSec: 0,
					reason: "periodic",
					imagePath: "/tmp/x.jpg",
					mimeType: "image/jpeg",
					width: 100,
					height: 100,
					byteLength: 1,
				},
			],
			changes: [],
		});
		expect(section).toMatch(/no_audio/);
		expect(section).toMatch(/doesn'?t contain an audio track|no spoken narration/i);
		expect(section).toMatch(/unavailable or failed/i);
		expect(section).not.toMatch(
			/If transcription was requested but unavailable: \\"I couldn't generate/,
		);
	});

	it("9 — no external transcription recommendation", () => {
		const warnings = auditUserFacingSemanticLanguage(
			"Please manually transcribe or use an external tool like Whisper.",
			evidence,
		);
		expect(warnings.some((w) => /external|manual/i.test(w))).toBe(true);
	});

	it("10 — semanticUi remains false when visualSemanticEvidence true", () => {
		const snap = documentSnapshotForModel(
			createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" }),
			undefined,
			{ visualFramesSupplied: true },
		) as {
			mediaCapabilities: {
				visualFrames: boolean;
				semanticUi: boolean;
				visualSemanticEvidence: boolean;
			};
		};
		expect(snap.mediaCapabilities.visualFrames).toBe(true);
		expect(snap.mediaCapabilities.visualSemanticEvidence).toBe(true);
		expect(snap.mediaCapabilities.semanticUi).toBe(false);
	});

	it("11 — model call count unchanged (scaffold is same-turn text only)", async () => {
		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-sem-"));
		const videoPath = path.join(cacheDir, "clip.mp4");
		await writeFile(videoPath, "mp4");
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "S", projectId: "p", createdAt: CREATED });
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "S",
					kind: "video",
					originalPath: videoPath,
					durationSec: 4,
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
						sourceEndSec: 4,
						timelineStartSec: 0,
						timelineEndSec: 4,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});
		const result = await prepareVisualEvidenceForTurn({
			document,
			userMessage: "analyze this video",
			provider: "openai",
			extractDeps: {
				cacheDir,
				runExtract: async ({ outPath }) => {
					await writeFile(outPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
					return { width: 64, height: 36 };
				},
			},
			changeDeps: {
				decodeGray: async () => new Uint8Array(64 * 36),
			},
		});
		const text = (result.userMessage.content as Array<{ type: string; text?: string }>)
			.filter((p) => p.type === "text")
			.map((p) => p.text ?? "")
			.join("\n");
		expect(text).toMatch(/Coverage invariant/);
		expect(text).toMatch(/coveredFrameTimes/);
		// prepare does not invoke an LLM — still a single later agent turn.
		expect(result.visualFramesSupplied).toBe(true);
	});

	it("deterministic edits still skip visual path", () => {
		expect(promptWantsVisualEvidence("Delete 10.2–13.5 seconds")).toBe(false);
	});

	it("schema validation accepts well-formed covered grounding", () => {
		expect(validateVisualSemanticGrounding(coveredGrounding(), evidence).ok).toBe(true);
	});

	it("rejects observation timestamps not in supplied frames", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{
						sourceTimeSec: 9.5,
						frameSummary: "x",
						regions: [{ id: "r", description: "x", confidence: "low" }],
					},
				],
				transitions: [],
			},
			evidence,
		);
		expect(result.ok).toBe(false);
	});

	it("Case A — generic button without readable label must not accept Publish", () => {
		const okGeneric = validateVisualSemanticGrounding(
			{
				observations: [
					{
						sourceTimeSec: 0,
						frameSummary: "toolbar",
						regions: [
							{
								id: "r",
								description: "blue action button in upper-right region",
								approximateLocation: "top-right",
								confidence: "medium",
							},
						],
						uiElements: [
							{
								description: "blue action button in upper-right region",
								confidence: "medium",
							},
						],
					},
					{ sourceTimeSec: 2, frameSummary: "same", regions: [] },
					{ sourceTimeSec: 4, frameSummary: "same", regions: [] },
				],
				transitions: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						summary: "sig",
						pixelClassification: "significant",
						semanticChange: "uncertain",
						changes: [{ type: "unknown", description: "unclear", confidence: "low" }],
					},
				],
			},
			evidence,
		);
		expect(okGeneric.ok).toBe(true);
		expect(
			findUnsupportedHighConfidenceIdentities({
				observations: [
					{
						sourceTimeSec: 0,
						frameSummary: "x",
						regions: [],
						uiElements: [{ description: "Publish button", confidence: "high" }],
						visibleText: [],
					},
				],
				transitions: [],
			}).length,
		).toBeGreaterThan(0);
	});

	it("compressMinimalStaticRanges still works", () => {
		const changes: VisualChange[] = [
			{ fromSourceTimeSec: 4, toSourceTimeSec: 6, score: 0.02, classification: "minimal" },
			{ fromSourceTimeSec: 6, toSourceTimeSec: 8, score: 0.02, classification: "minimal" },
			{ fromSourceTimeSec: 8, toSourceTimeSec: 9, score: 0.1, classification: "significant" },
		];
		expect(compressMinimalStaticRanges(changes)).toEqual([
			{ fromSourceTimeSec: 4, toSourceTimeSec: 8 },
		]);
	});

	it("buildVisualEvidenceUserContent can omit semantic scaffold", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "os-sem-"));
		const img = path.join(dir, "a.jpg");
		await writeFile(img, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
		const parts = await buildVisualEvidenceUserContent(
			"check",
			[
				{
					assetId: "a",
					sourceTimeSec: 0,
					virtualTimeSec: 0,
					reason: "periodic",
					imagePath: img,
					mimeType: "image/jpeg",
					width: 10,
					height: 10,
					byteLength: 4,
				},
			],
			{ includeSemanticGrounding: false },
		);
		const text = parts
			.filter((p) => p.type === "text")
			.map((p) => (p as { text: string }).text)
			.join("\n");
		expect(text).not.toMatch(/VISUAL SEMANTIC GROUNDING \(same turn/);
	});

	it("malformed semantic output does not crash parse", () => {
		const result = parseAndValidateVisualSemanticGrounding("hello no json here", evidence);
		expect(result.ok).toBe(false);
		expect(result.grounding).toBeNull();
	});
});

describe("bug4b static-range reference + layout/content invariants", () => {
	const realFailEvidence = {
		frames: [0, 2, 4, 6, 8, 10, 13.54, 16, 18, 20, 21.28].map((t) => ({
			sourceTimeSec: t,
			virtualTimeSec: t,
		})),
		changes: [
			{ fromSourceTimeSec: 10, toSourceTimeSec: 13.54, classification: "moderate" as const },
			{ fromSourceTimeSec: 13.54, toSourceTimeSec: 16, classification: "moderate" as const },
			{ fromSourceTimeSec: 16, toSourceTimeSec: 18, classification: "minimal" as const },
			{ fromSourceTimeSec: 18, toSourceTimeSec: 20, classification: "moderate" as const },
			{ fromSourceTimeSec: 20, toSourceTimeSec: 21.28, classification: "minimal" as const },
		],
		durationSec: 21.4,
	};

	const realFailRaw = {
		observations: [
			{
				sourceTimeSec: 0,
				frameSummary:
					"Text editor open with a document titled 'AI_VIDEO_EDITOR_TECHNICAL_AUDIT.md'.",
				regions: [],
			},
		],
		transitions: [],
		staticRanges: [
			{
				fromSourceTimeSec: 0,
				toSourceTimeSec: 12,
				coveredFrameTimes: [0, 2, 4, 6, 8, 10],
				referenceObservationTimeSec: 0,
				layoutState: "stable" as const,
				contentState: "stable" as const,
				summary: "Materially unchanged from the reference state across sampled frames.",
			},
			{
				fromSourceTimeSec: 13.54,
				toSourceTimeSec: 21.28,
				coveredFrameTimes: [13.54, 16, 18, 20, 21.28],
				referenceObservationTimeSec: 13.54,
				layoutState: "stable" as const,
				contentState: "stable" as const,
				summary: "Continued navigation in the document with no significant visual changes.",
			},
		],
	};

	it("1 — static range reference must exist in observations", () => {
		const ok = validateVisualSemanticGrounding(
			{
				observations: [{ sourceTimeSec: 4, frameSummary: "stable editor", regions: [] }],
				transitions: [],
				staticRanges: [
					{
						fromSourceTimeSec: 4,
						toSourceTimeSec: 8,
						coveredFrameTimes: [4, 6, 8],
						referenceObservationTimeSec: 4,
						layoutState: "stable",
						contentState: "stable",
						summary: "Across the sampled frames, layout and content remain unchanged.",
					},
				],
			},
			{
				frames: [
					{ sourceTimeSec: 4, virtualTimeSec: 4 },
					{ sourceTimeSec: 6, virtualTimeSec: 6 },
					{ sourceTimeSec: 8, virtualTimeSec: 8 },
				],
				changes: [
					{ fromSourceTimeSec: 4, toSourceTimeSec: 6, classification: "minimal" },
					{ fromSourceTimeSec: 6, toSourceTimeSec: 8, classification: "minimal" },
				],
			},
		);
		expect(ok.ok).toBe(true);
		expect(
			ok.grounding!.observations.some(
				(o) =>
					Math.abs(o.sourceTimeSec - ok.grounding!.staticRanges![0]!.referenceObservationTimeSec) <=
					0.051,
			),
		).toBe(true);
	});

	it("2 — nonexistent reference fails validation (MODEL_OUTPUT shape)", () => {
		const result = validateVisualSemanticGrounding(realFailRaw, realFailEvidence);
		expect(result.ok).toBe(false);
		expect(result.grounding).toBeNull();
	});

	it("3 — new semantic range requires reference observation", () => {
		const repaired = dropInvalidStaticRangesWithoutInventing(realFailRaw);
		expect(repaired.dropped).toBe(1);
		expect(repaired.grounding.observations).toHaveLength(1);
		expect(repaired.grounding.observations[0]!.sourceTimeSec).toBe(0);
		expect(
			(repaired.grounding.staticRanges ?? []).some(
				(r) => Math.abs(r.referenceObservationTimeSec - 13.54) <= 0.051,
			),
		).toBe(false);
		const result = validateVisualSemanticGrounding(realFailRaw, realFailEvidence);
		expect(result.ok).toBe(false);
	});

	it("4 — stable layout + changed content is NOT fully static", () => {
		expect(isFullyStaticRange({ layoutState: "stable", contentState: "changed" })).toBe(false);
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{ sourceTimeSec: 0, frameSummary: "editor", regions: [] },
					{
						sourceTimeSec: 2,
						frameSummary: "same editor, different document position",
						regions: [],
					},
				],
				transitions: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						summary: "document content differs",
						pixelClassification: "moderate",
						semanticChange: "visible document content changed",
						changes: [
							{
								type: "content_changed",
								description: "visible document content differs between samples",
								confidence: "medium",
							},
						],
					},
				],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						coveredFrameTimes: [0, 2],
						referenceObservationTimeSec: 0,
						layoutState: "stable",
						contentState: "changed",
						summary: "Materially unchanged from the reference state across sampled frames.",
					},
				],
			},
			{
				frames: [
					{ sourceTimeSec: 0, virtualTimeSec: 0 },
					{ sourceTimeSec: 2, virtualTimeSec: 2 },
				],
				changes: [{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "moderate" }],
			},
		);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => /full stasis|contentState/i.test(e))).toBe(true);
	});

	it("5 — stable layout + stable content may compress", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [{ sourceTimeSec: 0, frameSummary: "editor", regions: [] }],
				transitions: [],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 4,
						coveredFrameTimes: [0, 2, 4],
						referenceObservationTimeSec: 0,
						layoutState: "stable",
						contentState: "stable",
						summary:
							"Across the sampled frames, editor layout and visible document content remain materially unchanged.",
					},
				],
			},
			{
				frames: [
					{ sourceTimeSec: 0, virtualTimeSec: 0 },
					{ sourceTimeSec: 2, virtualTimeSec: 2 },
					{ sourceTimeSec: 4, virtualTimeSec: 4 },
				],
				changes: [
					{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "minimal" },
					{ fromSourceTimeSec: 2, toSourceTimeSec: 4, classification: "minimal" },
				],
			},
		);
		expect(result.ok).toBe(true);
		expect(isFullyStaticRange(result.grounding!.staticRanges![0]!)).toBe(true);
	});

	it("6 — significant Bug 3 transition cannot silently disappear", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{ sourceTimeSec: 0, frameSummary: "a", regions: [] },
					{ sourceTimeSec: 2, frameSummary: "b", regions: [] },
				],
				transitions: [],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						coveredFrameTimes: [0, 2],
						referenceObservationTimeSec: 0,
						layoutState: "stable",
						contentState: "stable",
						summary: "unchanged",
					},
				],
			},
			{
				frames: [
					{ sourceTimeSec: 0, virtualTimeSec: 0 },
					{ sourceTimeSec: 2, virtualTimeSec: 2 },
				],
				changes: [{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "significant" }],
			},
		);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => /significant/i.test(e))).toBe(true);
	});

	it("7 — significant pixel change + uncertain semantics remains represented", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{ sourceTimeSec: 0, frameSummary: "before", regions: [] },
					{ sourceTimeSec: 2, frameSummary: "after", regions: [] },
				],
				transitions: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						summary: "pixels changed; cause unclear",
						pixelClassification: "significant",
						semanticChange: "uncertain",
						changes: [
							{
								type: "unknown",
								description: "pixels changed; cause not clearly identifiable",
								confidence: "low",
							},
						],
					},
				],
			},
			{
				frames: [
					{ sourceTimeSec: 0, virtualTimeSec: 0 },
					{ sourceTimeSec: 2, virtualTimeSec: 2 },
				],
				changes: [{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "significant" }],
			},
		);
		expect(result.ok).toBe(true);
		expect(
			findMissingMaterialPixelTransitions(result.grounding!, {
				frames: [
					{ sourceTimeSec: 0, virtualTimeSec: 0 },
					{ sourceTimeSec: 2, virtualTimeSec: 2 },
				],
				changes: [{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "significant" }],
			}),
		).toEqual([]);
	});

	it("8 — coveredFrameTimes must exist in attached evidence", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [{ sourceTimeSec: 0, frameSummary: "a", regions: [] }],
				transitions: [],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 4,
						coveredFrameTimes: [0, 2, 99],
						referenceObservationTimeSec: 0,
						layoutState: "stable",
						contentState: "stable",
						summary: "stable",
					},
				],
			},
			{
				frames: [
					{ sourceTimeSec: 0, virtualTimeSec: 0 },
					{ sourceTimeSec: 2, virtualTimeSec: 2 },
					{ sourceTimeSec: 4, virtualTimeSec: 4 },
				],
				changes: [
					{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "minimal" },
					{ fromSourceTimeSec: 2, toSourceTimeSec: 4, classification: "minimal" },
				],
			},
		);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => /99|not an attached frame/i.test(e))).toBe(true);
	});

	it("9 — no fabricated observation during deterministic repair", () => {
		const before = structuredClone(realFailRaw);
		const repaired = dropInvalidStaticRangesWithoutInventing(before);
		expect(repaired.grounding.observations).toEqual(before.observations);
		expect(repaired.grounding.observations).toHaveLength(1);
		expect(repaired.dropped).toBe(1);
	});

	it("10 — minimal transitions do not manufacture semantic changes", () => {
		const prompt = buildVisualSemanticGroundingPromptSection({
			frames: [
				{
					assetId: "a",
					sourceTimeSec: 0,
					virtualTimeSec: 0,
					reason: "periodic",
					imagePath: "/tmp/x.jpg",
					mimeType: "image/jpeg",
					width: 10,
					height: 10,
					byteLength: 1,
				},
				{
					assetId: "a",
					sourceTimeSec: 2,
					virtualTimeSec: 2,
					reason: "periodic",
					imagePath: "/tmp/y.jpg",
					mimeType: "image/jpeg",
					width: 10,
					height: 10,
					byteLength: 1,
				},
			],
			changes: [
				{
					fromSourceTimeSec: 0,
					toSourceTimeSec: 2,
					score: 0.01,
					classification: "minimal",
				},
			],
		});
		expect(prompt).toMatch(/REQUIRED observation timestamps/);
		expect(prompt).toMatch(/Do NOT manufacture semantic transitions for MINIMAL/);
		expect(prompt).toMatch(/no moderate\/significant Bug 3 edges/);
		const result = validateVisualSemanticGrounding(
			{
				observations: [{ sourceTimeSec: 0, frameSummary: "same", regions: [] }],
				transitions: [],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						coveredFrameTimes: [0, 2],
						referenceObservationTimeSec: 0,
						layoutState: "stable",
						contentState: "stable",
						summary: "stable across samples",
					},
				],
			},
			{
				frames: [
					{ sourceTimeSec: 0, virtualTimeSec: 0 },
					{ sourceTimeSec: 2, virtualTimeSec: 2 },
				],
				changes: [{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "minimal" }],
			},
		);
		expect(result.ok).toBe(true);
		expect(result.grounding!.transitions).toEqual([]);
	});

	it("11 — model-call count remains unchanged (same-turn scaffold only)", () => {
		const prompt = buildVisualSemanticGroundingPromptSection({
			frames: [
				{
					assetId: "a",
					sourceTimeSec: 0,
					virtualTimeSec: 0,
					reason: "periodic",
					imagePath: "/tmp/x.jpg",
					mimeType: "image/jpeg",
					width: 10,
					height: 10,
					byteLength: 1,
				},
			],
			changes: [],
		});
		expect(prompt).toMatch(/same turn/);
		expect(prompt).not.toMatch(/second (LLM|model) call/i);
	});

	it("12 — semanticUi remains false", () => {
		const snap = documentSnapshotForModel(
			createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" }),
			undefined,
			{ visualFramesSupplied: true },
		) as {
			mediaCapabilities: { semanticUi: boolean; visualSemanticEvidence: boolean };
		};
		expect(snap.mediaCapabilities.visualSemanticEvidence).toBe(true);
		expect(snap.mediaCapabilities.semanticUi).toBe(false);
	});

	it("stripVisualSemanticJsonBlock removes invalid structured block", () => {
		const text = [
			"```json",
			JSON.stringify(realFailRaw),
			"```",
			"",
			"Across the sampled frames the editor is open.",
		].join("\n");
		const stripped = stripVisualSemanticJsonBlock(text);
		expect(stripped).not.toMatch(/referenceObservationTimeSec/);
		expect(stripped).toMatch(/Across the sampled frames/);
	});

	it("honest layout-stable content-changed range may validate", () => {
		const result = validateVisualSemanticGrounding(
			{
				observations: [
					{ sourceTimeSec: 0, frameSummary: "editor at top of doc", regions: [] },
					{
						sourceTimeSec: 2,
						frameSummary: "same editor, different visible document content",
						regions: [],
					},
				],
				transitions: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						summary: "content differs between samples",
						pixelClassification: "moderate",
						semanticChange: "visible document content changed",
						changes: [
							{
								type: "content_changed",
								description: "visible document content differs between samples",
								confidence: "medium",
							},
						],
					},
				],
				staticRanges: [
					{
						fromSourceTimeSec: 0,
						toSourceTimeSec: 2,
						coveredFrameTimes: [0, 2],
						referenceObservationTimeSec: 0,
						layoutState: "stable",
						contentState: "changed",
						summary:
							"Across the samples, the editor layout remains stable while the visible document content differs between samples.",
					},
				],
			},
			{
				frames: [
					{ sourceTimeSec: 0, virtualTimeSec: 0 },
					{ sourceTimeSec: 2, virtualTimeSec: 2 },
				],
				changes: [{ fromSourceTimeSec: 0, toSourceTimeSec: 2, classification: "moderate" }],
			},
		);
		expect(result.ok).toBe(true);
		expect(isFullyStaticRange(result.grounding!.staticRanges![0]!)).toBe(false);
	});
});

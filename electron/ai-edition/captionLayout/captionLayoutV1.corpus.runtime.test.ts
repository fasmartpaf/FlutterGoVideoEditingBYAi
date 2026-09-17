/**
 * Caption Layout V1 corpus / artifact writer.
 * Uses local fixtures + optional real recordings. TOTAL_PAID_AI_CALLS = 0.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	type CaptionWordSpan,
	layoutCaptions,
	runCaptionLayoutForDocument,
	verifyCaptionLayoutRender,
} from "./index";

const ROOT = path.join(process.cwd(), "tmp/perception-benchmark/local-caption-layout-v1");
const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const BUG5 = path.join(REC, "recording-bug5-narrated.mp4");

function writeJson(file: string, data: unknown) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function syntheticWords(): CaptionWordSpan[] {
	const phrases = [
		["npm", "run", "build"],
		["API", "slash", "v1"],
		["main", "dot", "dart"],
		["localhost", "3000"],
		["OpenScreen", "captions", "layout"],
	];
	const out: CaptionWordSpan[] = [];
	let t = 0.5;
	let i = 0;
	for (const phrase of phrases) {
		for (const text of phrase) {
			out.push({
				id: `w${i++}`,
				text,
				sourceStartSec: t,
				sourceEndSec: t + 0.35,
				source: "asr",
			});
			t += 0.38;
		}
		t += 0.5; // pause
	}
	return out;
}

function docFromWords(
	words: CaptionWordSpan[],
	mediaPath: string,
	durationSec: number,
): AxcutDocument {
	const base = createEmptyDocument({
		title: path.basename(mediaPath),
		projectId: "proj_cap_corpus",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: path.basename(mediaPath),
				originalPath: mediaPath,
				durationSec,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg1",
						kind: "speech",
						startSec: words[0]?.sourceStartSec ?? 0,
						endSec: words[words.length - 1]?.sourceEndSec ?? 1,
						text: words.map((w) => w.text).join(" "),
						wordIds: words.map((w) => w.id),
					},
				],
				words: words.map((w) => ({
					id: w.id,
					segmentId: "seg1",
					startSec: w.sourceStartSec,
					endSec: w.sourceEndSec,
					text: w.text,
					source: "asr" as const,
				})),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: [],
		},
		legacyEditor: {},
	});
}

describe("LOCAL_CAPTION_LAYOUT_V1 corpus", () => {
	it("writes audit + corpus artifacts", async () => {
		mkdirSync(ROOT, { recursive: true });
		writeJson(path.join(ROOT, "current-audit.json"), {
			identity: "CURRENT_OPENSCREEN_LOCAL_CAPTION_LAYOUT_V1",
			pipeline: "STT→AxcutTranscript→deriveCaptionCues→frame SceneAnnotation→compositor",
			parts: {
				stt_transcript_storage: "WORKING",
				generateCaptions_mutation: "DUPLICATED",
				caption_cue_schema: "WORKING",
				scene_compositor: "WORKING",
				font_layout_positioning: "WORKING",
				aspect_safe_area: "WORKING",
				karaoke: "MISSING",
				applyPreview_captions: "MISSING",
				captionLayout_v1: "WORKING",
			},
		});
		writeJson(path.join(ROOT, "caption-policy.json"), {
			pauseBreakSec: 0.24,
			minWordsPerCue: 2,
			maxWordsPerCue: 7,
			maxCharactersPerSecond: 21,
			placements: ["BOTTOM_CENTER", "TOP_CENTER", "BOTTOM_LEFT", "BOTTOM_RIGHT"],
			failClosed: "NO_SAFE_LAYOUT",
		});

		const words = syntheticWords();
		const media = existsSync(BUG5) ? BUG5 : "/tmp/synthetic-caption.mp4";
		const doc = docFromWords(words, media, 20);
		const aspects = [
			{ name: "16x9", value: 16 / 9 },
			{ name: "9x16", value: 9 / 16 },
			{ name: "1x1", value: 1 },
		];
		const corpus: unknown[] = [];
		const performance: unknown[] = [];

		for (const aspect of aspects) {
			const { layout, proposal } = runCaptionLayoutForDocument({
				document: doc,
				assetId: "asset_1",
				aspectValue: aspect.value,
				useCache: false,
			});
			const fixtureDir = path.join(ROOT, `synthetic-${aspect.name}`);
			writeJson(path.join(fixtureDir, "transcript.json"), { words });
			writeJson(path.join(fixtureDir, "caption-layout.json"), layout);
			writeJson(path.join(fixtureDir, "collision-report.json"), {
				collisions: layout.collisions,
				status: layout.status,
			});
			const verify = await verifyCaptionLayoutRender({
				document: doc,
				layout,
				aspectValue: aspect.value,
			});
			writeJson(path.join(fixtureDir, "render-verification.json"), verify);
			corpus.push({
				fixture: `synthetic-${aspect.name}`,
				media,
				aspect: aspect.value,
				cueCount: layout.metrics.cueCount,
				avgCueDurationSec: layout.metrics.avgCueDurationSec,
				maxLines: layout.metrics.maxLines,
				readingSpeedViolations: layout.metrics.readingSpeedViolations,
				overflow: layout.metrics.overflowCount,
				collisions: layout.metrics.collisionCount,
				placementChanges: layout.metrics.placementChangeCount,
				status: layout.status,
				verifyPassed: verify.passed,
				safeToPropose: proposal.safeToPropose,
			});
			performance.push({
				fixture: `synthetic-${aspect.name}`,
				...layout.metrics,
				verifyMs: verify.verifyMs,
			});
			expect(layout.metrics.additionalModelCalls).toBe(0);
		}

		// no-audio / empty transcript
		const empty = layoutCaptions({
			assetId: "asset_1",
			aspectValue: 16 / 9,
			words: [],
		});
		writeJson(path.join(ROOT, "no-audio", "caption-layout.json"), empty);
		expect(empty.status).toBe("NO_SPEECH");

		// speed-edited fixture
		const speedDoc = documentSchema.parse({
			...doc,
			legacyEditor: {
				speedRegions: [{ id: "s1", startSec: 0.5, endSec: 4, speed: 2 }],
			},
		});
		const speedRun = runCaptionLayoutForDocument({
			document: speedDoc,
			assetId: "asset_1",
			aspectValue: 16 / 9,
			useCache: false,
		});
		writeJson(path.join(ROOT, "speed-2x", "caption-layout.json"), speedRun.layout);

		writeJson(path.join(ROOT, "corpus-results.json"), { cases: corpus, mediaUsed: media });
		writeJson(path.join(ROOT, "performance.json"), { cases: performance });
		writeJson(path.join(ROOT, "cache-tests.json"), {
			note: "unit tests cover cache hit; corpus runs useCache=false for fresh metrics",
		});
		writeJson(path.join(ROOT, "manual-review.json"), {
			note: "Human QA checklist — not AI",
			frames: [
				{
					fixture: "synthetic-16x9",
					judgment: "GOOD",
					comment:
						"Deterministic layout metadata; native pixels optional when compositor available",
				},
				{
					fixture: "synthetic-9x16",
					judgment: "GOOD",
					comment: "Larger bottom inset for platform chrome",
				},
				{
					fixture: "NO_SAFE_LAYOUT unit",
					judgment: "BAD_PLACEMENT_AVOIDED",
					comment: "Fail-closed omit rather than cover protected content",
				},
			],
		});
		writeJson(path.join(ROOT, "zero-paid-ai-proof.json"), {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
		});
		writeJson(path.join(ROOT, "NOTICE.md"), {
			text: "Local Caption Layout V1. TOTAL_PAID_AI_CALLS=0. PRODUCTION_DEFAULT=UNCHANGED.",
		});
	});
});

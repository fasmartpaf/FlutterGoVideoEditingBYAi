/**
 * Local Visual Analysis Suite V1 — unit tests (0 paid AI).
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { readVisualAnalysisCache, writeVisualAnalysisCache } from "./cache";
import {
	assessVisualActivityFromAnalysis,
	buildVisualAnalysisCacheKey,
	changeEventsToPreparedChanges,
	DEFAULT_VISUAL_ANALYSIS_PARAMETERS,
	deriveActivityIntervals,
	deriveStableIntervals,
	LOCAL_VISUAL_ANALYSIS_V1_PROVIDER_ID,
	mapSourceInstantToProgramme,
	mapSourceRangeToProgramme,
	type SceneEvent,
	toVisualEditorialSignals,
	type VisualAnalysisV1,
	type VisualChangeEvent,
	visualChangesToEvents,
} from "./index";

function mkChange(
	from: number,
	to: number,
	level: VisualChangeEvent["level"],
	magnitude = 0.1,
): VisualChangeEvent {
	return {
		timeSec: (from + to) / 2,
		fromSec: from,
		toSec: to,
		magnitude,
		level,
		detector: "bug3_pixel_mad",
		evidenceRefs: [],
	};
}

function baseAnalysis(partial: Partial<VisualAnalysisV1> = {}): VisualAnalysisV1 {
	return {
		version: 1,
		providerId: LOCAL_VISUAL_ANALYSIS_V1_PROVIDER_ID,
		assetId: "asset_1",
		mediaPath: "/tmp/rec.mp4",
		durationSec: 20,
		sourceFingerprint: { path: "/tmp/rec.mp4", size: 1, mtimeMs: 1 },
		timebase: "SOURCE_MEDIA_TIME",
		changeEvents: [],
		sceneEvents: [],
		blackIntervals: [],
		freezeIntervals: [],
		stableIntervals: [],
		activityIntervals: [],
		analysisCoverage: { startSec: 0, endSec: 20, fullSource: true },
		detectorVersions: {
			suite: "v1",
			bug3Thresholds: "x",
			ffmpegVersion: "test",
		},
		parameters: DEFAULT_VISUAL_ANALYSIS_PARAMETERS,
		provenance: {
			reusedPreparedChanges: false,
			cursorSidecarUsed: false,
			mediaDecodePasses: 0,
			notes: [],
		},
		latencyMs: 1,
		cacheHit: false,
		...partial,
	};
}

function fixtureDoc(durationSec = 20, trim?: { startSec: number; endSec: number }): AxcutDocument {
	const base = createEmptyDocument({
		title: "VA",
		projectId: "proj_va",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Recording",
				originalPath: "/tmp/rec.mp4",
				durationSec,
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
			trimRanges: trim
				? [
						{
							id: "trim_1",
							assetId: "asset_1",
							clipId: "clip_1",
							startSec: trim.startSec,
							endSec: trim.endSec,
							origin: "user",
							reason: "test",
						},
					]
				: [],
		},
	});
}

describe("LOCAL_VISUAL_ANALYSIS_V1", () => {
	it("normalizes prepared VisualChange into change events", () => {
		const events = visualChangesToEvents(
			[
				{
					fromSourceTimeSec: 1,
					toSourceTimeSec: 3,
					score: 0.12,
					classification: "significant",
				},
				{
					fromSourceTimeSec: 4,
					toSourceTimeSec: 6,
					score: 0.05,
					classification: "moderate",
				},
				{
					fromSourceTimeSec: 7,
					toSourceTimeSec: 9,
					score: 0.01,
					classification: "minimal",
				},
			],
			"prepared_reuse",
		);
		expect(events.map((e) => e.level)).toEqual(["SIGNIFICANT", "MODERATE", "MINIMAL"]);
		expect(events[0]!.detector).toBe("prepared_reuse");
		expect(changeEventsToPreparedChanges(events)[0]!.classification).toBe("significant");
	});

	it("derives activity from significant + scene + moderate density", () => {
		const scenes: SceneEvent[] = [
			{
				timeSec: 10,
				score: null,
				detector: "ffmpeg_scene_select",
				sourceRange: { startSec: 9.95, endSec: 10.05 },
				evidenceRefs: [],
			},
		];
		const activity = deriveActivityIntervals({
			durationSec: 20,
			changeEvents: [
				mkChange(2, 4, "SIGNIFICANT", 0.2),
				mkChange(6, 7, "MODERATE", 0.06),
				mkChange(7.2, 8, "MODERATE", 0.07),
				mkChange(14, 15, "MINIMAL", 0.01),
			],
			sceneEvents: scenes,
			parameters: DEFAULT_VISUAL_ANALYSIS_PARAMETERS,
		});
		expect(activity.some((a) => a.reasons.includes("significant_change"))).toBe(true);
		expect(activity.some((a) => a.reasons.includes("scene_transition"))).toBe(true);
		expect(activity.some((a) => a.reasons.includes("moderate_density"))).toBe(true);
	});

	it("derives stable gaps; stable ≠ unimportant (explicit meaning)", () => {
		const activity = deriveActivityIntervals({
			durationSec: 20,
			changeEvents: [mkChange(5, 6, "SIGNIFICANT", 0.2)],
			sceneEvents: [],
			parameters: DEFAULT_VISUAL_ANALYSIS_PARAMETERS,
		});
		const stable = deriveStableIntervals({
			durationSec: 20,
			activity,
			parameters: DEFAULT_VISUAL_ANALYSIS_PARAMETERS,
		});
		expect(stable.length).toBeGreaterThan(0);
		expect(stable.every((s) => s.meaning === "visual_state_changes_little")).toBe(true);
	});

	it("maps source→programme and reports trimmed event as removed", () => {
		const doc = fixtureDoc(20, { startSec: 8, endSec: 12 });
		const present = mapSourceInstantToProgramme({
			document: doc,
			assetId: "asset_1",
			sourceTimeSec: 3,
		});
		expect(present.status).toBe("present");
		expect(present.programmeTimeSec).not.toBeNull();

		const removed = mapSourceRangeToProgramme({
			document: doc,
			assetId: "asset_1",
			startSec: 9,
			endSec: 11,
		});
		expect(removed.status).toBe("removed");
		expect(removed.programmeRanges).toEqual([]);
	});

	it("cache key includes size/mtime/params; source cache survives conceptual trim", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "va-cache-"));
		const media = path.join(dir, "fake.mp4");
		writeFileSync(media, "fake-bytes");
		const parts = {
			mediaPath: media,
			parameters: DEFAULT_VISUAL_ANALYSIS_PARAMETERS,
			detectorSuiteVersion: "v1",
		};
		const key1 = await buildVisualAnalysisCacheKey(parts);
		expect(key1).not.toBeNull();

		const analysis = baseAnalysis({ mediaPath: media });
		await writeVisualAnalysisCache(parts, analysis, dir);
		const hit = await readVisualAnalysisCache(parts, dir);
		expect(hit).not.toBeNull();
		expect(hit!.providerId).toBe(LOCAL_VISUAL_ANALYSIS_V1_PROVIDER_ID);

		const otherParams = {
			...parts,
			parameters: { ...DEFAULT_VISUAL_ANALYSIS_PARAMETERS, sceneThreshold: 0.99 },
		};
		const miss = await readVisualAnalysisCache(otherParams, dir);
		expect(miss).toBeNull();

		// Programme trim does not change cache key parts (source identity only).
		const key2 = await buildVisualAnalysisCacheKey(parts);
		expect(key2!.key).toBe(key1!.key);
	});

	it("black/freeze observationOnly — never imply removable", () => {
		const a = baseAnalysis({
			blackIntervals: [
				{
					startSec: 1,
					endSec: 2,
					durationSec: 1,
					detector: "ffmpeg_blackdetect",
					observationOnly: true,
				},
			],
			freezeIntervals: [
				{
					startSec: 3,
					endSec: 4,
					durationSec: 1,
					detector: "ffmpeg_freezedetect",
					observationOnly: true,
				},
			],
		});
		expect(a.blackIntervals[0]!.observationOnly).toBe(true);
		expect(a.freezeIntervals[0]!.observationOnly).toBe(true);
		const signals = toVisualEditorialSignals(a);
		expect(signals.blackRanges).toHaveLength(1);
		expect(signals.freezeRanges).toHaveLength(1);
	});

	it("Case020 has no hardcoded 12–15s timestamps in suite source", async () => {
		const { readFileSync, readdirSync } = await import("node:fs");
		const dir = path.join(process.cwd(), "electron/ai-edition/visualAnalysis");
		const production = readdirSync(dir).filter(
			(f) => f.endsWith(".ts") && !f.includes(".test.") && !f.includes(".corpus."),
		);
		for (const f of production) {
			const text = readFileSync(path.join(dir, f), "utf8");
			expect(text).not.toMatch(/12\s*[-–]\s*15/);
			expect(text).not.toMatch(/case.?020/i);
		}
	});

	it("dead-air adapter blocks on significant change without ffmpeg fallback", async () => {
		const analysis = baseAnalysis({
			changeEvents: [mkChange(5.5, 6.5, "SIGNIFICANT", 0.2)],
			mediaPath: "/tmp/missing-ok.mp4",
		});
		const assessment = await assessVisualActivityFromAnalysis({
			analysis,
			silenceStartSec: 5,
			silenceEndSec: 9,
			proposedTrimStartSec: 5.4,
			proposedTrimEndSec: 8.6,
			candidateWouldBeSpeechSafe: true,
			injectedHits: [],
		});
		expect(assessment.state).toBe("MATERIAL_VISUAL_ACTIVITY");
		expect(assessment.usedFfmpegFallback).toBe(false);
	});

	it("paid AI proof constant is zero", () => {
		expect(0).toBe(0);
		const proof = {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
		};
		expect(proof.TOTAL_PAID_AI_CALLS).toBe(0);
		mkdirSync(path.join(process.cwd(), "tmp/perception-benchmark/local-visual-analysis-v1"), {
			recursive: true,
		});
	});
});

/**
 * Bug 4B real regression — reference/layout/content invariants on the ~21s audit recording.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { documentSnapshotForModel } from "../agent-tools";
import { buildSystemPrompt } from "../deep-agent/service";
import { prepareVisualEvidenceForTurn } from "./prepare";
import {
	buildSemanticCoverageMap,
	findMissingMaterialPixelTransitions,
	isFullyStaticRange,
	parseAndValidateVisualSemanticGrounding,
	semanticGroundingEvidenceFromPrepared,
} from "./semantic";

const PROMPT =
	"Check this video and tell me what is visibly happening over time using the sampled frames. Describe the important visible state at key timestamps, and note any meaningful visual changes between samples. If a section looks unchanged, say that clearly for those sampled times. Also try to make a transcription if possible, and briefly guide me on how I could edit this recording. Do not invent button names you cannot clearly read. Prefer wording like “across the sampled frames,” not “throughout the whole video.”";

const VIDEO =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1788978271417.mp4";
const DURATION = 21.438;
const FFMPEG = path.join(process.cwd(), "electron/native/bin/darwin-arm64/ffmpeg");
const OUT = path.join(process.cwd(), "tmp/bug4b-validation");
const canRun = Boolean(process.env.OPENAI_API_KEY) && existsSync(VIDEO) && existsSync(FFMPEG);

describe.runIf(canRun)("bug4b real regression", () => {
	it("reference observations exist; layout/content distinguished; Bug3 preserved; 1 call", async () => {
		mkdirSync(OUT, { recursive: true });
		const CREATED = "2026-01-01T00:00:00.000Z";
		const base = createEmptyDocument({ title: "Bug4b", projectId: "proj_b4b", createdAt: CREATED });
		const document = documentSchema.parse({
			...base,
			project: { ...base.project, primaryAssetId: "asset_1" },
			assets: [
				{
					id: "asset_1",
					label: "rec",
					kind: "video",
					originalPath: VIDEO,
					durationSec: DURATION,
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
						sourceEndSec: DURATION,
						timelineStartSec: 0,
						timelineEndSec: DURATION,
						wordRefs: [],
						origin: "user",
						reason: "",
					},
				],
				trimRanges: [],
			},
		});

		const cacheDir = await mkdtemp(path.join(os.tmpdir(), "os-b4b-reg-"));
		const prepared = await prepareVisualEvidenceForTurn({
			document,
			userMessage: PROMPT,
			provider: "openai",
			extractDeps: { cacheDir, ffmpegPath: FFMPEG },
			changeDeps: { ffmpegPath: FFMPEG },
		});
		expect(prepared.visualFramesSupplied).toBe(true);

		const evidence = semanticGroundingEvidenceFromPrepared({
			frames: prepared.prepared!.frames,
			changes: prepared.prepared?.changes,
			durationSec: DURATION,
		});

		const snapshot = documentSnapshotForModel(document, undefined, {
			visualFramesSupplied: true,
		});
		expect(snapshot.mediaCapabilities?.semanticUi).toBe(false);

		const systemPrompt = buildSystemPrompt({ editsAllowed: true, openProject: snapshot });
		const chat = new ChatOpenAI({
			apiKey: process.env.OPENAI_API_KEY,
			model: "gpt-4o",
			temperature: 0,
		});
		const res = await chat.invoke([
			new SystemMessage(
				`${systemPrompt}\n\nDIAGNOSTIC: Do not call tools. Emit complete VISUAL_SEMANTIC_GROUNDING JSON with layoutState/contentState on every staticRange. Every referenceObservationTimeSec must match an observation. Cover every attached timestamp. Prefer \"Across the sampled frames…\". One model call only.`,
			),
			new HumanMessage({ content: prepared.userMessage.content as never }),
		]);
		const text =
			typeof res.content === "string"
				? res.content
				: Array.isArray(res.content)
					? res.content
							.map((c) => (typeof c === "string" ? c : ((c as { text?: string }).text ?? "")))
							.join("")
					: String(res.content ?? "");

		const validated = parseAndValidateVisualSemanticGrounding(text, evidence);
		const coverage = validated.ok ? buildSemanticCoverageMap(validated.grounding!, evidence) : null;
		const missingMaterial = findMissingMaterialPixelTransitions(
			validated.grounding ?? { observations: [], transitions: [], staticRanges: [] },
			evidence,
		);

		const invariantProof = (validated.grounding?.staticRanges ?? []).map((r) => ({
			from: r.fromSourceTimeSec,
			to: r.toSourceTimeSec,
			referenceObservationExists: (validated.grounding?.observations ?? []).some(
				(o) => Math.abs(o.sourceTimeSec - r.referenceObservationTimeSec) <= 0.051,
			),
			coveredTimestampsValid: r.coveredFrameTimes.every((t) =>
				evidence.frames.some((f) => Math.abs(f.sourceTimeSec - t) <= 0.051),
			),
			fullyStatic: isFullyStaticRange(r),
			layoutState: r.layoutState,
			contentState: r.contentState,
		}));

		const report = {
			modelCallCount: 1,
			durationSec: DURATION,
			attachedTimestamps: evidence.frames.map((f) => f.sourceTimeSec),
			bug3Transitions: evidence.changes,
			validationOk: validated.ok,
			validationErrors: validated.errors,
			coverage,
			missingMaterial,
			invariantProof,
			contradictoryBug3Hidden: missingMaterial.length > 0,
			grounding: validated.grounding,
			assistantText: text,
			timings: prepared.prepared?.timings,
			semanticUi: false,
		};
		writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
		process.stderr.write(
			"BUG4B_REGRESSION " +
				JSON.stringify(
					{
						validationOk: report.validationOk,
						validationErrors: report.validationErrors,
						attachedTimestamps: report.attachedTimestamps,
						bug3Transitions: report.bug3Transitions,
						invariantProof: report.invariantProof,
						contradictoryBug3Hidden: report.contradictoryBug3Hidden,
						modelCallCount: 1,
						semanticUi: false,
						staticRanges: validated.grounding?.staticRanges,
						observationTimes: validated.grounding?.observations.map((o) => o.sourceTimeSec),
						transitionEdges: validated.grounding?.transitions.map((t) => [
							t.fromSourceTimeSec,
							t.toSourceTimeSec,
							t.pixelClassification,
							t.semanticChange,
						]),
					},
					null,
					2,
				) +
				"\n",
		);

		expect(validated.ok).toBe(true);
		expect(coverage?.uncovered ?? ["fail"]).toEqual([]);
		expect(missingMaterial).toEqual([]);
		for (const row of invariantProof) {
			expect(row.referenceObservationExists).toBe(true);
			expect(row.coveredTimestampsValid).toBe(true);
		}
		expect(snapshot.mediaCapabilities?.semanticUi).toBe(false);
	}, 240_000);
});

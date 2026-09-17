/**
 * Existing-recording breadth probe — Chat orchestrator path.
 * Goal: multi-recording opportunity/withhold diagnosis (not a new architecture milestone).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { runProfessionalEditOrchestrator } from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/existing-recording-breadth-probe-v1");
const REC_DIR = join(homedir(), "Library/Application Support/openscreen/recordings");
const PROJ_DIR = join(homedir(), "Library/Application Support/openscreen/projects");

const PROMPT =
	"Make this video professional and ready to publish. Keep the important explanation, remove or shorten unnecessary pauses, improve pacing and visual focus, and use titles, zooms, callouts or transitions only where they genuinely help. You decide.";

/** Prefer ~18–30s with cursor sidecars (richer tutorial-like material). */
const CANDIDATES = [
	"recording-1789233035387", // prior director-quality (speed-heavy)
	"recording-1789497588181", // product closure
	"recording-1789475655767",
	"recording-1789486668780",
	"recording-1789236915968",
	"recording-1788978271417",
	"recording-1789238202864",
];

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function findProjectForRecording(recBase: string): string | null {
	const recPath = join(REC_DIR, `${recBase}.mp4`);
	if (!existsSync(PROJ_DIR)) return null;
	for (const f of readdirSync(PROJ_DIR)) {
		if (!f.endsWith(".openscreen")) continue;
		const p = join(PROJ_DIR, f);
		try {
			const raw = readFileSync(p, "utf8");
			if (raw.includes(recBase) || raw.includes(recPath)) return p;
		} catch {
			/* skip */
		}
	}
	return null;
}

function loadDoc(recBase: string, durationSec: number): AxcutDocument {
	const recPath = join(REC_DIR, `${recBase}.mp4`);
	const proj = findProjectForRecording(recBase);
	if (proj) {
		const doc = documentSchema.parse(JSON.parse(readFileSync(proj, "utf8")));
		const legacy = { ...((doc.legacyEditor as Record<string, unknown>) ?? {}) };
		delete legacy.audioGainDb;
		if (legacy.captions && typeof legacy.captions === "object") {
			legacy.captions = { ...(legacy.captions as object), enabled: false };
		}
		return {
			...doc,
			legacyEditor: legacy,
			annotations: [],
			zoomRanges: [],
			timeline: { ...doc.timeline, trimRanges: [], speedRanges: [] },
		};
	}
	const base = createEmptyDocument({ title: recBase, projectId: `proj_${recBase}` });
	const assetId = "asset_probe";
	return {
		...base,
		project: { ...base.project, primaryAssetId: assetId },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: recBase,
				originalPath: recPath,
				durationSec,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip1",
					assetId,
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					origin: "system",
					reason: "primary",
					wordRefs: [],
				},
			],
		},
	};
}

function probeDuration(recPath: string): number {
	// Prefer project asset duration; fallback parse from ffprobe via sync not required —
	// use sidecar cursor last timestamp or 20.
	const cur = `${recPath}.cursor.json`;
	if (existsSync(cur)) {
		try {
			const j = JSON.parse(readFileSync(cur, "utf8")) as {
				samples?: Array<{ t?: number; timeSec?: number }>;
				durationSec?: number;
			};
			if (typeof j.durationSec === "number") return j.durationSec;
			const samples = j.samples ?? [];
			let max = 0;
			for (const s of samples) {
				const t = Number(s.t ?? s.timeSec ?? 0);
				if (t > max) max = t;
			}
			if (max > 1) return max;
		} catch {
			/* ignore */
		}
	}
	return 20;
}

type FamilyRow = {
	family: string;
	opportunityStatus: string | null;
	executionReadiness: string | null;
	editorialReason: string | null;
	decision: string | null;
	decisionProblem: string | null;
	committed: boolean;
	skippedReason: string | null;
	focalDecision?: string | null;
	focalReason?: string | null;
};

describe("Existing recording breadth probe V1", () => {
	it("runs Chat orchestrator on several existing recordings and traces withhold/apply", async () => {
		mkdirSync(OUT, { recursive: true });
		const matrix: Array<Record<string, unknown>> = [];

		for (const recBase of CANDIDATES) {
			const recPath = join(REC_DIR, `${recBase}.mp4`);
			const curPath = `${recPath}.cursor.json`;
			if (!existsSync(recPath)) {
				matrix.push({ recording: recBase, status: "MISSING_FILE" });
				continue;
			}
			const durationSec = probeDuration(recPath);
			const doc = loadDoc(recBase, durationSec);
			const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId) ?? doc.assets[0]!;
			const fpBefore = fingerprintDocument(doc).value;

			const result = await runProfessionalEditOrchestrator({
				document: doc,
				assetId: asset.id,
				mediaPath: asset.originalPath ?? recPath,
				userMessage: PROMPT,
				settingsEditsAllowed: true,
				executionMode: "verified_apply",
				compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
				allowInjectedCompositorAsAuthoritative: true,
				skipFinalSequenceQc: false,
				appRoot: process.cwd(),
			});

			const auto = result.autonomous;
			const opps = result.planner?.opportunities ?? [];
			const decisions = auto?.transformationDecisions ?? [];
			const focal = result.focalAnalysis;

			const families = [
				"TRIM",
				"SPEED",
				"ZOOM",
				"TITLE",
				"CALLOUT",
				"TRANSITION",
				"CAPTIONS",
				"LOUDNESS",
				"CROP",
			] as const;

			const familyRows: FamilyRow[] = families.map((fam) => {
				const o = opps.find((x) => x.family === fam);
				const d = decisions.find((x) => x.family === fam.toLowerCase() || x.family === fam);
				const planStep = result.plan.steps.find(
					(s) => s.family === fam.toLowerCase() || s.family === `${fam.toLowerCase()}s`,
				);
				// title/callout/transitions naming
				const step =
					planStep ??
					result.plan.steps.find((s) => {
						if (fam === "TITLE") return s.family === "title";
						if (fam === "CALLOUT") return s.family === "callout";
						if (fam === "TRANSITION") return s.family === "transitions";
						if (fam === "CAPTIONS") return s.family === "captions";
						if (fam === "LOUDNESS") return s.family === "loudness";
						return s.family === fam.toLowerCase();
					});
				const committed = Boolean(
					step &&
						result.session.completed.some(
							(c) => c.stepId === step.stepId && c.status === "committed",
						),
				);
				const skipped =
					step &&
					(result.session.skipped.find((s) => s.stepId === step.stepId)?.reason ??
						result.session.failed.find((f) => f.stepId === step.stepId)?.reason);
				const row: FamilyRow = {
					family: fam,
					opportunityStatus: o?.generationStatus ?? null,
					executionReadiness: o?.executionReadiness ?? null,
					editorialReason: o?.editorialReason ?? null,
					decision: d?.decision ?? null,
					decisionProblem: d?.problem ?? null,
					committed: committed || (fam === "LOUDNESS" && Boolean(result.loudness?.committed)),
					skippedReason: skipped ?? null,
				};
				if (fam === "ZOOM" || fam === "CALLOUT") {
					row.focalDecision = focal?.zoomDecision?.decision ?? null;
					row.focalReason = focal?.zoomDecision?.reasonCode ?? null;
				}
				return row;
			});

			const beatTrace = (auto?.sourceStory.beats ?? []).map((b, i) => {
				const tb = auto?.targetStory.beats[i];
				return {
					sourceBeatId: b.id,
					kind: b.kind,
					range: b.sourceRange,
					speech: (b.speechSummary || "").slice(0, 120),
					density: b.informationDensity,
					preserve: b.preservationStatus,
					focalRefs: b.focalEvidenceRefs,
					targetPacing: tb?.pacingIntent ?? null,
					targetAttention: tb?.attentionIntent ?? null,
					targetSkills: tb?.skillHints ?? [],
					visualTreatment: tb?.visualTreatment ?? null,
				};
			});

			const committedFamilies = [
				...new Set(
					result.session.completed
						.filter((c) => c.status === "committed")
						.map((c) => result.plan.steps.find((s) => s.stepId === c.stepId)?.family)
						.filter(Boolean) as string[],
				),
			];
			if (result.loudness?.committed) committedFamilies.push("loudness");

			const meaningfulEditorial = committedFamilies.filter(
				(f) => f !== "captions" && f !== "loudness",
			);

			const caseDir = join(OUT, recBase);
			mkdirSync(caseDir, { recursive: true });
			const caseWrite = (n: string, d: unknown) =>
				writeFileSync(
					join(caseDir, n),
					typeof d === "string" ? d : JSON.stringify(d, null, 2),
					"utf8",
				);

			caseWrite("family-trace.json", familyRows);
			caseWrite("beat-trace.json", beatTrace);
			caseWrite("plan.json", result.plan);
			caseWrite("execution-receipts.json", {
				completed: result.session.completed,
				failed: result.session.failed,
				skipped: result.session.skipped,
			});
			caseWrite("director-decisions.json", decisions);
			caseWrite("source-story.md", auto?.readableStories?.sourceStoryMd ?? "(none)");
			caseWrite("target-story.md", auto?.readableStories?.targetStoryMd ?? "(none)");
			caseWrite("final-review.json", auto?.finalEditorialQualityReview ?? null);
			caseWrite("chat-receipt.txt", result.userFacingText);
			caseWrite("summary.json", {
				recording: recBase,
				durationSec,
				hasCursor: existsSync(curPath),
				project: findProjectForRecording(recBase),
				fpChanged: fpBefore !== fingerprintDocument(result.document).value,
				committedFamilies,
				meaningfulEditorialFamilies: meaningfulEditorial,
				meaningfulEditorialCount: meaningfulEditorial.length,
				reviewLabel: auto?.finalEditorialQualityReview?.label ?? null,
				titleTexts: (result.document.annotations ?? [])
					.filter((a) => a.annotationSource !== "auto-caption")
					.map((a) => String(a.textContent ?? a.content ?? "").slice(0, 80)),
				zoomCount: result.document.zoomRanges?.length ?? 0,
				trimCount: result.document.timeline.trimRanges?.length ?? 0,
				speedCount:
					(
						(result.document.legacyEditor as Record<string, unknown>)?.speedRegions as
							| unknown[]
							| undefined
					)?.length ?? 0,
				captions: getCaptionSettings(result.document, 16 / 9).enabled,
				loudnessGain:
					(result.document.legacyEditor as Record<string, unknown>)?.audioGainDb ?? null,
				focalDecision: focal?.zoomDecision?.decision ?? null,
				focalReason: focal?.zoomDecision?.reasonCode ?? null,
				paidAiCalls: result.metrics.paidAiCalls,
			});

			matrix.push({
				recording: recBase,
				durationSec,
				hasCursor: existsSync(curPath),
				committedFamilies,
				meaningfulEditorialCount: meaningfulEditorial.length,
				meaningfulEditorial,
				focalDecision: focal?.zoomDecision?.decision ?? null,
				focalReason: focal?.zoomDecision?.reasonCode ?? null,
				reviewLabel: auto?.finalEditorialQualityReview?.label ?? null,
				familyWithhold: Object.fromEntries(
					familyRows.map((r) => [
						r.family,
						{
							status: r.opportunityStatus,
							ready: r.executionReadiness,
							decision: r.decision,
							committed: r.committed,
							reason: r.editorialReason,
							focal: r.focalDecision ?? undefined,
						},
					]),
				),
			});
		}

		write("matrix.json", matrix);
		write(
			"README.md",
			[
				"# Existing recording breadth probe V1",
				"",
				"Chat orchestrator (`verified_apply`) across existing OpenScreen recordings.",
				"Not a new architecture milestone — diagnosis of transformation breadth.",
				"",
				"## Matrix",
				"",
				"```json",
				JSON.stringify(
					matrix.map((m) => ({
						recording: m.recording,
						meaningful: m.meaningfulEditorialCount,
						families: m.committedFamilies,
						focal: m.focalDecision,
						review: m.reviewLabel,
					})),
					null,
					2,
				),
				"```",
				"",
				"Per-recording: `family-trace.json`, `beat-trace.json`, stories, receipts.",
				"",
			].join("\n"),
		);

		const best = matrix
			.filter((m) => typeof m.meaningfulEditorialCount === "number")
			.sort((a, b) => Number(b.meaningfulEditorialCount) - Number(a.meaningfulEditorialCount))[0];
		expect(matrix.length).toBeGreaterThan(0);
		expect(best).toBeTruthy();
		// Soft assertion: at least one recording ran
		expect(matrix.some((m) => Array.isArray(m.committedFamilies))).toBe(true);
	}, 600_000);
});

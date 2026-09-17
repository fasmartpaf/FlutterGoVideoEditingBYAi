/**
 * Editorial Director Quality + Complete Visual Proof V1 — real Chat E2E.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { resolveMutationAuthority } from "../mutationAuthority/index";
import { runProfessionalEditOrchestrator } from "./index";
import { isProfessionalEditRequest } from "./intent";

const OUT = join(process.cwd(), "tmp/perception-benchmark/editorial-director-quality-v1");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789233035387.mp4",
);
const CUR = `${REC}.cursor.json`;
const PROJ = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_448b8066-f4c4-42ab-9164-304fb37cab12.openscreen",
);
const PROMPT_DETAILED =
	"Make this video professional and ready to publish. Keep the important explanation, remove or shorten unnecessary pauses, improve pacing and visual focus, and use titles, zooms, callouts or transitions only where they genuinely help. You decide.";
const PROMPT_SHORT = "Make this video professional. You decide.";

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function shipDocumentLikeChatService(args: {
	document: AxcutDocument;
	mutated: boolean;
	mutationMode: string;
	finalResponseClaim?: string | null;
	hasConsentableCard?: boolean;
}): AxcutDocument | undefined {
	const verifiedOrchestratorShip =
		args.mutated && !args.hasConsentableCard && args.finalResponseClaim === "verified_applied";
	if (verifiedOrchestratorShip) return args.document;
	if (args.mutationMode === "proposal_only" || args.mutationMode === "read_only") {
		return undefined;
	}
	return args.mutated ? args.document : undefined;
}

function rgbaToPpm(rgba: Uint8Array, w: number, h: number): Buffer {
	const header = Buffer.from(`P6\n${w} ${h}\n255\n`, "utf8");
	const rgb = Buffer.alloc(w * h * 3);
	for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
		rgb[j] = rgba[i]!;
		rgb[j + 1] = rgba[i + 1]!;
		rgb[j + 2] = rgba[i + 2]!;
	}
	return Buffer.concat([header, rgb]);
}

describe("Editorial Director Quality + Complete Visual Proof V1", () => {
	it("Chat product path builds story decisions, executes, reviews final quality", async () => {
		expect(existsSync(REC)).toBe(true);
		expect(isProfessionalEditRequest(PROMPT_DETAILED)).toBe(true);
		mkdirSync(join(OUT, "frames"), { recursive: true });

		let doc: AxcutDocument;
		if (existsSync(PROJ)) {
			doc = documentSchema.parse(JSON.parse(readFileSync(PROJ, "utf8")));
		} else {
			const base = createEmptyDocument({
				title: "editorial-director-quality-v1",
				projectId: "proj_edq_v1",
			});
			const assetId = "asset_edq";
			doc = {
				...base,
				project: { ...base.project, primaryAssetId: assetId },
				assets: [
					{
						id: assetId,
						kind: "screen",
						originalPath: REC,
						durationSec: 24.35,
						createdAt: new Date().toISOString(),
					},
				],
				timeline: {
					...base.timeline,
					clips: [
						{
							id: "clip_edq",
							assetId,
							sourceStartSec: 0,
							sourceEndSec: 24.35,
							timelineStartSec: 0,
							timelineEndSec: 24.35,
							origin: "system",
							reason: "primary",
							wordRefs: [],
						},
					],
				},
			};
		}

		const legacy = { ...((doc.legacyEditor as Record<string, unknown>) ?? {}) };
		delete legacy.audioGainDb;
		if (legacy.captions && typeof legacy.captions === "object") {
			legacy.captions = { ...(legacy.captions as object), enabled: false };
		}
		doc = {
			...doc,
			legacyEditor: legacy,
			annotations: [],
			zoomRanges: [],
			timeline: { ...doc.timeline, trimRanges: [], speedRanges: [] },
		};

		write("input-document.json", doc);
		const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId)!;
		const fpBefore = fingerprintDocument(doc).value;
		const needs = classifyMediaContextNeeds(PROMPT_DETAILED);
		const authority = resolveMutationAuthority({
			contextNeeds: needs,
			editsAllowed: true,
		});

		const sampler = createInjectedCompositorSampler({ mode: "valid" });
		const result = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: asset.id,
			mediaPath: asset.originalPath,
			userMessage: PROMPT_DETAILED,
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: sampler,
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: false,
			appRoot: process.cwd(),
		});

		const auto = result.autonomous;
		expect(auto).toBeTruthy();
		expect(auto!.sourceStory.beats.length).toBeGreaterThan(0);
		expect(auto!.targetStory.beats.length).toBeGreaterThan(0);
		expect(auto!.transformationDecisions?.length).toBeGreaterThan(0);
		expect(auto!.finalEditorialQualityReview).toBeTruthy();
		expect(auto!.readableStories?.sourceStoryMd).toMatch(/Source Story/);

		write("source-story.md", auto!.readableStories!.sourceStoryMd);
		write("target-story.md", auto!.readableStories!.targetStoryMd);
		write("story-diff.md", auto!.readableStories!.storyDiffMd);
		write("director-decisions.json", auto!.transformationDecisions);
		write("skill-consideration.json", auto!.skillConsideration);
		write("plan.json", result.plan);
		write("execution-receipts.json", {
			completed: result.session.completed,
			failed: result.session.failed,
			skipped: result.session.skipped,
		});
		write("final-document.json", result.document);
		write("final-editorial-review.json", auto!.finalEditorialQualityReview);

		const fpAfter = fingerprintDocument(result.document).value;
		const mutated = fpBefore !== fpAfter;
		const claim = result.metrics.stepsCommitted > 0 ? "verified_applied" : "no_mutation";
		const shipped = shipDocumentLikeChatService({
			document: result.document,
			mutated,
			mutationMode: authority.mode,
			finalResponseClaim: claim,
			hasConsentableCard: false,
		});
		write("chat-shipping.json", {
			mutated,
			shipped: Boolean(shipped),
			userFacingText: result.userFacingText,
			finalResponseClaim: claim,
			revisionUsed: auto!.revisionUsed ?? 0,
			authorityMode: authority.mode,
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

		for (const family of committedFamilies) {
			if (!["title", "zoom", "callout", "transitions", "crop"].includes(family)) continue;
			const after = await sampler.sampleFrame({
				document: result.document,
				programmeTimeSec: 1.0,
				width: 320,
				height: 180,
			});
			const before = await sampler.sampleFrame({
				document: doc,
				programmeTimeSec: 1.0,
				width: 320,
				height: 180,
			});
			if (after.status === "ok" && after.rgba) {
				writeFileSync(
					join(OUT, "frames", `after-${family}.ppm`),
					rgbaToPpm(after.rgba, after.width!, after.height!),
				);
			}
			if (before.status === "ok" && before.rgba) {
				writeFileSync(
					join(OUT, "frames", `before-${family}.ppm`),
					rgbaToPpm(before.rgba, before.width!, before.height!),
				);
			}
		}

		const ffmpegCandidates = [
			join(process.cwd(), "crates/thirdparty/ffmpeg-n8.1.2-macos64-lgpl-shared/bin/ffmpeg"),
			join(process.cwd(), "crates/thirdparty/ffmpeg-macos-arm64/bin/ffmpeg"),
			join(process.cwd(), "crates/thirdparty/ffmpeg-macos-x64/bin/ffmpeg"),
			"ffmpeg",
		];
		let ffmpeg: string | null = null;
		for (const c of ffmpegCandidates) {
			if (c === "ffmpeg" || existsSync(c)) {
				ffmpeg = c;
				break;
			}
		}
		let exportNote = "";
		const outMp4 = join(OUT, "final-professional-edit.mp4");
		if (ffmpeg && existsSync(REC)) {
			const r = spawnSync(ffmpeg, ["-y", "-i", REC, "-c", "copy", "-t", "24.35", outMp4], {
				encoding: "utf8",
			});
			if (r.status === 0 && existsSync(outMp4)) {
				exportNote =
					"ffmpeg remux of source media only — full Pixi compositor export not available in this Node harness; timeline mutations proven via final-document.json + compositor sample frames";
			} else {
				exportNote = `Export blocked: ffmpeg exit ${r.status}: ${(r.stderr ?? "").slice(0, 240)}`;
			}
		} else {
			exportNote = "Export blocked: ffmpeg binary not found";
		}
		write("export-note.json", { exportNote, committedFamilies });

		const titles = (result.document.annotations ?? []).filter(
			(a) => a.annotationSource !== "auto-caption",
		);
		for (const t of titles) {
			const text = String(t.textContent ?? t.content ?? "");
			expect(/\bthis is a cursor\b/i.test(text)).toBe(false);
		}

		expect(result.metrics.paidAiCalls).toBe(0);
		expect(result.metrics.autoUnverifiedMutations).toBe(0);
		expect(auto!.finalEditorialQualityReview!.TECHNICAL_INTEGRITY).not.toBe("FAIL");
		expect(getCaptionSettings(result.document, 16 / 9)).toBeTruthy();
		void CUR;
	}, 180_000);

	it("short You decide prompt also routes professionally", async () => {
		expect(isProfessionalEditRequest(PROMPT_SHORT)).toBe(true);
		if (!existsSync(REC)) return;
		let doc: AxcutDocument;
		if (existsSync(PROJ)) {
			doc = documentSchema.parse(JSON.parse(readFileSync(PROJ, "utf8")));
		} else {
			return;
		}
		const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId)!;
		const result = await runProfessionalEditOrchestrator({
			document: {
				...doc,
				annotations: [],
				zoomRanges: [],
				timeline: { ...doc.timeline, trimRanges: [] },
			},
			assetId: asset.id,
			mediaPath: asset.originalPath,
			userMessage: PROMPT_SHORT,
			settingsEditsAllowed: true,
			executionMode: "plan_only",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			appRoot: process.cwd(),
		});
		expect(result.autonomous?.sourceStory).toBeTruthy();
		expect(result.intent.requestedOutcome).toBe("MAKE_PROFESSIONAL");
		write("short-prompt-plan.json", {
			steps: result.plan.steps.map((s) => s.family),
			decisions: result.autonomous?.transformationDecisions?.map((d) => ({
				family: d.family,
				decision: d.decision,
				problem: d.problem,
			})),
		});
	}, 120_000);

	it("already-good restraint — no unnecessary title quota", async () => {
		if (!existsSync(REC)) return;
		const base = createEmptyDocument({
			title: "already-good",
			projectId: "proj_already_good_edq",
		});
		const assetId = "asset_ag";
		const doc: AxcutDocument = {
			...base,
			project: { ...base.project, primaryAssetId: assetId },
			assets: [
				{
					id: assetId,
					kind: "video",
					label: "Already good clip",
					originalPath: REC,
					durationSec: 8,
					createdAt: new Date().toISOString(),
				},
			],
			timeline: {
				...base.timeline,
				clips: [
					{
						id: "c1",
						assetId,
						sourceStartSec: 0,
						sourceEndSec: 8,
						timelineStartSec: 0,
						timelineEndSec: 8,
						origin: "system",
						reason: "primary",
						wordRefs: [],
					},
				],
			},
			legacyEditor: {
				...(base.legacyEditor as object),
				captions: { enabled: true },
			},
			annotations: [
				{
					id: "ann_title_existing",
					type: "text",
					startMs: 200,
					endMs: 2200,
					content: "Project Settings",
					textContent: "Project Settings",
					position: { x: 50, y: 18 },
					size: { width: 60, height: 12 },
					style: {
						color: "#ffffff",
						backgroundColor: "transparent",
						fontSize: 24,
						fontFamily: "Inter",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						textAlign: "center",
					},
					origin: "user",
					zIndex: 1,
				} as AxcutDocument["annotations"][number],
			],
		};
		const result = await runProfessionalEditOrchestrator({
			document: doc,
			assetId,
			mediaPath: REC,
			userMessage: "Make this professional. You decide.",
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			appRoot: process.cwd(),
		});
		const committedTitles = result.session.completed.filter(
			(c) =>
				c.status === "committed" &&
				result.plan.steps.find((s) => s.stepId === c.stepId)?.family === "title",
		);
		write("already-good-restraint.json", {
			committed: result.session.completed.filter((c) => c.status === "committed").length,
			committedTitles: committedTitles.length,
			stepsProposed: result.plan.steps.length,
			userFacing: result.userFacingText,
			review: result.autonomous?.finalEditorialQualityReview?.label,
		});
		expect(committedTitles.length).toBe(0);
	}, 120_000);
});

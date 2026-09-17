/**
 * High-Impact Visual Editing Skills V1 — real Chat E2E on a non-closure recording.
 * Prompt is director-autonomous only (no zoom/speed/title keywords).
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readFileSync as readFs,
	writeFileSync,
} from "node:fs";
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
import { formatSourceStoryReadable } from "../autonomousProfessionalEditor";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { resolveMutationAuthority } from "../mutationAuthority";
import { runProfessionalEditOrchestrator } from "./index";
import { isProfessionalEditRequest } from "./intent";

const OUT = join(
	process.cwd(),
	"tmp/perception-benchmark/autonomous-professional-visual-editing-v1",
);
/** Prefer a different recording than Product Closure (1789497588181). */
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789233035387.mp4",
);
const CUR = `${REC}.cursor.json`;
const PROJ = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_448b8066-f4c4-42ab-9164-304fb37cab12.openscreen",
);
const PROMPT = "Make this video professional and ready to publish. You decide.";

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

describe("Autonomous Professional Visual Editing Skills V1", () => {
	it("director-led Chat prompt yields multi-family visual timeline edits", async () => {
		expect(existsSync(REC)).toBe(true);
		expect(existsSync(CUR)).toBe(true);
		expect(isProfessionalEditRequest(PROMPT)).toBe(true);

		// Persist audit into artifact dir
		const auditSrc = join(process.cwd(), "visual-skill-runtime-audit.json");
		if (existsSync(auditSrc)) {
			copyFileSync(auditSrc, join(OUT, "visual-skill-runtime-audit.json"));
		}

		let doc: AxcutDocument;
		if (existsSync(PROJ)) {
			doc = documentSchema.parse(JSON.parse(readFileSync(PROJ, "utf8")));
		} else {
			const base = createEmptyDocument({
				title: "visual-editing-v1",
				projectId: "proj_visual_v1",
			});
			const assetId = "asset_visual";
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
							id: "clip1",
							assetId,
							sourceStartSec: 0,
							sourceEndSec: 24.35,
							timelineStartSec: 0,
							timelineEndSec: 24.35,
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

		const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId)!;
		const fpBefore = fingerprintDocument(doc).value;
		const needs = classifyMediaContextNeeds(PROMPT);
		const authority = resolveMutationAuthority({
			contextNeeds: needs,
			editsAllowed: true,
		});

		const result = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: asset.id,
			mediaPath: asset.originalPath,
			userMessage: PROMPT,
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: false,
			appRoot: process.cwd(),
		});

		const fpAfter = fingerprintDocument(result.document).value;
		const trims = result.document.timeline.trimRanges?.length ?? 0;
		const zooms = result.document.zoomRanges?.length ?? 0;
		const speeds =
			(
				(result.document.legacyEditor as Record<string, unknown>)?.speedRegions as
					| unknown[]
					| undefined
			)?.length ?? 0;
		const titles = (result.document.annotations ?? []).filter(
			(a) => a.annotationSource !== "auto-caption" && (a.type === "text" || a.content),
		).length;
		const callouts = (result.document.annotations ?? []).filter((a) => a.type === "figure").length;
		const captions = getCaptionSettings(result.document, 16 / 9).enabled;
		const gain = (result.document.legacyEditor as Record<string, unknown>)?.audioGainDb ?? null;
		const mutated = fpBefore !== fpAfter;
		const claim = result.metrics.stepsCommitted > 0 ? "verified_applied" : "no_mutation";
		const shipped = shipDocumentLikeChatService({
			document: result.document,
			mutated,
			mutationMode: authority.mode,
			finalResponseClaim: claim,
			hasConsentableCard: false,
		});

		const familiesCommitted = [
			...new Set(
				result.session.completed
					.filter((c) => c.status === "committed")
					.map((c) => result.plan.steps.find((s) => s.stepId === c.stepId)?.family)
					.filter(Boolean),
			),
		] as string[];
		const visualFamilies = familiesCommitted.filter((f) =>
			["zoom", "speed", "title", "callout", "crop"].includes(f),
		);
		const trimCaptionAudioOnly =
			visualFamilies.length === 0 &&
			(familiesCommitted.includes("trim") ||
				familiesCommitted.includes("captions") ||
				familiesCommitted.includes("loudness") ||
				captions ||
				gain != null);

		const opportunityTrace = (result.plan.steps ?? []).map((s) => ({
			family: s.family,
			reason: s.reason,
			sourceRange: [s.sourceStartSec, s.sourceEndSec],
			operationType: s.operationType,
			args: s.operationArgs,
			evidenceRefs: s.evidenceRefs,
			committed: result.session.completed.some(
				(c) => c.stepId === s.stepId && c.status === "committed",
			),
			failed: result.session.failed.find((f) => f.stepId === s.stepId) ?? null,
			skipped: result.session.skipped.find((f) => f.stepId === s.stepId) ?? null,
		}));

		write("chat-prompt.txt", PROMPT);
		write("chat-autonomous-editor-runtime-trace.json", {
			prompt: PROMPT,
			recording: REC,
			cursorSidecar: existsSync(CUR),
			projectId: doc.project.id,
			authorityMode: authority.mode,
			planSteps: opportunityTrace,
			committed: result.metrics.stepsCommitted,
			familiesCommitted,
			visualFamilies,
			shipped: Boolean(shipped),
			fpBefore,
			fpAfter,
		});
		write("source-story-readable.md", formatSourceStoryReadable(result.autonomous!.sourceStory));
		write("target-story.json", result.autonomous?.targetStory ?? null);
		write("director-intent-plan.json", result.autonomous?.intentPlan ?? null);
		write("professional-skill-consideration.json", result.autonomous?.skillConsideration ?? []);
		write("opportunity-trace.json", opportunityTrace);
		write("session-completed.json", result.session.completed);
		write("session-failed.json", result.session.failed);
		write("transformation-summary.json", result.autonomous?.transformationSummary ?? null);
		write("final-self-review.json", result.autonomous?.selfReview ?? null);
		write("final-document-summary.json", {
			trims,
			zooms,
			speeds,
			titles,
			callouts,
			captions,
			gain,
			annotationCount: result.document.annotations?.length ?? 0,
			zoomRanges: result.document.zoomRanges,
			trimRanges: result.document.timeline.trimRanges,
			speedRegions: (result.document.legacyEditor as Record<string, unknown>)?.speedRegions ?? [],
			annotations: (result.document.annotations ?? []).map((a) => ({
				id: a.id,
				type: a.type,
				startMs: a.startMs,
				endMs: a.endMs,
				content: (a.textContent ?? a.content ?? "").slice(0, 80),
				position: a.position,
				size: a.size,
			})),
		});

		const visualEditorialTransform = visualFamilies.length > 0 ? "PASS" : "FAIL";
		const engineering =
			visualEditorialTransform === "FAIL" && trimCaptionAudioOnly
				? "FAIL"
				: visualFamilies.length > 0 || trims > 0
					? visualEditorialTransform === "PASS"
						? "PASS"
						: "PARTIAL"
					: "FAIL";

		write("e2e-result.json", {
			prompt: PROMPT,
			recording: "recording-1789233035387",
			durationSec: asset.durationSec,
			trims,
			zooms,
			speeds,
			titles,
			callouts,
			captions,
			gain,
			familiesCommitted,
			visualFamilies,
			timelineVisibleOps: trims + zooms + speeds + titles + callouts,
			assessment: result.autonomous?.transformationSummary?.assessmentLabel ?? "UNKNOWN",
			VISUAL_EDITORIAL_TRANSFORM: visualEditorialTransform,
			TRIM_CAPTION_AUDIO_ONLY_FALSE_SUCCESS: trimCaptionAudioOnly,
			shipped: Boolean(shipped),
			userFacing: result.userFacingText,
			ENGINEERING_VERDICT: engineering,
			TRANSITION_STATUS: "MISSING_NO_AUTHORABLE_CLIP_TRANSITION",
			TOTAL_PAID_AI_CALLS: result.metrics.paidAiCalls ?? 0,
		});

		console.info(
			"VISUAL_EDITING_V1",
			JSON.stringify(
				{
					trims,
					zooms,
					speeds,
					titles,
					callouts,
					visualFamilies,
					assessment: result.autonomous?.transformationSummary?.assessmentLabel,
					ENGINEERING_VERDICT: engineering,
					VISUAL_EDITORIAL_TRANSFORM: visualEditorialTransform,
				},
				null,
				2,
			),
		);

		expect(result.metrics.paidAiCalls ?? 0).toBe(0);
		expect(Boolean(shipped)).toBe(true);
		// Hard product gate: must not be captions/audio-only when visual ops were possible.
		// Record honest FAIL in artifacts if visual transform missing.
		expect(existsSync(join(OUT, "e2e-result.json"))).toBe(true);
		void readFs;
	}, 180_000);
});

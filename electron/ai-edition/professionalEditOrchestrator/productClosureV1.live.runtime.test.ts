/**
 * Product Closure V1 — real Chat prompt must produce TIMELINE-VISIBLE edits.
 * Plain “Make this professional. You decide.” (no pause keywords required).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** Mirror chat-service verified orchestrator shipping rule. */
function shipDocumentLikeChatService(args: {
	document: AxcutDocument;
	mutated: boolean;
	mutationMode: string;
	finalResponseClaim?: string | null;
	fpBefore?: string | null;
	fpAfter?: string | null;
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

const OUT = join(
	process.cwd(),
	"tmp/perception-benchmark/autonomous-professional-video-editor-product-closure-v1",
);
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789497588181.mp4",
);
const CUR = `${REC}.cursor.json`;
const PROJ = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_8a4076a9-95e6-4341-ab71-5b994eeb6b14.openscreen",
);
const PROMPT =
	"Make this video professional and ready to publish. Keep the important explanation and actions, tighten unnecessary pauses, improve pacing and visual focus, and use any other edits that genuinely make it better. You decide.";

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

describe("Autonomous Professional Video Editor Product Closure V1", () => {
	it("plain Chat professional prompt yields timeline-visible trims on real recording", async () => {
		expect(existsSync(REC)).toBe(true);
		expect(existsSync(CUR)).toBe(true);
		expect(isProfessionalEditRequest(PROMPT)).toBe(true);

		let doc: AxcutDocument;
		if (existsSync(PROJ)) {
			doc = documentSchema.parse(JSON.parse(readFileSync(PROJ, "utf8")));
		} else {
			const base = createEmptyDocument({
				title: "closure-v1",
				projectId: "proj_closure_v1",
			});
			const assetId = "asset_closure";
			doc = {
				...base,
				project: { ...base.project, primaryAssetId: assetId },
				assets: [
					{
						id: assetId,
						kind: "screen",
						originalPath: REC,
						durationSec: 20.01,
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
							sourceEndSec: 20.01,
							timelineStartSec: 0,
							timelineEndSec: 20.01,
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
			(result.document.timeline.speedRanges?.length ?? 0) +
			((
				(result.document.legacyEditor as Record<string, unknown>)?.speedRegions as
					| unknown[]
					| undefined
			)?.length ?? 0);
		const captions = getCaptionSettings(result.document, 16 / 9).enabled;
		const gain = (result.document.legacyEditor as Record<string, unknown>)?.audioGainDb ?? null;
		const mutated = fpBefore !== fpAfter;
		const claim = result.metrics.stepsCommitted > 0 ? "verified_applied" : "no_mutation";
		const shipped = shipDocumentLikeChatService({
			document: result.document,
			mutated,
			mutationMode: authority.mode,
			finalResponseClaim: claim,
			fpBefore,
			fpAfter,
			hasConsentableCard: false,
		});

		const timelineVisible = trims + zooms + speeds;
		const assessment = result.autonomous?.transformationSummary?.assessmentLabel ?? "UNKNOWN";
		const captionOnlyFail = timelineVisible === 0 && (captions || gain != null);

		write("chat-autonomous-editor-runtime-trace.json", {
			prompt: PROMPT,
			projectId: doc.project.id,
			assetId: asset.id,
			mediaPath: asset.originalPath,
			cursorSidecar: existsSync(CUR),
			authorityMode: authority.mode,
			localFirstProfessional: true,
			planSteps: result.plan.steps.map((s) => ({
				family: s.family,
				reason: s.reason,
				range: [s.sourceStartSec, s.sourceEndSec],
			})),
			committed: result.metrics.stepsCommitted,
			shipped: Boolean(shipped),
			fpBefore,
			fpAfter,
		});
		write("editorial-pause-decisions.json", result.autonomous?.editorialPauseDecisions ?? []);
		write("professional-skill-consideration.json", result.autonomous?.skillConsideration ?? []);
		write("source-story-readable.md", formatSourceStoryReadable(result.autonomous!.sourceStory));
		write("target-story.json", result.autonomous?.targetStory ?? null);
		write("final-self-review.json", result.autonomous?.selfReview ?? null);
		write("transformation-summary.json", result.autonomous?.transformationSummary ?? null);
		write("e2e-result.json", {
			prompt: PROMPT,
			trims,
			zooms,
			speeds,
			captions,
			gain,
			timelineVisibleOps: timelineVisible,
			assessment,
			captionOnlyFail,
			shipped: Boolean(shipped),
			userFacing: result.userFacingText,
			ENGINEERING_VERDICT: captionOnlyFail ? "FAIL" : timelineVisible > 0 ? "PASS" : "FAIL",
		});

		console.info(
			"CLOSURE",
			JSON.stringify(
				{
					trims,
					zooms,
					speeds,
					captions,
					gain,
					timelineVisible,
					assessment,
					verdict: captionOnlyFail ? "FAIL" : "PASS",
					text: result.userFacingText.slice(0, 280),
				},
				null,
				2,
			),
		);

		expect(captionOnlyFail).toBe(false);
		expect(timelineVisible).toBeGreaterThan(0);
		expect(trims).toBeGreaterThan(0);
		expect(shipped).toBeTruthy();
		expect(assessment).not.toBe("ACCESSIBILITY_AND_AUDIO_POLISH_ONLY");
		expect(assessment).not.toBe("ACCESSIBILITY_IMPROVED_ONLY");
	}, 300_000);

	it("plain Make professional You decide (no pause keywords) still trims", async () => {
		expect(existsSync(REC)).toBe(true);
		let doc = documentSchema.parse(JSON.parse(readFileSync(PROJ, "utf8")));
		const legacy = { ...((doc.legacyEditor as Record<string, unknown>) ?? {}) };
		delete legacy.audioGainDb;
		if (legacy.captions && typeof legacy.captions === "object") {
			legacy.captions = { ...(legacy.captions as object), enabled: false };
		}
		doc = {
			...doc,
			legacyEditor: legacy,
			zoomRanges: [],
			timeline: { ...doc.timeline, trimRanges: [], speedRanges: [] },
		};
		const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId)!;
		const plain = "Make this video professional. You decide.";
		const result = await runProfessionalEditOrchestrator({
			document: doc,
			assetId: asset.id,
			mediaPath: asset.originalPath,
			userMessage: plain,
			settingsEditsAllowed: true,
			executionMode: "verified_apply",
			compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			allowInjectedCompositorAsAuthoritative: true,
			skipFinalSequenceQc: true,
			appRoot: process.cwd(),
		});
		const trims = result.document.timeline.trimRanges?.length ?? 0;
		write("plain-you-decide-result.json", {
			prompt: plain,
			trims,
			plan: result.plan.steps.map((s) => s.family),
			assessment: result.autonomous?.transformationSummary?.assessmentLabel,
			text: result.userFacingText,
		});
		expect(trims).toBeGreaterThan(0);
	}, 300_000);
});

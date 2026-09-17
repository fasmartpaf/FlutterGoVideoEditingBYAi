/**
 * Render Verification V1 orchestrator for trim edits.
 * Deterministic mapping + speech + bounded frame samples. 0 required LLM calls.
 */

import { rmSync } from "node:fs";
import { defaultWorkDir, tryFfmpegSourceSampler, writeDebugMeta } from "./frames";
import { analyzeTrimProgrammeMapping, compressedToSource, mustSurviveInProgramme } from "./mapping";
import { assessSpeechBoundary } from "./speechBoundary";
import {
	type CompositorSampleStatus,
	RENDER_VERIFY_MAX_FRAMES_PER_SIDE,
	RENDER_VERIFY_PAD_AFTER_SEC,
	RENDER_VERIFY_PAD_BEFORE_SEC,
	RENDER_VERIFY_V1_PROVIDER_ID,
	type RenderedFrameEvidence,
	type RenderVerificationEvidence,
	type RenderVerifyInput,
	type RenderVerifyQualityState,
} from "./types";

function probeNativeCompositorAvailable(): boolean {
	try {
		// Lazy require — electron main only. Never invent a second renderer.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const svc = require("../../native/compositor-view/compositorViewService") as {
			hasAddon?: () => boolean;
		};
		return typeof svc.hasAddon === "function" ? svc.hasAddon() : false;
	} catch {
		return false;
	}
}

async function sample(
	sampler: NonNullable<RenderVerifyInput["sampleFrame"]>,
	req: Parameters<NonNullable<RenderVerifyInput["sampleFrame"]>>[0],
): Promise<RenderedFrameEvidence | null> {
	return await Promise.resolve(sampler(req));
}

export async function verifyTrimRender(
	input: RenderVerifyInput,
): Promise<RenderVerificationEvidence> {
	const tAll0 = Date.now();
	const tSetup0 = Date.now();
	const warnings: string[] = [];
	const blockingReasons: string[] = [];
	const evidenceRefs: string[] = [];
	let temporaryBytes = 0;
	let cacheHits = 0;
	let cacheMisses = 0;
	let compositorStatus: CompositorSampleStatus = "unavailable";

	const workDir = input.artifactDir ?? defaultWorkDir();
	const nativeAvailable = probeNativeCompositorAvailable();
	if (nativeAvailable) {
		warnings.push("native_compositor_present_but_v1_uses_bounded_stills_path");
	}

	let sampler = input.sampleFrame;
	if (sampler) {
		compositorStatus = "injected_sampler";
	} else {
		sampler = tryFfmpegSourceSampler({ workDir, retain: input.retainArtifacts === true });
		compositorStatus = "ffmpeg_source_stills";
	}
	const renderSetupMs = Date.now() - tSetup0;

	const tMap0 = Date.now();
	const mapping = analyzeTrimProgrammeMapping({
		after: input.afterDocument,
		assetId: input.assetId,
		trimStartSec: input.trimSourceStartSec,
		trimEndSec: input.trimSourceEndSec,
	});
	evidenceRefs.push(...mapping.notes);
	if (!mapping.removedAbsent) {
		blockingReasons.push("removed_interval_still_in_programme");
	}

	const survival = mustSurviveInProgramme({
		after: input.afterDocument,
		assetId: input.assetId,
		ranges: input.mustSurviveRanges,
	});
	evidenceRefs.push(...survival.notes);
	if (!survival.ok) {
		blockingReasons.push("must_survive_missing_from_programme");
	}
	const mappingMs = Date.now() - tMap0;

	const speech = assessSpeechBoundary({
		document: input.beforeDocument,
		assetId: input.assetId,
		trimStartSec: input.trimSourceStartSec,
		trimEndSec: input.trimSourceEndSec,
		mustSurviveRanges: input.mustSurviveRanges,
		confirmedSilenceRanges: [
			{
				startSourceSec: input.trimSourceStartSec,
				endSourceSec: input.trimSourceEndSec,
			},
		],
	});
	evidenceRefs.push(...speech.notes);
	if (speech.blocking) {
		blockingReasons.push(`speech_boundary:${speech.risk}`);
	}
	if (speech.risk === "near_speech_boundary") {
		warnings.push("near_speech_boundary");
	}
	if (speech.risk === "unknown") {
		warnings.push("speech_boundary_unknown");
	}

	const join = mapping.joinCompressedSec ?? 0;
	const windowBefore = RENDER_VERIFY_PAD_BEFORE_SEC;
	const windowAfter = RENDER_VERIFY_PAD_AFTER_SEC;
	const beforeTimes: number[] = [];
	const afterTimes: number[] = [];
	const n = RENDER_VERIFY_MAX_FRAMES_PER_SIDE;
	for (let i = n; i >= 1; i -= 1) {
		beforeTimes.push(Math.max(0, join - (windowBefore * i) / n));
	}
	for (let i = 1; i <= n; i += 1) {
		afterTimes.push(join + (windowAfter * i) / n);
	}

	const asset =
		input.afterDocument.assets.find((a) => a.id === input.assetId) ?? input.afterDocument.assets[0];
	const assetPath = asset?.originalPath ?? null;

	const tFrame0 = Date.now();
	const beforeBoundary: RenderedFrameEvidence[] = [];
	const afterBoundary: RenderedFrameEvidence[] = [];
	const preEditContext: RenderedFrameEvidence[] = [];

	let anySampleAttempted = false;
	let anySampleOk = false;

	for (const c of beforeTimes) {
		const sourceTimeSec =
			compressedToSource(input.afterDocument, c, input.assetId) ??
			mapping.sourceJustBefore ??
			input.trimSourceStartSec - 0.05;
		const frame = await sample(sampler, {
			role: "before_boundary",
			sourceTimeSec,
			compressedTimeSec: c,
			assetId: input.assetId,
			assetPath,
		});
		anySampleAttempted = true;
		if (!frame) {
			cacheMisses += 1;
			continue;
		}
		cacheMisses += 1;
		temporaryBytes += frame.byteLength ?? 0;
		beforeBoundary.push(frame);
		if (frame.valid && !frame.blank) anySampleOk = true;
		else if (frame.blank || !frame.valid)
			blockingReasons.push(`blank_or_invalid_before:${sourceTimeSec}`);
	}

	for (const c of afterTimes) {
		const sourceTimeSec =
			compressedToSource(input.afterDocument, c, input.assetId) ??
			mapping.sourceJustAfter ??
			input.trimSourceEndSec + 0.05;
		const frame = await sample(sampler, {
			role: "after_boundary",
			sourceTimeSec,
			compressedTimeSec: c,
			assetId: input.assetId,
			assetPath,
		});
		anySampleAttempted = true;
		if (!frame) {
			cacheMisses += 1;
			continue;
		}
		cacheMisses += 1;
		temporaryBytes += frame.byteLength ?? 0;
		afterBoundary.push(frame);
		if (frame.valid && !frame.blank) anySampleOk = true;
		else if (frame.blank || !frame.valid)
			blockingReasons.push(`blank_or_invalid_after:${sourceTimeSec}`);
	}

	// Pre-edit context: neighbors of the removal on the BEFORE document (source times).
	const prePoints = [
		Math.max(0, input.trimSourceStartSec - 0.25),
		Math.min(input.trimSourceEndSec + 0.25, asset?.durationSec ?? input.trimSourceEndSec + 1),
	];
	for (const sourceTimeSec of prePoints) {
		const frame = await sample(sampler, {
			role: "pre_edit_context",
			sourceTimeSec,
			assetId: input.assetId,
			assetPath,
		});
		anySampleAttempted = true;
		if (!frame) continue;
		temporaryBytes += frame.byteLength ?? 0;
		preEditContext.push(frame);
		if (frame.valid && !frame.blank) anySampleOk = true;
	}

	// Probe interior of removed range on AFTER mapping — should not yield programme source.
	// Frame sample at mid-trim source is for evidence of "what was removed" from pre-edit only.
	const removedProbe = await sample(sampler, {
		role: "removed_probe",
		sourceTimeSec: (input.trimSourceStartSec + input.trimSourceEndSec) / 2,
		assetId: input.assetId,
		assetPath,
	});
	if (removedProbe) {
		preEditContext.push({ ...removedProbe, role: "removed_probe" });
		temporaryBytes += removedProbe.byteLength ?? 0;
	}

	const frameRenderMs = Date.now() - tFrame0;
	const tVis0 = Date.now();

	const framesRendered = beforeBoundary.length + afterBoundary.length + preEditContext.length;

	const failClosed = input.failClosedIfUnavailable !== false;
	let qualityState: RenderVerifyQualityState;

	if (!anySampleAttempted || (framesRendered === 0 && !anySampleOk)) {
		compositorStatus = compositorStatus === "injected_sampler" ? "injected_sampler" : "unavailable";
		qualityState = "render_unavailable";
		blockingReasons.push("render_unavailable");
		if (!failClosed) {
			warnings.push("render_unavailable_non_fail_closed");
		}
	} else if (blockingReasons.length > 0) {
		qualityState = "render_verification_failed";
	} else if (warnings.length > 0) {
		qualityState = "verified_render_with_warnings";
	} else if (anySampleOk && mapping.removedAbsent && survival.ok && !speech.blocking) {
		qualityState = "verified_render_basic";
	} else {
		qualityState = "render_verification_failed";
		if (!anySampleOk) blockingReasons.push("no_valid_frames");
	}

	// Fail-closed: unavailable is blocking for consented preview.
	if (qualityState === "render_unavailable" && failClosed) {
		if (!blockingReasons.includes("render_unavailable")) {
			blockingReasons.push("render_unavailable");
		}
	}

	const visualVerificationMs = Date.now() - tVis0;
	const renderVerificationMs = Date.now() - tAll0;

	const evidence: RenderVerificationEvidence = {
		version: 1,
		providerId: RENDER_VERIFY_V1_PROVIDER_ID,
		proposalId: input.proposalId,
		beforeDocumentFingerprint: input.beforeDocumentFingerprint,
		afterDocumentFingerprint: input.afterDocumentFingerprint,
		editType: "trim",
		boundary: {
			timebaseSource: "SOURCE_MEDIA_TIME",
			sourceStartSec: input.trimSourceStartSec,
			sourceEndSec: input.trimSourceEndSec,
			compressedJoinSec: mapping.joinCompressedSec ?? undefined,
			resolvedTimelineBeforeSec: mapping.sourceJustBefore ?? undefined,
			resolvedTimelineAfterSec: mapping.sourceJustAfter ?? undefined,
			windowBeforeSec: windowBefore,
			windowAfterSec: windowAfter,
		},
		renderedSamples: {
			beforeBoundary,
			afterBoundary,
			preEditContext,
		},
		removedIntervalAbsentFromProgramme: mapping.removedAbsent,
		mustSurvivePresentInProgramme: survival.ok,
		speechBoundaryRisk: speech.risk,
		compositorStatus,
		qualityState,
		warnings: [...new Set(warnings)],
		blockingReasons: [...new Set(blockingReasons)],
		evidenceRefs: [...new Set(evidenceRefs)],
		framesRendered,
		temporaryBytes,
		cacheHits,
		cacheMisses,
		additionalModelCalls: 0,
		optionalSemanticModelCalls: 0,
		latencyMs: {
			renderSetupMs,
			frameRenderMs,
			audioBoundaryCheckMs: speech.checkMs,
			visualVerificationMs,
			mappingMs,
			renderVerificationMs,
		},
	};

	if (input.retainArtifacts && input.artifactDir) {
		writeDebugMeta(input.artifactDir, evidence);
	} else if (!input.retainArtifacts) {
		try {
			rmSync(workDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}

	return evidence;
}

export function renderVerifyPassed(evidence: RenderVerificationEvidence): boolean {
	return (
		evidence.qualityState === "verified_render_basic" ||
		evidence.qualityState === "verified_render_with_warnings"
	);
}

/**
 * Authoritative compositor verification for a single trim join.
 */

import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { analyzeTrimProgrammeMapping, mustSurviveInProgramme } from "../renderVerify/mapping";
import { assessSpeechBoundary } from "../renderVerify/speechBoundary";
import {
	RENDER_VERIFY_MAX_FRAMES_PER_SIDE,
	RENDER_VERIFY_PAD_AFTER_SEC,
	RENDER_VERIFY_PAD_BEFORE_SEC,
} from "../renderVerify/types";
import { assertSourceOutsideRemoved, locateProgrammeInstant } from "./programmeMap";
import { createInjectedCompositorSampler, NativeCompositorFrameSampler } from "./sampler";
import {
	COMPOSITOR_VERIFY_V1_PROVIDER_ID,
	type CompositedFrameResult,
	type CompositedFrameSampler,
	type CompositorVerifyQualityState,
	type FrameProviderKind,
} from "./types";

export interface CompositorTrimVerifyInput {
	proposalId: string;
	beforeDocumentFingerprint: string;
	afterDocumentFingerprint: string;
	trimSourceStartSec: number;
	trimSourceEndSec: number;
	assetId: string;
	afterDocument: AxcutDocument;
	beforeDocument: AxcutDocument;
	mustSurviveRanges: Array<{ id: string; startSourceSec: number; endSourceSec: number }>;
	/** Injected sampler for unit tests; production uses NativeCompositorFrameSampler. */
	sampler?: CompositedFrameSampler;
	/** When true, injected_test may count as authoritative (unit tests only). */
	allowInjectedAsAuthoritative?: boolean;
	failClosedIfUnavailable?: boolean;
	retainArtifacts?: boolean;
	artifactDir?: string;
	width?: number;
	height?: number;
}

export interface CompositorTrimVerifyEvidence {
	version: 1;
	providerId: typeof COMPOSITOR_VERIFY_V1_PROVIDER_ID;
	proposalId: string;
	qualityState: CompositorVerifyQualityState;
	frameProvider: FrameProviderKind | "mixed" | "none";
	authoritativeProviderRequired: "native_compositor";
	authoritativeSatisfied: boolean;
	ffmpegSourceUsedAsAuthoritative: false;
	audioContinuity: "NOT_VERIFIED";
	additionalModelCalls: 0;
	boundary: {
		compressedJoinSec: number | null;
		windowBeforeSec: number;
		windowAfterSec: number;
		trimSourceStartSec: number;
		trimSourceEndSec: number;
	};
	removedIntervalAbsentFromProgramme: boolean;
	mustSurvivePresentInProgramme: boolean;
	speechBoundaryRisk: string;
	frames: CompositedFrameResult[];
	warnings: string[];
	blockingReasons: string[];
	latencyMs: {
		compositorSetupMs: number;
		sceneBuildMs: number;
		presentMs: number;
		readFrameMs: number;
		exportMs: number;
		totalCompositorVerificationMs: number;
	};
	framesCaptured: number;
	frameBytes: number;
	backend: string;
}

export async function verifyTrimWithCompositor(
	input: CompositorTrimVerifyInput,
): Promise<CompositorTrimVerifyEvidence> {
	const t0 = Date.now();
	const warnings: string[] = [];
	const blockingReasons: string[] = [];
	const ownedSampler =
		input.sampler ??
		new NativeCompositorFrameSampler({
			retain: input.retainArtifacts,
			workDir: input.artifactDir,
		});
	const disposeOwned = !input.sampler;

	const mapping = analyzeTrimProgrammeMapping({
		after: input.afterDocument,
		assetId: input.assetId,
		trimStartSec: input.trimSourceStartSec,
		trimEndSec: input.trimSourceEndSec,
	});
	if (!mapping.removedAbsent) blockingReasons.push("removed_interval_still_in_programme");

	const survival = mustSurviveInProgramme({
		after: input.afterDocument,
		assetId: input.assetId,
		ranges: input.mustSurviveRanges,
	});
	if (!survival.ok) blockingReasons.push("must_survive_missing_from_programme");

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
	if (speech.blocking) blockingReasons.push(`speech_boundary:${speech.risk}`);
	if (speech.risk === "near_speech_boundary") warnings.push("near_speech_boundary");

	const join = mapping.joinCompressedSec ?? 0;
	const times: number[] = [];
	const n = RENDER_VERIFY_MAX_FRAMES_PER_SIDE;
	for (let i = n; i >= 1; i -= 1) {
		times.push(Math.max(0, join - (RENDER_VERIFY_PAD_BEFORE_SEC * i) / n));
	}
	times.push(join);
	for (let i = 1; i <= n; i += 1) {
		times.push(join + (RENDER_VERIFY_PAD_AFTER_SEC * i) / n);
	}

	// Must-survive representative programme points
	for (const r of input.mustSurviveRanges) {
		const mid = (r.startSourceSec + r.endSourceSec) / 2;
		const segs = input.afterDocument.timeline.clips;
		void segs;
		// Find programme time for mid source via locate inverse: scan instants
		const probeProg = findProgrammeTimeForSource(input.afterDocument, input.assetId, mid);
		if (probeProg != null) times.push(probeProg);
		else warnings.push(`must_survive_programme_unmapped:${r.id}`);
	}

	const frames: CompositedFrameResult[] = [];
	let setupMs = 0;
	let sceneMs = 0;
	let presentMs = 0;
	let readMs = 0;
	let exportMs = 0;
	let frameBytes = 0;
	let backend = "unknown";

	try {
		for (const programmeTimeSec of times) {
			const located = locateProgrammeInstant(input.afterDocument, programmeTimeSec);
			if (located) {
				if (
					!assertSourceOutsideRemoved(
						located.sourceTimeSec,
						input.trimSourceStartSec,
						input.trimSourceEndSec,
					)
				) {
					blockingReasons.push(`sampled_removed_source:${located.sourceTimeSec}`);
				}
			}
			const frame = await ownedSampler.sampleFrame({
				document: input.afterDocument,
				programmeTimeSec,
				width: input.width,
				height: input.height,
			});
			frames.push(frame);
			setupMs += frame.latencyMs.compositorSetupMs;
			sceneMs += frame.latencyMs.sceneBuildMs;
			presentMs += frame.latencyMs.presentMs;
			readMs += frame.latencyMs.readFrameMs;
			exportMs += frame.latencyMs.exportMs;
			frameBytes += frame.byteLength;
			backend = frame.compositorBackend;
			// Drop raw pixels from retained evidence (stats already computed).
			delete frame.rgba;
			if (frame.status === "unavailable") {
				blockingReasons.push("compositor_frame_unavailable");
			} else if (
				frame.status === "invalid" ||
				frame.status === "empty" ||
				frame.status === "error"
			) {
				blockingReasons.push(`compositor_frame_${frame.status}`);
			} else if (frame.pixelStats && !frame.pixelStats.valid) {
				blockingReasons.push("pixel_validation_failed");
			}
		}
	} finally {
		if (disposeOwned) {
			await Promise.resolve(ownedSampler.dispose?.());
		}
	}

	const providers = new Set(frames.map((f) => f.frameProvider));
	const frameProvider: CompositorTrimVerifyEvidence["frameProvider"] =
		providers.size === 0
			? "none"
			: providers.size === 1
				? ([...providers][0] as FrameProviderKind)
				: "mixed";

	const hasNativeOk = frames.some(
		(f) => f.frameProvider === "native_compositor" && f.status === "ok",
	);
	const injectedFrames = frames.filter((f) => f.frameProvider === "injected_test");
	const injectedContext = input.allowInjectedAsAuthoritative === true && injectedFrames.length > 0;
	const hasInjectedOk = injectedContext && injectedFrames.some((f) => f.status === "ok");
	const injectedAllUnavailable =
		injectedContext && injectedFrames.every((f) => f.status === "unavailable");

	const authoritativeSatisfied = hasNativeOk || hasInjectedOk;
	if (frames.some((f) => f.frameProvider === "ffmpeg_source" && f.status === "ok")) {
		warnings.push("ffmpeg_source_present_but_not_authoritative");
	}

	const frameInvalid = frames.some(
		(f) =>
			f.status === "invalid" ||
			f.status === "empty" ||
			f.status === "error" ||
			(f.pixelStats && !f.pixelStats.valid),
	);

	const contentBlocks = [
		...(!mapping.removedAbsent ? ["removed_interval_still_in_programme"] : []),
		...(!survival.ok ? ["must_survive_missing_from_programme"] : []),
		...(speech.blocking ? [`speech_boundary:${speech.risk}`] : []),
		...(frameInvalid ? ["compositor_frame_invalid"] : []),
		...blockingReasons.filter((b) => b.startsWith("sampled_removed_source")),
	];
	const uniqueContentBlocks = [...new Set(contentBlocks)];

	let qualityState: CompositorVerifyQualityState;
	if (injectedAllUnavailable || (!authoritativeSatisfied && !injectedContext)) {
		qualityState = "compositor_unavailable";
		blockingReasons.push("authoritative_native_compositor_required");
	} else if (!authoritativeSatisfied && injectedContext && frameInvalid) {
		qualityState = "compositor_verification_failed";
		blockingReasons.push(...uniqueContentBlocks);
	} else if (uniqueContentBlocks.length > 0) {
		qualityState = "compositor_verification_failed";
		blockingReasons.push(...uniqueContentBlocks);
	} else if (!authoritativeSatisfied) {
		qualityState = "compositor_unavailable";
		blockingReasons.push("authoritative_native_compositor_required");
	} else if (warnings.length > 0) {
		qualityState = "verified_compositor_with_warnings";
	} else {
		qualityState = "verified_compositor_basic";
	}

	return {
		version: 1,
		providerId: COMPOSITOR_VERIFY_V1_PROVIDER_ID,
		proposalId: input.proposalId,
		qualityState,
		frameProvider,
		authoritativeProviderRequired: "native_compositor",
		authoritativeSatisfied,
		ffmpegSourceUsedAsAuthoritative: false,
		audioContinuity: "NOT_VERIFIED",
		additionalModelCalls: 0,
		boundary: {
			compressedJoinSec: mapping.joinCompressedSec,
			windowBeforeSec: RENDER_VERIFY_PAD_BEFORE_SEC,
			windowAfterSec: RENDER_VERIFY_PAD_AFTER_SEC,
			trimSourceStartSec: input.trimSourceStartSec,
			trimSourceEndSec: input.trimSourceEndSec,
		},
		removedIntervalAbsentFromProgramme: mapping.removedAbsent,
		mustSurvivePresentInProgramme: survival.ok,
		speechBoundaryRisk: speech.risk,
		frames,
		warnings: [...new Set(warnings)],
		blockingReasons: [...new Set(blockingReasons)],
		latencyMs: {
			compositorSetupMs: setupMs,
			sceneBuildMs: sceneMs,
			presentMs,
			readFrameMs: readMs,
			exportMs,
			totalCompositorVerificationMs: Date.now() - t0,
		},
		framesCaptured: frames.filter((f) => f.status === "ok").length,
		frameBytes,
		backend,
	};
}

function findProgrammeTimeForSource(
	doc: AxcutDocument,
	assetId: string,
	sourceTimeSec: number,
): number | null {
	const segs = resolvePlaybackSegments(doc.timeline.clips, doc.timeline.trimRanges).filter(
		(s) => s.assetId === assetId,
	);
	for (const s of segs) {
		const end = s.sourceEndSec ?? s.sourceStartSec;
		if (sourceTimeSec >= s.sourceStartSec - 1e-9 && sourceTimeSec < end - 1e-9) {
			return s.timelineStartSec + (sourceTimeSec - s.sourceStartSec);
		}
	}
	return null;
}

export function compositorVerifyPassed(ev: CompositorTrimVerifyEvidence): boolean {
	return (
		ev.qualityState === "verified_compositor_basic" ||
		ev.qualityState === "verified_compositor_with_warnings"
	);
}

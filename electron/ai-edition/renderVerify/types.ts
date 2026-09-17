/**
 * Render Verification V1 — post-edit perceptual/mapping check for a single trim.
 * Identity: CURRENT_OPENSCREEN_RENDER_VERIFY_V1
 *
 * Extends Apply Preview verification. Does not mutate. 0 required LLM calls.
 */

export const RENDER_VERIFY_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_RENDER_VERIFY_V1";

/** Bounded window around compressed join (seconds). */
export const RENDER_VERIFY_PAD_BEFORE_SEC = 0.75;
export const RENDER_VERIFY_PAD_AFTER_SEC = 0.75;
/** Max frames per side of the join. */
export const RENDER_VERIFY_MAX_FRAMES_PER_SIDE = 3;
/** Interior speech cut is blocking. */
export const SPEECH_BOUNDARY_EPSILON_SEC = 0.05;

export type RenderVerifyQualityState =
	| "verified_structural_only"
	| "verified_render_basic"
	| "verified_render_with_warnings"
	| "render_verification_failed"
	| "render_unavailable"
	| "not_run";

export type SpeechBoundaryRisk =
	| "safe_silence_boundary"
	| "near_speech_boundary"
	| "inside_active_speech"
	| "inside_protected_speech"
	| "unknown";

export type CompositorSampleStatus =
	| "native_compositor"
	| "ffmpeg_source_stills"
	| "injected_sampler"
	| "mapping_only"
	| "unavailable";

export interface RenderedFrameEvidence {
	role: "before_boundary" | "after_boundary" | "pre_edit_context" | "removed_probe";
	/** SOURCE_MEDIA_TIME sample point. */
	sourceTimeSec: number;
	/** COMPRESSED programme time when known. */
	compressedTimeSec?: number;
	valid: boolean;
	blank: boolean;
	width?: number;
	height?: number;
	byteLength?: number;
	meanLuma?: number;
	path?: string;
	note?: string;
}

export interface RenderVerificationBoundary {
	timebaseSource: "SOURCE_MEDIA_TIME";
	sourceStartSec: number;
	sourceEndSec: number;
	/** Compressed programme time of the join after trim. */
	compressedJoinSec?: number;
	resolvedTimelineBeforeSec?: number;
	resolvedTimelineAfterSec?: number;
	windowBeforeSec: number;
	windowAfterSec: number;
}

export interface RenderVerificationEvidence {
	version: 1;
	providerId: typeof RENDER_VERIFY_V1_PROVIDER_ID;
	proposalId: string;
	beforeDocumentFingerprint: string;
	afterDocumentFingerprint: string;
	editType: "trim";
	boundary: RenderVerificationBoundary;
	renderedSamples: {
		beforeBoundary: RenderedFrameEvidence[];
		afterBoundary: RenderedFrameEvidence[];
		preEditContext: RenderedFrameEvidence[];
	};
	removedIntervalAbsentFromProgramme: boolean;
	mustSurvivePresentInProgramme: boolean;
	speechBoundaryRisk: SpeechBoundaryRisk;
	compositorStatus: CompositorSampleStatus;
	qualityState: RenderVerifyQualityState;
	warnings: string[];
	blockingReasons: string[];
	evidenceRefs: string[];
	framesRendered: number;
	temporaryBytes: number;
	cacheHits: number;
	cacheMisses: number;
	additionalModelCalls: 0;
	optionalSemanticModelCalls: 0;
	latencyMs: {
		renderSetupMs: number;
		frameRenderMs: number;
		audioBoundaryCheckMs: number;
		visualVerificationMs: number;
		mappingMs: number;
		renderVerificationMs: number;
	};
}

export interface RenderFrameSampleRequest {
	role: RenderedFrameEvidence["role"];
	sourceTimeSec: number;
	compressedTimeSec?: number;
	assetId: string;
	assetPath: string | null;
}

/**
 * Injected / pluggable sampler. Production may use ffmpeg or native compositor.
 * Tests inject deterministic samples. Returning null means sample failed.
 */
export type RenderFrameSampler = (
	req: RenderFrameSampleRequest,
) => RenderedFrameEvidence | null | Promise<RenderedFrameEvidence | null>;

export interface RenderVerifyInput {
	proposalId: string;
	beforeDocumentFingerprint: string;
	afterDocumentFingerprint: string;
	trimSourceStartSec: number;
	trimSourceEndSec: number;
	assetId: string;
	clipId?: string;
	/** Post-edit document. */
	afterDocument: import("../../../src/lib/ai-edition/schema").AxcutDocument;
	/** Pre-edit document (for pre-edit context samples). */
	beforeDocument: import("../../../src/lib/ai-edition/schema").AxcutDocument;
	mustSurviveRanges: Array<{
		id: string;
		startSourceSec: number;
		endSourceSec: number;
		text?: string;
	}>;
	/** Optional sampler; if omitted, attempts ffmpeg then marks unavailable. */
	sampleFrame?: RenderFrameSampler;
	/** When true, treat missing sampler/media as fail-closed unavailable. Default true. */
	failClosedIfUnavailable?: boolean;
	/** Retain temp frame paths (benchmark). Default false → cleanup. */
	retainArtifacts?: boolean;
	artifactDir?: string;
}

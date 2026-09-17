/**
 * Offscreen Native Compositor Verification V1
 * Identity: CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1
 *
 * Authoritative visual samples come from OpenScreen's native compositor
 * (live readFrame and/or bounded exportMulti — same walk_composited_timeline).
 * ffmpeg source stills are diagnostics only and never upgrade status.
 */

export const COMPOSITOR_VERIFY_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_COMPOSITOR_VERIFY_V1";

export type FrameProviderKind = "native_compositor" | "ffmpeg_source" | "injected_test";

export type CompositorVerifyQualityState =
	| "verified_compositor_basic"
	| "verified_compositor_with_warnings"
	| "compositor_verification_failed"
	| "compositor_unavailable"
	| "not_run";

export type CompositorBackendLabel = "hardware" | "cpu" | "none" | "unknown" | "injected";

export interface CompositedFrameResult {
	evidenceId: string;
	/** COMPRESSED_PROGRAMME_TIME requested. */
	requestedProgrammeTimeSec: number;
	/** Actual SOURCE_MEDIA_TIME presented to compositor when known. */
	actualSourceTimeSec?: number;
	/** Provenance: which source span this programme instant maps to. */
	sourceProvenance?: {
		assetId: string;
		clipId: string;
		sourceStartSec: number;
		sourceEndSec: number;
	};
	width: number;
	height: number;
	/** RGBA8 tightly packed. */
	pixelFormat: "rgba8";
	/** Raw pixels; may be omitted after validation to save memory. */
	rgba?: Uint8Array;
	byteLength: number;
	frameProvider: FrameProviderKind;
	compositorBackend: CompositorBackendLabel;
	capturePath: "live_readFrame" | "bounded_exportMulti" | "injected";
	status: "ok" | "empty" | "invalid" | "unavailable" | "error";
	error?: string;
	latencyMs: {
		sceneBuildMs: number;
		compositorSetupMs: number;
		presentMs: number;
		readFrameMs: number;
		exportMs: number;
		decodeMs: number;
		perFrameMs: number;
	};
	pixelStats?: PixelStats;
}

export interface PixelStats {
	meanLuma: number;
	lumaVariance: number;
	nearBlackFraction: number;
	nearTransparentFraction: number;
	uniqueApproxBuckets: number;
	uniform: boolean;
	entirelyTransparent: boolean;
	valid: boolean;
	/** Dark but non-uniform content — not a blank failure. */
	darkButValid: boolean;
}

export interface CompositedFrameSampleRequest {
	document: import("../../../src/lib/ai-edition/schema").AxcutDocument;
	/** COMPRESSED_PROGRAMME_TIME */
	programmeTimeSec: number;
	width?: number;
	height?: number;
}

export interface CompositedFrameSampler {
	readonly providerKind: FrameProviderKind;
	sampleFrame(input: CompositedFrameSampleRequest): Promise<CompositedFrameResult>;
	dispose?(): Promise<void> | void;
}

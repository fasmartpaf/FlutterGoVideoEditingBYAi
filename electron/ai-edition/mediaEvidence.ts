// Explicit evidence channels available to the in-app agent for one turn.
// visualFrames is true only when pixel/image content was actually supplied to
// the model on this turn — never because a video path or mediaContext exists.

import type { AxcutDocument } from "../../src/lib/ai-edition/schema";

export interface MediaEvidenceCapabilities {
	/** Facts from AxcutDocument (clips, trims, zooms, settings, …). Always true. */
	timelineMetadata: true;
	/** Recorded pointer track available for at least one asset this turn. */
	cursorTelemetry: boolean;
	/** Speech transcript present for at least one asset. */
	transcript: boolean;
	/**
	 * A decodable audio stream was probed on at least one target asset this turn.
	 * null/absent when not probed. Never inferred from STT failure.
	 */
	audioStream?: boolean | null;
	/**
	 * Speech evidence status for the primary/timeline target this turn.
	 * Distinct from audioStream and from transcript boolean.
	 */
	speechStatus?:
		| "available"
		| "no_speech_detected"
		| "unavailable"
		| "failed"
		| "no_audio"
		| "not_requested";
	/**
	 * Actual image/frame content was attached to the model for this turn.
	 * A path in visibleMedia, filmstrip UI cells, or mediaContext text do NOT count.
	 */
	visualFrames: boolean;
	/**
	 * Named UI control / OCR / a11y / DOM grounding of what the pointer hit.
	 * Cursor coordinates alone never make this true.
	 * Opportunistic model-read text from supplied frames is NOT semanticUi.
	 */
	semanticUi: boolean;
	/**
	 * Turn-local AI visual-semantic grounding scaffold is available (frames +
	 * structured observation instructions). Not a durable verified UI index.
	 * Always false when visualFrames is false. Never implies semanticUi.
	 */
	visualSemanticEvidence: boolean;
	/**
	 * Turn-local Source Story scaffold was requested this turn (mediaUnderstanding /
	 * editingContext). Internal chronological meaning — not Target Story / edits.
	 * Never persisted to .openscreen.
	 */
	sourceStory?: boolean;
	/**
	 * Turn-local Target Story instructions were requested this turn (editingContext).
	 * Desired viewer experience — not an edit plan / tool list. Never persisted.
	 */
	targetStory?: boolean;
}

export interface MediaEvidenceOptions {
	/** Per-asset probe results from getCursorTrack / pre-turn probe. */
	cursorTelemetryAvailableByAssetId?: Record<string, boolean>;
	/**
	 * Set only when this turn has proven pixel/image content was supplied to the
	 * model (e.g. multimodal parts). Local-CLI ffmpeg stills inside a subprocess
	 * do not count unless those images are also attached here.
	 */
	visualFramesSupplied?: boolean;
	audioStream?: boolean | null;
	speechStatus?: MediaEvidenceCapabilities["speechStatus"];
	/** True when SOURCE_STORY scaffold/instructions were attached this turn. */
	sourceStoryRequested?: boolean;
	/** True when TARGET_STORY instructions were attached this turn. */
	targetStoryRequested?: boolean;
}

function assetHasTranscript(document: AxcutDocument, assetId: string): boolean {
	const row =
		document.transcripts.find((t) => t.assetId === assetId) ??
		(document.transcript?.assetId === assetId ? document.transcript : null);
	if (!row) return false;
	if (Array.isArray(row.segments) && row.segments.length > 0) return true;
	if (Array.isArray(row.words) && row.words.length > 0) return true;
	return false;
}

/** Deterministic evidence flags for the agent snapshot / system contract. */
export function buildMediaEvidenceCapabilities(
	document: AxcutDocument,
	options?: MediaEvidenceOptions,
): MediaEvidenceCapabilities {
	const availability = options?.cursorTelemetryAvailableByAssetId;
	const cursorTelemetry = Boolean(
		availability && Object.values(availability).some((v) => v === true),
	);
	const transcript = document.assets.some((a) => assetHasTranscript(document, a.id));
	const visualFrames = options?.visualFramesSupplied === true;
	return {
		timelineMetadata: true,
		cursorTelemetry,
		transcript,
		...(options?.audioStream !== undefined ? { audioStream: options.audioStream } : {}),
		...(options?.speechStatus !== undefined ? { speechStatus: options.speechStatus } : {}),
		// Default false. Never infer from paths, mediaContext, or UI thumbnails.
		visualFrames,
		semanticUi: false,
		// Scaffold only when real frames are on this turn — still not semanticUi.
		visualSemanticEvidence: visualFrames,
		...(options?.sourceStoryRequested === true ? { sourceStory: true } : {}),
		...(options?.targetStoryRequested === true ? { targetStory: true } : {}),
	};
}

/** Short contract text embedded next to mediaCapabilities in the snapshot. */
export const MEDIA_EVIDENCE_NOTE = [
	"mediaCapabilities lists which evidence channels you have THIS turn.",
	"timelineMetadata: AxcutDocument facts (durations, clips, trims, zooms, annotations, aspect, …).",
	"cursorTelemetry: pointer samples (coordinates / shape / timing) — not named UI controls.",
	"transcript: speech text from STT when present. Missing transcript ≠ missing audio.",
	"audioStream: decodable audio track probed when present. STT unavailable ≠ no audio.",
	"speechStatus: available | no_speech_detected | unavailable | failed | no_audio | not_requested — never collapse these.",
	"visualFrames: true only if pixel/image content was supplied to you this turn (timestamped VISUAL EVIDENCE JPEGs). visibleMedia and mediaContext are NOT visualFrames.",
	"visualSemanticEvidence: true when visualFrames is true and you should emit turn-local structured VISUAL_SEMANTIC_GROUNDING JSON from those frames for INTERNAL use. Do NOT show that JSON to the user unless they explicitly ask for raw/structured data.",
	"sourceStory: true when this turn requested an INTERNAL SOURCE_STORY JSON block (chronological communication meaning). Not Target Story, not an edit plan. Do NOT show SOURCE_STORY JSON to the user unless they ask for raw/structured data.",
	"targetStory: true when this turn requested an INTERNAL TARGET_STORY JSON block (desired viewer experience / editorial direction after SOURCE_STORY). Not trim/zoom/tool commands, not edit execution. Do NOT show TARGET_STORY JSON to the user unless they ask for raw/structured data.",
	"semanticUi: named control / OCR / a11y grounding. Always false unless such evidence exists. Opportunistic text visible in a supplied frame is not semanticUi.",
	"Speech describes what was SAID, not what was clicked. Never treat spoken words as proof of a named UI action without matching visual/cursor evidence.",
	"mediaContext is a textual/derived outline (kept spans, speech/silence parts, stored notes) — not pixels.",
	"visibleMedia is a file inventory (ids/paths). Presence of a recording does not mean you inspected its frames.",
	"Prefer getTranscriptRange for speech near a visual moment. Do not dump enormous full transcripts into every reply as JSON.",
].join(" ");

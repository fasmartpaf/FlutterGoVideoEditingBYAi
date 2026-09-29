// Agent tool layer (P1.1/P1.2): the zod argument schemas — the single source of
// truth, shared with the LangChain `tool()`s built in `deep-agent/service.ts` —
// plus the executor that validates arguments and applies each tool against an
// AxcutDocument snapshot. Pure — no IPC, no fs. The chat-service tool loop owns
// checkpoints and persistence; this module only knows how to turn
// (document, toolName, argsJson) into a new document.
//
// Read tools return JSON the model can reason over; write tools return the
// mutated document plus a human-readable summary line for the chat panel
// ("applied: added trim 0:02.1 – 0:02.4").
//
// The PROSE the model reads lives in `TOOL_DESCRIPTIONS` (deep-agent/service.ts)
// — not here. This header used to claim the file held "the JSON-schema tool
// definitions fed to the LLM as tools[]", which stopped being true when the
// deep-agent landed and stayed on the page for a whole release; the specs it
// described are gone (see `MUTATING_TOOL_NAMES`).

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import {
	collapseTracksToPills,
	patchAudioTrack,
	placeAudioTrackInDocument,
	trackGroupId,
} from "../../src/lib/ai-edition/document/audioTracks";
import {
	assertImageDataUri,
	GRAPHIC_KINDS,
	graphicCaption,
	isImageDataUri,
	loadImageFileAsDataUri,
	renderPlatePng,
	resolveGraphic,
} from "../../src/lib/ai-edition/document/graphicPlate";
import { createId } from "../../src/lib/ai-edition/document/ids";
import { buildMediaContext } from "../../src/lib/ai-edition/document/mediaContext";
import { resolveFfmpeg } from "../media/audioPeaks";
import {
	duplicateClip,
	insertClip,
	moveClip,
	openTimelineMedia,
	planTimelineReplacement,
	type RegionKind,
	removeClip,
	removeRegion,
	replaceTimeline,
	resolvePlaybackSegments,
	setClipCropRegion,
	setClipSourceRange,
	splitClip,
} from "../../src/lib/ai-edition/document/timeline";
import {
	getCaptionSettings,
	patchCaptionSettings,
} from "../../src/lib/ai-edition/captions/settings";
import {
	getEditorSettings,
	patchEditorSettings,
	type EditorSettingsPatch,
} from "../../src/lib/ai-edition/store/editorSettings";
import { setDocumentWordText } from "../../src/lib/ai-edition/document/transcript";
import { type AxcutDocument, clipCropRegionSchema } from "../../src/lib/ai-edition/schema";
import { hasAnyClipWithCamera } from "../../src/lib/ai-edition/timeline/camera";
import { isGeneratedAssetId } from "../../src/lib/ai-edition/timeline/clip-parts";
import {
	buildCursorTrack,
	type CursorTrackSample,
} from "../../src/lib/ai-edition/timeline/cursor-track";
import {
	anchorRegionsWithDerivedMs,
	coalesceRegionsForRuler,
	replacePillSpan,
	resolvePillIds,
} from "../../src/lib/ai-edition/timeline/timelineMap";
import { trimAppliesToClip } from "../../src/lib/ai-edition/timeline/trim-mapping";
// ponytail: relative, and it has to stay that way — `electron/` never resolves
// the `@/` alias (the main-process build does not declare it), which is why the
// scale table was moved out of `components/video-editor/types.ts` to be
// reachable from here at all.
import {
	effectiveZoomScale,
	ZOOM_DEPTH_LEGEND,
} from "../../src/lib/ai-edition/timeline/zoom-scale";
import {
	buildMediaEvidenceCapabilities,
	MEDIA_EVIDENCE_NOTE,
	type MediaEvidenceCapabilities,
} from "./mediaEvidence";
import { type PreparedToolMedia, resolveGeneratedGraphicsDir } from "./agentToolMedia";
import { assertSafeLocalMediaPath } from "./mediaStudio";
import { findStartThumbnailClip, insertStartThumbnailClip } from "./startThumbnail";
import { brandKitPatchSchema, readBrandKit, storedBrandKit, writeBrandKit } from "./motionStudio/brandKit";

/** First graphic in a project without a brand kit: keep the colours it was drawn with (the video's). */
function withVideoBrandKit(document: AxcutDocument, prepared: PreparedToolMedia | undefined): AxcutDocument {
	if (storedBrandKit(document) || !prepared?.videoBrandKit) return document;
	return writeBrandKit(document, prepared.videoBrandKit).document;
}
import { type MotionPlacement, placeMotionClip } from "./motionStudio/placement";
import {
	MOTION_TEMPLATE_IDS,
	OVERLAY_DEFAULT_SEC,
	OVERLAY_DESCRIPTIONS,
	OVERLAY_TEMPLATE_IDS,
	TEMPLATE_DEFAULT_SEC,
	TEMPLATE_DESCRIPTIONS,
} from "./motionStudio/templates";
import { encodeImageSequenceRef } from "../../src/lib/ai-edition/document/imageSequence";
import {
	BUILTIN_CHARACTERS,
	listCharactersCatalog,
	registerCharacterOnDocument,
	resolveCharacterImage,
} from "./characterLibrary";
import { mutationAuthorityRefusal } from "./mutationAuthority";
import {
	legacyKindToTransitionId,
	listUserAvailableTransitions,
	resolveTransitionId,
	type GpuBackend,
	validateAndClampTransitionApply,
} from "./transitionLibrary";

const BUILTIN_CHARACTER_LABELS = new Set(BUILTIN_CHARACTERS.map((c) => c.label));

function defaultGpuBackend(): GpuBackend {
	if (process.platform === "darwin") return "metal";
	if (process.platform === "win32") return "d3d11";
	return "wgpu";
}

export interface AgentToolExecution {
	ok: boolean;
	/** JSON payload returned to the model as the tool result. */
	resultJson: string;
	/** Updated document — only set when the tool mutated it. */
	document?: AxcutDocument;
	/** One-line human summary for the chat panel (mutating tools only). */
	summary?: string;
}

function formatSec(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return "0:00.0";
	const m = Math.floor(sec / 60);
	const s = (sec % 60).toFixed(1);
	return `${m}:${s.padStart(4, "0")}`;
}

function toMs(sec: number): number {
	return Math.max(0, Math.round(sec * 1000));
}

function slugLabel(label: string): string {
	return (
		label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "graphic"
	);
}

function maybeWriteGeneratedGraphic(
	dir: string,
	stem: string,
	dataUri: string,
): string | null {
	if (!dataUri.startsWith("data:image")) return null;
	const comma = dataUri.indexOf(",");
	if (comma < 0) return null;
	try {
		mkdirSync(dir, { recursive: true });
		const path = join(dir, `${stem}.png`);
		writeFileSync(path, Buffer.from(dataUri.slice(comma + 1), "base64"));
		return path;
	} catch {
		// Fallback when the project folder is not writable. Keep the project
		// folder name so two projects never overwrite each other's beat-1.png.
		try {
			const fallback = join(tmpdir(), "openscreen-generated-graphics", basename(dir), stem);
			mkdirSync(dirname(fallback), { recursive: true });
			const path = `${fallback}.png`;
			writeFileSync(path, Buffer.from(dataUri.slice(comma + 1), "base64"));
			return path;
		} catch {
			return null;
		}
	}
}

// For the effect set* tools: keep the stored span unless the caller passes new
// edges, and normalise so start ≤ end. Input seconds are virtual-timeline time.
function resolveSpanMs(
	existing: { startMs: number; endMs: number },
	startSec: number | undefined,
	endSec: number | undefined,
): { startMs: number; endMs: number } {
	if (startSec === undefined && endSec === undefined) {
		return { startMs: existing.startMs, endMs: existing.endMs };
	}
	const s = startSec ?? existing.startMs / 1000;
	const e = endSec ?? existing.endMs / 1000;
	return { startMs: toMs(Math.min(s, e)), endMs: toMs(Math.max(s, e)) };
}

// v5: a modifier is stored as clip-anchored fragment(s), and adjacent regions with the
// same properties read as ONE pill (timelineMap merge rule). The agent reasons in VIRTUAL
// seconds over whole regions, so we present exactly the pills the user sees, keyed by the
// first region under each — which every set*/remove* tool accepts as the id.
function coalesceForAgent<T extends { id: string; startMs: number; endMs: number }>(
	regions: T[],
): T[] {
	return coalesceRegionsForRuler(regions).map((pill) => ({
		...pill.member,
		id: pill.ids[0],
		startMs: Math.round(pill.start * 1000),
		endMs: Math.round(pill.end * 1000),
	}));
}

/** Every agent write anchors the region to the clip(s) it covers, exactly like the UI. */
function anchorForAgent<T extends { id: string; startMs: number; endMs: number }>(
	region: T,
	document: AxcutDocument,
	prefix: string,
) {
	return anchorRegionsWithDerivedMs([region], document.timeline.clips, () => createId(prefix));
}

// ─── What the write actually LANDED ────────────────────────────────────────
//
// ponytail: every add*/set* used to echo back the span it was ASKED for. Three
// ways that is a lie, all reproduced against the real fixtures:
//   • CLAMP — `addZoom {20,40}` on a 24.70 s clip stores 20–24.704 and reported
//     20–40. Ventilation trims the span to the clip, silently.
//   • FRAGMENTATION — `addZoom {25,35}` across two clips stores TWO fragments,
//     the second with a brand-new id (`anchorRawRegionsToClips:74`), and the
//     result named one id and one span.
//   • NOTHING PLACED — `addZoom {90,95}` on a 24.70 s timeline covers no clip.
//     `anchorRegionsWithDerivedMs` passes it through UNANCHORED by design
//     (timelineMap.ts:360-375, so a v2 project with a zero-extent clip does not
//     lose data), and it was stored, reported ok, and can never play.
// The document is the referee; the report is read back off it.

interface Landing {
	/** Every id the write produced — more than one when it straddled a clip. */
	ids: string[];
	startSec: number;
	endSec: number;
	/** False when nothing covered a clip: the region cannot ever play. */
	anchored: boolean;
	fragments: number;
}

function overlapsAClip(
	region: { startMs: number; endMs: number },
	document: AxcutDocument,
): boolean {
	const startSec = region.startMs / 1000;
	const endSec = region.endMs / 1000;
	return document.timeline.clips.some(
		(c) => Math.min(endSec, c.timelineEndSec) - Math.max(startSec, c.timelineStartSec) > 0,
	);
}

/**
 * `anchored` is BOTH structural and positional on purpose. `replacePillSpan`
 * re-anchors from `pill.member`, whose payload still carries the OLD `clipId`
 * even when the new span covers nothing — so a `clipId` alone proves nothing
 * about where the region ended up. The ruler overlap is what decides whether a
 * viewer will ever see it.
 */
function landingOf(
	regions: Array<{ id: string; startMs: number; endMs: number; clipId?: string }>,
	document: AxcutDocument,
): Landing {
	const starts = regions.map((r) => r.startMs);
	const ends = regions.map((r) => r.endMs);
	return {
		ids: regions.map((r) => r.id),
		startSec: regions.length ? Math.min(...starts) / 1000 : 0,
		endSec: regions.length ? Math.max(...ends) / 1000 : 0,
		anchored:
			regions.length > 0 &&
			regions.every((r) => typeof r.clipId === "string" && overlapsAClip(r, document)),
		fragments: regions.length,
	};
}

/** The regions a pill edit produced: everything in `after` that is not an
 * untouched original. `replacePillSpan` re-ventilates the pill, so the count and
 * the ids can both change under a caller that only passed one id. */
function landingAfterPillEdit<T extends { id: string; startMs: number; endMs: number }>(
	before: T[],
	after: T[],
	pillIds: Set<string>,
	document: AxcutDocument,
): Landing {
	const untouched = new Set(before.filter((r) => !pillIds.has(r.id)).map((r) => r.id));
	return landingOf(
		after.filter((r) => !untouched.has(r.id)) as Array<T & { clipId?: string }>,
		document,
	);
}

/**
 * Refuse a full-camera region on footage that carries no webcam.
 *
 * ponytail: `addCameraFullscreen` took a span and nothing else, and answered
 * `ok: true` whether or not any camera existed anywhere in the project — it
 * writes into `legacyEditor.cameraFullscreenRegions`, which the schema does not
 * validate. A pair of scenarios identical but for a linked webcam produced
 * identical turns, because the evidence really was identical. The snapshot now
 * carries `hasCameraTrack`, and this is the other half: a region that can only
 * render nothing is not written, and the refusal names the reason.
 */
function cameraUnderSpan(
	document: AxcutDocument,
	startSec: number,
	endSec: number,
): { clips: number; withCamera: number } {
	const covered = document.timeline.clips.filter(
		(c) => Math.min(endSec, c.timelineEndSec) - Math.max(startSec, c.timelineStartSec) > 0,
	);
	return {
		clips: covered.length,
		withCamera: covered.filter(
			(c) => document.assets.find((a) => a.id === c.assetId)?.cameraTrack != null,
		).length,
	};
}

function noCameraUnderSpan(
	document: AxcutDocument,
	startSec: number,
	endSec: number,
): AgentToolExecution | null {
	const coverage = cameraUnderSpan(document, startSec, endSec);
	if (coverage.clips === 0 || coverage.withCamera > 0) return null;
	const anywhere = hasAnyClipWithCamera(document.assets, document.timeline.clips);
	return failure(
		`No webcam is linked to the footage under ${startSec.toFixed(1)}–${endSec.toFixed(1)} s, ` +
			"so a full-camera region there would render nothing and none was written. " +
			(anywhere
				? "Other clips in this project do carry a camera — check assets[].hasCameraTrack in getCurrentDocument and pick a span over one of those."
				: "No asset in this project carries a cameraTrack at all (assets[].hasCameraTrack is false everywhere): this recording has no webcam. Tell the user instead of placing a region."),
	);
}

/** The span the edited timeline actually occupies, for an actionable refusal. */
function editedExtentSec(document: AxcutDocument): { startSec: number; endSec: number } {
	const clips = document.timeline.clips;
	if (clips.length === 0) return { startSec: 0, endSec: 0 };
	return {
		startSec: Math.min(...clips.map((c) => c.timelineStartSec)),
		endSec: Math.max(...clips.map((c) => c.timelineEndSec)),
	};
}

const PRIVACY_PRESET_RECTS: Record<
	"topStrip" | "topRight" | "bottomRight" | "fullFrame",
	{ x: number; y: number; width: number; height: number }
> = {
	topStrip: { x: 0, y: 0, width: 100, height: 14 },
	topRight: { x: 58, y: 0, width: 42, height: 16 },
	bottomRight: { x: 68, y: 72, width: 32, height: 28 },
	fullFrame: { x: 0, y: 0, width: 100, height: 100 },
};

/**
 * Refuse rather than store a region that covers no clip. The message carries the
 * real bounds so the model can retry once with a usable span instead of looping
 * — there is no AbortSignal and no timeout on the product path.
 */
function coversNoClip(
	kind: string,
	requestedStartSec: number,
	requestedEndSec: number,
	document: AxcutDocument,
): AgentToolExecution {
	const extent = editedExtentSec(document);
	return failure(
		`The span ${requestedStartSec.toFixed(1)}–${requestedEndSec.toFixed(1)} s covers no clip, ` +
			`so no ${kind} was placed (it could never play). The edited timeline runs ` +
			`${extent.startSec.toFixed(1)}–${extent.endSec.toFixed(1)} s. ` +
			`Pick a span inside it, or place a clip there first.`,
	);
}

function commitAnnotation(
	document: AxcutDocument,
	ann: Record<string, unknown>,
	startMs: number,
	endMs: number,
	summary: string,
): AgentToolExecution {
	const placed = anchorForAgent(
		{ ...ann, id: createId("ann"), startMs, endMs } as {
			id: string;
			startMs: number;
			endMs: number;
		},
		document,
		"ann",
	);
	const landing = landingOf(placed, document);
	if (!landing.anchored) {
		return coversNoClip("annotation", startMs / 1000, endMs / 1000, document);
	}
	const next: AxcutDocument = {
		...document,
		annotations: [...document.annotations, ...placed] as AxcutDocument["annotations"],
	};
	return {
		ok: true,
		document: next,
		resultJson: JSON.stringify({
			annotationId: landing.ids[0],
			merged: true,
			...landingReport(landing, startMs / 1000, endMs / 1000),
		}),
		summary:
			`${summary} ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)}` +
			landingSuffix(landing, startMs / 1000, endMs / 1000),
	};
}

// The landing fields shared by every add / set result, so the model reads the
// same three things everywhere: what it asked for, what it got, and whether the
// two differ. `clamped` and `fragments` are omitted when there is nothing to
// say — an unconditional `clamped: false` on every result trains a reader to
// stop looking at it.
function landingReport(
	landing: Landing,
	requestedStartSec: number,
	requestedEndSec: number,
): Record<string, unknown> {
	const clamped =
		Math.abs(landing.startSec - requestedStartSec) > 0.001 ||
		Math.abs(landing.endSec - requestedEndSec) > 0.001;
	return {
		startSec: landing.startSec,
		endSec: landing.endSec,
		ids: landing.ids,
		...(clamped ? { clamped: true, requestedStartSec, requestedEndSec } : {}),
		...(landing.fragments > 1 ? { fragments: landing.fragments } : {}),
	};
}

function landingSuffix(
	landing: Landing,
	requestedStartSec: number,
	requestedEndSec: number,
): string {
	const parts: string[] = [];
	if (
		Math.abs(landing.startSec - requestedStartSec) > 0.001 ||
		Math.abs(landing.endSec - requestedEndSec) > 0.001
	) {
		parts.push(
			`clamped from ${formatSec(requestedStartSec)} – ${formatSec(requestedEndSec)} to fit the clips`,
		);
	}
	if (landing.fragments > 1) parts.push(`split across ${landing.fragments} clips`);
	return parts.length ? ` (${parts.join(", ")})` : "";
}

/** Ids of every modifier in the document, all four families at once — the basis
 * for naming what a destructive edit took with it. */
function modifierIdsOf(document: AxcutDocument): string[] {
	const legacy = (document.legacyEditor as Record<string, unknown>) ?? {};
	const speedRegions = (legacy.speedRegions as Array<{ id: string }> | undefined) ?? [];
	const cameraFullscreenRegions =
		(legacy.cameraFullscreenRegions as Array<{ id: string }> | undefined) ?? [];
	return [
		...document.zoomRanges.map((r) => r.id),
		...document.annotations.map((r) => r.id),
		...speedRegions.map((r) => r.id),
		...cameraFullscreenRegions.map((r) => r.id),
	];
}

/** ponytail: `setClipRange` and `removeClip` both delete anchored modifiers as a
 * side effect (`setClipSourceRange` drops the pills the new window no longer
 * covers; `removeClip` takes everything anchored to the clip). Both used to
 * report only what was asked — "trimmed clip to 0:00.0 – 0:03.0" while a zoom
 * ceased to exist. Nothing in the result NAMED the casualty, which is what made
 * "the zoom is preserved" an easy thing for a model to say. */
function droppedByEdit(before: AxcutDocument, after: AxcutDocument) {
	const survivingModifiers = new Set(modifierIdsOf(after));
	const survivingTrims = new Set(after.timeline.trimRanges.map((t) => t.id));
	return {
		droppedModifierIds: modifierIdsOf(before).filter((id) => !survivingModifiers.has(id)),
		droppedTrimIds: before.timeline.trimRanges
			.map((t) => t.id)
			.filter((id) => !survivingTrims.has(id)),
	};
}

// Zod arg schemas — the SINGLE source of truth for every tool's arguments. The executor
// below validates against them, and the deep-agent (LangChain) layer imports the same
// objects to build its `tool()`s, so the two can never advertise a different shape than the
// one we actually validate. (The primitives `secondsSchema`/`depthSchema`/`focusSchema` stay
// private — callers only ever need the composed `*Args`.)
const secondsSchema = z.number().finite().nonnegative();

/** Span given to an agent-placed audio track when the asset has no probed duration
 *  yet. Short on purpose: a wrong guess the user has to lengthen beats one that
 *  silently covers the whole programme. */
const DEFAULT_AGENT_AUDIO_SEC = 10;

export const addTrimArgs = z.object({
	startSec: secondsSchema,
	endSec: secondsSchema,
	assetId: z.string().min(1).optional(),
	// A cut belongs to ONE clip. Without this, a project where two clips draw from the same
	// asset (a duplicated clip) cannot say which of them the model meant, and the cut lands
	// on both. Resolved from the source range when the model omits it and only one clip
	// matches; ambiguity is reported back rather than guessed.
	clipId: z.string().min(1).optional(),
	reason: z.string().default(""),
});

/**
 * ponytail: the element schema is `addTrimArgs` itself, not a copy of it.
 *
 * A batch is N unitary calls and nothing else — same validation, same clip
 * resolution, same refusal wording — so the two can never drift into meaning
 * different things. A separate element schema would be one more place to forget
 * `clipId` the next time the unitary one grows a field.
 *
 * The `union(…, unknown)` is what makes "each item stands or falls alone" true for
 * MALFORMED items too, not just unplaceable ones. A bare `z.array(addTrimArgs)`
 * rejects the whole call the moment one entry is bad — and it rejects it in
 * LangChain, before `applyBatch` runs — so nine good cuts would be thrown away
 * with the tenth and `refused[index]` could never name it. Advertising the
 * union keeps the element shape in the JSON schema the model reads (it shows up
 * as `anyOf: [addTrim, {}]`) while letting a bad entry through to the unitary
 * executor, which refuses it by itself with the wording it always uses.
 *
 * No cap on the array. A half-hour recording has hundreds of silences, and the
 * point of this tool is precisely that it should not have to guess how many are
 * too many. Picking a number here would repeat the mistake `getTranscript` made
 * with its 800.
 */
export const addTrimsArgs = z.object({
	ranges: z.array(z.union([addTrimArgs, z.unknown()])).min(1),
});

export const setTrimArgs = z.object({
	trimRangeId: z.string().min(1),
	startSec: secondsSchema,
	endSec: secondsSchema,
});

export const setClipRangeArgs = z.object({
	clipId: z.string().min(1),
	sourceStartSec: secondsSchema,
	sourceEndSec: secondsSchema,
});

export const replaceTimelineArgs = z.object({
	intervals: z.array(z.object({ startSec: secondsSchema, endSec: secondsSchema })).min(1),
	reason: z.string().default(""),
});

/**
 * ponytail: `beforeClipId`, never an index.
 *
 * `moveClip` (document/timeline.ts) takes an `insertIndex` interpreted against
 * the array AFTER the moved clip is removed — V4Timeline does the `-1` by hand
 * at its call site, with a comment about it. That is a fine internal contract
 * and a terrible one to hand a language model: off by one is silent here, and
 * "put the demo first" would land it second. A neighbour's id has no such
 * ambiguity. Null (or omitted) means last, which is the only position no
 * existing clip can name.
 *
 * There is deliberately NO `reason` field: `reason` is the clip's label ("intro",
 * "demo"), the only thing in the snapshot that lets the model tell two clips
 * apart. A reorder must not be able to overwrite it.
 */
export const moveClipArgs = z.object({
	clipId: z.string().min(1),
	beforeClipId: z.string().min(1).nullish(),
});

export const addClipArgs = z.object({
	assetId: z.string().min(1),
	beforeClipId: z.string().min(1).nullish(),
	sourceStartSec: secondsSchema.optional(),
	sourceEndSec: secondsSchema.optional(),
	reason: z.string().optional(),
});

export const splitClipArgs = z.object({
	clipId: z.string().min(1),
	/** Source-time cut point inside the clip (asset seconds). */
	atSourceSec: secondsSchema,
});

export const duplicateClipArgs = z.object({
	clipId: z.string().min(1),
	reason: z.string().optional(),
});

export const importMediaArgs = z.object({
	/** Absolute path to a video or audio file on this machine. */
	path: z.string().min(1),
	kind: z.enum(["video", "audio"]).optional(),
	label: z.string().optional(),
	/** Required when ffprobe cannot read duration; seconds. */
	durationSec: z.number().positive().optional(),
	/** When true (default for video), place a clip on the timeline. */
	placeOnTimeline: z.boolean().optional(),
	beforeClipId: z.string().min(1).nullish(),
});

export const tightenPacingArgs = z.object({
	assetId: z.string().min(1).optional(),
	/** Only cut silence segments at least this long (default 0.45s). */
	minSilenceSec: z.number().positive().max(30).optional(),
	/** Leave this much pause after each cut (default 0.12s). */
	keepPauseSec: z.number().nonnegative().max(2).optional(),
});

export const removeFillerWordsArgs = z.object({
	assetId: z.string().min(1).optional(),
	/** Extra words to treat as filler (default um/uh/erm/ah). */
	extraWords: z.array(z.string().min(1)).optional(),
});

export const setClipCropArgs = z.object({
	clipId: z.string().min(1),
	crop: clipCropRegionSchema.nullable(),
});

export const setClipIncomingTransitionArgs = z
	.object({
		clipId: z.string().min(1),
		kind: z.enum(["cut", "dissolve"]).optional(),
		/** Canonical Transition Registry id (preferred). */
		transitionId: z.string().min(1).optional(),
		/** Dissolve / transition window seconds; ignored for cut. Default 0.35. */
		durationSec: z.number().min(0).max(2).optional(),
		params: z.record(z.union([z.number(), z.boolean()])).optional(),
	})
	.refine((a) => Boolean(a.kind || a.transitionId), {
		message: "kind or transitionId required",
	});

const textAnimationSchema = z.enum([
	"none",
	"fade",
	"rise",
	"pop",
	"slide-left",
	"typewriter",
	"pulse",
]);

const fadeSecSchema = z.number().nonnegative().max(60);

export const getTranscriptArgs = z.object({
	assetId: z.string().min(1).optional(),
	/** Inclusive source-time window — omit both for the full transcript. */
	startSec: z.number().finite().optional(),
	endSec: z.number().finite().optional(),
});

/** Explicit range alias — same contract as getTranscript with startSec/endSec. */
export const getTranscriptRangeArgs = z.object({
	assetId: z.string().min(1).optional(),
	startSourceTimeSec: z.number().finite(),
	endSourceTimeSec: z.number().finite(),
});

// ponytail: an assetId, never a path. The model names a row of the document and
// the runtime resolves it to `asset.originalPath` behind the allow-list; letting
// it name a file instead would turn a read-only reporting tool into an arbitrary
// JSON reader on the user's disk.
export const getCursorTrackArgs = z.object({
	assetId: z.string().min(1).optional(),
});

// Effects (zoom / speed / annotation) are authored in *virtual* (edited-
// timeline) seconds — the position on the ruler the user sees — unlike clips
// and trims, which are source-time. The executor converts to the stored ms.
const depthSchema = z.number().int().min(1).max(6);
const focusSchema = z.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1) });

export const addZoomArgs = z.object({
	startSec: secondsSchema,
	endSec: secondsSchema,
	depth: depthSchema.default(3),
	focus: focusSchema.default({ cx: 0.5, cy: 0.5 }),
});

/** Same contract as `addTrimsArgs`: the element schema IS the unitary one, and
 *  it is advertised rather than enforced so a bad region is refused by itself. */
export const addZoomsArgs = z.object({
	regions: z.array(z.union([addZoomArgs, z.unknown()])).min(1),
});

export const setZoomArgs = z.object({
	zoomId: z.string().min(1),
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
	depth: depthSchema.optional(),
	focus: focusSchema.optional(),
});

export const addSpeedArgs = z.object({
	startSec: secondsSchema,
	endSec: secondsSchema,
	speed: z.number().positive().default(1.5),
});

export const setSpeedArgs = z.object({
	speedId: z.string().min(1),
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
	speed: z.number().positive().optional(),
});

const annotationColorSchema = z.string().min(1).max(64);
const annotationTypeSchema = z.enum(["text", "image", "figure", "blur"]);
const imageDataUriSchema = z.string().min(1);

export const addAnnotationArgs = z.object({
	startSec: secondsSchema,
	endSec: secondsSchema,
	text: z.string().default(""),
	x: z.number().min(0).max(100).default(50),
	y: z.number().min(0).max(100).default(50),
	width: z.number().positive().max(100).default(30),
	height: z.number().positive().max(100).default(20),
	type: annotationTypeSchema.default("text"),
	textAnimation: textAnimationSchema.default("none"),
	color: annotationColorSchema.default("#ffffff"),
	backgroundColor: annotationColorSchema.default("transparent"),
	fontSize: z.number().positive().max(200).default(32),
	fontWeight: z.enum(["normal", "bold"]).default("bold"),
	textAlign: z.enum(["left", "center", "right"]).default("center"),
	arrowDirection: z
		.enum(["up", "down", "left", "right", "up-right", "up-left", "down-right", "down-left"])
		.default("right"),
	blurKind: z.enum(["blur", "mosaic"]).default("mosaic"),
	blurShape: z.enum(["rectangle", "oval"]).default("rectangle"),
	image: imageDataUriSchema.optional(),
});

export const setAnnotationArgs = z.object({
	annotationId: z.string().min(1),
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
	text: z.string().optional(),
	x: z.number().min(0).max(100).optional(),
	y: z.number().min(0).max(100).optional(),
	width: z.number().positive().max(100).optional(),
	height: z.number().positive().max(100).optional(),
	textAnimation: textAnimationSchema.optional(),
	color: annotationColorSchema.optional(),
	backgroundColor: annotationColorSchema.optional(),
	fontSize: z.number().positive().max(200).optional(),
	fontWeight: z.enum(["normal", "bold"]).optional(),
	textAlign: z.enum(["left", "center", "right"]).optional(),
	arrowDirection: z
		.enum(["up", "down", "left", "right", "up-right", "up-left", "down-right", "down-left"])
		.optional(),
	blurKind: z.enum(["blur", "mosaic"]).optional(),
	blurShape: z.enum(["rectangle", "oval"]).optional(),
	image: imageDataUriSchema.optional(),
});

/**
 * Reliable privacy mosaic/blur presets — prefer this over guessing tiny x/y
 * patches for name / avatar / browser chrome. Defaults span the full edited timeline.
 */
export const addPrivacyCoverArgs = z.object({
	/** Where to cover. topStrip = full browser chrome band (best for name+avatar). */
	preset: z.enum(["topStrip", "topRight", "bottomRight", "fullFrame"]).default("topStrip"),
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
	blurKind: z.enum(["blur", "mosaic"]).default("mosaic"),
	/** Also lay a denser top-right patch (default true for topStrip). */
	includeTopRight: z.boolean().optional(),
	/** Drop existing blur annotations that overlap this span (default true). */
	replaceExistingBlurs: z.boolean().default(true),
});

export const addGraphicArgs = z.object({
	startSec: secondsSchema,
	endSec: secondsSchema,
	kind: z.enum(GRAPHIC_KINDS).default("title"),
	text: z.string().default(""),
	subtext: z.string().optional(),
	x: z.number().min(0).max(100).optional(),
	y: z.number().min(0).max(100).optional(),
	width: z.number().positive().max(100).optional(),
	height: z.number().positive().max(100).optional(),
	color: annotationColorSchema.optional(),
	backgroundColor: annotationColorSchema.optional(),
	fontSize: z.number().positive().max(200).optional(),
	fontWeight: z.enum(["normal", "bold"]).optional(),
	textAlign: z.enum(["left", "center", "right"]).optional(),
	textAnimation: textAnimationSchema.optional(),
	arrowDirection: z
		.enum(["up", "down", "left", "right", "up-right", "up-left", "down-right", "down-left"])
		.optional(),
	image: imageDataUriSchema.optional(),
	/** Absolute path to a PNG/JPEG/GIF/WebP the agent rendered on disk. */
	imagePath: z.string().min(1).optional(),
	/** Built-in or registered character → resolves to image (listCharacters). */
	characterId: z.string().min(1).optional(),
	/** User-uploaded / agent-made character file (same as imagePath for characters). */
	characterPath: z.string().min(1).optional(),
});

/**
 * Place short on-video highlights that follow the recorded pointer
 * (finger ring / callout / presenter plate). Requires cursor telemetry.
 */
export const addCursorHighlightArgs = z.object({
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
	/** ring = oval mosaic; finger = small circle; callout = arrow; character = avatar plate near cursor. */
	style: z.enum(["ring", "finger", "callout", "character"]).default("finger"),
	/** Sample spacing in virtual seconds (default 0.5). */
	everySec: z.number().positive().max(5).default(0.5),
	maxPoints: z.number().int().min(1).max(48).default(24),
	/** Highlight diameter as % of frame (default 14; characters default larger in executor). */
	sizePct: z.number().min(4).max(40).optional(),
	/** Only place at click/mouseup samples. */
	clicksOnly: z.boolean().default(false),
	/** Label for callout/character plates. */
	label: z.string().optional(),
	/** Built-in or registered character id (listCharacters). Default guide when style is character. */
	characterId: z.string().min(1).optional(),
	/** Absolute path to a user-uploaded or agent-made character PNG/JPEG/WebP. */
	characterPath: z.string().min(1).optional(),
	/** Character image as a data URI (alternative to characterPath). */
	image: imageDataUriSchema.optional(),
	/** Drop prior cursor-follow character/finger overlays in the span (default true for character). */
	replaceExisting: z.boolean().optional(),
});

export const listCharactersArgs = z.object({});

export const registerCharacterArgs = z.object({
	/** Stable id to reuse later (not a builtin name). */
	id: z.string().min(1).max(64),
	label: z.string().optional(),
	/** Absolute path the user uploaded or you rendered. */
	imagePath: z.string().min(1).optional(),
	/** Or pass the pixels as a data URI. */
	image: imageDataUriSchema.optional(),
});

/**
 * Place N image/badge overlays evenly across the edited timeline.
 * Use for "make 5 images for this video" — no Bash loop required.
 */
export const addBeatGraphicsArgs = z.object({
	count: z.number().int().min(1).max(12).default(5),
	/** badge|title text plates, or character avatar bubbles. */
	kind: z.enum(["badge", "title", "lowerThird", "character"]).default("badge"),
	characterId: z.string().min(1).optional(),
	/** Optional labels — one per beat; extras use Beat 1…N. */
	texts: z.array(z.string()).optional(),
	/** Frame % size for each plate (default 22 for character, 28 for badge/title). */
	sizePct: z.number().min(8).max(50).optional(),
	/** Vertical position 0–100 (default 12 top / 72 for lowerThird). */
	y: z.number().min(0).max(90).optional(),
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
	/** Each beat visible this many seconds (default 2.2). */
	holdSec: z.number().positive().max(8).optional(),
	/**
	 * When true: render PNGs to generated-graphics/ for the chat preview only —
	 * do NOT place overlays on the timeline. Use for "create / show me images";
	 * place later with addGraphic(imagePath) when the user says use on video.
	 */
	previewOnly: z.boolean().optional(),
});

/**
 * Bake a short motion-graphic MP4 (title cards with zoom/fade) for the chat board.
 * Does NOT place on the timeline — use importMedia / insertStartThumbnail / addGraphic
 * when the user says "use on video".
 */
const motionPlacementSchema = z
	.union([
		z.enum(["none", "start", "end"]),
		z.object({ beforeClipId: z.string().min(1) }),
		z.object({ afterClipId: z.string().min(1) }),
		z.object({ atSec: z.number().nonnegative() }),
	])
	.default("none");

/**
 * Render a full-frame motion graphic (MP4 at the project's size) from a
 * built-in template or from HTML the agent wrote, check it, and optionally
 * place it on the timeline. Rendering happens in the async media step.
 */
export const createMotionClipArgs = z
	.object({
		template: z.enum(MOTION_TEMPLATE_IDS).optional(),
		/** Template fields — see listMotionTemplates. */
		params: z.record(z.string(), z.unknown()).optional(),
		/** A complete HTML composition (CSS/Web Animations, rAF, or window.render(t) on a canvas). */
		html: z.string().min(1).max(8_000_000).optional(),
		/** Absolute path to an .html composition on disk (relative assets resolve next to it). */
		htmlPath: z.string().min(1).optional(),
		durationSec: z.number().min(0.8).max(30).optional(),
		fps: z.number().int().min(24).max(60).optional(),
		label: z.string().max(80).optional(),
		/** none = preview in chat only; start / end; next to a clip; or at a playback time (snapped to a speech pause). */
		place: motionPlacementSchema,
	})
	.refine((v) => Boolean(v.template || v.html || v.htmlPath), {
		message: "createMotionClip needs template, html or htmlPath",
	});

/** Place an already-rendered MP4 (e.g. from createMotionClip with place:none) on the timeline. */
export const placeMotionClipArgs = z.object({
	videoPath: z.string().min(1),
	place: z.union([
		z.enum(["start", "end"]),
		z.object({ beforeClipId: z.string().min(1) }),
		z.object({ afterClipId: z.string().min(1) }),
		z.object({ atSec: z.number().nonnegative() }),
	]),
	label: z.string().max(80).optional(),
	durationSec: z.number().positive().max(120).optional(),
});

export const setBrandKitArgs = brandKitPatchSchema.extend({
	/** Take the colours from the recording (anything else passed still overrides). */
	fromVideo: z.boolean().optional(),
});

export const listMotionTemplatesArgs = z.object({});

/**
 * Stills the agent looks at to check its work: the EDITED timeline (what the
 * viewer will see), a finished export, or the raw recording.
 */
export const sampleFramesArgs = z.object({
	from: z.enum(["timeline", "export", "recording"]).default("timeline"),
	/** Seconds: programme time for timeline/export, source time for recording. Max 8. */
	times: z.array(z.number().nonnegative()).min(1).max(8).optional(),
	/** Evenly spaced frames when no times are given (default 4). */
	count: z.number().int().min(1).max(8).optional(),
	/** For from:"export" — the outputPath exportProject returned. */
	exportPath: z.string().min(1).optional(),
});

/**
 * An animated graphic drawn ON TOP of the recording (lower third, callout,
 * badge, keyword pop, or agent HTML with a transparent background). Rendered
 * to a transparent PNG sequence sized to the box, then stored as an image
 * annotation the compositor plays frame by frame.
 */
export const addMotionOverlayArgs = z
	.object({
		template: z.enum(OVERLAY_TEMPLATE_IDS).optional(),
		/** Template fields — see listMotionTemplates (overlays). */
		params: z.record(z.string(), z.unknown()).optional(),
		/** A complete HTML composition with a TRANSPARENT background, drawn at the box size. */
		html: z.string().min(1).max(8_000_000).optional(),
		htmlPath: z.string().min(1).optional(),
		/** Box, in % of the recording (0–100). */
		x: z.number().min(0).max(100),
		y: z.number().min(0).max(100),
		width: z.number().min(2).max(100),
		height: z.number().min(2).max(100),
		/** Playback time the overlay appears. */
		startSec: z.number().nonnegative(),
		durationSec: z.number().min(0.6).max(30).optional(),
		fps: z.number().int().min(12).max(30).optional(),
		label: z.string().max(80).optional(),
	})
	.refine((v) => Boolean(v.template || v.html || v.htmlPath), {
		message: "addMotionOverlay needs template, html or htmlPath",
	});

export const createMotionGraphicPreviewArgs = z.object({
	titles: z.array(z.string().min(1)).min(1).max(12),
	/** Seconds per title card (default 1.8). */
	holdSec: z.number().positive().max(4).optional(),
	/** Optional output file stem. */
	fileStem: z.string().min(1).max(64).optional(),
});

/**
 * Full-frame OPENING segment (own timeline clip), not an overlay on the recording.
 * Prefer this for "thumbnail / cover / start frame at the beginning".
 */
export const insertStartThumbnailArgs = z
	.object({
		/** Absolute path to a PNG/JPEG/WebP on disk. */
		imagePath: z.string().min(1).optional(),
		/** PNG/JPEG data URI when the agent already has pixels in memory. */
		image: imageDataUriSchema.optional(),
		/** Title card text — baked to a plate when no image/imagePath is given. */
		text: z.string().optional(),
		subtext: z.string().optional(),
		/** How long the opening segment plays (default 2.5s). */
		durationSec: z.number().positive().max(30).optional(),
		label: z.string().optional(),
		/** Remove near-full-bleed start image overlays (default true). */
		removeStartOverlays: z.boolean().optional(),
		/**
		 * Replace an existing opening start-thumbnail clip. Required when one
		 * already exists — otherwise the call is refused (do not stack covers).
		 */
		replace: z.boolean().optional(),
	})
	.refine((a) => Boolean(a.imagePath?.trim() || a.image?.trim() || a.text?.trim()), {
		message: "insertStartThumbnail needs imagePath, image, or text",
	});

export const listTransitionsArgs = z.object({
	/** GPU backend hint — defaults by platform (metal / d3d11 / wgpu). */
	backend: z.enum(["metal", "d3d11", "wgpu"]).optional(),
});

export const addAudioArgs = z.object({
	assetId: z.string().min(1),
	startSec: secondsSchema,
	endSec: secondsSchema.optional(),
	kind: z.enum(["voiceover", "music"]).default("music"),
	offsetSec: secondsSchema.default(0),
	gainDb: z.number().min(-60).max(12).default(0),
	fadeInSec: fadeSecSchema.default(0),
	fadeOutSec: fadeSecSchema.default(0),
});

export const setAudioArgs = z.object({
	audioId: z.string().min(1),
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
	kind: z.enum(["voiceover", "music"]).optional(),
	offsetSec: secondsSchema.optional(),
	gainDb: z.number().min(-60).max(12).optional(),
	fadeInSec: fadeSecSchema.optional(),
	fadeOutSec: fadeSecSchema.optional(),
	muted: z.boolean().optional(),
	loop: z.boolean().optional(),
});

export const addCameraFullscreenArgs = z.object({
	startSec: secondsSchema,
	endSec: secondsSchema,
});

export const setCameraFullscreenArgs = z.object({
	cameraFullscreenId: z.string().min(1),
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
});

export const getTranscriptWordsArgs = z.object({
	assetId: z.string().min(1).optional(),
	startSec: secondsSchema.optional(),
	endSec: secondsSchema.optional(),
});

export const setWordTextArgs = z.object({
	wordId: z.string().min(1),
	text: z.string(),
	assetId: z.string().min(1).optional(),
});

export const removeTrimArgs = z.object({
	trimRangeId: z.string().min(1),
});

export const removeModifierArgs = z.object({
	id: z.string().min(1),
});

export const setAspectRatioArgs = z.object({
	value: z.string().min(1),
});

export const setBackgroundArgs = z.object({
	wallpaper: z.string().min(1),
});

/** Caption look / enable — transcript stays SSOT; this only styles the burn-in. */
export const setCaptionSettingsArgs = z.object({
	enabled: z.boolean().optional(),
	fontSize: z.number().positive().max(200).optional(),
	fontWeight: z.enum(["normal", "bold"]).optional(),
	color: z.string().min(1).optional(),
	backgroundEnabled: z.boolean().optional(),
	backgroundColor: z.string().min(1).optional(),
	backgroundOpacity: z.number().min(0).max(1).optional(),
	anchorV: z.enum(["bottom", "top"]).optional(),
	anchorH: z.enum(["left", "center", "right"]).optional(),
	insetY: z.number().min(0).max(50).optional(),
	insetX: z.number().min(0).max(50).optional(),
	minWordsPerLine: z.number().int().positive().max(20).optional(),
	maxWordsPerLine: z.number().int().positive().max(20).optional(),
	captionLane: z.enum(["recording", "voiceover"]).optional(),
});

/**
 * Composition / look / webcam / cursor settings the Effects + Layout panes edit.
 * Pass only fields you want to change. fitClip:true zeros padding/roundness/shadow
 * and sets aspectRatio to the given fitClipAspect (default "native").
 */
export const setEditorSettingsArgs = z.object({
	shadowIntensity: z.number().min(0).max(1).optional(),
	showBlur: z.boolean().optional(),
	motionBlurAmount: z.number().min(0).max(1).optional(),
	borderRadius: z.number().min(0).max(100).optional(),
	padding: z.number().min(0).max(100).optional(),
	audioGainDb: z.number().min(-60).max(24).optional(),
	autoFocusAll: z.boolean().optional(),
	webcamLayoutPreset: z
		.enum(["picture-in-picture", "vertical-stack", "dual-frame", "no-webcam"])
		.optional(),
	webcamMaskShape: z.enum(["rectangle", "circle", "square", "rounded"]).optional(),
	webcamMirrored: z.boolean().optional(),
	webcamReactiveZoom: z.boolean().optional(),
	webcamSizePreset: z.number().min(10).max(50).optional(),
	webcamBackgroundMode: z.enum(["none", "transparent", "blur", "custom"]).optional(),
	webcamBlurIntensity: z.number().min(0).max(1).optional(),
	cursorShow: z.boolean().optional(),
	cursorTheme: z.string().min(1).optional(),
	cursorSize: z.number().min(0.5).max(8).optional(),
	cursorSmoothing: z.number().min(0).max(1).optional(),
	/** Zero pad/round/shadow and set aspect to fitClipAspect (default native). */
	fitClip: z.boolean().optional(),
	fitClipAspect: z.string().min(1).optional(),
});

export const listSourcesArgs = z.object({});

export const recordScreenArgs = z.object({
	window: z.string().min(1).optional(),
	display: z.number().int().nonnegative().optional(),
	durationSec: z.number().positive().max(600).default(15),
	mic: z.boolean().optional(),
	systemAudio: z.boolean().optional(),
});

export const generateCaptionsArgs = z.object({
	minWords: z.number().int().positive().optional(),
	maxWords: z.number().int().positive().optional(),
});

export const exportProjectArgs = z.object({
	out: z.string().min(1).optional(),
	quality: z.enum(["medium", "good", "source"]).optional(),
	format: z.enum(["mp4", "gif"]).optional(),
	autoZoom: z.boolean().optional(),
});

export const removeClipArgs = z.object({
	clipId: z.string().min(1),
});

/**
 * Every tool the model is handed, in the order `buildTools` builds them.
 *
 * The roster lives here, beside `MUTATING_TOOL_NAMES`, rather than in
 * `deep-agent/service.ts` where `buildTools` is: the workbench needs to name the
 * surface from its L0 layer, and importing the service would drag LangChain into
 * a layer that deliberately runs on zod and pure document helpers alone.
 *
 * It is hand-written — the schemas differ per tool, so nothing can generate it —
 * but it is not free-floating: `deep-agent/service.test.ts` asserts it equals
 * `buildTools(...).map(t => t.name)`, and that test runs in CI. Adding a tool
 * without adding it here fails the suite.
 *
 * ponytail: there used to be two more copies of this list, one in that test and
 * one in `workbench/lib/prompts.ts`, neither derived from anything. The
 * workbench's copy sat at 19 entries from the day it was written while the agent
 * grew to 21 (`addTrims`/`addZooms`, commit 560d368e). Nothing caught it,
 * because `npm run wb` is not part of CI — so the bench asserted a surface the
 * product had not had for some time.
 */
export const OPENSCREEN_TOOL_NAMES = [
	"getCurrentDocument",
	"getTranscript",
	"getTranscriptRange",
	"getTranscriptWords",
	"getCursorTrack",
	"listCharacters",
	"sampleFrames",
	"createMotionGraphicPreview",
	"listMotionTemplates",
	"createMotionClip",
	"placeMotionClip",
	"addMotionOverlay",
	"setBrandKit",
	"setWordText",
	"addTrim",
	"addTrims",
	"setTrim",
	"tightenPacing",
	"removeFillerWords",
	"setClipRange",
	"addClip",
	"splitClip",
	"duplicateClip",
	"importMedia",
	"insertStartThumbnail",
	"listTransitions",
	"setClipCrop",
	"setClipIncomingTransition",
	"moveClip",
	"replaceTimeline",
	"addZoom",
	"addZooms",
	"setZoom",
	"addSpeed",
	"setSpeed",
	"addAnnotation",
	"addPrivacyCover",
	"addCursorHighlight",
	"registerCharacter",
	"addBeatGraphics",
	"addGraphic",
	"setAnnotation",
	"addCameraFullscreen",
	"setCameraFullscreen",
	"addAudio",
	"setAudio",
	"removeTrim",
	"removeModifier",
	"removeClip",
	"setAspectRatio",
	"setBackground",
	"setCaptionSettings",
	"setEditorSettings",
	"listSources",
	"recordScreen",
	"generateCaptions",
	"exportProject",
] as const;

/**
 * The tools `createDeepAgent` used to inject on top of ours, over an in-memory
 * backend that was EMPTY and that the model was not told was empty — the
 * mechanical cause of D1, where the agent ran `ls`/`glob` against that sandbox
 * and reported in good faith that the project held no cursor telemetry.
 *
 * The surface is gone, so this is no longer "tools we also get": it is the list
 * of names that must never appear again. A call to one of them now means the
 * model is hallucinating a filesystem it was never offered, which is a rarer but
 * still exact D1 tell — which is why the workbench scores it as well as pinning
 * it here.
 *
 * `execute` is included even though it vanished at runtime: it is in the
 * middleware's list too and only disappeared because the default backend is not
 * a sandbox. A sandbox backend would have made it a 26th tool. The workbench's
 * own copy of this list omitted it, so `isPhantomTool` could not flag the one
 * name a sandbox backend would have brought back.
 */
export const PHANTOM_TOOL_NAMES = [
	"ls",
	"read_file",
	"write_file",
	"edit_file",
	"glob",
	"grep",
	"execute",
	"write_todos",
	"task",
] as const;

/**
 * The tools that change the document. A LIST, not an inference: it gates the
 * checkpoint the chat-service takes before a write and the mutating/non-mutating
 * split the workbench scores its DSL axis on, and neither should quietly change
 * because someone edited a switch case.
 *
 * ponytail: this replaces `AGENT_TOOL_SPECS`, ~300 lines of JSON schema whose
 * own comment said "sent verbatim to the provider". It has not been sent
 * anywhere since the deep-agent landed: the model receives the zod schemas
 * built in `deep-agent/service.ts` and the prose in `TOOL_DESCRIPTIONS`. Two
 * descriptions of the same tools, only one of them reaching the model — and it
 * was the other one that humans read and kept up to date. The surviving
 * documentation duty is `TOOL_DESCRIPTIONS`; `service.test.ts` pins the three
 * remaining surfaces (descriptions, built tools, executor cases) to each other.
 */
export const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
	// Writes the transcript, not the timeline — but it writes the document, so it is a
	// consented edit like any other.
	"setWordText",
	"addTrim",
	"addTrims",
	"addZooms",
	"setTrim",
	"tightenPacing",
	"removeFillerWords",
	"setClipRange",
	"addClip",
	"splitClip",
	"duplicateClip",
	"importMedia",
	"insertStartThumbnail",
	"setClipCrop",
	"setClipIncomingTransition",
	"moveClip",
	"replaceTimeline",
	"addZoom",
	"setZoom",
	"addSpeed",
	"setSpeed",
	"addAnnotation",
	"addPrivacyCover",
	"addCursorHighlight",
	"registerCharacter",
	"addBeatGraphics",
	"createMotionClip",
	"placeMotionClip",
	"addMotionOverlay",
	"setBrandKit",
	"addGraphic",
	"setAnnotation",
	"addCameraFullscreen",
	"setCameraFullscreen",
	"addAudio",
	"setAudio",
	"removeTrim",
	"removeModifier",
	"removeClip",
	"setAspectRatio",
	"setBackground",
	"setCaptionSettings",
	"setEditorSettings",
	"recordScreen",
	"generateCaptions",
]);

export function isMutatingTool(name: string): boolean {
	return MUTATING_TOOL_NAMES.has(name);
}

function isAspectRatioToken(value: string): boolean {
	return value === "native" || /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value.trim());
}

function resolveWallpaperInput(input: string): string {
	const trimmed = input.trim();
	if (/^\d+$/.test(trimmed)) {
		const index = Number(trimmed);
		if (index < 1 || index > 18) {
			throw new Error("Wallpaper index must be 1–18");
		}
		return `/wallpapers/wallpaper${index}.jpg`;
	}
	if (/^wallpaper\d+$/i.test(trimmed)) {
		return `/wallpapers/${trimmed.toLowerCase()}.jpg`;
	}
	if (/^\/wallpapers\/wallpaper\d+\.jpg$/.test(trimmed)) return trimmed;
	if (
		trimmed.startsWith("#") ||
		/^(rgb|rgba|hsl|hsla)\(/i.test(trimmed) ||
		/(linear|radial|conic)-gradient\(/i.test(trimmed)
	) {
		return trimmed;
	}
	if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed)) {
		if (trimmed.length > 1_500_000) {
			throw new Error("wallpaper data URI is too large");
		}
		return trimmed;
	}
	let abs: string | null = null;
	try {
		abs = assertSafeLocalMediaPath(trimmed, "wallpaper");
	} catch {
		abs = null;
	}
	if (abs && existsSync(abs)) {
		const ext = extname(abs).toLowerCase();
		if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
			throw new Error("wallpaper imagePath must be .png, .jpg, .jpeg, .webp, or .gif");
		}
		return loadImageFileAsDataUri(abs, { ffmpegPath: resolveFfmpeg() });
	}
	throw new Error(
		"wallpaper must be a bundled /wallpapers/wallpaperN.jpg path, index 1–18, a CSS color/gradient, an image data URI, or an absolute image path",
	);
}

function patchLegacyEditor(document: AxcutDocument, patch: Record<string, unknown>): AxcutDocument {
	const current =
		document.legacyEditor && typeof document.legacyEditor === "object"
			? { ...(document.legacyEditor as Record<string, unknown>) }
			: {};
	return { ...document, legacyEditor: { ...current, ...patch } };
}

function roundSec(ms: number): number {
	return Math.round(ms) / 1000;
}

function projectQueueForModel(document: AxcutDocument): Record<string, unknown> {
	const placedAssetIds = new Set(document.timeline.clips.map((c) => c.assetId));
	const placedAudioIds = new Set(document.audioTracks.map((t) => t.assetId));
	const playback = resolvePlaybackSegments(document.timeline.clips, document.timeline.trimRanges);
	const editedDurationSec =
		playback.length === 0 ? 0 : playback[playback.length - 1].timelineEndSec;
	const unusedAssets = document.assets
		.filter((a) => a.kind !== "audio" && !placedAssetIds.has(a.id))
		.map((a) => ({
			id: a.id,
			label: a.label,
			kind: a.kind,
			durationSec: a.durationSec ?? null,
			originalPath: a.originalPath,
		}));
	const unusedAudio = document.assets
		.filter((a) => a.kind === "audio" && !placedAudioIds.has(a.id))
		.map((a) => ({
			id: a.id,
			label: a.label,
			durationSec: a.durationSec ?? null,
		}));
	const clips = document.timeline.clips.map((c, index) => {
		const asset = document.assets.find((a) => a.id === c.assetId);
		const sourceDurationSec = asset?.durationSec ?? null;
		const placedEnd = c.sourceEndSec ?? sourceDurationSec ?? c.sourceStartSec;
		const placedDurationSec = Math.max(0, placedEnd - c.sourceStartSec);
		return {
			index,
			clipId: c.id,
			assetId: c.assetId,
			label: asset?.label ?? c.reason,
			reason: c.reason,
			sourceDurationSec,
			placedSourceSec: { start: c.sourceStartSec, end: c.sourceEndSec ?? null },
			placedDurationSec,
			timelineSec: { start: c.timelineStartSec, end: c.timelineEndSec },
			unusedHeadSec: c.sourceStartSec,
			unusedTailSec:
				sourceDurationSec != null && c.sourceEndSec != null
					? Math.max(0, sourceDurationSec - c.sourceEndSec)
					: null,
			cropRegion: c.cropRegion ?? null,
			incomingTransition: c.incomingTransition
				? {
						kind: c.incomingTransition.kind,
						transitionId: c.incomingTransition.transitionId ?? null,
						durationSec: c.incomingTransition.durationSec ?? null,
					}
				: null,
		};
	});
	return {
		note:
			"unusedAssets are recordings in this project that are not on the timeline — addClip places one. " +
			"editedDurationSec is the playback length after trims. sourceDurationSec on each clip is the full file. " +
			"Clip joins: clips[].incomingTransition + setClipIncomingTransition / listTransitions. Multi-band EQ is not a field. " +
			"Start cover/thumbnail → insertStartThumbnail (refused if one already exists unless replace:true). Overlay titles/CTAs → addGraphic. " +
			"Caption look → setCaptionSettings; frame/look/webcam/cursor → setEditorSettings. " +
			"Annotation textAnimation is a text enter animation. Audio gainDb + fadeInSec/fadeOutSec is the official level/fade. " +
			"addGraphic / addAnnotation land on the footage and are already composited — no separate merge step.",
		editedDurationSec,
		clipCount: clips.length,
		hasStartThumbnail: findStartThumbnailClip(document) != null,
		startThumbnail: findStartThumbnailClip(document),
		unusedAssetCount: unusedAssets.length,
		unusedAudioCount: unusedAudio.length,
		clips,
		unusedAssets,
		unusedAudio,
	};
}

// Compact projection of the document for the model: everything it needs to
// reference ids and times, nothing it doesn't (no waveform paths, no history).
//
// Three clearly-separated groups, each with its OWN time-base spelled out so the
// model never has to guess:
//   • clips   — arranged segments; source-time in/out + their timeline position.
//   • trims   — source-time cuts inside a clip (do not split the clip).
//   • effects — zoom / speed / annotation, in *virtual* (edited-timeline)
//     seconds, i.e. positions on the ruler after clips + trims are applied.
//
// ponytail: what a projection LEAVES OUT is a claim too, and two omissions here
// were being read by the model as facts about the project.
//   • `cameraTrack` — the assets went out as `{id, label, durationSec}`, so two
//     projects identical except for a linked webcam were literally
//     indistinguishable. `addCameraFullscreen` answered ok either way, and the
//     model placed a full-camera region on a project with no camera and
//     reported it done. `hasCameraTrack` is the exact parity of `hasTranscript`
//     below, which had already solved the same problem for the transcript.
//   • the zoom's real strength — `depth` went out bare. It is an ORDINAL, so a
//     reader turns "3" into "3×" while the frame renders 1.80×; and when a
//     migrated v1.7 project carries `customScale`, `depth` is inert and nothing
//     said so. `renderedScale` is `effectiveZoomScale`, the renderer's own
//     function, so the number the model reports is the number the viewer sees.
export function documentSnapshotForModel(
	document: AxcutDocument,
	cursorTelemetry?: CursorTelemetryContext,
	evidence?: {
		visualFramesSupplied?: boolean;
		audioStream?: boolean | null;
		speechStatus?: MediaEvidenceCapabilities["speechStatus"];
		sourceStoryRequested?: boolean;
		targetStoryRequested?: boolean;
	},
): Record<string, unknown> {
	const availability = cursorTelemetry?.availableByAssetId;
	const legacy = document.legacyEditor as Record<string, unknown> | null;
	const speedRegions =
		(legacy?.speedRegions as
			| Array<{ id: string; startMs: number; endMs: number; speed: number }>
			| undefined) ?? [];
	const cameraFullscreenRegions =
		(legacy?.cameraFullscreenRegions as
			| Array<{ id: string; startMs: number; endMs: number }>
			| undefined) ?? [];
	// The global Auto-Focus toggle OVERRIDES each region's own focusMode at
	// render (sceneDescription.ts:703) and the inspector disables the per-region
	// control while it is on. Reporting the stored mode would hand the model a
	// second thing to be confidently wrong about, so the projection reports the
	// EFFECTIVE mode and the flag that decides it.
	const autoFocusAll = legacy?.autoFocusAll === true;
	const mediaCapabilities = buildMediaEvidenceCapabilities(document, {
		cursorTelemetryAvailableByAssetId: availability,
		visualFramesSupplied: evidence?.visualFramesSupplied,
		audioStream: evidence?.audioStream,
		speechStatus: evidence?.speechStatus,
		sourceStoryRequested: evidence?.sourceStoryRequested,
		targetStoryRequested: evidence?.targetStoryRequested,
	});
	return {
		timeBaseNote:
			"clips and trims are in source-time seconds; zooms, speedRegions, annotations, cameraFullscreenRegions and audioTracks are in virtual (edited-timeline) seconds.",
		audioNote:
			"audioTracks are imported voiceover / music files laid over the recording. They are clip-anchored like every other region, so they travel with their clip through reorder and trim, and they play at 1x whatever a speed region does to the picture under them. importMedia(path, kind:\"audio\") brings a file into the project; addAudio then places that asset on a lane.",
		zoomNote:
			`renderedScale is what the viewer sees (depth is an ordinal, not a factor: ${ZOOM_DEPTH_LEGEND}). ` +
			"When a zoom carries customScale it wins over depth and depthIsOverridden is true — " +
			"a setZoom that only changes depth on such a zoom clears customScale so the depth takes effect.",
		project: { id: document.project.id, title: document.project.title },
		primaryAssetId: document.project.primaryAssetId ?? document.assets[0]?.id ?? null,
		openMedia: openTimelineMedia(document),
		openMediaNote:
			"mediaContext is a TEXTUAL/derived outline of each recording (kept spans, speech/silence parts, stored notes) — not pixels. It is rebuilt when the project opens and reused on later turns. visibleMedia is only the file inventory (ids/paths). Neither grants visualFrames. A transcript is optional and separate from whether audio exists.",
		mediaEvidenceNote: MEDIA_EVIDENCE_NOTE,
		mediaCapabilities,
		mediaContext: buildMediaContext(document),
		visibleMedia: document.assets
			.filter((a) => a.kind !== "audio" && Boolean(a.originalPath?.trim()))
			.filter((a) => !/^https?:\/\//i.test(a.originalPath))
			.map((a) => ({
				id: a.id,
				label: a.label,
				kind: a.kind,
				originalPath: a.originalPath,
			})),
		autoFocusAll,
		hasAnyCamera: hasAnyClipWithCamera(document.assets, document.timeline.clips),
		cursorNote:
			"assets[].hasCursorTelemetry says whether recorded pointer telemetry exists for that " +
			"asset. true — call getCursorTrack to read the recorded pointer track. " +
			"false — this asset was checked and has none (imported footage, or a recording made " +
			"without the cursor recorder). null — it was NOT checked from here; say that, and do " +
			"not report it as the project having no cursor data.",
		assets: document.assets.map((a) => ({
			id: a.id,
			label: a.label,
			// "audio" is an imported voiceover / music file: it is never a clip, it is
			// played by an audio track. Without this the model sees an asset it cannot
			// explain and tries to place it on the timeline as footage.
			kind: a.kind,
			originalPath: a.originalPath,
			durationSec: a.durationSec ?? null,
			hasCameraTrack: a.cameraTrack != null,
			cameraVisible: a.cameraTrack?.visible ?? false,
			// Three-valued on purpose (see `CursorTelemetryContext`): `null` is
			// "not checked", and it must never render as `false`. The whole defect
			// was a runtime that could not look being read as a project that has
			// nothing — same field, same three states, one honest projection.
			//
			// `?? null`, not `?? false`: an asset MISSING from the map is one whose
			// probe threw. Defaulting that to `false` would put our failure back in
			// the answer as their fact, one layer lower down.
			hasCursorTelemetry: availability?.[a.id] ?? null,
		})),
		// ponytail: `index`, `reason` and `origin` are here because without them a
		// clip cannot be DESIGNATED. "Put the demo first" is unanswerable when the
		// only handles are `clip_1`/`clip_2` and two indistinguishable source
		// windows — the label the user sees lives in `reason`, and it was not being
		// sent. A reorder tool without this is a tool the model cannot aim.
		clips: document.timeline.clips.map((c, index) => ({
			id: c.id,
			index,
			assetId: c.assetId,
			reason: c.reason,
			origin: c.origin,
			sourceStartSec: c.sourceStartSec,
			sourceEndSec: c.sourceEndSec ?? null,
			timelineStartSec: c.timelineStartSec,
			timelineEndSec: c.timelineEndSec,
			...(c.cropRegion ? { cropRegion: c.cropRegion } : {}),
			...(c.incomingTransition
				? {
						incomingTransition: {
							kind: c.incomingTransition.kind,
							transitionId: c.incomingTransition.transitionId ?? null,
							durationSec: c.incomingTransition.durationSec ?? null,
						},
					}
				: {}),
		})),
		projectQueue: projectQueueForModel(document),
		look: (() => {
			const settings = getEditorSettings(document);
			return {
				aspectRatio: settings.aspectRatio,
				wallpaper: settings.wallpaper,
				padding: settings.padding,
				borderRadius: settings.borderRadius,
				shadowIntensity: settings.shadowIntensity,
				showBlur: settings.showBlur,
				motionBlurAmount: settings.motionBlurAmount,
				audioGainDb: settings.audioGainDb,
				autoFocusAll: settings.autoFocusAll,
				webcamLayoutPreset: settings.webcamLayoutPreset,
				cursorShow: settings.cursorShow,
			};
		})(),
		captions: (() => {
			const c = getCaptionSettings(document);
			return {
				enabled: c.enabled,
				fontSize: c.fontSize,
				anchorV: c.anchorV,
				anchorH: c.anchorH,
				insetY: c.insetY,
				insetX: c.insetX,
				captionLane: c.captionLane,
			};
		})(),
		trimRanges: document.timeline.trimRanges.map((s) => ({
			id: s.id,
			assetId: s.assetId,
			// The clip the cut is on — the only thing separating two cuts over the same
			// media. `null` is a pre-v7 cut that still applies to every clip of its asset.
			clipId: s.clipId ?? null,
			startSec: s.startSec,
			endSec: s.endSec,
			reason: s.reason,
		})),
		zoomRanges: coalesceForAgent(document.zoomRanges).map((z) => ({
			id: z.id,
			startSec: roundSec(z.startMs),
			endSec: roundSec(z.endMs),
			depth: z.depth,
			renderedScale: effectiveZoomScale(z),
			// Emitted only when set: an unconditional `customScale: null` on every
			// zoom of every snapshot is noise the reader learns to skip, which is
			// how the field would go unnoticed again.
			...(z.customScale != null ? { customScale: z.customScale, depthIsOverridden: true } : {}),
			...(z.rotationPreset ? { rotationPreset: z.rotationPreset } : {}),
			focus: z.focus,
			focusMode: autoFocusAll ? "auto" : (z.focusMode ?? "manual"),
			source: z.source ?? "manual",
		})),
		speedRegions: coalesceForAgent(speedRegions).map((s) => ({
			id: s.id,
			startSec: roundSec(s.startMs),
			endSec: roundSec(s.endMs),
			speed: s.speed,
		})),
		annotations: coalesceForAgent(document.annotations).map((a) => {
			const raw = a.textContent ?? a.content ?? "";
			const text = isImageDataUri(raw)
				? a.textContent && !isImageDataUri(a.textContent)
					? a.textContent
					: ""
				: raw;
			return {
				id: a.id,
				startSec: roundSec(a.startMs),
				endSec: roundSec(a.endMs),
				type: a.type,
				text,
				hasImage: a.type === "image" && Boolean(a.content || a.imageContent),
				x: a.position?.x ?? 50,
				y: a.position?.y ?? 50,
				width: a.size?.width ?? 30,
				height: a.size?.height ?? 20,
				textAnimation: a.style?.textAnimation ?? "none",
				color: a.style?.color ?? "#ffffff",
				backgroundColor: a.style?.backgroundColor ?? "transparent",
				fontSize: a.style?.fontSize ?? 32,
				...(a.figureData ? { arrowDirection: a.figureData.arrowDirection } : {}),
				...(a.blurData ? { blurKind: a.blurData.type, blurShape: a.blurData.shape } : {}),
			};
		}),
		cameraFullscreenRegions: coalesceForAgent(cameraFullscreenRegions).map((c) => ({
			id: c.id,
			startSec: roundSec(c.startMs),
			endSec: roundSec(c.endMs),
		})),
		// Imported audio, collapsed to the pills the ruler draws — a track ventilated
		// across a clip boundary is several fragments the user sees as one thing, and
		// the model has to name what the user sees.
		audioTracks: collapseTracksToPills(document.audioTracks).map((t) => ({
			id: trackGroupId(t),
			startSec: roundSec(t.startMs),
			endSec: roundSec(t.endMs),
			assetId: t.assetId,
			// Which lane it sits on. Also decides whether it is transcribed at all.
			kind: t.kind,
			// Where in the FILE the track starts playing, in that file's own seconds.
			offsetSec: roundSec(t.offsetMs),
			gainDb: t.gainDb,
			fadeInSec: roundSec(t.fadeInMs),
			fadeOutSec: roundSec(t.fadeOutMs),
			muted: t.muted,
			loop: t.loop,
		})),
		hasTranscript: document.transcripts.length > 0 || document.transcript !== null,
		aspectRatio: typeof legacy?.aspectRatio === "string" ? legacy.aspectRatio : "native",
		wallpaper: typeof legacy?.wallpaper === "string" ? legacy.wallpaper : null,
	};
}

function failure(message: string): AgentToolExecution {
	return { ok: false, resultJson: JSON.stringify({ error: message }), summary: message };
}

/**
 * Runs `unitName` once per item, folding the document forward.
 *
 * ponytail: the batch tools exist to save ROUND TRIPS, not to mean something new.
 * Replaying the unitary executor is what guarantees that — anchoring, clip
 * resolution, clamping, the wording of every refusal, all identical by
 * construction rather than by a second implementation staying in step. A batch
 * of N is exactly N unitary calls minus N-1 round trips, and `agent-tools.test`
 * asserts that against a document built the long way.
 *
 * ponytail: PARTIAL application, deliberately. `replaceTimeline` is the repo's
 * other array-taking tool and it refuses in one block — "Refused … Nothing was
 * modified" — which is right for a tool that rebuilds the whole timeline and
 * ruinous for one that adds ten independent cuts: a single bad bound would throw
 * away nine good ones and the model would have to guess which. So each item
 * stands or falls alone, and the result says which did what. `ok:false` is kept
 * for the case where NOTHING landed, because that is the only one where the
 * document did not move.
 */
function applyBatch(
	document: AxcutDocument,
	unitName: "addTrim" | "addZoom",
	items: unknown[],
	options: AgentToolOptions | undefined,
	noun: string,
): AgentToolExecution {
	let current = document;
	const applied: Array<Record<string, unknown>> = [];
	const refused: Array<{ index: number; error: string }> = [];

	items.forEach((item, index) => {
		const execution = executeAgentTool(current, unitName, JSON.stringify(item), options);
		let payload: Record<string, unknown> = {};
		try {
			payload = JSON.parse(execution.resultJson) as Record<string, unknown>;
		} catch {
			payload = { error: execution.resultJson };
		}
		if (execution.ok && execution.document) {
			current = execution.document;
			applied.push({ index, ...payload });
		} else {
			refused.push({ index, error: String(payload.error ?? "refused") });
		}
	});

	// Nothing landed: the document is untouched, so say so the way every other
	// refusal does rather than reporting a success with an empty list.
	if (applied.length === 0) {
		return failure(
			`No ${noun} was added. ` +
				refused.map((r) => `[${r.index}] ${r.error}`).join(" | ") +
				" Nothing was modified.",
		);
	}

	const refusedSuffix = refused.length ? `, ${refused.length} refused` : "";
	return {
		ok: true,
		document: current,
		// The counts come first on purpose: the model must be able to see that one
		// of ten was refused WITHOUT re-reading the document, and know which one.
		resultJson: JSON.stringify({
			requested: items.length,
			appliedCount: applied.length,
			refusedCount: refused.length,
			applied,
			...(refused.length ? { refused } : {}),
		}),
		summary: `added ${applied.length} ${noun}${applied.length === 1 ? "" : "s"}${refusedSuffix}`,
	};
}

/** The clips as the model would have to name them, for an error about an id it
 *  got wrong — a bare "Unknown clip: demo" leaves it guessing twice. */
function clipRoster(document: AxcutDocument): string {
	const clips = document.timeline.clips;
	if (clips.length === 0) return "The timeline has no clips.";
	return `The timeline is: ${clips.map((c) => `${c.id}${c.reason ? ` (${c.reason})` : ""}`).join(", ")}.`;
}

/**
 * The refusal the model gets for every write while `allowAgentEdits` is off.
 *
 * ponytail: it has to be ACTIONABLE, not merely negative. There is no
 * AbortSignal and no timeout anywhere on the product path, and the agent runs
 * at recursionLimit 1000: a bare "refused" invites a model to try the next
 * write tool, and the next, for as long as the provider will answer. So the
 * payload says what to do instead (state the edit, ask), that retrying is
 * pointless (every write is refused, not just this one), that claiming the edit
 * happened is forbidden, and where the user turns the setting back on. The
 * arguments are echoed back so the model can quote the exact edit it wanted
 * without a second round trip.
 *
 * The `{error}` envelope is the shape the workbench's wire oracle already
 * recognises as a failed tool result — a new one would read as a success.
 */
function consentRequired(name: string, args: unknown): AgentToolExecution {
	return {
		ok: false,
		resultJson: JSON.stringify({
			error:
				"Project edits are turned off for this project: the user asked to be consulted " +
				"before the timeline changes. Nothing was modified.",
			code: "consent_required",
			tool: name,
			requestedArgs: args,
			howToProceed:
				"Describe the exact edit you would make — the tool, the times, the ids — and ask the " +
				"user to confirm it. Do NOT retry this call and do NOT reach for another write tool: " +
				"every one of them is refused while the setting is off. Never say an edit was applied. " +
				"If they want you to go ahead, they can re-enable 'Project edits' in Settings → AI.",
		}),
	};
}

export interface AgentToolOptions {
	/**
	 * `allowAgentEdits` from the LLM config, threaded down as an explicit
	 * argument rather than read from a module global so this stays pure and
	 * testable. Only `false` refuses; `undefined` is "allowed", which keeps the
	 * three-argument call sites (and ~40 test assertions) working unchanged and
	 * mirrors `config.allowAgentEdits !== false`.
	 */
	editsAllowed?: boolean;
	/**
	 * Single Mutation Authority V1 — when `proposal_only` or `read_only`,
	 * mutating tools are refused even if `editsAllowed` is true.
	 * `consented_apply` / `deterministic_edit` / omitted keep prior behavior.
	 */
	mutationMode?: import("./mutationAuthority").MutationMode;
	/** Cursor telemetry resolved for THIS turn — see `CursorTelemetryContext`.
	 *  Absent means the runtime has no telemetry reader wired at all, which the
	 *  executor reports as "could not look", never as "there is none". */
	cursorTelemetry?: CursorTelemetryContext;
	/** True only when this turn already attached JPEG visual evidence to the model. */
	visualFramesSupplied?: boolean;
	/**
	 * Output of the async media step (`prepareAgentToolMedia`) for THIS call:
	 * rendered MP4s and probed durations. Tools that render video refuse to run
	 * without it rather than blocking the main process with a synchronous ffmpeg.
	 */
	prepared?: PreparedToolMedia;
}

/**
 * What the runtime managed to find out about cursor telemetry this turn.
 *
 * ponytail: the three states are the whole point, and collapsing any two of them
 * is the defect. "There is no telemetry for this asset" is a fact about the
 * project. "I have no way to look" is a fact about me. The measured failure was
 * the model reporting the second as the first — it probed an empty sandbox and
 * concluded the recording had no pointer data — so the payloads keep them apart
 * and the prompt tells the model to keep them apart too.
 */
export interface CursorTelemetryContext {
	/** assetId → whether a sidecar exists. A MISSING key means "not checked",
	 *  which the snapshot reports as null, never false. */
	availableByAssetId?: Record<string, boolean>;
	/** The samples the async tool wrapper loaded before entering the executor.
	 *  `executeAgentTool` is synchronous — deliberately, it is the pure gate every
	 *  mutation passes through — so the IO happens outside and the verdict comes
	 *  in as data. */
	load?: CursorTelemetryLoad;
}

export type CursorTelemetryLoad =
	| { status: "ok"; assetId: string; samples: CursorTrackSample[]; durationSec?: number }
	/** We looked; this asset has no sidecar. */
	| { status: "no-sidecar"; assetId: string }
	/** We could NOT look: no reader wired, path refused, file unreadable. */
	| { status: "unavailable"; assetId: string | null; note?: string };

/** Resolves the asset a cursor/transcript question is about: the argument if it
 *  names one, otherwise the project's primary asset. Shared so the async wrapper
 *  in `deep-agent/service.ts` loads telemetry for exactly the asset the executor
 *  will then report on. */
export function resolveCursorAssetId(
	document: AxcutDocument,
	assetId?: string | null,
): string | null {
	return assetId ?? document.project.primaryAssetId ?? document.assets[0]?.id ?? null;
}

// ─── What the pointer was doing where the zoom landed ──────────────────────
//
// ponytail: `focus` is the one thing a zoom write says that nothing ever
// checked. A span covering no clip is refused, a depth outside the table is
// refused, and the result reports the span that really landed — but a focus on
// the pointer and a focus half a frame off it produced byte-identical results,
// so a caller had no way to find out which of the two it had just written. The
// result now carries where the pointer ACTUALLY was over the window the zoom
// landed on, beside the focus the call used.
//
// It informs; it decides nothing. Framing a slide, a face, or a corner the
// pointer never visits is a legitimate zoom: nothing is moved, nothing is
// refused, and this is a measurement the caller is free to disagree with. The
// only thing that changes is that the difference is on the page instead of
// nowhere.

/** Per-axis median, not the mean. A pointer that crosses the frame and comes
 *  back averages to the middle of a path it spent no time on, while the median
 *  lands where it actually sat. `spread` is what says whether either number
 *  describes anything. */
function medianOf(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * Where the recorded pointer was over the span a zoom write LANDED on.
 *
 * A zoom is authored in VIRTUAL seconds and the pointer is recorded on the
 * asset's SOURCE clock, so something has to map between them — and that map
 * already exists, computed once by `anchorRawRegionsToClips`, which writes
 * `sourceStartSec`/`sourceEndSec` onto every fragment as it ventilates a span
 * across clips. So the source windows are read back OFF THE FRAGMENTS the write
 * just stored, never re-derived from `timelineStartSec`. A second derivation
 * would be free to drift, and it would drift on exactly the cases that make this
 * report worth having: a CLAMPED span and a span SPLIT across two clips both
 * land on source windows that are not the ones asked for, and both are already
 * right in the anchors. A fragment whose clip draws on another asset contributes
 * nothing — this telemetry does not describe that media.
 *
 * Absence is never a claim. The field is left OFF when the runtime holds no
 * telemetry for the footage under the span, which covers "no reader wired",
 * "this asset has no sidecar" and "the zoom landed on another asset's clip"
 * alike; none of those is evidence about the recording, and the tool description
 * says so. `available: false` is emitted only for the two things that ARE
 * findings about this span: nothing was recorded over it, or everything recorded
 * over it is cut out of playback.
 */
function cursorAnchorReport(
	// `id` is not read; it is what makes this a fragment of a stored region rather
	// than an all-optional bag TypeScript would let any object satisfy.
	regions: Array<{ id: string; clipId?: string; sourceStartSec?: number; sourceEndSec?: number }>,
	document: AxcutDocument,
	focus: { cx: number; cy: number },
	telemetry: CursorTelemetryContext | undefined,
): Record<string, unknown> | undefined {
	const load = telemetry?.load;
	if (load?.status !== "ok") return undefined;
	const byId = new Map(document.timeline.clips.map((c) => [c.id, c]));
	const windows = regions.flatMap((region) => {
		const clip = region.clipId ? byId.get(region.clipId) : undefined;
		if (!clip || clip.assetId !== load.assetId) return [];
		if (region.sourceStartSec === undefined || region.sourceEndSec === undefined) return [];
		return [{ clip, startSec: region.sourceStartSec, endSec: region.sourceEndSec }];
	});
	if (windows.length === 0) return undefined;

	const xs: number[] = [];
	const ys: number[] = [];
	let cutOut = 0;
	for (const sample of load.samples) {
		if (
			!Number.isFinite(sample.timeMs) ||
			!Number.isFinite(sample.cx) ||
			!Number.isFinite(sample.cy)
		) {
			continue;
		}
		const atSec = sample.timeMs / 1000;
		const covering = windows.find((w) => atSec >= w.startSec && atSec <= w.endSec);
		if (!covering) continue;
		// `trimAppliesToClip` is THE rule for "is this cut on this clip", and the
		// fragment names its clip, so the question is answered exactly once here.
		// A trimmed instant is one the viewer never reaches: a position argued from
		// frames that do not play would be the same kind of untruth as a span that
		// reports the edges it was asked for rather than the ones it got.
		if (
			document.timeline.trimRanges.some(
				(t) => trimAppliesToClip(t, covering.clip) && atSec >= t.startSec && atSec <= t.endSec,
			)
		) {
			cutOut += 1;
			continue;
		}
		xs.push(sample.cx);
		ys.push(sample.cy);
	}

	if (xs.length === 0) {
		return cutOut > 0
			? {
					available: false,
					reason: "trimmed-out",
					note:
						"The pointer WAS recorded over this span, but a trim cuts every one of those " +
						"instants out of playback, so none of them describes what a viewer sees here.",
				}
			: {
					available: false,
					reason: "no-samples",
					note:
						"This recording's pointer telemetry covers no instant of this span. That is a " +
						"fact about this span, not about the recording.",
				};
	}

	const cx = medianOf(xs);
	const cy = medianOf(ys);
	let spread = 0;
	for (let i = 0; i < xs.length; i += 1) {
		spread = Math.max(spread, Math.hypot(xs[i] - cx, ys[i] - cy));
	}
	return {
		available: true,
		// Echoed, including the default a call that omitted `focus` silently got:
		// "you asked for the centre" is the half of the comparison the caller
		// cannot reconstruct from its own arguments.
		focus: { cx: focus.cx, cy: focus.cy },
		cursor: { cx: round3(cx), cy: round3(cy) },
		offset: round3(Math.hypot(cx - focus.cx, cy - focus.cy)),
		spread: round3(spread),
		samples: xs.length,
	};
}

export function executeAgentTool(
	document: AxcutDocument,
	name: string,
	rawArgs: string,
	options?: AgentToolOptions,
): AgentToolExecution {
	let args: unknown = {};
	if (typeof rawArgs === "string" && rawArgs.trim()) {
		try {
			args = JSON.parse(rawArgs);
		} catch {
			return failure(`Tool arguments are not valid JSON: ${rawArgs.slice(0, 120)}`);
		}
	}

	// ponytail: THE guard for `allowAgentEdits`. It sits here, in front of the
	// switch, because this function is the single gate every document mutation
	// passes through — the two production callers (`documentTool` for the main
	// agent and, through it, any sub-agent) and the workbench alike. A guard in
	// the event sink could not work: the sink is an observer, called from inside
	// the tool body, and by the time it fires the edit has happened.
	//
	// Reads stay open on purpose. A model that cannot call getCurrentDocument or
	// getTranscript cannot describe the edit it is asking permission for, and
	// would answer "I have no tool for that" — false, and worse than silence.
	//
	// Single Mutation Authority V1: semantic/editorial (`proposal_only`) and
	// non-edit (`read_only`) turns refuse mutations before the switch — even
	// when Project edits are enabled. Prompt instructions alone are not enough.
	const mutationMode = options?.mutationMode;
	if (isMutatingTool(name) && (mutationMode === "proposal_only" || mutationMode === "read_only")) {
		const payload = mutationAuthorityRefusal(name, args, mutationMode);
		return {
			ok: false,
			resultJson: JSON.stringify(payload),
			summary: payload.error,
		};
	}
	if (options?.editsAllowed === false && isMutatingTool(name)) {
		return consentRequired(name, args);
	}

	switch (name) {
		case "getCurrentDocument": {
			return {
				ok: true,
				resultJson: JSON.stringify(
					documentSnapshotForModel(document, options?.cursorTelemetry, {
						visualFramesSupplied: options?.visualFramesSupplied,
					}),
				),
			};
		}

		case "getCursorTrack": {
			const parsed = getCursorTrackArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const assetId = resolveCursorAssetId(document, parsed.data.assetId);
			if (!assetId)
				return failure("Project has no assets — there is nothing to read telemetry for.");
			if (!document.assets.some((a) => a.id === assetId)) {
				return failure(`Unknown asset: ${assetId}`);
			}
			const load = options?.cursorTelemetry?.load;
			// ponytail: `ok: true` on all three branches, including the two that
			// return nothing. None of them is a failure of the CALL — the question
			// was answered, and the answer is "none" or "I could not look". Marking
			// them ok:false would push the model to retry a tool whose verdict will
			// not change, and there is no timeout anywhere on this path.
			if (!load || load.status === "unavailable") {
				return {
					ok: true,
					resultJson: JSON.stringify({
						available: false,
						reason: "unavailable",
						assetId,
						note:
							load?.note ??
							"Cursor telemetry cannot be read in this run — no reader is wired to this " +
								"runtime. This says nothing about whether the recording has any: report " +
								"the limit as yours, and do not tell the user the project has no cursor data.",
					}),
				};
			}
			if (load.status === "no-sidecar") {
				return {
					ok: true,
					resultJson: JSON.stringify({
						available: false,
						reason: "no-sidecar",
						assetId: load.assetId,
						note:
							"Checked: this asset has no cursor-telemetry sidecar. That normally means it " +
							"was imported rather than recorded with OpenScreen's cursor recorder. This is " +
							"a fact about the asset, not a limit of yours.",
					}),
				};
			}
			const asset = document.assets.find((a) => a.id === load.assetId);
			const track = buildCursorTrack({
				assetId: load.assetId,
				samples: load.samples,
				durationSec: load.durationSec ?? asset?.durationSec ?? 0,
				clips: document.timeline.clips,
				trimRanges: document.timeline.trimRanges,
			});
			return { ok: true, resultJson: JSON.stringify({ available: true, ...track }) };
		}

		case "getTranscript": {
			const parsed = getTranscriptArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const assetId =
				parsed.data.assetId ?? document.project.primaryAssetId ?? document.assets[0]?.id;
			const transcript =
				document.transcripts.find((t) => t.assetId === assetId) ??
				(document.transcript?.assetId === assetId ? document.transcript : null);
			if (!transcript) {
				return failure(
					`No transcript yet for asset ${assetId ?? "(none)"}. Call generateCaptions once (on-device speech-to-text), then read it again. If the recording has no speech, edit from sampleFrames and getCursorTrack instead.`,
				);
			}
			const from = parsed.data.startSec ?? Number.NEGATIVE_INFINITY;
			const to = parsed.data.endSec ?? Number.POSITIVE_INFINITY;
			const ranged = parsed.data.startSec != null || parsed.data.endSec != null;
			const segments = transcript.segments
				.filter((s) => s.endSec >= from && s.startSec <= to)
				.map((s) => ({
					id: s.id,
					kind: s.kind,
					startSec: s.startSec,
					endSec: s.endSec,
					text: s.text,
				}));
			return {
				ok: true,
				resultJson: JSON.stringify({
					assetId,
					language: transcript.language,
					timebase: "source",
					ranged,
					totalSegments: transcript.segments.length,
					returned: segments.length,
					segments,
					note: ranged
						? "Source-time window only. Speech is not proof of visual UI actions."
						: "Full transcript in source time. Prefer startSec/endSec or getTranscriptRange near visual events. Speech is not proof of visual UI actions.",
				}),
			};
		}

		case "getTranscriptRange": {
			const parsed = getTranscriptRangeArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			return executeAgentTool(
				document,
				"getTranscript",
				JSON.stringify({
					assetId: parsed.data.assetId,
					startSec: parsed.data.startSourceTimeSec,
					endSec: parsed.data.endSourceTimeSec,
				}),
				options,
			);
		}

		// The word-level read. `getTranscript` answers in SEGMENTS, whose ids belong to a
		// different namespace than the words — so on its own it cannot address anything
		// `setWordText` takes. This is the one that can. It is separate rather than folded
		// in because a whole transcript is already ~70k tokens and most turns never touch a
		// word; the span filter is there so fixing one name costs one phrase, not the film.
		case "getTranscriptWords": {
			const parsed = getTranscriptWordsArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const assetId =
				parsed.data.assetId ?? document.project.primaryAssetId ?? document.assets[0]?.id;
			const transcript =
				document.transcripts.find((t) => t.assetId === assetId) ??
				(document.transcript?.assetId === assetId ? document.transcript : null);
			if (!transcript) {
				return failure(
					`No transcript yet for asset ${assetId ?? "(none)"}. Call generateCaptions once (on-device speech-to-text), then read it again. If the recording has no speech, edit from sampleFrames and getCursorTrack instead.`,
				);
			}
			const from = parsed.data.startSec ?? Number.NEGATIVE_INFINITY;
			const to = parsed.data.endSec ?? Number.POSITIVE_INFINITY;
			const words = transcript.words
				.filter((word) => word.endSec >= from && word.startSec <= to)
				.map((word) => ({
					id: word.id,
					text: word.text,
					startSec: word.startSec,
					endSec: word.endSec,
					// Only the words that are NOT plain transcription say so, so the common
					// case costs nothing to read.
					...(word.source ? { source: word.source } : {}),
					...(word.originalText !== undefined ? { originalText: word.originalText } : {}),
				}));
			return {
				ok: true,
				resultJson: JSON.stringify({
					assetId,
					language: transcript.language,
					total: transcript.words.length,
					returned: words.length,
					words,
				}),
			};
		}

		// Correcting what the transcriber HEARD. This writes text and nothing else: the
		// captions follow it, the film does not move. The tool for making a spoken word go
		// away is addTrim, which removes its audio with it.
		case "setWordText": {
			const parsed = setWordTextArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const assetId =
				parsed.data.assetId ?? document.project.primaryAssetId ?? document.assets[0]?.id;
			if (!assetId) return failure("Project has no assets — nothing to correct.");
			const { wordId, text } = parsed.data;
			const transcript = document.transcripts.find((t) => t.assetId === assetId);
			const before = transcript?.words.find((word) => word.id === wordId);
			if (!before) {
				return failure(
					`No word ${wordId} in the transcript for asset ${assetId}. ` +
						`Call getTranscriptWords to read the ids.`,
				);
			}
			if (before.text === text) {
				return failure(`Word ${wordId} already reads "${text}" — nothing to change.`);
			}
			// This tool exists to fix a name the transcriber misheard. An INSERTED word was
			// never heard: retyping it resizes the clip it plays on and asks for generated
			// media of a new length, which is the gesture the editor gates on `insertionsEnabled`
			// — and that gate lives in the renderer, where the chat does not run. Refused here
			// unconditionally rather than mirrored, because the agent has no business authoring
			// generated media at all.
			if (isGeneratedAssetId(assetId)) {
				return failure(
					`Word ${wordId} was added to the transcript, not heard — the chat cannot rewrite it.`,
				);
			}
			let next: AxcutDocument;
			try {
				next = setDocumentWordText(document, assetId, wordId, text);
			} catch (error) {
				return failure(error instanceof Error ? error.message : String(error));
			}
			const after = next.transcripts
				.find((t) => t.assetId === assetId)
				?.words.find((word) => word.id === wordId);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					wordId,
					assetId,
					text: after?.text ?? text,
					was: before.text,
					// Absent once the word is back to what the transcriber said — the pair is
					// cleared on that round trip, and the model should be able to see it.
					originalText: after?.originalText,
					blanked: text.trim().length === 0,
				}),
				summary:
					text.trim().length === 0 ? `blanked "${before.text}"` : `"${before.text}" → "${text}"`,
			};
		}

		case "addTrim": {
			const parsed = addTrimArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const assetId =
				parsed.data.assetId ?? document.project.primaryAssetId ?? document.assets[0]?.id;
			if (!assetId) return failure("Project has no assets — nothing to trim.");
			if (!document.assets.some((a) => a.id === assetId)) {
				return failure(`Unknown asset: ${assetId}`);
			}
			const startSec = Math.min(parsed.data.startSec, parsed.data.endSec);
			const endSec = Math.max(parsed.data.startSec, parsed.data.endSec);

			// Which clip the cut sits on. Named explicitly when the model says so; otherwise
			// inferred from the source range — but only when the answer is unique. Two clips
			// over the same asset covering that range is a real question the model has to
			// answer (their ids are in the snapshot), not one to settle by picking the first.
			const covering = document.timeline.clips.filter(
				(c) =>
					c.assetId === assetId &&
					endSec > c.sourceStartSec &&
					startSec < (c.sourceEndSec ?? Number.POSITIVE_INFINITY),
			);
			let clipId = parsed.data.clipId;
			if (clipId) {
				const target = document.timeline.clips.find((c) => c.id === clipId);
				if (!target) return failure(`Unknown clip: ${clipId}`);
				if (target.assetId !== assetId) {
					return failure(`Clip ${clipId} does not use asset ${assetId}.`);
				}
			} else if (covering.length === 1) {
				clipId = covering[0].id;
			} else if (covering.length > 1) {
				return failure(
					`${covering.length} clips use asset ${assetId} over ${formatSec(startSec)} – ${formatSec(
						endSec,
					)} (${covering.map((c) => c.id).join(", ")}). Pass clipId to say which one to trim.`,
				);
			}

			const trim = {
				id: createId("trim"),
				assetId,
				...(clipId ? { clipId } : {}),
				startSec,
				endSec,
				reason: parsed.data.reason,
				origin: "agent" as const,
			};
			const next: AxcutDocument = {
				...document,
				timeline: {
					...document.timeline,
					trimRanges: [...document.timeline.trimRanges, trim],
				},
			};
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({ trimRangeId: trim.id, startSec, endSec }),
				summary: `added trim ${formatSec(startSec)} – ${formatSec(endSec)}`,
			};
		}

		case "addTrims": {
			const parsed = addTrimsArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			return applyBatch(document, "addTrim", parsed.data.ranges, options, "trim");
		}

		case "setTrim": {
			const parsed = setTrimArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { trimRangeId } = parsed.data;
			if (!document.timeline.trimRanges.some((r) => r.id === trimRangeId)) {
				return failure(`Unknown trim range: ${trimRangeId}`);
			}
			const startSec = Math.min(parsed.data.startSec, parsed.data.endSec);
			const endSec = Math.max(parsed.data.startSec, parsed.data.endSec);
			// Moving a cut out of the clip it is anchored to would leave it storing a range
			// nothing plays — silently inert. Re-point it at the clip the new range actually
			// lands in, but only when that clip is unique: with several candidates the old
			// anchor is the better guess than an arbitrary one.
			const reanchor = (trim: AxcutDocument["timeline"]["trimRanges"][number]) => {
				if (!trim.clipId) return undefined;
				const covers = (c: { sourceStartSec: number; sourceEndSec?: number }) =>
					endSec > c.sourceStartSec && startSec < (c.sourceEndSec ?? Number.POSITIVE_INFINITY);
				const current = document.timeline.clips.find((c) => c.id === trim.clipId);
				if (current && covers(current)) return trim.clipId;
				const candidates = document.timeline.clips.filter(
					(c) => c.assetId === trim.assetId && covers(c),
				);
				return candidates.length === 1 ? candidates[0].id : trim.clipId;
			};
			const next: AxcutDocument = {
				...document,
				timeline: {
					...document.timeline,
					trimRanges: document.timeline.trimRanges.map((r) =>
						r.id === trimRangeId ? { ...r, clipId: reanchor(r), startSec, endSec } : r,
					),
				},
			};
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({ trimRangeId, startSec, endSec }),
				summary: `moved trim to ${formatSec(startSec)} – ${formatSec(endSec)}`,
			};
		}

		case "tightenPacing": {
			const parsed = tightenPacingArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const assetId =
				parsed.data.assetId ?? document.project.primaryAssetId ?? document.assets[0]?.id;
			if (!assetId) return failure("Project has no assets — nothing to tighten.");
			const transcript =
				document.transcripts.find((t) => t.assetId === assetId) ??
				(document.transcript?.assetId === assetId ? document.transcript : null);
			if (!transcript) {
				return failure(
					`No transcript for asset ${assetId}. Run generateCaptions first, or cut silences with addTrims using source times.`,
				);
			}
			const minSilenceSec = parsed.data.minSilenceSec ?? 0.45;
			const keepPauseSec = parsed.data.keepPauseSec ?? 0.12;
			const ranges = transcript.segments
				.filter((s) => s.kind === "silence")
				.map((s) => {
					const startSec = s.startSec;
					const endSec = Math.max(startSec, s.endSec - keepPauseSec);
					return { startSec, endSec, assetId };
				})
				.filter((r) => r.endSec - r.startSec >= minSilenceSec);
			if (ranges.length === 0) {
				return {
					ok: true,
					document,
					resultJson: JSON.stringify({
						appliedCount: 0,
						minSilenceSec,
						keepPauseSec,
						note: "No silence segments long enough to cut.",
					}),
					summary: "no silences long enough to cut",
				};
			}
			const batch = executeAgentTool(
				document,
				"addTrims",
				JSON.stringify({ ranges }),
				options,
			);
			if (!batch.ok) return batch;
			let payload: Record<string, unknown> = {};
			try {
				payload = JSON.parse(batch.resultJson) as Record<string, unknown>;
			} catch {
				payload = {};
			}
			return {
				ok: true,
				document: batch.document ?? document,
				resultJson: JSON.stringify({
					...payload,
					minSilenceSec,
					keepPauseSec,
					requestedSilences: ranges.length,
				}),
				summary: `tightened pacing: ${batch.summary ?? `${ranges.length} silence cuts`}`,
			};
		}

		case "removeFillerWords": {
			const parsed = removeFillerWordsArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const assetId =
				parsed.data.assetId ?? document.project.primaryAssetId ?? document.assets[0]?.id;
			if (!assetId) return failure("Project has no assets — nothing to edit.");
			const transcript =
				document.transcripts.find((t) => t.assetId === assetId) ??
				(document.transcript?.assetId === assetId ? document.transcript : null);
			if (!transcript) {
				return failure(
					`No transcript for asset ${assetId}. Run generateCaptions first, then removeFillerWords.`,
				);
			}
			const extras = (parsed.data.extraWords ?? []).map((w) => w.toLowerCase().trim());
			const fillers = new Set(["um", "uh", "erm", "ah", "uhh", "umm", ...extras]);
			const ranges = transcript.words
				.filter((w) => fillers.has(w.text.toLowerCase().replace(/[^a-z']/g, "")))
				.map((w) => ({
					startSec: w.startSec,
					endSec: w.endSec,
					assetId,
				}))
				.filter((r) => r.endSec > r.startSec);
			if (ranges.length === 0) {
				return {
					ok: true,
					document,
					resultJson: JSON.stringify({ appliedCount: 0, note: "No filler words found." }),
					summary: "no filler words found",
				};
			}
			const batch = executeAgentTool(
				document,
				"addTrims",
				JSON.stringify({ ranges }),
				options,
			);
			if (!batch.ok) return batch;
			return {
				ok: true,
				document: batch.document ?? document,
				resultJson: batch.resultJson,
				summary: `removed ${ranges.length} filler word cut(s)`,
			};
		}

		case "setClipRange": {
			const parsed = setClipRangeArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { clipId } = parsed.data;
			if (!document.timeline.clips.some((c) => c.id === clipId)) {
				return failure(`Unknown clip: ${clipId}`);
			}
			const sourceStartSec = Math.min(parsed.data.sourceStartSec, parsed.data.sourceEndSec);
			const sourceEndSec = Math.max(parsed.data.sourceStartSec, parsed.data.sourceEndSec);
			// One shared mutator with the modale + op dispatcher: recomputes the clip's
			// width from the new source window AND clamps/drops the anchored pills the
			// trim removed. Hand-rolling it here is exactly what left this façade orphaning
			// stale pills the other two didn't.
			const next = setClipSourceRange(document, clipId, sourceStartSec, sourceEndSec);
			const dropped = droppedByEdit(document, next);
			const casualties = dropped.droppedModifierIds.length + dropped.droppedTrimIds.length;
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({ clipId, sourceStartSec, sourceEndSec, ...dropped }),
				summary:
					`trimmed clip to ${formatSec(sourceStartSec)} – ${formatSec(sourceEndSec)}` +
					(casualties > 0
						? ` — dropped ${[...dropped.droppedModifierIds, ...dropped.droppedTrimIds].join(", ")}`
						: ""),
			};
		}

		case "addClip": {
			const parsed = addClipArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { assetId } = parsed.data;
			const asset = document.assets.find((a) => a.id === assetId);
			if (!asset) {
				const unused = document.assets.filter(
					(a) => a.kind !== "audio" && !document.timeline.clips.some((c) => c.assetId === a.id),
				);
				return failure(
					`Unknown asset: ${assetId}.` +
						(unused.length
							? ` Unused footage in this project: ${unused.map((a) => `${a.id} (${a.label})`).join(", ")}.`
							: " This project has no unused footage — every video asset is already on the timeline, or there is none to place."),
				);
			}
			if (asset.kind === "audio") {
				return failure(
					`Asset ${assetId} is audio, not footage. addClip places a recording; to play imported audio use addAudio.`,
				);
			}
			const beforeClipId = parsed.data.beforeClipId ?? null;
			let insertIndex = document.timeline.clips.length;
			if (beforeClipId !== null) {
				insertIndex = document.timeline.clips.findIndex((c) => c.id === beforeClipId);
				if (insertIndex < 0) {
					return failure(`Unknown clip: ${beforeClipId}. ${clipRoster(document)}`);
				}
			}
			let next: AxcutDocument;
			try {
				next = insertClip(
					document,
					assetId,
					insertIndex,
					"agent",
					parsed.data.reason ?? "",
					parsed.data.sourceStartSec ?? 0,
					parsed.data.sourceEndSec,
				);
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			const previousIds = new Set(document.timeline.clips.map((c) => c.id));
			const placed = next.timeline.clips.find((c) => !previousIds.has(c.id));
			const order = next.timeline.clips.map((c) => c.id);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					clipId: placed?.id ?? next.timeline.clips[Math.min(insertIndex, order.length - 1)]?.id,
					assetId,
					clipOrder: order,
					sourceStartSec: placed?.sourceStartSec,
					sourceEndSec: placed?.sourceEndSec ?? null,
					timelineStartSec: placed?.timelineStartSec,
					timelineEndSec: placed?.timelineEndSec,
					joined: placed == null,
				}),
				summary: `placed ${asset.label} ${beforeClipId ? `before ${beforeClipId}` : "at the end"}`,
			};
		}

		case "splitClip": {
			const parsed = splitClipArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { clipId, atSourceSec } = parsed.data;
			if (!document.timeline.clips.some((c) => c.id === clipId)) {
				return failure(`Unknown clip: ${clipId}. ${clipRoster(document)}`);
			}
			let next: AxcutDocument;
			try {
				next = splitClip(document, clipId, atSourceSec, "agent");
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			const leftIdx = next.timeline.clips.findIndex((c) => c.id === clipId);
			const left = leftIdx >= 0 ? next.timeline.clips[leftIdx] : undefined;
			const right = leftIdx >= 0 ? next.timeline.clips[leftIdx + 1] : undefined;
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					leftClipId: left?.id ?? clipId,
					rightClipId: right?.id ?? null,
					atSourceSec,
					clipOrder: next.timeline.clips.map((c) => c.id),
					note: "Style the join with setClipIncomingTransition on rightClipId (dissolve / wipe / …).",
				}),
				summary: `split ${clipId} at ${formatSec(atSourceSec)}`,
			};
		}

		case "duplicateClip": {
			const parsed = duplicateClipArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { clipId } = parsed.data;
			if (!document.timeline.clips.some((c) => c.id === clipId)) {
				return failure(`Unknown clip: ${clipId}. ${clipRoster(document)}`);
			}
			let next: AxcutDocument;
			try {
				next = duplicateClip(document, clipId, "agent", parsed.data.reason ?? "");
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			const previousIds = new Set(document.timeline.clips.map((c) => c.id));
			const copy = next.timeline.clips.find((c) => !previousIds.has(c.id));
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					clipId,
					copyClipId: copy?.id ?? null,
					clipOrder: next.timeline.clips.map((c) => c.id),
				}),
				summary: `duplicated ${clipId}`,
			};
		}

		case "importMedia": {
			const parsed = importMediaArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			let abs: string;
			try {
				abs = assertSafeLocalMediaPath(parsed.data.path, "importMedia path");
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			if (!existsSync(abs)) {
				return failure(`importMedia path not found: ${abs}`);
			}
			const ext = extname(abs).toLowerCase();
			const videoExt = new Set([
				".mp4",
				".mov",
				".webm",
				".mkv",
				".m4v",
				".avi",
				".mpeg",
				".mpg",
			]);
			const audioExt = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);
			const kind =
				parsed.data.kind ??
				(audioExt.has(ext) ? "audio" : videoExt.has(ext) ? "video" : null);
			if (!kind) {
				return failure(
					`Unsupported media extension ${ext || "(none)"}. Use a common video or audio file.`,
				);
			}
			if (kind === "video" && !videoExt.has(ext)) {
				return failure(`Extension ${ext} is not a supported video type for importMedia.`);
			}
			if (kind === "audio" && !audioExt.has(ext)) {
				return failure(`Extension ${ext} is not a supported audio type for importMedia.`);
			}
			// The probed duration (async media step) wins over a model-supplied
			// guess; the model's value is only a fallback when ffprobe is missing.
			const probed = options?.prepared?.mediaDurationSec;
			const durationSec =
				typeof probed === "number" && probed > 0 ? probed : parsed.data.durationSec;
			if (durationSec == null || !(durationSec > 0)) {
				return failure(
					"Could not probe media duration. Pass durationSec (seconds) and call importMedia again.",
				);
			}
			let sizeBytes: number | undefined;
			try {
				sizeBytes = statSync(abs).size;
			} catch {
				sizeBytes = undefined;
			}
			const assetId = createId("asset");
			const label = parsed.data.label?.trim() || basename(abs);
			const asset = {
				id: assetId,
				kind,
				label,
				originalPath: abs,
				durationSec,
				sizeBytes,
				cameraTrack: null,
			} as AxcutDocument["assets"][number];
			const claimsPrimary = kind !== "audio" && !document.project.primaryAssetId;
			let next: AxcutDocument = {
				...document,
				assets: [...document.assets, asset],
				project: {
					...document.project,
					...(claimsPrimary ? { primaryAssetId: assetId } : {}),
					updatedAt: new Date().toISOString(),
				},
			};
			const place =
				parsed.data.placeOnTimeline ?? kind === "video";
			let clipId: string | null = null;
			if (place && kind === "video") {
				const beforeClipId = parsed.data.beforeClipId ?? null;
				let insertIndex = next.timeline.clips.length;
				if (beforeClipId !== null) {
					insertIndex = next.timeline.clips.findIndex((c) => c.id === beforeClipId);
					if (insertIndex < 0) {
						return failure(`Unknown clip: ${beforeClipId}. ${clipRoster(document)}`);
					}
				}
				try {
					const beforeIds = new Set(next.timeline.clips.map((c) => c.id));
					next = insertClip(next, assetId, insertIndex, "agent", `Imported ${label}`);
					clipId = next.timeline.clips.find((c) => !beforeIds.has(c.id))?.id ?? null;
				} catch (err) {
					return failure(err instanceof Error ? err.message : String(err));
				}
			}
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					assetId,
					kind,
					durationSec,
					placedClipId: clipId,
					placeOnTimeline: place && kind === "video",
					note:
						kind === "audio"
							? "Audio asset imported — use addAudio to lay it on a voiceover/music lane."
							: clipId
								? "Video placed on the timeline."
								: "Video asset imported — use addClip to place it.",
				}),
				summary:
					kind === "audio"
						? `imported audio ${label}`
						: clipId
							? `imported and placed ${label}`
							: `imported ${label}`,
			};
		}

		case "insertStartThumbnail": {
			const parsed = insertStartThumbnailArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const existing = findStartThumbnailClip(document);
			if (existing && !parsed.data.replace) {
				return failure(
					`A start thumbnail already exists (clip ${existing.clipId}, "${existing.label}" at index ${existing.index}). ` +
						`Do not stack another opener — keep it, or pass replace:true to swap it. ` +
						`For polish/attractive asks, use setEditorSettings, addGraphic overlays, and setClipIncomingTransition instead.`,
				);
			}
			const baked = options?.prepared?.startThumbnail;
			if (!baked) {
				if (options?.prepared?.renderError) {
					return failure(`Could not render the start thumbnail: ${options.prepared.renderError}`);
				}
				if (!resolveFfmpeg()?.trim()) {
					return failure(
						"insertStartThumbnail needs ffmpeg (bundled OpenScreen ffmpeg missing). Cannot bake a start clip.",
					);
				}
				if (
					!parsed.data.imagePath?.trim() &&
					!parsed.data.image?.trim() &&
					!graphicCaption(parsed.data.text ?? "", parsed.data.subtext)
				) {
					return failure("insertStartThumbnail needs imagePath, image, or text");
				}
				return failure(
					"insertStartThumbnail renders video, so it must be called directly as an agent tool " +
						"(not inside a batch). Check that imagePath is an absolute path to a readable image.",
				);
			}
			try {
				const placed = insertStartThumbnailClip(document, {
					mp4Path: baked.mp4Path,
					durationSec: baked.durationSec,
					label: parsed.data.label,
					removeStartOverlays: parsed.data.removeStartOverlays,
					replace: parsed.data.replace === true,
				});
				return {
					ok: true,
					document: placed.document,
					resultJson: JSON.stringify({
						assetId: placed.assetId,
						clipId: placed.clipId,
						durationSec: baked.durationSec,
						width: baked.width,
						height: baked.height,
						replaced: Boolean(existing && parsed.data.replace),
						removedOverlayIds: placed.removedAnnotationIds,
						note:
							"Opening segment is a real timeline clip at index 0 — the recording plays after it. " +
							"This is not an overlay; nothing is covered on the take.",
					}),
					summary: existing && parsed.data.replace
						? `replaced start thumbnail (${baked.durationSec.toFixed(1)}s), recording follows`
						: `inserted full-frame start thumbnail (${baked.durationSec.toFixed(1)}s), recording follows`,
				};
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
		}

		case "setClipCrop": {
			const parsed = setClipCropArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { clipId, crop } = parsed.data;
			if (!document.timeline.clips.some((c) => c.id === clipId)) {
				return failure(`Unknown clip: ${clipId}. ${clipRoster(document)}`);
			}
			let next: AxcutDocument;
			try {
				next = setClipCropRegion(document, clipId, crop);
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			const after = next.timeline.clips.find((c) => c.id === clipId);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					clipId,
					cropRegion: after?.cropRegion ?? null,
				}),
				summary:
					after?.cropRegion != null
						? `cropped ${clipId} to ${after.cropRegion.width}×${after.cropRegion.height} at (${after.cropRegion.x}, ${after.cropRegion.y})`
						: `cleared crop on ${clipId}`,
			};
		}

		case "setClipIncomingTransition": {
			const parsed = setClipIncomingTransitionArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { clipId } = parsed.data;
			const clip = document.timeline.clips.find((c) => c.id === clipId);
			if (!clip) return failure(`Unknown clip: ${clipId}. ${clipRoster(document)}`);
			const clipIndex = document.timeline.clips.findIndex((c) => c.id === clipId);
			if (clipIndex <= 0) {
				const clipCount = document.timeline.clips.length;
				return failure(
					`Cannot set an incoming transition on the first timeline clip (${clipId} at index ${clipIndex}). ` +
						`Transitions only apply to the JOIN into clip index ≥ 1. ` +
						(clipCount < 2
							? `Only ${clipCount} clip on the timeline — either skip the dissolve, or splitClip(this clip, atSourceSec) first and then setClipIncomingTransition on the RIGHT half id from the split result. Do not retry the same first-clip call.`
							: `Pass a non-first clipId (${clipRoster(document)}). If you just removed a start thumbnail, the recording is now index 0 with no join — splitClip mid-take if you still want a dissolve, otherwise skip it and finish.`),
				);
			}
			// Resolve through the canonical Transition Registry.
			const transitionId = resolveTransitionId({
				transitionId: parsed.data.transitionId,
				kind: parsed.data.kind ?? null,
			});
			const validated = validateAndClampTransitionApply({
				transitionId,
				durationSec: parsed.data.durationSec,
				params: parsed.data.params ?? null,
			});
			if (!validated.ok) return failure(validated.reason);
			const isCut = validated.transitionId === "openscreen.cut";
			const durationSec = validated.durationSec;
			const kind = isCut ? ("cut" as const) : ("dissolve" as const);
			const params =
				Object.keys(validated.params).length > 0 && !isCut ? validated.params : undefined;
			const nextClips = document.timeline.clips.map((c) =>
				c.id === clipId
					? {
							...c,
							incomingTransition: {
								kind,
								transitionId: validated.transitionId,
								...(isCut ? {} : { durationSec }),
								...(params ? { params } : {}),
							},
						}
					: c,
			);
			const next = {
				...document,
				timeline: { ...document.timeline, clips: nextClips },
			};
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					clipId,
					kind,
					transitionId: validated.transitionId,
					durationSec: isCut ? 0 : durationSec,
					clamped: validated.clamped,
					rejectedKeys: validated.rejectedKeys,
					legacyKind: legacyKindToTransitionId(kind),
				}),
				summary: `set incoming ${validated.transitionId} on ${clipId}${isCut ? "" : ` (${durationSec}s)`}`,
			};
		}

		case "moveClip": {
			const parsed = moveClipArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { clipId } = parsed.data;
			const beforeClipId = parsed.data.beforeClipId ?? null;
			const clips = document.timeline.clips;
			const moving = clips.find((c) => c.id === clipId);
			if (!moving) return failure(`Unknown clip: ${clipId}. ${clipRoster(document)}`);
			if (beforeClipId === clipId) {
				return failure(
					`beforeClipId must name a different clip than clipId (both were ${clipId}); ` +
						`pass null to move it last.`,
				);
			}
			const remaining = clips.filter((c) => c.id !== clipId);
			let insertIndex = remaining.length;
			if (beforeClipId !== null) {
				insertIndex = remaining.findIndex((c) => c.id === beforeClipId);
				if (insertIndex < 0) {
					return failure(`Unknown clip: ${beforeClipId}. ${clipRoster(document)}`);
				}
			}
			let next: AxcutDocument;
			try {
				// The clip's OWN origin is passed back in: `moveClip` stamps whatever it
				// is given onto the clip, and a reorder is not a change of provenance —
				// a user's clip stays the user's. Empty reason keeps its label.
				next = moveClip(document, clipId, insertIndex, moving.origin, "");
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			const order = next.timeline.clips.map((c) => c.id);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					clipId,
					beforeClipId,
					clipOrder: order,
					// Nothing is destroyed by a reorder — say so, since the alternative
					// tool the model used to reach for destroyed plenty in silence.
					trimCount: next.timeline.trimRanges.length,
					...droppedByEdit(document, next),
				}),
				summary:
					`moved ${clipId} ${beforeClipId ? `before ${beforeClipId}` : "to the end"} ` +
					`(order: ${order.join(" → ")})`,
			};
		}

		case "replaceTimeline": {
			const parsed = replaceTimelineArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			// ponytail: refuse on the DAMAGE, not on the provenance. The old guard
			// tested `origin === "user"`, which missed every clip the agent itself had
			// placed — and disarmed itself, since a rebuild stamps its own output
			// `origin: "agent"`. `planTimelineReplacement` answers the question that
			// actually matters: what would this call cost?
			const plan = planTimelineReplacement(document, parsed.data.intervals);
			const objections: string[] = [];
			if (plan.reorderRequested) {
				objections.push(
					"- the intervals are not in ascending order, so this reads as a REORDER. " +
						"replaceTimeline sorts and merges its intervals, so the swap could not happen " +
						"at all: use moveClip (it preserves ids, trims and anchored effects).",
				);
			}
			if (plan.lostClipIds.length > 0) {
				objections.push(
					`- these clips would be merged away or dropped: ${plan.lostClipIds.join(", ")}. ` +
						"To shorten one, use setClipRange; to delete one, removeClip; to change the " +
						"order, moveClip; to cut a span inside one, addTrim.",
				);
			}
			if (plan.slidRegionIds.length > 0) {
				objections.push(
					`- these effects are anchored to those clips and would be re-anchored onto ` +
						`whatever footage moved under them: ${plan.slidRegionIds.join(", ")}.`,
				);
			}
			if (objections.length > 0) {
				return {
					ok: false,
					resultJson: JSON.stringify({
						error:
							"Refused: replaceTimeline would destroy work you were not asked to touch. " +
							"Nothing was modified.\n" +
							`${objections.join("\n")}\n` +
							"replaceTimeline rebuilds the whole timeline and is only for an explicit " +
							"'start over with these intervals' on a timeline with nothing to lose.",
						code: "would_destroy",
						reorderRequested: plan.reorderRequested,
						lostClipIds: plan.lostClipIds,
						slidRegionIds: plan.slidRegionIds,
					}),
				};
			}
			let next: AxcutDocument;
			try {
				next = replaceTimeline(document, parsed.data.intervals, parsed.data.reason, "agent");
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			const kept = parsed.data.intervals.length;
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					clipCount: next.timeline.clips.length,
					trimCount: next.timeline.trimRanges.length,
					// What survived, by name. The old result reported two counts, and a
					// model reading `trimCount: 0` after a rebuild had nothing telling it
					// WHICH cut had ceased to exist — which is what made "the silence trim
					// is preserved" so easy to write.
					preservedClipIds: plan.slots.map((s) => s.keepClipId).filter((id): id is string => !!id),
					...(plan.absorbedTrimIds.length ? { absorbedTrimIds: plan.absorbedTrimIds } : {}),
					...(plan.clippedTrimIds.length ? { clippedTrimIds: plan.clippedTrimIds } : {}),
				}),
				summary:
					`rebuilt timeline from ${kept} interval${kept === 1 ? "" : "s"} ` +
					`(${next.timeline.clips.length} clips, ${next.timeline.trimRanges.length} trims)` +
					(plan.absorbedTrimIds.length
						? ` — ${plan.absorbedTrimIds.join(", ")} now fall outside the kept spans`
						: ""),
			};
		}

		case "addZoom": {
			const parsed = addZoomArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const startMs = toMs(Math.min(parsed.data.startSec, parsed.data.endSec));
			const endMs = toMs(Math.max(parsed.data.startSec, parsed.data.endSec));
			const zoom = {
				id: createId("zoom"),
				startMs,
				endMs,
				depth: parsed.data.depth as 1 | 2 | 3 | 4 | 5 | 6,
				focus: parsed.data.focus,
				focusMode: "manual" as const,
				source: "manual" as const,
			};
			const placed = anchorForAgent(zoom, document, "zoom");
			const landing = landingOf(placed, document);
			if (!landing.anchored) return coversNoClip("zoom", startMs / 1000, endMs / 1000, document);
			const next: AxcutDocument = {
				...document,
				zoomRanges: [...document.zoomRanges, ...placed] as AxcutDocument["zoomRanges"],
			};
			// Measured over what was STORED, never over what was asked for: `placed`
			// is the clamped, ventilated truth, so the report cannot end up
			// describing a window the zoom does not occupy.
			const anchor = cursorAnchorReport(placed, document, zoom.focus, options?.cursorTelemetry);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					zoomId: landing.ids[0],
					depth: zoom.depth,
					// The depth alone is an ordinal; reported on its own it is what the
					// model turns into "3×" for a frame that renders 1.80×.
					renderedScale: effectiveZoomScale(zoom),
					...landingReport(landing, startMs / 1000, endMs / 1000),
					...(anchor ? { cursorAnchor: anchor } : {}),
				}),
				summary:
					`added zoom ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)} ` +
					`at ${effectiveZoomScale(zoom).toFixed(2)}×` +
					landingSuffix(landing, startMs / 1000, endMs / 1000),
			};
		}

		case "addZooms": {
			const parsed = addZoomsArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			return applyBatch(document, "addZoom", parsed.data.regions, options, "zoom");
		}

		case "setZoom": {
			const parsed = setZoomArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { zoomId } = parsed.data;
			const existing = document.zoomRanges.find((z) => z.id === zoomId);
			if (!existing) return failure(`Unknown zoom: ${zoomId}`);
			const { startMs, endMs } = resolveSpanMs(existing, parsed.data.startSec, parsed.data.endSec);
			const zoomPill = new Set(resolvePillIds(document.zoomRanges, zoomId));
			// ponytail: a depth write CLEARS customScale, and that is the whole
			// point. `effectiveZoomScale` returns customScale when it is set, so on a
			// migrated v1.7 zoom (`migrate.ts:185` keeps both fields) a `setZoom
			// {depth: 6}` used to store the 6, answer ok, and leave the picture at
			// 1.10× forever — a write that could not do what every layer involved
			// believed it did. Dropping the override is destructive of a fine-tuned
			// value, so it happens only on an explicit depth write (which IS a
			// request to change the strength) and is named in the result and the
			// summary rather than done quietly.
			const clearsCustomScale =
				parsed.data.depth !== undefined &&
				document.zoomRanges.some((z) => zoomPill.has(z.id) && z.customScale != null);
			const rebuiltZooms = replacePillSpan(
				// payload edits first, applied to every region under the pill…
				document.zoomRanges.map((z) => {
					if (!zoomPill.has(z.id)) return z;
					const { customScale, ...rest } = z;
					return {
						...(clearsCustomScale ? rest : z),
						...(parsed.data.depth !== undefined
							? { depth: parsed.data.depth as 1 | 2 | 3 | 4 | 5 | 6 }
							: {}),
						...(parsed.data.focus ? { focus: parsed.data.focus } : {}),
					};
				}),
				// …then the span: clamped against different-property pills, then re-ventilated.
				zoomId,
				startMs,
				endMs,
				document.timeline.clips,
				() => createId("zoom"),
			) as AxcutDocument["zoomRanges"];
			const landing = landingAfterPillEdit(document.zoomRanges, rebuiltZooms, zoomPill, document);
			if (!landing.anchored) return coversNoClip("zoom", startMs / 1000, endMs / 1000, document);
			const next: AxcutDocument = { ...document, zoomRanges: rebuiltZooms };
			// Read back off the document, not off the request: the pill may have been
			// re-ventilated, and `renderedScale` is the only number the viewer sees.
			const landed = new Set(landing.ids);
			const strength = rebuiltZooms.find((z) => landed.has(z.id));
			// The EFFECTIVE focus, read off the document exactly like `renderedScale`
			// is: a setZoom that moved only the span still gets told what its
			// untouched focus now looks at, which is most of the reason to reshape a
			// zoom at all.
			const anchor = strength
				? cursorAnchorReport(
						rebuiltZooms.filter((z) => landed.has(z.id)),
						document,
						strength.focus,
						options?.cursorTelemetry,
					)
				: undefined;
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					zoomId: landing.ids[0] ?? zoomId,
					...(strength
						? { depth: strength.depth, renderedScale: effectiveZoomScale(strength) }
						: {}),
					...(clearsCustomScale ? { clearedCustomScale: true } : {}),
					...landingReport(landing, startMs / 1000, endMs / 1000),
					...(anchor ? { cursorAnchor: anchor } : {}),
				}),
				summary:
					`updated zoom ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)}` +
					(strength ? ` at ${effectiveZoomScale(strength).toFixed(2)}×` : "") +
					(clearsCustomScale ? " (cleared its custom scale so the depth applies)" : "") +
					landingSuffix(landing, startMs / 1000, endMs / 1000),
			};
		}

		case "addSpeed": {
			const parsed = addSpeedArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const startMs = toMs(Math.min(parsed.data.startSec, parsed.data.endSec));
			const endMs = toMs(Math.max(parsed.data.startSec, parsed.data.endSec));
			const legacy = (document.legacyEditor as Record<string, unknown>) ?? {};
			const prev = (legacy.speedRegions as unknown[] | undefined) ?? [];
			const region = { id: createId("speed"), startMs, endMs, speed: parsed.data.speed };
			const placed = anchorForAgent(region, document, "speed");
			const landing = landingOf(placed, document);
			if (!landing.anchored) {
				return coversNoClip("speed region", startMs / 1000, endMs / 1000, document);
			}
			const next: AxcutDocument = {
				...document,
				legacyEditor: { ...legacy, speedRegions: [...prev, ...placed] },
			};
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					speedId: landing.ids[0],
					speed: region.speed,
					...landingReport(landing, startMs / 1000, endMs / 1000),
				}),
				summary:
					`added ${parsed.data.speed}× speed ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)}` +
					landingSuffix(landing, startMs / 1000, endMs / 1000),
			};
		}

		case "setSpeed": {
			const parsed = setSpeedArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const legacy = (document.legacyEditor as Record<string, unknown>) ?? {};
			const prev =
				(legacy.speedRegions as
					| Array<{ id: string; startMs: number; endMs: number; speed: number }>
					| undefined) ?? [];
			const existing = prev.find((s) => s.id === parsed.data.speedId);
			const speedPill = new Set(resolvePillIds(prev, parsed.data.speedId));
			if (!existing) return failure(`Unknown speed region: ${parsed.data.speedId}`);
			const { startMs, endMs } = resolveSpanMs(existing, parsed.data.startSec, parsed.data.endSec);
			const speed = parsed.data.speed ?? existing.speed;
			const rebuiltSpeeds = replacePillSpan(
				prev.map((s) => (speedPill.has(s.id) ? { ...s, speed } : s)),
				parsed.data.speedId,
				startMs,
				endMs,
				document.timeline.clips,
				() => createId("speed"),
			);
			const landing = landingAfterPillEdit(prev, rebuiltSpeeds, speedPill, document);
			if (!landing.anchored) {
				return coversNoClip("speed region", startMs / 1000, endMs / 1000, document);
			}
			const next: AxcutDocument = {
				...document,
				legacyEditor: { ...legacy, speedRegions: rebuiltSpeeds },
			};
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					speedId: landing.ids[0] ?? parsed.data.speedId,
					speed,
					...landingReport(landing, startMs / 1000, endMs / 1000),
				}),
				summary:
					`updated speed to ${speed}× over ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)}` +
					landingSuffix(landing, startMs / 1000, endMs / 1000),
			};
		}

		case "addAnnotation": {
			const parsed = addAnnotationArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const startMs = toMs(Math.min(parsed.data.startSec, parsed.data.endSec));
			const endMs = toMs(Math.max(parsed.data.startSec, parsed.data.endSec));
			if (parsed.data.type === "image") {
				try {
					const graphic = resolveGraphic({
						kind: "image",
						text: parsed.data.text,
						image: parsed.data.image,
						x: parsed.data.x,
						y: parsed.data.y,
						width: parsed.data.width,
						height: parsed.data.height,
						color: parsed.data.color,
						backgroundColor: parsed.data.backgroundColor,
					});
					return commitAnnotation(
						document,
						{
							type: graphic.type,
							content: graphic.content,
							textContent: graphic.textContent,
							imageContent: graphic.imageContent,
							position: graphic.position,
							size: graphic.size,
							style: graphic.style,
							zIndex: document.annotations.length + 1,
						},
						startMs,
						endMs,
						`added image ${graphic.textContent ? `"${graphic.textContent.slice(0, 24)}" ` : ""}`,
					);
				} catch (err) {
					return failure(err instanceof Error ? err.message : String(err));
				}
			}
			const ann = {
				type: parsed.data.type,
				content: parsed.data.text,
				textContent: parsed.data.text,
				position: { x: parsed.data.x, y: parsed.data.y },
				size: { width: parsed.data.width, height: parsed.data.height },
				style: {
					color: parsed.data.color,
					backgroundColor: parsed.data.backgroundColor,
					fontSize: parsed.data.fontSize,
					fontFamily: "Inter",
					fontWeight: parsed.data.fontWeight,
					fontStyle: "normal" as const,
					textDecoration: "none" as const,
					textAlign: parsed.data.textAlign,
					textAnimation: parsed.data.textAnimation,
				},
				zIndex: document.annotations.length + 1,
				...(parsed.data.type === "figure"
					? {
							figureData: {
								arrowDirection: parsed.data.arrowDirection,
								color: parsed.data.color,
								strokeWidth: 4,
							},
						}
					: {}),
				...(parsed.data.type === "blur"
					? {
							blurData: {
								type: parsed.data.blurKind,
								shape: parsed.data.blurShape,
								color: "white" as const,
								intensity: 12,
								blockSize: 12,
							},
						}
					: {}),
			};
			return commitAnnotation(
				document,
				ann,
				startMs,
				endMs,
				`added ${parsed.data.type} ${parsed.data.text ? `"${parsed.data.text.slice(0, 24)}" ` : ""}`,
			);
		}

		case "addPrivacyCover": {
			const parsed = addPrivacyCoverArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const extent = editedExtentSec(document);
			if (extent.endSec <= extent.startSec) {
				return failure("No clips on the timeline — place footage before adding a privacy cover.");
			}
			const startSec = parsed.data.startSec ?? extent.startSec;
			const endSec = parsed.data.endSec ?? extent.endSec;
			if (endSec <= startSec) {
				return failure("addPrivacyCover needs endSec > startSec");
			}
			const startMs = toMs(startSec);
			const endMs = toMs(endSec);
			let working = document;
			const removedIds: string[] = [];
			if (parsed.data.replaceExistingBlurs !== false) {
				const keep = working.annotations.filter((a) => {
					if (a.type !== "blur") return true;
					const aStart = a.startMs ?? 0;
					const aEnd = a.endMs ?? 0;
					const overlaps = aStart < endMs && aEnd > startMs;
					if (overlaps) {
						removedIds.push(a.id);
						return false;
					}
					return true;
				});
				if (removedIds.length > 0) {
					working = { ...working, annotations: keep };
				}
			}
			const rects: Array<{ x: number; y: number; width: number; height: number; label: string }> =
				[
					{
						...PRIVACY_PRESET_RECTS[parsed.data.preset],
						label: parsed.data.preset,
					},
				];
			const alsoTopRight =
				parsed.data.includeTopRight ?? parsed.data.preset === "topStrip";
			if (alsoTopRight && parsed.data.preset !== "topRight" && parsed.data.preset !== "fullFrame") {
				rects.push({ ...PRIVACY_PRESET_RECTS.topRight, label: "topRight" });
			}
			const appliedIds: string[] = [];
			let lastSummary = "";
			for (const rect of rects) {
				const ann = {
					type: "blur" as const,
					content: `privacy:${rect.label}`,
					textContent: `privacy:${rect.label}`,
					position: { x: rect.x, y: rect.y },
					size: { width: rect.width, height: rect.height },
					style: {
						color: "#ffffff",
						backgroundColor: "transparent",
						fontSize: 32,
						fontFamily: "Inter",
						fontWeight: "bold" as const,
						fontStyle: "normal" as const,
						textDecoration: "none" as const,
						textAlign: "center" as const,
						textAnimation: "none" as const,
					},
					zIndex: working.annotations.length + 1 + appliedIds.length,
					blurData: {
						type: parsed.data.blurKind,
						shape: "rectangle" as const,
						color: "white" as const,
						intensity: 16,
						blockSize: 14,
					},
				};
				const result = commitAnnotation(
					working,
					ann,
					startMs,
					endMs,
					`privacy ${rect.label} (${parsed.data.blurKind})`,
				);
				if (!result.ok || !result.document) return result;
				working = result.document;
				lastSummary = result.summary ?? lastSummary;
				try {
					const payload = JSON.parse(result.resultJson) as { annotationId?: string };
					if (payload.annotationId) appliedIds.push(payload.annotationId);
				} catch {
					/* ignore */
				}
			}
			return {
				ok: true,
				document: working,
				resultJson: JSON.stringify({
					preset: parsed.data.preset,
					blurKind: parsed.data.blurKind,
					annotationIds: appliedIds,
					removedBlurIds: removedIds,
					startSec,
					endSec,
					note:
						"Privacy mosaics are burnt into preview/export. Scrub the opening and any tab-switch moments; if an edge is still readable, call again with preset topRight or fullFrame.",
				}),
				summary:
					`privacy cover ${parsed.data.preset}` +
					(alsoTopRight && parsed.data.preset === "topStrip" ? "+topRight" : "") +
					` ${formatSec(startSec)} – ${formatSec(endSec)}` +
					(removedIds.length ? ` (replaced ${removedIds.length} prior blur(s))` : "") +
					(lastSummary.includes("clamped") ? " (clamped to clips)" : ""),
			};
		}

		case "addCursorHighlight": {
			const parsed = addCursorHighlightArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const load = options?.cursorTelemetry?.load;
			if (!load || load.status === "unavailable") {
				return failure(
					"addCursorHighlight needs cursor telemetry for this recording. " +
						"No reader is available in this run — cannot place pointer-following highlights.",
				);
			}
			if (load.status === "no-sidecar") {
				return failure(
					"This asset has no cursor-telemetry sidecar, so pointer-following highlights cannot be placed. " +
						"Use addGraphic / addAnnotation with explicit x/y instead, or record with OpenScreen cursor capture.",
				);
			}
			const asset = document.assets.find((a) => a.id === load.assetId);
			const track = buildCursorTrack({
				assetId: load.assetId,
				samples: load.samples,
				durationSec: load.durationSec ?? asset?.durationSec ?? 0,
				clips: document.timeline.clips,
				trimRanges: document.timeline.trimRanges,
			});
			const extent = editedExtentSec(document);
			const winStart = parsed.data.startSec ?? extent.startSec;
			const winEnd = parsed.data.endSec ?? extent.endSec;
			if (winEnd <= winStart) {
				return failure("addCursorHighlight needs endSec > startSec");
			}
			const every = parsed.data.everySec;
			const size =
				parsed.data.sizePct ??
				(parsed.data.style === "character" ? 22 : parsed.data.style === "callout" ? 16 : 14);
			const half = size / 2;
			type Pick = { virtualSec: number; cx: number; cy: number; kind?: string };
			const candidates: Pick[] = [];
			for (const p of track.points) {
				if (p.trimmed) continue;
				const v = p.virtualSec ?? p.atSec;
				if (v < winStart || v > winEnd) continue;
				if (parsed.data.clicksOnly) {
					const k = (p.kind ?? "").toLowerCase();
					if (k !== "click" && k !== "mouseup" && k !== "mousedown") continue;
				}
				candidates.push({ virtualSec: v, cx: p.cx, cy: p.cy, kind: p.kind });
			}
			if (candidates.length === 0) {
				return failure(
					parsed.data.clicksOnly
						? "No click samples in that span — try clicksOnly:false or widen the window."
						: "No cursor samples in that span — check getCursorTrack / hasCursorTelemetry.",
				);
			}
			const picked: Pick[] = [];
			let lastKept = Number.NEGATIVE_INFINITY;
			for (const c of candidates) {
				if (c.virtualSec - lastKept < every && picked.length > 0) continue;
				picked.push(c);
				lastKept = c.virtualSec;
				if (picked.length >= parsed.data.maxPoints) break;
			}
			let working = document;
			const replaceExisting =
				parsed.data.replaceExisting ?? parsed.data.style === "character";
			if (replaceExisting) {
				const startMsWin = toMs(winStart);
				const endMsWin = toMs(winEnd);
				working = {
					...working,
					annotations: working.annotations.filter((a) => {
						const text = String(a.textContent ?? a.content ?? "");
						const knownCharacter =
							text === "Coach" ||
							text === "Guide" ||
							text === "Pointer" ||
							text === "Spark" ||
							text === "Bot" ||
							text === "Follow along" ||
							BUILTIN_CHARACTER_LABELS.has(text);
						const isCursorOverlay =
							(a.type === "blur" && text.startsWith("cursor-")) ||
							(a.type === "image" && knownCharacter);
						if (!isCursorOverlay) return true;
						const aStart = a.startMs ?? 0;
						const aEnd = a.endMs ?? 0;
						return !(aStart < endMsWin && aEnd > startMsWin);
					}),
				};
			}
			const appliedIds: string[] = [];
			const holdSec =
				parsed.data.style === "character"
					? Math.min(Math.max(every * 1.6, 1.8), 3.5)
					: Math.min(Math.max(every * 0.85, 0.28), 1.2);
			let characterImage: string | null = null;
			let characterMeta: { characterId: string; source: string } | null = null;
			if (parsed.data.style === "character") {
				try {
					const resolved = resolveCharacterImage(
						document,
						{
							characterId: parsed.data.characterId ?? "guide",
							characterPath: parsed.data.characterPath,
							image: parsed.data.image,
							label: parsed.data.label,
						},
						{ ffmpegPath: resolveFfmpeg() },
					);
					characterImage = resolved.image;
					characterMeta = { characterId: resolved.characterId, source: resolved.source };
				} catch (err) {
					return failure(err instanceof Error ? err.message : String(err));
				}
			}
			for (const c of picked) {
				const x = Math.min(100 - size, Math.max(0, c.cx * 100 - half));
				const y = Math.min(100 - size, Math.max(0, c.cy * 100 - half));
				const startMs = toMs(c.virtualSec);
				const endMs = toMs(Math.min(winEnd, c.virtualSec + holdSec));
				let ann: Record<string, unknown>;
				if (parsed.data.style === "callout") {
					ann = {
						type: "figure",
						content: parsed.data.label?.trim() || "Look",
						textContent: parsed.data.label?.trim() || "Look",
						position: { x, y },
						size: { width: size, height: size * 0.7 },
						style: {
							color: "#ffcc00",
							backgroundColor: "transparent",
							fontSize: 28,
							fontFamily: "Inter",
							fontWeight: "bold",
							fontStyle: "normal",
							textDecoration: "none",
							textAlign: "center",
							textAnimation: "pop",
						},
						zIndex: working.annotations.length + 1 + appliedIds.length,
						figureData: {
							arrowDirection: "down",
							color: "#ffcc00",
							strokeWidth: 4,
						},
					};
				} else if (parsed.data.style === "character" && characterImage) {
					const label =
						parsed.data.label?.trim() ||
						BUILTIN_CHARACTERS.find((c) => c.id === characterMeta?.characterId)?.label ||
						characterMeta?.characterId ||
						"Guide";
					ann = {
						type: "image",
						content: characterImage,
						textContent: label,
						imageContent: characterImage,
						position: { x, y },
						size: { width: size, height: size },
						style: {
							color: "#ffffff",
							backgroundColor: "transparent",
							fontSize: 24,
							fontFamily: "Inter",
							fontWeight: "bold",
							fontStyle: "normal",
							textDecoration: "none",
							textAlign: "center",
							textAnimation: "none",
						},
						zIndex: working.annotations.length + 1 + appliedIds.length,
					};
				} else {
					ann = {
						type: "blur",
						content: `cursor-${parsed.data.style}`,
						textContent: `cursor-${parsed.data.style}`,
						position: { x, y },
						size: { width: size, height: size },
						style: {
							color: "#ffffff",
							backgroundColor: "transparent",
							fontSize: 24,
							fontFamily: "Inter",
							fontWeight: "bold",
							fontStyle: "normal",
							textDecoration: "none",
							textAlign: "center",
							textAnimation: "none",
						},
						zIndex: working.annotations.length + 1 + appliedIds.length,
						blurData: {
							type: "mosaic",
							shape: parsed.data.style === "finger" ? "oval" : "oval",
							color: "white",
							intensity: parsed.data.style === "ring" ? 10 : 14,
							blockSize: parsed.data.style === "ring" ? 10 : 16,
						},
					};
				}
				const result = commitAnnotation(
					working,
					ann,
					startMs,
					endMs,
					`cursor ${parsed.data.style}`,
				);
				if (!result.ok || !result.document) {
					if (appliedIds.length === 0) return result;
					break;
				}
				working = result.document;
				try {
					const payload = JSON.parse(result.resultJson) as { annotationId?: string };
					if (payload.annotationId) appliedIds.push(payload.annotationId);
				} catch {
					/* ignore */
				}
			}
			if (appliedIds.length === 0) {
				return failure("No cursor highlights could be placed on playable clips.");
			}
			return {
				ok: true,
				document: working,
				resultJson: JSON.stringify({
					style: parsed.data.style,
					placed: appliedIds.length,
					annotationIds: appliedIds,
					windowSec: { start: winStart, end: winEnd },
					...(characterMeta ? { character: characterMeta } : {}),
					note:
						parsed.data.style === "character"
							? "Character plates follow pointer samples — not lip-synced speech. Choose characterId via listCharacters, pass characterPath for an upload/agent PNG, or registerCharacter then reuse the id."
							: "Highlights track recorded pointer positions on the edited timeline.",
				}),
				summary: `cursor ${parsed.data.style}${characterMeta ? `:${characterMeta.characterId}` : ""} ×${appliedIds.length} (${formatSec(winStart)} – ${formatSec(winEnd)})`,
			};
		}

		case "listMotionTemplates": {
			return {
				ok: true,
				resultJson: JSON.stringify({
					templates: MOTION_TEMPLATE_IDS.map((id) => ({
						id,
						params: TEMPLATE_DESCRIPTIONS[id],
						defaultSec: TEMPLATE_DEFAULT_SEC[id],
					})),
					overlays: OVERLAY_TEMPLATE_IDS.map((id) => ({
						id,
						params: OVERLAY_DESCRIPTIONS[id],
						defaultSec: OVERLAY_DEFAULT_SEC[id],
					})),
					overlayNote:
						"Overlays go on top of the recording with addMotionOverlay (box x/y/width/height in % of the recording, startSec). " +
						"Custom overlay HTML must keep a transparent background; the page is the box size.",
					brandKit: storedBrandKit(document) ?? options?.prepared?.videoBrandKit ?? readBrandKit(document),
					brandKitSource: storedBrandKit(document)
						? storedBrandKit(document)?.source === "video"
							? "taken from the video"
							: "set for this project"
						: options?.prepared?.videoBrandKit
							? "read from the video (used until setBrandKit changes it)"
							: "default (no readable video)",
					customHtml:
						"Or write your own composition: html (or htmlPath) with CSS/Web Animations, requestAnimationFrame, or window.render(t) drawing a canvas. " +
						"Time starts at 0 on load and is stepped frame by frame; no network. Page size = project canvas. " +
						"Use the brandKit colours and font above in your own HTML so it matches the video.",
				}),
			};
		}

		case "setBrandKit": {
			const parsed = setBrandKitArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { fromVideo, ...rest } = parsed.data;
			const videoKit = options?.prepared?.videoBrandKit;
			if (fromVideo && !videoKit) {
				return failure(
					"Could not read colours from the recording (no readable video in the project, or ffmpeg is missing). Set the colours directly instead.",
				);
			}
			const touchesColours = ["primary", "secondary", "background", "text"].some((k) => k in rest);
			const patch = {
				...(fromVideo && videoKit
					? { primary: videoKit.primary, secondary: videoKit.secondary, background: videoKit.background, text: videoKit.text }
					: {}),
				...rest,
				source: fromVideo && !touchesColours ? ("video" as const) : ("manual" as const),
			};
			if (patch.logoPath) {
				try {
					patch.logoPath = assertSafeLocalMediaPath(patch.logoPath, "logoPath");
				} catch (err) {
					return failure(err instanceof Error ? err.message : String(err));
				}
				if (!existsSync(patch.logoPath)) return failure(`logoPath not found: ${patch.logoPath}`);
			}
			const { document: next, kit } = writeBrandKit(document, patch);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({ brandKit: kit }),
				summary: `${fromVideo ? "brand kit taken from the video" : "brand kit set"} (${kit.primary} / ${kit.secondary}, ${kit.fontFamily}, ${kit.style})`,
			};
		}

		case "createMotionClip": {
			const parsed = createMotionClipArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const clip = options?.prepared?.motionClip;
			if (!clip) {
				if (options?.prepared?.renderError) {
					return failure(`Could not render the motion graphic: ${options.prepared.renderError}`);
				}
				return failure(
					resolveFfmpeg()?.trim()
						? "createMotionClip renders video, so it must be called directly as an agent tool (not inside a batch)."
						: "createMotionClip needs ffmpeg (bundled OpenScreen ffmpeg missing).",
				);
			}
			const place = parsed.data.place as MotionPlacement;
			let placed: ReturnType<typeof placeMotionClip> | null = null;
			try {
				placed =
					place === "none"
						? null
						: placeMotionClip(
								document,
								{ mp4Path: clip.mp4Path, durationSec: clip.durationSec, label: clip.label },
								place,
							);
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			return {
				ok: true,
				...(placed ? { document: withVideoBrandKit(placed.document, options?.prepared) } : {}),
				resultJson: JSON.stringify({
					videoPath: clip.mp4Path,
					exportedPaths: [clip.mp4Path],
					durationSec: clip.durationSec,
					width: clip.width,
					height: clip.height,
					fps: clip.fps,
					placed: placed
						? { clipId: placed.clipId, where: placed.where, snappedToSec: placed.snappedToSec }
						: null,
					checks: { ok: clip.check.ok, problems: clip.check.problems },
					previewFrames: clip.check.framePaths,
					pageErrors: clip.pageErrors,
					...(clip.upgradedFrom
						? {
								template: "productIntro",
								upgraded:
									"titleCard was rendered as productIntro — the premium opener that shows the real app. Fill productIntro yourself next time (features, stat, url); pass simple:true to titleCard only if the user asked for a plain card.",
							}
						: {}),
					note: clip.check.ok
						? placed
							? "Rendered, checked and placed. Look at previewFrames to confirm it reads well."
							: "Rendered and checked — preview only. Place it with placeMotionClip(videoPath, place) when it looks right."
						: "Rendered, but the automatic check found problems — fix the composition and render again before placing.",
				}),
				summary: placed
					? `motion graphic "${clip.label}" (${clip.durationSec.toFixed(1)}s) ${placed.where}`
					: `motion graphic "${clip.label}" rendered (${clip.durationSec.toFixed(1)}s) for preview`,
			};
		}

		case "sampleFrames": {
			const parsed = sampleFramesArgs.safeParse(args ?? {});
			if (!parsed.success) return failure(parsed.error.message);
			const sampled = options?.prepared?.sampledFrames;
			if (!sampled) {
				if (options?.prepared?.renderError) return failure(`Could not sample frames: ${options.prepared.renderError}`);
				return failure(
					resolveFfmpeg()?.trim()
						? "sampleFrames extracts video frames, so it must be called directly as an agent tool (not inside a batch)."
						: "sampleFrames needs ffmpeg (bundled OpenScreen ffmpeg missing).",
				);
			}
			const blank = sampled.frames.filter((f) => f.blank).map((f) => f.timeSec);
			return {
				ok: true,
				resultJson: JSON.stringify({
					from: parsed.data.from,
					durationSec: Math.round(sampled.durationSec * 100) / 100,
					frames: sampled.frames,
					...(blank.length ? { warning: `Blank (single-colour) frames at ${blank.join(", ")} s — something is covering the picture or nothing is drawn.` } : {}),
					notes: sampled.notes,
					howToUse:
						"Read each frame path to look at it. Check: the subject is visible and not cut off, text is readable and not covering the key UI, graphics match the video's colours, nothing is blank or frozen. Fix what's wrong, then sample again.",
				}),
			};
		}

		case "addMotionOverlay": {
			const parsed = addMotionOverlayArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const overlay = options?.prepared?.motionOverlay;
			if (!overlay) {
				if (options?.prepared?.renderError) {
					return failure(`Could not render the overlay: ${options.prepared.renderError}`);
				}
				return failure(
					"addMotionOverlay renders frames, so it must be called directly as an agent tool (not inside a batch).",
				);
			}
			const d = parsed.data;
			const width = Math.min(d.width, 100 - d.x);
			const height = Math.min(d.height, 100 - d.y);
			const startMs = Math.round(d.startSec * 1000);
			const endMs = Math.round((d.startSec + overlay.durationSec) * 1000);
			const label = d.label ?? (d.template ? `${d.template} overlay` : "motion overlay");
			const seqRef = { dir: overlay.dir, fps: overlay.fps, frameCount: overlay.frameCount };
			const result = commitAnnotation(
				document,
				{
					type: "image",
					content: overlay.posterDataUri,
					imageContent: encodeImageSequenceRef(seqRef),
					textContent: label,
					position: { x: d.x, y: d.y },
					size: { width, height },
					style: {
						color: "#ffffff",
						backgroundColor: "transparent",
						fontSize: 32,
						fontFamily: "Inter",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						textAlign: "center",
						textAnimation: "none",
					},
					zIndex: document.annotations.length + 1,
				},
				startMs,
				endMs,
				`animated overlay "${label}"`,
			);
			if (!result.ok || !result.document) return result;
			// A split overlay (it straddles a cut) continues where it left off.
			const before = new Set(document.annotations.map((a) => a.id));
			const fresh = result.document.annotations.filter((a) => !before.has(a.id));
			const firstStart = Math.min(...fresh.map((a) => a.startMs));
			const nextDoc: AxcutDocument = {
				...result.document,
				annotations: result.document.annotations.map((a) =>
					before.has(a.id) || a.startMs === firstStart
						? a
						: { ...a, imageContent: encodeImageSequenceRef({ ...seqRef, offsetSec: (a.startMs - firstStart) / 1000 }) },
				) as AxcutDocument["annotations"],
			};
			let payload: Record<string, unknown> = {};
			try {
				payload = JSON.parse(result.resultJson) as Record<string, unknown>;
			} catch {
				/* keep empty */
			}
			return {
				...result,
				document: withVideoBrandKit(nextDoc, options?.prepared),
				resultJson: JSON.stringify({
					...payload,
					framesDir: overlay.dir,
					frameCount: overlay.frameCount,
					fps: overlay.fps,
					durationSec: overlay.durationSec,
					previewFrames: [overlay.posterPath],
					pageErrors: overlay.pageErrors,
					note: "Placed on top of the recording. Look at previewFrames to check it reads well; move or resize it with setAnnotation.",
				}),
			};
		}

		case "placeMotionClip": {
			const parsed = placeMotionClipArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			let videoPath: string;
			try {
				videoPath = assertSafeLocalMediaPath(parsed.data.videoPath, "videoPath");
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
			if (!existsSync(videoPath)) return failure(`videoPath not found: ${videoPath}`);
			const probed = options?.prepared?.mediaDurationSec;
			const durationSec = typeof probed === "number" && probed > 0 ? probed : parsed.data.durationSec;
			if (!durationSec) return failure("Could not read the clip length. Pass durationSec.");
			try {
				const placed = placeMotionClip(
					document,
					{ mp4Path: videoPath, durationSec, label: parsed.data.label ?? basename(videoPath) },
					parsed.data.place as MotionPlacement,
				);
				return {
					ok: true,
					document: placed.document,
					resultJson: JSON.stringify({
						clipId: placed.clipId,
						where: placed.where,
						snappedToSec: placed.snappedToSec,
					}),
					summary: `placed motion graphic ${placed.where}`,
				};
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
		}

		case "listCharacters": {
			return {
				ok: true,
				resultJson: JSON.stringify(listCharactersCatalog(document)),
			};
		}

		case "createMotionGraphicPreview": {
			const parsed = createMotionGraphicPreviewArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const baked = options?.prepared?.motionGraphic;
			if (!baked) {
				if (options?.prepared?.renderError) {
					return failure(`Could not render the motion graphic: ${options.prepared.renderError}`);
				}
				return failure(
					resolveFfmpeg()?.trim()
						? "createMotionGraphicPreview renders video, so it must be called directly as an agent tool (not inside a batch)."
						: "createMotionGraphicPreview needs ffmpeg (bundled OpenScreen ffmpeg missing).",
				);
			}
			return {
				ok: true,
				resultJson: JSON.stringify({
					previewOnly: true,
					placed: 0,
					videoPath: baked.mp4Path,
					exportedPaths: [baked.mp4Path],
					exportDir: baked.exportDir,
					durationSec: baked.durationSec,
					slideCount: baked.slideCount,
					titles: parsed.data.titles,
					note: "Motion graphic MP4 for chat preview — NOT on the timeline. When the user says use on video: importMedia(path) or insertStartThumbnail / addGraphic.",
				}),
				summary: `motion graphic preview ×${baked.slideCount} slides (${baked.durationSec.toFixed(1)}s) → ${baked.mp4Path}`,
			};
		}

		case "registerCharacter": {
			const parsed = registerCharacterArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			if (!parsed.data.imagePath?.trim() && !parsed.data.image?.trim()) {
				return failure("registerCharacter needs imagePath or image");
			}
			try {
				const placed = registerCharacterOnDocument(
					document,
					{
						id: parsed.data.id,
						label: parsed.data.label,
						imagePath: parsed.data.imagePath,
						image: parsed.data.image,
					},
					{ ffmpegPath: resolveFfmpeg() },
				);
				return {
					ok: true,
					document: placed.document,
					resultJson: JSON.stringify({
						character: {
							id: placed.character.id,
							label: placed.character.label,
							hasPath: Boolean(placed.character.imagePath),
							hasImage: Boolean(placed.character.image),
						},
						note: "Reuse with addCursorHighlight({ style:\"character\", characterId }) or addGraphic({ kind:\"image\", characterId }).",
					}),
					summary: `registered character "${placed.character.id}"`,
				};
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
		}

		case "addBeatGraphics": {
			const parsed = addBeatGraphicsArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const previewOnly = parsed.data.previewOnly === true;
			const count = parsed.data.count;
			const kind = parsed.data.kind;
			const characterIds = ["guide", "pointer", "coach", "spark", "bot"] as const;
			const exportDir = resolveGeneratedGraphicsDir(document);

			const renderOne = (i: number, label: string): string | { error: string } => {
				if (kind === "character") {
					const cid =
						(parsed.data.characterId as (typeof characterIds)[number] | undefined) ??
						characterIds[i % characterIds.length];
					try {
						return resolveCharacterImage(
							document,
							{ characterId: cid, label },
							{ ffmpegPath: resolveFfmpeg() },
						).image;
					} catch (err) {
						return { error: err instanceof Error ? err.message : String(err) };
					}
				}
				return renderPlatePng({
					kind: kind === "title" ? "title" : kind === "lowerThird" ? "lowerThird" : "badge",
					text: label,
					color: "#ffffff",
					backgroundColor: kind === "title" ? "rgba(0,0,0,0.62)" : "rgba(17,24,39,0.92)",
				});
			};

			if (previewOnly) {
				const exportedPaths: string[] = [];
				for (let i = 0; i < count; i++) {
					const label =
						parsed.data.texts?.[i]?.trim() ||
						(kind === "character"
							? BUILTIN_CHARACTERS[i % BUILTIN_CHARACTERS.length]?.label || `Beat ${i + 1}`
							: `Beat ${i + 1}`);
					const image = renderOne(i, label);
					if (typeof image !== "string") return failure(image.error);
					const filePath = maybeWriteGeneratedGraphic(
						exportDir,
						`preview-${i + 1}-${slugLabel(label)}`,
						image,
					);
					if (filePath) exportedPaths.push(filePath);
				}
				if (exportedPaths.length === 0) {
					return failure(
						"Could not write preview graphics — project needs a media path under Application Support.",
					);
				}
				return {
					ok: true,
					document,
					resultJson: JSON.stringify({
						kind,
						previewOnly: true,
						placed: 0,
						exportedPaths,
						exportDir: exportDir ?? undefined,
						note: "Preview files for chat — NOT on the timeline yet. Place with addGraphic(imagePath) when the user says use on video.",
					}),
					summary: `preview graphics ×${exportedPaths.length} (${kind}) — chat only; files → ${exportDir}`,
				};
			}

			const extent = editedExtentSec(document);
			if (extent.endSec <= extent.startSec) {
				return failure("No clips on the timeline — place footage before adding beat graphics.");
			}
			const winStart = parsed.data.startSec ?? extent.startSec;
			const winEnd = parsed.data.endSec ?? extent.endSec;
			if (winEnd - winStart < 0.5) {
				return failure("addBeatGraphics needs a longer timeline window");
			}
			const hold = parsed.data.holdSec ?? 2.2;
			const sizePct =
				parsed.data.sizePct ?? (kind === "character" ? 28 : kind === "title" ? 70 : 56);
			const yDefault =
				kind === "lowerThird" ? 74 : kind === "title" ? 14 : kind === "character" ? 58 : 8;
			const y = parsed.data.y ?? yDefault;
			// Keep plate aspect: badges are ~4.4:1; characters are square. A square box
			// on a wide plate squashes text so users think "nothing was created".
			const width =
				kind === "character"
					? Math.min(40, sizePct)
					: kind === "title"
						? Math.min(90, sizePct)
						: Math.min(70, sizePct);
			const height =
				kind === "character"
					? width
					: kind === "title"
						? Math.min(22, width * 0.22)
						: Math.min(16, width * 0.24);
			const x = Math.max(0, (100 - width) / 2);
			const span = winEnd - winStart;
			const step = span / count;
			let working = document;
			const appliedIds: string[] = [];
			const exportedPaths: string[] = [];
			for (let i = 0; i < count; i++) {
				const t0 = winStart + step * i + Math.min(0.15, step * 0.08);
				const t1 = Math.min(winEnd, t0 + Math.min(hold, step * 0.85));
				const label =
					parsed.data.texts?.[i]?.trim() ||
					(kind === "character"
						? BUILTIN_CHARACTERS[i % BUILTIN_CHARACTERS.length]?.label || `Beat ${i + 1}`
						: `Beat ${i + 1}`);
				const startMs = toMs(t0);
				const endMs = toMs(t1);
				const imageOrErr = renderOne(i, label);
				if (typeof imageOrErr !== "string") return failure(imageOrErr.error);
				const imageDataUri = imageOrErr;
				const ann: Record<string, unknown> = {
					type: "image",
					content: imageDataUri,
					textContent: label,
					imageContent: imageDataUri,
					position: { x, y },
					size: { width, height },
					style: {
						color: "#ffffff",
						backgroundColor: "transparent",
						fontSize: kind === "character" ? 24 : 28,
						fontFamily: "Inter",
						fontWeight: "bold",
						fontStyle: "normal",
						textDecoration: "none",
						textAlign: "center",
						textAnimation: kind === "character" ? "pop" : "fade",
					},
					zIndex: working.annotations.length + 1 + appliedIds.length,
				};
				const filePath = maybeWriteGeneratedGraphic(
					exportDir,
					`${i + 1}-${slugLabel(label)}`,
					imageDataUri,
				);
				if (filePath) exportedPaths.push(filePath);
				const result = commitAnnotation(
					working,
					ann,
					startMs,
					endMs,
					`beat ${i + 1} ${kind}`,
				);
				if (!result.ok || !result.document) {
					if (appliedIds.length === 0) return result;
					break;
				}
				working = result.document;
				try {
					const payload = JSON.parse(result.resultJson) as { annotationId?: string };
					if (payload.annotationId) appliedIds.push(payload.annotationId);
				} catch {
					/* ignore */
				}
			}
			if (appliedIds.length === 0) {
				return failure("No beat graphics could be placed.");
			}
			return {
				ok: true,
				document: working,
				resultJson: JSON.stringify({
					kind,
					placed: appliedIds.length,
					annotationIds: appliedIds,
					windowSec: { start: winStart, end: winEnd },
					exportedPaths,
					exportDir: exportDir ?? undefined,
					note:
						"Images are ON the video preview (scrub to each beat). " +
						(exportedPaths.length
							? `Also written as PNG files under ${exportDir}.`
							: "They live in the project file — not only as chat text."),
				}),
				summary: `beat graphics ×${appliedIds.length} (${kind}) across ${formatSec(winStart)} – ${formatSec(winEnd)}${
					exportedPaths.length ? `; files → ${exportDir}` : ""
				}`,
			};
		}

		case "addGraphic": {
			const parsed = addGraphicArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const startMs = toMs(Math.min(parsed.data.startSec, parsed.data.endSec));
			const endMs = toMs(Math.max(parsed.data.startSec, parsed.data.endSec));
			try {
				let image = parsed.data.image;
				if (parsed.data.imagePath) {
					image = loadImageFileAsDataUri(parsed.data.imagePath, {
						ffmpegPath: resolveFfmpeg(),
					});
				} else if (parsed.data.characterId || parsed.data.characterPath) {
					image = resolveCharacterImage(
						document,
						{
							characterId: parsed.data.characterId,
							characterPath: parsed.data.characterPath,
							image: parsed.data.image,
							label: parsed.data.text,
						},
						{ ffmpegPath: resolveFfmpeg() },
					).image;
				}
				const graphic = resolveGraphic({
					...parsed.data,
					kind:
						image && (parsed.data.characterId || parsed.data.characterPath)
							? "image"
							: parsed.data.kind,
					image,
				});
				// Near-full-bleed plate at t≈0 is almost always meant as an opening
				// segment — as an overlay it hides the take. Force the right tool.
				const isStartCoverIntent =
					startMs <= 500 &&
					endMs - startMs >= 800 &&
					graphic.size.width >= 70 &&
					graphic.size.height >= 70 &&
					(parsed.data.kind === "intro" ||
						parsed.data.kind === "image" ||
						parsed.data.kind === "outro");
				if (isStartCoverIntent && parsed.data.kind !== "outro") {
					return failure(
						"Full-bleed graphic at the start would cover the recording. " +
							"Use insertStartThumbnail(imagePath|image|text, durationSec) so it becomes " +
							"its own opening timeline clip; the take plays after it.",
					);
				}
				return commitAnnotation(
					document,
					{
						type: graphic.type,
						content: graphic.content,
						textContent: graphic.textContent,
						...(graphic.imageContent ? { imageContent: graphic.imageContent } : {}),
						position: graphic.position,
						size: graphic.size,
						style: graphic.style,
						zIndex: document.annotations.length + 1,
						...(graphic.figureData ? { figureData: graphic.figureData } : {}),
					},
					startMs,
					endMs,
					`added ${graphic.summaryLabel} (merged into video)`,
				);
			} catch (err) {
				return failure(err instanceof Error ? err.message : String(err));
			}
		}

		case "setAnnotation": {
			const parsed = setAnnotationArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			if (parsed.data.image !== undefined) {
				try {
					parsed.data.image = assertImageDataUri(parsed.data.image);
				} catch (err) {
					return failure(err instanceof Error ? err.message : String(err));
				}
			}
			const { annotationId } = parsed.data;
			const existing = document.annotations.find((a) => a.id === annotationId);
			const annPill = new Set(resolvePillIds(document.annotations, annotationId));
			if (!existing) return failure(`Unknown annotation: ${annotationId}`);
			const { startMs, endMs } = resolveSpanMs(existing, parsed.data.startSec, parsed.data.endSec);
			const rebuiltAnnotations = replacePillSpan(
				document.annotations.map((a) =>
					annPill.has(a.id)
						? {
								...a,
								...(parsed.data.text !== undefined
									? a.type === "image"
										? { textContent: parsed.data.text }
										: { content: parsed.data.text, textContent: parsed.data.text }
									: {}),
								...(parsed.data.image !== undefined
									? {
											type: "image" as const,
											content: parsed.data.image,
											imageContent: parsed.data.image,
										}
									: {}),
								...(parsed.data.x !== undefined || parsed.data.y !== undefined
									? {
											position: {
												x: parsed.data.x ?? a.position.x,
												y: parsed.data.y ?? a.position.y,
											},
										}
									: {}),
								...(parsed.data.width !== undefined || parsed.data.height !== undefined
									? {
											size: {
												width: parsed.data.width ?? a.size.width,
												height: parsed.data.height ?? a.size.height,
											},
										}
									: {}),
								...(parsed.data.textAnimation !== undefined ||
								parsed.data.color !== undefined ||
								parsed.data.backgroundColor !== undefined ||
								parsed.data.fontSize !== undefined ||
								parsed.data.fontWeight !== undefined ||
								parsed.data.textAlign !== undefined
									? {
											style: {
												...a.style,
												...(parsed.data.textAnimation !== undefined
													? { textAnimation: parsed.data.textAnimation }
													: {}),
												...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
												...(parsed.data.backgroundColor !== undefined
													? { backgroundColor: parsed.data.backgroundColor }
													: {}),
												...(parsed.data.fontSize !== undefined
													? { fontSize: parsed.data.fontSize }
													: {}),
												...(parsed.data.fontWeight !== undefined
													? { fontWeight: parsed.data.fontWeight }
													: {}),
												...(parsed.data.textAlign !== undefined
													? { textAlign: parsed.data.textAlign }
													: {}),
											},
										}
									: {}),
								...(parsed.data.arrowDirection !== undefined && a.figureData
									? {
											figureData: {
												...a.figureData,
												arrowDirection: parsed.data.arrowDirection,
												...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
											},
										}
									: {}),
								...(a.blurData &&
								(parsed.data.blurKind !== undefined || parsed.data.blurShape !== undefined)
									? {
											blurData: {
												...a.blurData,
												...(parsed.data.blurKind !== undefined
													? { type: parsed.data.blurKind }
													: {}),
												...(parsed.data.blurShape !== undefined
													? { shape: parsed.data.blurShape }
													: {}),
											},
										}
									: {}),
							}
						: a,
				),
				annotationId,
				startMs,
				endMs,
				document.timeline.clips,
				() => createId("ann"),
			);
			const landing = landingAfterPillEdit(
				document.annotations,
				rebuiltAnnotations,
				annPill,
				document,
			);
			if (!landing.anchored) {
				return coversNoClip("annotation", startMs / 1000, endMs / 1000, document);
			}
			const next: AxcutDocument = { ...document, annotations: rebuiltAnnotations };
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					annotationId: landing.ids[0] ?? annotationId,
					...landingReport(landing, startMs / 1000, endMs / 1000),
				}),
				summary:
					`updated annotation ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)}` +
					landingSuffix(landing, startMs / 1000, endMs / 1000),
			};
		}

		case "addCameraFullscreen": {
			const parsed = addCameraFullscreenArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const startMs = toMs(Math.min(parsed.data.startSec, parsed.data.endSec));
			const endMs = toMs(Math.max(parsed.data.startSec, parsed.data.endSec));
			const legacy = (document.legacyEditor as Record<string, unknown>) ?? {};
			const prev = (legacy.cameraFullscreenRegions as unknown[] | undefined) ?? [];
			const region = { id: createId("camfull"), startMs, endMs };
			const placed = anchorForAgent(region, document, "camfull");
			const landing = landingOf(placed, document);
			if (!landing.anchored) {
				return coversNoClip("full-camera region", startMs / 1000, endMs / 1000, document);
			}
			const blind = noCameraUnderSpan(document, landing.startSec, landing.endSec);
			if (blind) return blind;
			const next: AxcutDocument = {
				...document,
				legacyEditor: { ...legacy, cameraFullscreenRegions: [...prev, ...placed] },
			};
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					cameraFullscreenId: landing.ids[0],
					...landingReport(landing, startMs / 1000, endMs / 1000),
				}),
				summary:
					`full-camera ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)}` +
					landingSuffix(landing, startMs / 1000, endMs / 1000),
			};
		}

		case "setCameraFullscreen": {
			const parsed = setCameraFullscreenArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const legacy = (document.legacyEditor as Record<string, unknown>) ?? {};
			const prev =
				(legacy.cameraFullscreenRegions as
					| Array<{ id: string; startMs: number; endMs: number }>
					| undefined) ?? [];
			const existing = prev.find((r) => r.id === parsed.data.cameraFullscreenId);
			if (!existing)
				return failure(`Unknown full-camera region: ${parsed.data.cameraFullscreenId}`);
			const { startMs, endMs } = resolveSpanMs(existing, parsed.data.startSec, parsed.data.endSec);
			const camPill = new Set(resolvePillIds(prev, parsed.data.cameraFullscreenId));
			const rebuiltCamera = replacePillSpan(
				prev,
				parsed.data.cameraFullscreenId,
				startMs,
				endMs,
				document.timeline.clips,
				() => createId("camfull"),
			);
			const landing = landingAfterPillEdit(prev, rebuiltCamera, camPill, document);
			if (!landing.anchored) {
				return coversNoClip("full-camera region", startMs / 1000, endMs / 1000, document);
			}
			const blindMove = noCameraUnderSpan(document, landing.startSec, landing.endSec);
			if (blindMove) return blindMove;
			const next: AxcutDocument = {
				...document,
				legacyEditor: { ...legacy, cameraFullscreenRegions: rebuiltCamera },
			};
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					cameraFullscreenId: landing.ids[0] ?? parsed.data.cameraFullscreenId,
					...landingReport(landing, startMs / 1000, endMs / 1000),
				}),
				summary:
					`moved full-camera to ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)}` +
					landingSuffix(landing, startMs / 1000, endMs / 1000),
			};
		}

		case "addAudio": {
			const parsed = addAudioArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { assetId, kind, offsetSec, gainDb, fadeInSec, fadeOutSec } = parsed.data;
			const asset = document.assets.find((a) => a.id === assetId);
			// Two distinct refusals, because they need two different corrections: an
			// unknown id is a hallucinated asset, a video id is the model reaching for
			// footage. Naming the audio the project HAS is what stops the retry loop.
			if (!asset) {
				const available = document.assets.filter((a) => a.kind === "audio");
				return failure(
					`Unknown asset: ${assetId}.` +
						(available.length
							? ` Imported audio in this project: ${available.map((a) => `${a.id} (${a.label})`).join(", ")}.`
							: " This project has no imported audio; a file can only be imported or recorded from the editor, not from here."),
				);
			}
			if (asset.kind !== "audio") {
				return failure(
					`Asset ${assetId} is video, not audio. addAudio plays an imported audio file over the recording; to place footage use replaceTimeline.`,
				);
			}
			const durationSec = asset.durationSec ?? 0;
			// "Start the file at offsetSec" is only answerable when there is file left
			// there. Past the end it yields a track that plays silence, which the model
			// then reports as having placed audio. Unknown duration is not a refusal: an
			// import whose probe failed carries 0 until the renderer re-probes it.
			if (durationSec > 0 && offsetSec >= durationSec) {
				return failure(
					`offsetSec ${offsetSec}s is at or past the end of ${assetId} (${durationSec}s), so the track would play nothing. Pick an offset inside the file.`,
				);
			}
			// No endSec means "as long as the file is" — the natural span, and the one
			// the editor's own add uses, so the model never has to compute it.
			const startSec = parsed.data.startSec;
			const endSec =
				parsed.data.endSec ??
				startSec + Math.max(0.1, (durationSec || DEFAULT_AGENT_AUDIO_SEC) - offsetSec);
			const startMs = toMs(Math.min(startSec, endSec));
			const endMs = toMs(Math.max(startSec, endSec));
			const trackId = createId("audio");
			const withTrack = placeAudioTrackInDocument(
				document,
				{
					id: trackId,
					trackId,
					startMs,
					endMs,
					assetId,
					kind,
					durationSec,
					offsetMs: toMs(offsetSec),
					gainDb,
					loop: false,
					fadeInMs: toMs(fadeInSec),
					fadeOutMs: toMs(fadeOutSec),
					muted: false,
					label: asset.label,
					origin: "agent",
				} as AxcutDocument["audioTracks"][number],
				() => createId("audio"),
				"create",
			);
			if (withTrack === document) {
				return coversNoClip("audio", startMs / 1000, endMs / 1000, document);
			}
			const placed = withTrack.audioTracks.filter((t) => trackGroupId(t) === trackId);
			const next: AxcutDocument = withTrack;
			const landing = landingOf(placed, document);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					audioId: trackId,
					...landingReport(landing, startMs / 1000, endMs / 1000),
				}),
				summary:
					`added ${kind} "${asset.label}" ${formatSec(landing.startSec)} – ${formatSec(landing.endSec)}` +
					landingSuffix(landing, startMs / 1000, endMs / 1000),
			};
		}

		case "setAudio": {
			const parsed = setAudioArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { audioId } = parsed.data;
			const pill = collapseTracksToPills(document.audioTracks).find(
				(t) => trackGroupId(t) === audioId,
			);
			if (!pill) return failure(`Unknown audio track: ${audioId}`);

			if (parsed.data.offsetSec !== undefined) {
				const asset = document.assets.find((a) => a.id === pill.assetId);
				const durationSec = asset?.durationSec ?? 0;
				if (durationSec > 0 && parsed.data.offsetSec >= durationSec) {
					return failure(
						`offsetSec ${parsed.data.offsetSec}s is at or past the end of ${pill.assetId} (${durationSec}s), so the track would play nothing.`,
					);
				}
			}

			// Payload first, through the helper that keeps every fragment of the group in
			// agreement — gain, mute, loop and the offset are all track-wide, and a patch
			// that reached only one fragment would split the pill in two.
			let next = patchAudioTrack(document, audioId, {
				...(parsed.data.gainDb !== undefined ? { gainDb: parsed.data.gainDb } : {}),
				...(parsed.data.muted !== undefined ? { muted: parsed.data.muted } : {}),
				...(parsed.data.loop !== undefined ? { loop: parsed.data.loop } : {}),
				...(parsed.data.offsetSec !== undefined ? { offsetMs: toMs(parsed.data.offsetSec) } : {}),
				...(parsed.data.fadeInSec !== undefined ? { fadeInMs: toMs(parsed.data.fadeInSec) } : {}),
				...(parsed.data.fadeOutSec !== undefined
					? { fadeOutMs: toMs(parsed.data.fadeOutSec) }
					: {}),
			});

			// A span or lane change re-anchors: drop the group and lay it down again, so
			// the fragments are re-cut against the clips the new span covers rather than
			// patched in place against the old ones.
			const wantsRespan =
				parsed.data.startSec !== undefined ||
				parsed.data.endSec !== undefined ||
				parsed.data.kind !== undefined;
			if (wantsRespan) {
				const current =
					collapseTracksToPills(next.audioTracks).find((t) => trackGroupId(t) === audioId) ?? pill;
				const { startMs, endMs } = resolveSpanMs(current, parsed.data.startSec, parsed.data.endSec);
				// A `kind` flip re-clamps against the DESTINATION lane's neighbours, not the
				// one it is leaving — moving a take onto the music row must respect what is
				// already on the music row (issue #560).
				const moved = placeAudioTrackInDocument(
					next,
					{
						...current,
						id: audioId,
						trackId: audioId,
						startMs,
						endMs,
						...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
					},
					() => createId("audio"),
					"move",
				);
				if (moved === next) {
					return coversNoClip("audio", startMs / 1000, endMs / 1000, document);
				}
				next = moved;
			}

			const after = collapseTracksToPills(next.audioTracks).find(
				(t) => trackGroupId(t) === audioId,
			);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					audioId,
					startSec: roundSec(after?.startMs ?? pill.startMs),
					endSec: roundSec(after?.endMs ?? pill.endMs),
				}),
				summary: `updated audio ${audioId} ${formatSec(roundSec(after?.startMs ?? pill.startMs))} – ${formatSec(roundSec(after?.endMs ?? pill.endMs))}`,
			};
		}

		case "removeTrim": {
			const parsed = removeTrimArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { trimRangeId } = parsed.data;
			if (!document.timeline.trimRanges.some((s) => s.id === trimRangeId)) {
				return failure(`Unknown trim range: ${trimRangeId}`);
			}
			const next = removeRegion(document, "trim", trimRangeId);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({ removed: trimRangeId, kind: "trim" }),
				summary: `removed trim ${trimRangeId}`,
			};
		}

		case "removeModifier": {
			const parsed = removeModifierArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { id } = parsed.data;
			const legacy = (document.legacyEditor as Record<string, unknown>) ?? {};
			const speedRegions = (legacy.speedRegions as Array<{ id: string }> | undefined) ?? [];
			const cameraFullscreenRegions =
				(legacy.cameraFullscreenRegions as Array<{ id: string }> | undefined) ?? [];
			let kind: RegionKind | null = null;
			if (document.zoomRanges.some((z) => z.id === id)) kind = "zoom";
			else if (document.annotations.some((a) => a.id === id)) kind = "annotation";
			else if (speedRegions.some((s) => s.id === id)) kind = "speed";
			else if (cameraFullscreenRegions.some((c) => c.id === id)) kind = "cameraFullscreen";
			else if (document.audioTracks.some((t) => trackGroupId(t) === id)) kind = "audio";
			if (!kind) {
				return failure(
					`No zoom / speed / annotation / full-camera / audio modifier with id ${id}. ` +
						`For a trim use removeTrim; for a clip use removeClip.`,
				);
			}
			const next = removeRegion(document, kind, id);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({ removed: id, kind }),
				summary: `removed ${kind} ${id}`,
			};
		}

		case "removeClip": {
			const parsed = removeClipArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const { clipId } = parsed.data;
			if (!document.timeline.clips.some((c) => c.id === clipId)) {
				return failure(`Unknown clip: ${clipId}`);
			}
			const next = removeClip(document, clipId);
			const dropped = droppedByEdit(document, next);
			const casualties = dropped.droppedModifierIds.length + dropped.droppedTrimIds.length;
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					removed: clipId,
					clipCount: next.timeline.clips.length,
					...dropped,
				}),
				summary:
					`removed clip ${clipId}` +
					(casualties > 0
						? ` — dropped ${[...dropped.droppedModifierIds, ...dropped.droppedTrimIds].join(", ")}`
						: ""),
			};
		}

		case "setAspectRatio": {
			const parsed = setAspectRatioArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			if (!isAspectRatioToken(parsed.data.value)) {
				return failure(`aspectRatio "${parsed.data.value}" is not a valid W:H token`);
			}
			const next = patchLegacyEditor(document, { aspectRatio: parsed.data.value });
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({ aspectRatio: parsed.data.value }),
				summary: `aspectRatio → ${parsed.data.value}`,
			};
		}

		case "setBackground": {
			const parsed = setBackgroundArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			try {
				const wallpaper = resolveWallpaperInput(parsed.data.wallpaper);
				const next = patchLegacyEditor(document, { wallpaper });
				return {
					ok: true,
					document: next,
					resultJson: JSON.stringify({ wallpaper: wallpaper.startsWith("data:") ? "data:image/…" : wallpaper }),
					summary: `background → ${wallpaper.startsWith("data:") ? "custom image" : wallpaper}`,
				};
			} catch (error) {
				return failure(error instanceof Error ? error.message : String(error));
			}
		}

		case "setCaptionSettings": {
			const parsed = setCaptionSettingsArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const keys = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
			if (keys.length === 0) {
				return failure("setCaptionSettings needs at least one field to change");
			}
			const next = patchCaptionSettings(document, parsed.data);
			const settings = getCaptionSettings(next);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					enabled: settings.enabled,
					fontSize: settings.fontSize,
					anchorV: settings.anchorV,
					anchorH: settings.anchorH,
					insetY: settings.insetY,
					insetX: settings.insetX,
				}),
				summary: `captions → ${settings.enabled ? "on" : "off"}${parsed.data.fontSize != null ? `, ${settings.fontSize}px` : ""}`,
			};
		}

		case "setEditorSettings": {
			const parsed = setEditorSettingsArgs.safeParse(args);
			if (!parsed.success) return failure(parsed.error.message);
			const data = parsed.data;
			const patch: EditorSettingsPatch = {};
			if (data.fitClip) {
				const aspect = data.fitClipAspect?.trim() || "native";
				if (!isAspectRatioToken(aspect)) {
					return failure(`fitClipAspect "${aspect}" is not a valid W:H token`);
				}
				patch.padding = 0;
				patch.borderRadius = 0;
				patch.shadowIntensity = 0;
				patch.aspectRatio = aspect as EditorSettingsPatch["aspectRatio"];
			}
			if (data.shadowIntensity !== undefined) patch.shadowIntensity = data.shadowIntensity;
			if (data.showBlur !== undefined) patch.showBlur = data.showBlur;
			if (data.motionBlurAmount !== undefined) patch.motionBlurAmount = data.motionBlurAmount;
			if (data.borderRadius !== undefined) patch.borderRadius = data.borderRadius;
			if (data.padding !== undefined) patch.padding = data.padding;
			if (data.audioGainDb !== undefined) patch.audioGainDb = data.audioGainDb;
			if (data.autoFocusAll !== undefined) patch.autoFocusAll = data.autoFocusAll;
			if (data.webcamLayoutPreset !== undefined) {
				patch.webcamLayoutPreset = data.webcamLayoutPreset;
			}
			if (data.webcamMaskShape !== undefined) patch.webcamMaskShape = data.webcamMaskShape;
			if (data.webcamMirrored !== undefined) patch.webcamMirrored = data.webcamMirrored;
			if (data.webcamReactiveZoom !== undefined) {
				patch.webcamReactiveZoom = data.webcamReactiveZoom;
			}
			if (data.webcamSizePreset !== undefined) patch.webcamSizePreset = data.webcamSizePreset;
			if (data.webcamBackgroundMode !== undefined) {
				patch.webcamBackgroundMode = data.webcamBackgroundMode;
			}
			if (data.webcamBlurIntensity !== undefined) {
				patch.webcamBlurIntensity = data.webcamBlurIntensity;
			}
			const cursorPatch: NonNullable<EditorSettingsPatch["cursor"]> = {};
			if (data.cursorShow !== undefined) cursorPatch.show = data.cursorShow;
			if (data.cursorTheme !== undefined) cursorPatch.theme = data.cursorTheme;
			if (data.cursorSize !== undefined) cursorPatch.size = data.cursorSize;
			if (data.cursorSmoothing !== undefined) cursorPatch.smoothing = data.cursorSmoothing;
			if (Object.keys(cursorPatch).length > 0) patch.cursor = cursorPatch;
			if (Object.keys(patch).length === 0) {
				return failure("setEditorSettings needs at least one field to change");
			}
			const next = patchEditorSettings(document, patch);
			const look = getEditorSettings(next);
			return {
				ok: true,
				document: next,
				resultJson: JSON.stringify({
					padding: look.padding,
					borderRadius: look.borderRadius,
					shadowIntensity: look.shadowIntensity,
					showBlur: look.showBlur,
					aspectRatio: look.aspectRatio,
					autoFocusAll: look.autoFocusAll,
					webcamLayoutPreset: look.webcamLayoutPreset,
					cursorShow: look.cursorShow,
				}),
				summary: data.fitClip
					? `fit clip (${look.aspectRatio})`
					: `look updated (pad ${look.padding}, round ${look.borderRadius}, shadow ${look.shadowIntensity})`,
			};
		}

		case "listTransitions": {
			const parsed = listTransitionsArgs.safeParse(args ?? {});
			if (!parsed.success) return failure(parsed.error.message);
			const backend = parsed.data.backend ?? defaultGpuBackend();
			const transitions = listUserAvailableTransitions(backend).map((t) => ({
				id: t.id,
				displayName: t.displayName,
				category: t.category,
				defaultDurationSec: t.defaultDurationSec,
				autonomousEligible: t.autonomousEligible,
			}));
			return {
				ok: true,
				resultJson: JSON.stringify({
					backend,
					count: transitions.length,
					transitions,
					note: "Pass transitionId into setClipIncomingTransition on a NON-FIRST clip (after splitClip if needed).",
				}),
			};
		}

		case "listSources":
		case "recordScreen":
		case "generateCaptions":
		case "exportProject":
			return failure(
				"CLI engine is not available in this runtime. These tools run only inside the OpenScreen app agent.",
			);

		default:
			return failure(`Unknown tool: ${name}`);
	}
}

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { locateSourcePosition } from "../../../src/lib/ai-edition/timeline/virtual-preview";
import type { CursorTelemetryLoad } from "../agent-tools";
import type { MediaContextNeeds } from "../mediaContextNeeds";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { ensureCanonicalSourceDuration } from "../sourceTiming";
import { buildVisualEvidenceUserContent, toAgentUserMessage } from "./attach";
import {
	type ChangeScoreDeps,
	correlateInteractionsWithChanges,
	cullFramesToBudget,
	planRefinementMidpoints,
	refinementCandidatesFromPlan,
	scoreAdjacentVisualFrames,
} from "./change";
import {
	defaultVisualFrameCacheDir,
	type ExtractFrameDeps,
	extractVisualEvidenceFrames,
} from "./extract";
import { providerSupportsAttachedVisualFrames } from "./providers";
import {
	applyVisualFrameBudget,
	collectVisualEvidenceCandidates,
	interactionInstantsFromSamples,
} from "./sample";
import {
	CHANGE_COMPARE_HEIGHT,
	CHANGE_COMPARE_WIDTH,
	DEDUPE_WINDOW_SEC,
	MAX_REFINEMENT_FRAMES,
	MAX_REFINEMENT_LEVELS,
	MAX_VISUAL_FRAMES,
	type PreparedVisualEvidence,
	type VisualEvidenceFrame,
	type VisualEvidenceTimings,
} from "./types";

/** Minimal cursor door — same shape as CursorTelemetryReader.read, without importing service.ts. */
export interface VisualEvidenceCursorSource {
	read(input: { assetId: string; originalPath: string | null }): Promise<CursorTelemetryLoad>;
}

export interface PrepareVisualEvidenceInput {
	document: AxcutDocument;
	userMessage: string;
	provider: string;
	cursor?: VisualEvidenceCursorSource;
	extractDeps?: Partial<ExtractFrameDeps>;
	changeDeps?: Partial<ChangeScoreDeps>;
	/** When provided, overrides promptWantsVisualEvidence for this prepare call. */
	contextNeeds?: MediaContextNeeds;
	/**
	 * Hard cap after budget/refinement (Video Memory retrieval path).
	 * Defaults to MAX_VISUAL_FRAMES. Use 0 to skip attachment while still allowing
	 * callers to short-circuit via skipVisualAttachment.
	 */
	maxFrames?: number;
	/** Force skip visual attachment (speech / direct_edit retrieval). */
	skipVisualAttachment?: boolean;
	/**
	 * Coverage-first candidate pick (Retrieval whole-media): duration buckets
	 * before interaction/change dominance. FULL context leaves this unset.
	 */
	coverageFirst?: boolean;
	/** Restrict candidates to a source-time window (local / bounded queries). */
	sourceWindowSec?: { startSec: number; endSec: number };
	/** When set with coverageFirst / retrieval, compute focus window after duration probe. */
	queryScope?: import("../videoMemory/queryScope").QueryScope;
}

export interface PrepareVisualEvidenceResult {
	/** When attached, replace the plain user string with this message. */
	userMessage: { role: "user"; content: unknown };
	visualFramesSupplied: boolean;
	prepared: PreparedVisualEvidence | null;
}

function emptyTimings(): VisualEvidenceTimings {
	return {
		candidateSelectionMs: 0,
		cacheHits: 0,
		cacheMisses: 0,
		extractMs: 0,
		frameCount: 0,
		totalBytes: 0,
		attachMs: 0,
		changeDetectionMs: 0,
		refinementExtractMs: 0,
		initialFrameCount: 0,
		refinementFrameCount: 0,
	};
}

function logTimings(t: VisualEvidenceTimings): void {
	console.log(
		"[visual-evidence]",
		`candidateSelectionMs=${t.candidateSelectionMs}`,
		`cacheHits=${t.cacheHits}`,
		`cacheMisses=${t.cacheMisses}`,
		`extractMs=${t.extractMs}`,
		`changeDetectionMs=${t.changeDetectionMs ?? 0}`,
		`refinementExtractMs=${t.refinementExtractMs ?? 0}`,
		`initialFrameCount=${t.initialFrameCount ?? 0}`,
		`refinementFrameCount=${t.refinementFrameCount ?? 0}`,
		`semanticGroundingPreparationMs=${t.semanticGroundingPreparationMs ?? 0}`,
		`semanticGroundingPromptChars=${t.semanticGroundingPromptChars ?? 0}`,
		`frameCount=${t.frameCount}`,
		`totalBytes=${t.totalBytes}`,
		`attachMs=${t.attachMs}`,
	);
}

function mergeFramesByTime(
	existing: VisualEvidenceFrame[],
	added: VisualEvidenceFrame[],
): VisualEvidenceFrame[] {
	const out = [...existing];
	for (const f of added) {
		if (out.some((e) => Math.abs(e.sourceTimeSec - f.sourceTimeSec) <= DEDUPE_WINDOW_SEC)) {
			continue;
		}
		out.push(f);
	}
	return out.sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
}

/**
 * Build sampled visual evidence for one agent turn, or skip (metadata-only).
 * visualFramesSupplied is true only when JPEG parts are in the user message.
 *
 * After JPEG extract: score adjacent frames → bounded midpoint refinement →
 * cull to MAX_VISUAL_FRAMES → attach with transition metadata.
 */
export async function prepareVisualEvidenceForTurn(
	input: PrepareVisualEvidenceInput,
): Promise<PrepareVisualEvidenceResult> {
	const plain = toAgentUserMessage(input.userMessage);
	// Canonical: classifyMediaContextNeeds owns visual routing (incl. Bug-2 families).
	const needs = input.contextNeeds ?? classifyMediaContextNeeds(input.userMessage);
	const wantsVisual = needs.visual && !input.skipVisualAttachment;
	const frameCap =
		typeof input.maxFrames === "number" && Number.isFinite(input.maxFrames)
			? Math.max(0, Math.floor(input.maxFrames))
			: MAX_VISUAL_FRAMES;

	if (!wantsVisual || frameCap === 0) {
		return { userMessage: plain, visualFramesSupplied: false, prepared: null };
	}
	if (!providerSupportsAttachedVisualFrames(input.provider)) {
		return { userMessage: plain, visualFramesSupplied: false, prepared: null };
	}

	let workingDocument = input.document;
	const assetId =
		workingDocument.project.primaryAssetId ??
		workingDocument.assets.find((a) => a.kind !== "audio")?.id ??
		null;
	if (!assetId) {
		return { userMessage: plain, visualFramesSupplied: false, prepared: null };
	}

	const ensured = await ensureCanonicalSourceDuration({
		document: workingDocument,
		assetId,
		ffmpegPath: input.extractDeps?.ffmpegPath,
	});
	workingDocument = ensured.document;

	const asset = workingDocument.assets.find((a) => a.id === assetId) ?? null;
	const durationSec = ensured.canonical?.durationSec ?? asset?.durationSec;
	if (!asset?.originalPath?.trim() || !(durationSec && durationSec > 0)) {
		return { userMessage: plain, visualFramesSupplied: false, prepared: null };
	}

	let sourceWindowSec = input.sourceWindowSec;
	if (!sourceWindowSec && input.queryScope) {
		const { parseFocusWindow } = await import("../videoMemory/queryScope");
		const w = parseFocusWindow(input.userMessage, durationSec, input.queryScope);
		if (w) sourceWindowSec = { startSec: w.startSec, endSec: w.endSec };
	}

	const timings = emptyTimings();
	const selectStarted = Date.now();

	let interactions: Array<{ sourceTimeSec: number }> = [];
	const wantsCursor = input.contextNeeds != null ? needs.cursor : true;
	if (input.cursor && wantsCursor) {
		try {
			const load = await input.cursor.read({
				assetId: asset.id,
				originalPath: asset.originalPath,
			});
			if (load.status === "ok") {
				interactions = interactionInstantsFromSamples(load.samples);
			}
		} catch {
			// Cursor optional for vision — continue with periodic/boundaries.
		}
	}

	const collected = collectVisualEvidenceCandidates({
		document: workingDocument,
		assetId: asset.id,
		durationSec,
		interactions,
	});
	const windowed = sourceWindowSec
		? collected.filter(
				(c) =>
					c.sourceTimeSec >= sourceWindowSec.startSec - 0.2 &&
					c.sourceTimeSec <= sourceWindowSec.endSec + 0.2,
			)
		: collected;
	const pool = windowed.length ? windowed : collected;

	let candidates;
	if (input.coverageFirst) {
		const { applyCoverageFirstCandidateBudget } = await import("../videoMemory/coverage");
		// Leave ~35%+ of extract cap for change midpoints (Stage B raw material).
		const refineReserve = Math.max(2, Math.floor(frameCap * 0.35));
		const initialSlots = Math.max(
			3,
			Math.min(frameCap - refineReserve, Math.ceil(frameCap * 0.55)),
		);
		candidates = applyCoverageFirstCandidateBudget(pool, initialSlots, durationSec);
	} else {
		candidates = applyVisualFrameBudget(pool, frameCap);
	}
	timings.candidateSelectionMs = Date.now() - selectStarted;

	if (candidates.length === 0) {
		return { userMessage: plain, visualFramesSupplied: false, prepared: null };
	}

	const cacheDir = input.extractDeps?.cacheDir ?? (await defaultVisualFrameCacheDir());
	const extractOpts = {
		cacheDir,
		ffmpegPath: input.extractDeps?.ffmpegPath,
		runExtract: input.extractDeps?.runExtract,
	};

	const extracted = await extractVisualEvidenceFrames(candidates, asset.originalPath, extractOpts);
	timings.cacheHits = extracted.cacheHits;
	timings.cacheMisses = extracted.cacheMisses;
	timings.extractMs = extracted.extractMs;
	timings.initialFrameCount = extracted.frames.length;

	if (extracted.frames.length === 0) {
		logTimings(timings);
		return {
			userMessage: plain,
			visualFramesSupplied: false,
			prepared: {
				frames: [],
				timings,
				attached: false,
				changes: [],
				sourceDurationSec: durationSec,
			},
		};
	}

	const changeDeps: ChangeScoreDeps = {
		ffmpegPath: input.changeDeps?.ffmpegPath ?? input.extractDeps?.ffmpegPath,
		decodeGray:
			input.changeDeps?.decodeGray ??
			// Mocked extracts (runExtract without ffmpeg) still need a deterministic scorer.
			(input.extractDeps?.runExtract &&
			!input.extractDeps?.ffmpegPath &&
			!input.changeDeps?.ffmpegPath
				? async () => new Uint8Array(CHANGE_COMPARE_WIDTH * CHANGE_COMPARE_HEIGHT)
				: undefined),
	};

	let frames = [...extracted.frames].sort((a, b) => a.sourceTimeSec - b.sourceTimeSec);
	let changes: Awaited<ReturnType<typeof scoreAdjacentVisualFrames>>["changes"] = [];
	try {
		const scored = await scoreAdjacentVisualFrames(frames, changeDeps);
		timings.changeDetectionMs = (timings.changeDetectionMs ?? 0) + scored.changeDetectionMs;
		changes = scored.changes;
	} catch (err) {
		console.warn(
			"[visual-evidence] change scoring skipped",
			err instanceof Error ? err.message : err,
		);
	}

	let refinementAdded = 0;
	for (let level = 1; level <= MAX_REFINEMENT_LEVELS; level++) {
		if (refinementAdded >= MAX_REFINEMENT_FRAMES) break;
		if (frames.length >= frameCap) break;

		const plan = planRefinementMidpoints(changes, {
			level,
			alreadyPlanned: refinementAdded,
			includeModerateLargeGaps: Boolean(input.coverageFirst),
			moderateMinGapSec: 3.0,
		});
		const room = Math.min(
			MAX_REFINEMENT_FRAMES - refinementAdded,
			frameCap - frames.length,
			plan.midpoints.length,
		);
		if (room <= 0) break;

		const virtualTimeFor = (sourceTimeSec: number): number | null => {
			const pos = locateSourcePosition(
				workingDocument.timeline.clips.filter((c) => c.assetId === asset.id),
				sourceTimeSec,
				asset.id,
			);
			return pos ? pos.virtualTimeSec : null;
		};

		const refineCandidates = refinementCandidatesFromPlan(
			{ midpoints: plan.midpoints.slice(0, room) },
			asset.id,
			virtualTimeFor,
		).filter(
			(c) => !frames.some((f) => Math.abs(f.sourceTimeSec - c.sourceTimeSec) <= DEDUPE_WINDOW_SEC),
		);
		if (refineCandidates.length === 0) break;

		const refineStarted = Date.now();
		const refined = await extractVisualEvidenceFrames(
			refineCandidates,
			asset.originalPath,
			extractOpts,
		);
		timings.refinementExtractMs = (timings.refinementExtractMs ?? 0) + (Date.now() - refineStarted);
		timings.cacheHits += refined.cacheHits;
		timings.cacheMisses += refined.cacheMisses;
		timings.extractMs += refined.extractMs;
		refinementAdded += refined.frames.length;
		if (refined.frames.length === 0) break;

		frames = mergeFramesByTime(frames, refined.frames);
		try {
			const scored = await scoreAdjacentVisualFrames(frames, changeDeps);
			timings.changeDetectionMs = (timings.changeDetectionMs ?? 0) + scored.changeDetectionMs;
			changes = scored.changes;
		} catch (err) {
			console.warn(
				"[visual-evidence] change scoring skipped after refine",
				err instanceof Error ? err.message : err,
			);
			break;
		}
	}

	timings.refinementFrameCount = refinementAdded;

	if (frames.length > frameCap) {
		frames = cullFramesToBudget(frames, changes, frameCap);
		try {
			const scored = await scoreAdjacentVisualFrames(frames, changeDeps);
			timings.changeDetectionMs = (timings.changeDetectionMs ?? 0) + scored.changeDetectionMs;
			changes = scored.changes;
		} catch (err) {
			console.warn(
				"[visual-evidence] change scoring skipped after cull",
				err instanceof Error ? err.message : err,
			);
		}
	}

	timings.frameCount = frames.length;
	timings.totalBytes = frames.reduce((n, f) => n + f.byteLength, 0);

	const correlations = correlateInteractionsWithChanges(interactions, changes).map((row) => ({
		interactionSourceSec: row.interactionSourceSec,
		fromSourceTimeSec: row.change.fromSourceTimeSec,
		toSourceTimeSec: row.change.toSourceTimeSec,
		score: row.change.score,
	}));

	const attachStarted = Date.now();
	const semanticTimingOut = { preparationMs: 0, promptChars: 0 };
	const content = await buildVisualEvidenceUserContent(input.userMessage, frames, {
		changes,
		interactionCorrelations: correlations,
		includeSemanticGrounding: true,
		semanticTimingOut,
	});
	timings.semanticGroundingPreparationMs = semanticTimingOut.preparationMs;
	timings.semanticGroundingPromptChars = semanticTimingOut.promptChars;
	timings.attachMs = Date.now() - attachStarted;
	logTimings(timings);

	return {
		userMessage: toAgentUserMessage(content),
		visualFramesSupplied: true,
		prepared: { frames, timings, attached: true, changes, sourceDurationSec: durationSec },
	};
}

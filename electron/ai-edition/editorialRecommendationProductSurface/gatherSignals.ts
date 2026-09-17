/**
 * Gather local editorial signals from the live document (+ optional dead-air).
 * Does not mutate. Prefer injected detector results when provided.
 */

import { createHash } from "node:crypto";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	type CaptionLayoutResult,
	classifyDocumentCaptions,
	programmeFingerprintFromDocument,
	runCaptionLayoutForDocument,
} from "../captionLayout";
import { analyzeDeadAir, type DeadAirCandidateV1 } from "../deadAir";
import type { EditorialSignalBundle } from "../editorialOrchestration/types";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import type { VisualChange } from "../visualEvidence/types";
import { parseProductEditorialIntents, shouldRunDeadAir } from "./intents";
import type { ProductEditorialIntents } from "./types";

export interface GatherLocalSignalsArgs {
	document: AxcutDocument;
	assetId: string;
	mediaPath?: string | null;
	userMessage: string;
	aspectValue?: number;
	speechEvidence?: SpeechEvidence | null;
	preparedChanges?: VisualChange[] | null;
	ledger?: TemporalEventLedger | null;
	signal?: AbortSignal;
	/** Injected dead-air candidates (tests / warm cache). Skips ffmpeg when set. */
	injectedDeadAirCandidates?: DeadAirCandidateV1[] | null;
	/** Force dead-air on/off regardless of intent. */
	forceDeadAir?: boolean;
	bypassDeadAirCache?: boolean;
}

export interface GatheredLocalSignals {
	intents: ProductEditorialIntents;
	bundle: EditorialSignalBundle;
	captionLayout: CaptionLayoutResult | null;
	deadAirCandidates: DeadAirCandidateV1[];
	notes: string[];
	metrics: {
		gatherMs: number;
		deadAirRan: boolean;
		captionLayoutRan: boolean;
	};
}

function mediaFingerprintFor(
	assetId: string,
	mediaPath: string | null | undefined,
	durationSec: number,
): string {
	const h = createHash("sha256");
	h.update(assetId);
	h.update("|");
	h.update(mediaPath ?? "");
	h.update("|");
	h.update(String(Math.round(durationSec * 1000)));
	return h.digest("hex").slice(0, 24);
}

function aspectFromDocument(doc: AxcutDocument, fallback = 16 / 9): number {
	const legacy = doc.legacyEditor as Record<string, unknown> | null | undefined;
	const token = typeof legacy?.aspectRatio === "string" ? legacy.aspectRatio : null;
	if (token === "9:16" || token === "9x16") return 9 / 16;
	if (token === "1:1" || token === "1x1") return 1;
	if (token === "4:5" || token === "4x5") return 4 / 5;
	if (token === "16:9" || token === "16x9") return 16 / 9;
	const asset = doc.assets.find((a) => a.id === doc.project.primaryAssetId) ?? doc.assets[0];
	const w = asset && "width" in asset ? Number((asset as { width?: number }).width) : NaN;
	const h = asset && "height" in asset ? Number((asset as { height?: number }).height) : NaN;
	if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w / h;
	return fallback;
}

export async function gatherLocalEditorialSignals(
	args: GatherLocalSignalsArgs,
): Promise<GatheredLocalSignals> {
	const t0 = Date.now();
	const notes: string[] = [];
	const intents = parseProductEditorialIntents(args.userMessage);
	const aspectValue = args.aspectValue ?? aspectFromDocument(args.document);
	const asset = args.document.assets.find((a) => a.id === args.assetId) ?? args.document.assets[0];
	const mediaPath = args.mediaPath ?? asset?.originalPath ?? null;
	const durationSec = asset?.durationSec ?? 0;
	const mediaFp = mediaFingerprintFor(args.assetId, mediaPath, durationSec);
	const programmeFp = programmeFingerprintFromDocument(args.document);

	let captionLayout: CaptionLayoutResult | null = null;
	let captionLayoutRan = false;
	const transcript = args.document.transcripts.find((t) => t.assetId === args.assetId);
	const wordCount = transcript?.words?.filter((w) => w.text.trim().length > 0).length ?? 0;

	if (wordCount > 0) {
		captionLayoutRan = true;
		const { layout } = runCaptionLayoutForDocument({
			document: args.document,
			assetId: args.assetId,
			aspectValue,
			useCache: true,
		});
		captionLayout = layout;
	} else {
		notes.push("no_transcript_words");
	}

	const captionClass = classifyDocumentCaptions(args.document);
	const captionsEnabled = getCaptionSettings(args.document, aspectValue).enabled;
	const keptCues = captionLayout?.cues.filter((c) => !c.omitted) ?? [];
	const speechDurationSec =
		keptCues.length > 0
			? Math.max(...keptCues.map((c) => c.sourceEndSec)) -
				Math.min(...keptCues.map((c) => c.sourceStartSec))
			: 0;

	let deadAirCandidates: DeadAirCandidateV1[] = [];
	let deadAirRan = false;
	const runDeadAir =
		args.forceDeadAir === true ||
		(args.forceDeadAir !== false && shouldRunDeadAir(intents) && Boolean(mediaPath));

	if (args.injectedDeadAirCandidates) {
		deadAirCandidates = args.injectedDeadAirCandidates;
		notes.push("dead_air_injected");
	} else if (runDeadAir && mediaPath) {
		deadAirRan = true;
		try {
			const bundle = await analyzeDeadAir({
				assetId: args.assetId,
				mediaPath,
				document: args.document,
				speechEvidence: args.speechEvidence,
				preparedChanges: args.preparedChanges,
				ledger: args.ledger,
				signal: args.signal,
				bypassCache: args.bypassDeadAirCache,
			});
			deadAirCandidates = bundle.candidates;
			notes.push(
				`dead_air_candidates=${bundle.candidates.length}:safe=${bundle.metrics.safeCandidateCount}`,
			);
		} catch (err) {
			notes.push(
				`dead_air_failed:${err instanceof Error ? err.message.slice(0, 80) : String(err)}`,
			);
		}
	} else if (!mediaPath && shouldRunDeadAir(intents)) {
		notes.push("dead_air_skipped_no_media_path");
	} else {
		notes.push("dead_air_skipped_by_intent");
	}

	const layoutStatus =
		captionLayout?.status === "ok" ||
		captionLayout?.status === "NO_SAFE_LAYOUT" ||
		captionLayout?.status === "NO_SPEECH" ||
		captionLayout?.status === "NO_TRANSCRIPT"
			? captionLayout.status
			: wordCount > 0
				? "NO_SAFE_LAYOUT"
				: "NO_TRANSCRIPT";

	const bundle: EditorialSignalBundle = {
		assetId: args.assetId,
		mediaPath: mediaPath ?? undefined,
		mediaFingerprint: mediaFp,
		programmeFingerprint: programmeFp,
		aspectValue,
		intents: {
			wantCaptions: intents.wantCaptions || intents.wantProfessional,
			targetDurationSec: intents.targetDurationSec ?? undefined,
			speed: false,
			cropForAspect: false,
		},
		deadAir: {
			candidates: deadAirCandidates.map((c) => ({
				id: c.id,
				startSec: c.silenceRange.startSec,
				endSec: c.silenceRange.endSec,
				durationSec: c.silenceDurationSec,
				safeToPropose: c.safeToPropose,
				blockingReasons: c.blockingReasons,
				classification: c.classification,
				confidence: c.confidence === "high" ? "HIGH" : c.confidence === "medium" ? "MEDIUM" : "LOW",
			})),
		},
		captions: {
			layoutStatus,
			cueCount: keptCues.length,
			alreadyEnabled: captionsEnabled,
			manualConflict: captionClass.hasManualConflict,
			speechDurationSec,
			safeToPropose:
				layoutStatus === "ok" &&
				keptCues.length > 0 &&
				!captionsEnabled &&
				!captionClass.hasManualConflict,
		},
		visual: {
			activityRanges: [],
			stableRanges: [],
			focalTargets: [],
		},
		preservation: [
			...(captionClass.manualTextCount > 0
				? [
						{
							id: "pres_manual_caption",
							startSec: 0,
							endSec: durationSec,
							reason: "Manual caption/text annotations present",
							kind: "manual_caption" as const,
						},
					]
				: []),
		],
		timeline: {
			existingTrimCount: args.document.timeline.trimRanges.length,
			existingZoomCount: 0,
			existingSpeedCount: 0,
			existingCropCount: 0,
		},
	};

	return {
		intents,
		bundle,
		captionLayout,
		deadAirCandidates,
		notes,
		metrics: {
			gatherMs: Date.now() - t0,
			deadAirRan,
			captionLayoutRan,
		},
	};
}

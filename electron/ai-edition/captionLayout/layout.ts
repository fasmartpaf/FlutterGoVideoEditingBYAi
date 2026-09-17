/**
 * Canonical caption layout pipeline.
 */

import { createHash } from "node:crypto";
import { hasBlockingCollision } from "./collision";
import { groupWordsIntoCaptionDrafts } from "./group";
import { chooseFontSize } from "./measure";
import { choosePlacement } from "./place";
import { mergeGroupingPolicy } from "./policy";
import { buildCaptionSafeArea, placementStyle } from "./safeArea";
import type {
	CaptionCueV1,
	CaptionLayoutInput,
	CaptionLayoutResult,
	CaptionLineV1,
	CaptionPlacementId,
} from "./types";
import { CAPTION_LAYOUT_VERSION, LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID } from "./types";

function cueId(index: number, start: number, end: number): string {
	return `cap_layout_${index}_${start.toFixed(3)}_${end.toFixed(3)}`;
}

function readingSpeedOf(
	text: string,
	wordCount: number,
	durSec: number,
	policy: ReturnType<typeof mergeGroupingPolicy>,
): CaptionCueV1["readingSpeed"] {
	const dur = Math.max(1e-3, durSec);
	const cps = text.replace(/\s+/g, "").length / dur;
	const wps = wordCount / dur;
	const flags: string[] = [];
	if (cps > policy.maxCharactersPerSecond) flags.push("reading_speed_cps_high");
	if (wps > policy.maxWordsPerSecond) flags.push("reading_speed_wps_high");
	if (cps < policy.minCharactersPerSecond) flags.push("reading_speed_cps_low");
	return {
		charactersPerSecond: cps,
		wordsPerSecond: wps,
		withinPolicy: flags.filter((f) => f.includes("high")).length === 0,
		flags,
	};
}

export function layoutCaptions(input: CaptionLayoutInput): CaptionLayoutResult {
	const t0 = Date.now();
	const policy = mergeGroupingPolicy(input.policy);
	const safeArea = buildCaptionSafeArea(input.aspectValue);
	const warnings: string[] = [];
	const overflow: CaptionLayoutResult["overflow"] = [];
	const collisions: CaptionLayoutResult["collisions"] = [];
	const placementChanges: CaptionLayoutResult["placementChanges"] = [];

	if (input.words.length === 0) {
		return {
			version: 1,
			layoutVersion: CAPTION_LAYOUT_VERSION,
			providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
			assetId: input.assetId,
			aspectValue: input.aspectValue,
			cues: [],
			safeArea,
			collisions: [],
			overflow: [],
			warnings: ["no_words"],
			placementChanges: [],
			status: "NO_SPEECH",
			metrics: emptyMetrics(Date.now() - t0),
			cacheHit: false,
		};
	}

	const tGroup0 = Date.now();
	const drafts = groupWordsIntoCaptionDrafts(input.words, policy);
	const groupingMs = Date.now() - tGroup0;

	const tLine0 = Date.now();
	const maxWidthFrac = Math.min(policy.maxSafeWidthFrac, safeArea.column.width);
	let previous: CaptionPlacementId | null = null;
	const cues: CaptionCueV1[] = [];
	let anySafe = false;
	let allBlocked = drafts.length > 0;

	const tCollStart = Date.now();
	let collisionMs = 0;
	let programmeMapMs = 0;

	for (let i = 0; i < drafts.length; i++) {
		const draft = drafts[i]!;
		const tMap0 = Date.now();
		const progSpans = input.mapSourceSpanToProgramme
			? input.mapSourceSpanToProgramme(draft.sourceStartSec, draft.sourceEndSec)
			: [{ startSec: draft.sourceStartSec, endSec: draft.sourceEndSec }];
		programmeMapMs += Date.now() - tMap0;

		if (progSpans.length === 0) {
			cues.push(
				makeOmittedCue(draft, i, "removed_by_trim_or_unmapped", policy, safeArea.aspectValue),
			);
			continue;
		}

		const fontChoice = chooseFontSize(draft.text, policy, maxWidthFrac, policy.preferredMaxLines);
		if (fontChoice.overflow && fontChoice.fontSize <= policy.minFontSizePxAt1080) {
			overflow.push({
				cueId: cueId(i, draft.sourceStartSec, draft.sourceEndSec),
				reason: "text_overflow_at_min_font",
			});
			warnings.push(`overflow:${draft.text.slice(0, 24)}`);
		}

		const lines: CaptionLineV1[] = fontChoice.lines.map((text, index) => ({
			index,
			text,
			estimatedWidthFrac: fontChoice.estimatedWidths[index] ?? 0,
		}));
		const boxHeightFrac = Math.min(0.22, 0.04 + lines.length * (fontChoice.fontSize / 1080) * 1.5);

		const id = cueId(i, draft.sourceStartSec, draft.sourceEndSec);
		const tC0 = Date.now();
		const placed = choosePlacement({
			cueId: id,
			safeArea,
			boxHeightFrac,
			protectedRegions: input.protectedRegions ?? [],
			previousPlacement: previous,
			preferContinuity: input.preferPlacementContinuity !== false,
		});
		collisionMs += Date.now() - tC0;
		collisions.push(...placed.collisions);

		if (placed.changedFrom && placed.changeReason) {
			placementChanges.push({
				fromCueId: cues[cues.length - 1]?.id ?? id,
				toCueId: id,
				from: placed.changedFrom,
				to: placed.placement,
				reason: placed.changeReason,
			});
		}

		const blocked = hasBlockingCollision(placed.collisions);
		if (blocked) {
			warnings.push(`no_safe_placement:${id}`);
		} else {
			anySafe = true;
			allBlocked = false;
		}

		const style = placementStyle(placed.placement);
		const prog = progSpans[0]!;
		const dur = Math.max(1e-3, draft.sourceEndSec - draft.sourceStartSec);
		cues.push({
			id,
			sourceStartSec: draft.sourceStartSec,
			sourceEndSec: draft.sourceEndSec,
			programmeStartSec: prog.startSec,
			programmeEndSec: prog.endSec,
			words: draft.words,
			text: draft.text,
			lines,
			placement: blocked ? placed.placement : placed.placement,
			boundingBox: placed.box,
			styleRef: {
				fontSizePxAt1080: fontChoice.fontSize,
				fontFamily: "Inter",
				fontWeight: "bold",
				anchorV: style.anchorV,
				anchorH: style.anchorH,
			},
			provenanceRefs: [
				{ kind: "transcript_words", id: draft.words.map((w) => w.id).join(","), note: "verbatim" },
			],
			readingSpeed: readingSpeedOf(draft.text, draft.words.length, dur, policy),
			omitted: blocked,
			omitReason: blocked ? "NO_SAFE_LAYOUT" : undefined,
		});
		if (!blocked) previous = placed.placement;
	}
	void tCollStart;
	const lineLayoutMs = Date.now() - tLine0 - collisionMs - programmeMapMs;

	const status =
		drafts.length === 0 ? "NO_SPEECH" : allBlocked && !anySafe ? "NO_SAFE_LAYOUT" : "ok";

	if (input.manualCaptionIds && input.manualCaptionIds.length > 0) {
		warnings.push("manual_captions_present_not_overwritten");
	}

	const kept = cues.filter((c) => !c.omitted);
	const avgDur =
		kept.length === 0
			? 0
			: kept.reduce((s, c) => s + (c.sourceEndSec - c.sourceStartSec), 0) / kept.length;

	return {
		version: 1,
		layoutVersion: CAPTION_LAYOUT_VERSION,
		providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
		assetId: input.assetId,
		aspectValue: input.aspectValue,
		cues,
		safeArea,
		collisions,
		overflow,
		warnings,
		placementChanges,
		status,
		metrics: {
			cueCount: kept.length,
			avgCueDurationSec: avgDur,
			maxLines: kept.reduce((m, c) => Math.max(m, c.lines.length), 0),
			readingSpeedViolations: cues.filter((c) => !c.readingSpeed.withinPolicy).length,
			overflowCount: overflow.length,
			collisionCount: collisions.length,
			placementChangeCount: placementChanges.length,
			groupingMs,
			lineLayoutMs: Math.max(0, lineLayoutMs),
			collisionMs,
			programmeMapMs,
			totalMs: Date.now() - t0,
			additionalModelCalls: 0,
		},
		cacheHit: false,
	};
}

function makeOmittedCue(
	draft: {
		words: CaptionCueV1["words"];
		sourceStartSec: number;
		sourceEndSec: number;
		text: string;
	},
	index: number,
	reason: string,
	policy: ReturnType<typeof mergeGroupingPolicy>,
	_aspect: number,
): CaptionCueV1 {
	const dur = Math.max(1e-3, draft.sourceEndSec - draft.sourceStartSec);
	return {
		id: cueId(index, draft.sourceStartSec, draft.sourceEndSec),
		sourceStartSec: draft.sourceStartSec,
		sourceEndSec: draft.sourceEndSec,
		programmeStartSec: 0,
		programmeEndSec: 0,
		words: draft.words,
		text: draft.text,
		lines: [{ index: 0, text: draft.text, estimatedWidthFrac: 0 }],
		placement: "BOTTOM_CENTER",
		boundingBox: { x: 0, y: 0, width: 0, height: 0 },
		styleRef: {
			fontSizePxAt1080: policy.preferredFontSizePxAt1080,
			fontFamily: "Inter",
			fontWeight: "bold",
			anchorV: "bottom",
			anchorH: "center",
		},
		provenanceRefs: [],
		readingSpeed: readingSpeedOf(draft.text, draft.words.length, dur, policy),
		omitted: true,
		omitReason: reason,
	};
}

function emptyMetrics(totalMs: number): CaptionLayoutResult["metrics"] {
	return {
		cueCount: 0,
		avgCueDurationSec: 0,
		maxLines: 0,
		readingSpeedViolations: 0,
		overflowCount: 0,
		collisionCount: 0,
		placementChangeCount: 0,
		groupingMs: 0,
		lineLayoutMs: 0,
		collisionMs: 0,
		programmeMapMs: 0,
		totalMs,
		additionalModelCalls: 0,
	};
}

export function fingerprintWords(words: CaptionLayoutInput["words"]): string {
	const h = createHash("sha256");
	for (const w of words) {
		h.update(`${w.id}|${w.text}|${w.sourceStartSec}|${w.sourceEndSec};`);
	}
	return h.digest("hex").slice(0, 24);
}

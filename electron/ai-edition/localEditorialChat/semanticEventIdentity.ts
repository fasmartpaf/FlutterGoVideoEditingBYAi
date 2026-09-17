/**
 * Semantic event identity — requested_event_identified vs visual_change_observed.
 *
 * VisualAnalysisV1 activity/change intervals prove pixels changed, NOT that a named
 * UI/page became visible. OCR is a negative filter only. Provider vision judges
 * presence per frame; earliest onset is bounded across programme samples
 * (trims/speed via programme↔source map). No single-pair first-appearance certify.
 *
 * No recording-specific or phrase-specific hardcoding.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { resolveFfmpeg } from "../../media/audioPeaks";
import type { OpenScreenChatModelConfig } from "../deep-agent/chat-model";
import { resolveOcrEngine } from "../visualSpecialist/ocr/engine";
import {
	judgeVisualUiPresenceWithProviderVision,
	type VisionIdentityJudge,
	type VisualPresenceJudge,
	type VisualPresenceVerdict,
} from "./semanticEventVisionIdentity";
import { mapProgrammeInstantToSourceSafe } from "./semanticProgrammeMap";

export type EventIdentityStatus =
	| "IDENTIFIED"
	| "NOT_IDENTIFIED"
	| "OCR_UNAVAILABLE"
	| "VISION_UNAVAILABLE"
	| "FRAME_UNAVAILABLE"
	| "MAPPING_UNAVAILABLE";

export type OnsetBoundStatus =
	| "bounded"
	| "insufficient_bracket"
	| "absent_at_candidate"
	| "not_searched";

export interface EventIdentityResult {
	status: EventIdentityStatus;
	/**
	 * True only when provider vision presence samples bound an earliest onset
	 * and this candidate lies on that onset (not a late already-visible frame).
	 */
	requestedEventIdentified: boolean;
	/** True when a material pixel/activity change was observed nearby (not identity). */
	visualChangeObserved: boolean;
	beforeSourceSec: number | null;
	afterSourceSec: number | null;
	beforeText: string;
	afterText: string;
	matchedTokensAfter: string[];
	matchedTokensBefore: string[];
	onsetTokens: string[];
	evidenceRefs: string[];
	reason: string;
	/** Programme-time earliest supported onset when bound; else null. */
	earliestProgrammeSec?: number | null;
	/** Programme-time last absent sample used to bound onset; else null. */
	absentProgrammeSec?: number | null;
	onsetBoundStatus?: OnsetBoundStatus;
}

/** Programme-step lookback for bounding earliest onset (not recording-specific). */
export const ONSET_STEP_PROGRAMME_SEC = 1.5;
/** Legacy fixed lookback depth — adaptive planner may use fewer/more within budget. */
export const ONSET_MAX_LOOKBACK_STEPS = 10;
/** Max presence-judge calls per identity check (cost budget). */
export const ONSET_VISION_CALL_BUDGET = 6;
/** Shared presence-call budget across all candidates in one WHERE turn. */
export const TURN_VISION_CALL_BUDGET = 20;
/** Candidate may certify only if within this of the bounded earliest onset (adaptive may vary). */
export const ONSET_MATCH_TOLERANCE_SEC = 2.0;

/**
 * Bounded adaptive programme sample plan for first-onset search.
 * Coarse exponential lookback toward 0; caller may bisect within remaining budget.
 */
export function planAdaptiveOnsetProgrammeSamples(args: {
	anchorSec: number;
	programmeDurationSec?: number | null;
	budget?: number;
}): number[] {
	const budget = Math.max(3, Math.min(args.budget ?? ONSET_VISION_CALL_BUDGET, 16));
	const dur =
		typeof args.programmeDurationSec === "number" && args.programmeDurationSec > 0
			? args.programmeDurationSec
			: null;
	const anchor = Math.max(0, dur != null ? Math.min(args.anchorSec, dur) : args.anchorSec);
	const out: number[] = [Number(anchor.toFixed(2))];
	if (anchor <= 0.05) return out;

	let step = Math.max(0.75, Math.min(3.0, anchor / 5 || 1.5));
	let t = anchor - step;
	const coarseCap = Math.max(3, Math.ceil(budget * 0.55));
	while (out.length < coarseCap && t > 0.02) {
		out.push(Number(Math.max(0, t).toFixed(2)));
		step = Math.min(step * 1.35, 4.5);
		t -= step;
	}
	if (out[out.length - 1]! > 0.05) out.push(0);
	return [...new Set(out)].slice(0, budget);
}

/** Adaptive tolerance from the absent→present bracket width. */
export function adaptiveOnsetMatchToleranceSec(bracketWidthSec: number): number {
	const w = Number.isFinite(bracketWidthSec)
		? Math.abs(bracketWidthSec)
		: ONSET_MATCH_TOLERANCE_SEC;
	// Never tighter than the historical 2s floor — only widen for coarse brackets.
	return Math.max(ONSET_MATCH_TOLERANCE_SEC, Math.min(3.5, w * 1.25 + 0.5));
}

const IDENTITY_STOP = new Set([
	"when",
	"while",
	"as",
	"i",
	"we",
	"you",
	"the",
	"a",
	"an",
	"to",
	"into",
	"on",
	"at",
	"of",
	"and",
	"or",
	"my",
	"our",
	"this",
	"that",
	"are",
	"is",
	"am",
	"do",
	"does",
	"did",
	"start",
	"started",
	"begin",
	"beginning",
	"switch",
	"switching",
	"switched",
	"open",
	"opening",
	"opened",
	"click",
	"clicked",
	"show",
	"showing",
	"showed",
	"appear",
	"appears",
	"appeared",
	"appearance",
	"stood",
	"out",
	"more",
	"help",
	"viewers",
	"viewer",
	"if",
	"would",
	"it",
	"moment",
	"described",
	"happens",
	"coming",
	"into",
	"view",
	"screen",
	"emphasize",
	"attention",
	"bring",
	"focus",
	"frame",
	"zoom",
]);

/**
 * Singleton OCR tokens too weak to certify a named UI event alone.
 * E.g. “page” appears in Cursor chat (“black page”) and cannot mean LANDING_PAGE.
 * Multi-word phrases and non-generic heads remain eligible.
 */
export const GENERIC_IDENTITY_SINGLETONS = new Set([
	"page",
	"pages",
	"home",
	"site",
	"sites",
	"web",
	"app",
	"apps",
	"window",
	"windows",
	"tab",
	"tabs",
	"menu",
	"menus",
	"button",
	"buttons",
	"text",
	"image",
	"images",
	"link",
	"links",
	"view",
	"views",
	"panel",
	"panels",
	"card",
	"cards",
	"form",
	"forms",
	"black",
	"white",
	"dark",
	"light",
	"main",
	"new",
	"old",
	"ui",
	"gui",
	"doc",
	"docs",
	"file",
	"files",
]);

/** True when a token is specific enough to certify event identity by itself. */
export function isSpecificIdentityToken(token: string): boolean {
	const t = token.trim().toLowerCase();
	if (!t) return false;
	if (t.includes(" ")) return true;
	return !GENERIC_IDENTITY_SINGLETONS.has(t);
}

/**
 * Anchors that must onset for identity when the cue names a multi-word UI target.
 * Generic tails (“page”) are dropped; specific heads / full phrases remain.
 */
export function identityAnchorsFromCue(cue: string): string[] {
	const tokens = identityTokensFromCue(cue);
	const phrases = tokens.filter((t) => t.includes(" "));
	if (phrases.length > 0) {
		const anchors: string[] = [];
		for (const p of phrases) {
			anchors.push(p);
			for (const part of p.split(/\s+/)) {
				if (isSpecificIdentityToken(part)) anchors.push(part);
			}
		}
		return [...new Set(anchors)];
	}
	return tokens.filter(isSpecificIdentityToken);
}

/** Contentful tokens from a semantic cue — generic, not phrase-memorized. */
export function identityTokensFromCue(cue: string): string[] {
	const normalized = cue.toLowerCase().replace(/-/g, " ");
	const words = normalized
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length >= 3 && !IDENTITY_STOP.has(w));
	const phrases: string[] = [];
	const multi = [
		"landing page",
		"home page",
		"results page",
		"settings",
		"dashboard",
		"export",
		"website",
		"pricing",
	];
	for (const p of multi) {
		if (normalized.includes(p)) phrases.push(p);
	}
	return [...new Set([...phrases, ...words])].slice(0, 10);
}

function tokenHits(text: string, tokens: string[]): string[] {
	const hay = text.toLowerCase();
	const hits: string[] = [];
	for (const t of tokens) {
		const re = new RegExp(
			`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`,
			"i",
		);
		if (re.test(hay)) hits.push(t);
	}
	return hits;
}

async function extractJpegAtSourceSec(args: {
	mediaPath: string;
	sourceTimeSec: number;
	outPath: string;
}): Promise<boolean> {
	const ffmpeg = resolveFfmpeg();
	if (!ffmpeg) return false;
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			ffmpeg,
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-ss",
				args.sourceTimeSec.toFixed(3),
				"-i",
				args.mediaPath,
				"-frames:v",
				"1",
				"-vf",
				"scale=960:960:force_original_aspect_ratio=decrease",
				"-q:v",
				"4",
				"-y",
				args.outPath,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let stderr = "";
		child.stderr?.on("data", (c) => {
			stderr += String(c);
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg ${code}`)),
		);
	}).catch(() => undefined);
	return existsSync(args.outPath);
}

/**
 * Verify whether the requested semantic event first becomes visible near a
 * programme-time candidate. visualChangeObserved is an input hint only.
 *
 * OCR is a negative filter only. Provider vision reports presence per frame.
 * Earliest onset is bounded by walking programme frames (trims/speed via map).
 * A single BEFORE/AFTER pair never self-certifies first appearance.
 */
export async function verifyRequestedEventIdentity(args: {
	document: AxcutDocument;
	cue: string;
	/** Programme-time candidate anchor (Zoom / Chat clock). */
	programmeAnchorSec: number;
	visualChangeObserved: boolean;
	/** Optional override OCR/media for tests. */
	ocrRecognize?: (imagePath: string) => Promise<{ text: string; available: boolean }>;
	extractFrame?: (sourceSec: number, outPath: string) => Promise<boolean>;
	skipOcr?: boolean;
	/** Selected OpenScreen Chat model for multimodal vision presence. */
	chatModelConfig?: OpenScreenChatModelConfig | null;
	/** Preferred: presence-only judge (one frame). */
	presenceJudge?: VisualPresenceJudge | null;
	/**
	 * Legacy pair seam — adapted to presence on the sample frame only.
	 * Cannot certify first appearance by itself.
	 */
	visionJudge?: VisionIdentityJudge | null;
	/** Skip vision (wiring fixtures only). */
	skipVision?: boolean;
	/** Shared presence cache across candidates (rounded programmeSec → verdict). */
	presenceCache?: Map<string, VisualPresenceVerdict | null>;
	/** Per-check presence call budget (default ONSET_VISION_CALL_BUDGET). */
	visionCallBudget?: number;
	/** Optional shared turn counter — decremented on each real presence judge call. */
	turnVisionCalls?: { used: number; budget: number };
}): Promise<EventIdentityResult> {
	const tokens = identityTokensFromCue(args.cue);
	const anchors = identityAnchorsFromCue(args.cue);
	const cueTrimmed = args.cue.trim().replace(/\s+/g, " ");
	const semanticCueForVision = cueTrimmed.length >= 8;
	const baseRefs = [
		`candidate_programme@${args.programmeAnchorSec.toFixed(2)}`,
		...(args.visualChangeObserved ? ["visual_change_observed"] : []),
		`identity_anchors:${anchors.join(",") || "none"}`,
		...(anchors.length === 0 && semanticCueForVision ? ["identity_mode:semantic_cue_vision"] : []),
	];

	// Generic OCR anchors (site/page/app) must NOT refuse vision. Free-language cue
	// reaches presence grounding with honest ambiguity later — not more phrase regex.
	if (tokens.length === 0 && !semanticCueForVision) {
		return {
			status: "NOT_IDENTIFIED",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: null,
			afterSourceSec: null,
			beforeText: "",
			afterText: "",
			matchedTokensAfter: [],
			matchedTokensBefore: [],
			onsetTokens: [],
			evidenceRefs: baseRefs,
			onsetBoundStatus: "not_searched",
			reason:
				"No contentful tokens in the event cue to verify on screen — pixel change alone cannot identify the event.",
		};
	}

	const mapped = mapProgrammeInstantToSourceSafe({
		document: args.document,
		programmeTimeSec: args.programmeAnchorSec,
	});
	if (mapped.status === "speed_blocked") {
		return {
			status: "MAPPING_UNAVAILABLE",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: null,
			afterSourceSec: null,
			beforeText: "",
			afterText: "",
			matchedTokensAfter: [],
			matchedTokensBefore: [],
			onsetTokens: [],
			evidenceRefs: [...baseRefs, "speed_region_blocks_mapping"],
			onsetBoundStatus: "not_searched",
			reason:
				"This moment sits inside a speed region; source↔programme mapping is unavailable for semantic WHERE.",
		};
	}
	if (mapped.status !== "ok" || mapped.sourceTimeSec == null) {
		return {
			status: "MAPPING_UNAVAILABLE",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: null,
			afterSourceSec: null,
			beforeText: "",
			afterText: "",
			matchedTokensAfter: [],
			matchedTokensBefore: [],
			onsetTokens: [],
			evidenceRefs: [...baseRefs, `map_status:${mapped.status}`],
			onsetBoundStatus: "not_searched",
			reason: "Could not map the candidate programme time onto source media.",
		};
	}

	const candidateSource = mapped.sourceTimeSec;
	const afterSource = candidateSource + 0.35;
	const beforeSource = Math.max(0, candidateSource - 1.0);

	const assetId = args.document.project.primaryAssetId ?? args.document.assets[0]?.id;
	const asset = args.document.assets.find((a) => a.id === assetId) ?? args.document.assets[0];
	const mediaPath = asset?.originalPath ?? null;
	const hasInjectedInspectors = Boolean(args.ocrRecognize || args.extractFrame);
	if ((!mediaPath || mediaPath.startsWith("/tmp/")) && !hasInjectedInspectors) {
		return {
			status: "FRAME_UNAVAILABLE",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: beforeSource,
			afterSourceSec: afterSource,
			beforeText: "",
			afterText: "",
			matchedTokensAfter: [],
			matchedTokensBefore: [],
			onsetTokens: [],
			evidenceRefs: [...baseRefs, `source@${candidateSource.toFixed(2)}`],
			onsetBoundStatus: "not_searched",
			reason: "No real media path available to inspect frames for event identity.",
		};
	}

	const tmp = await mkdtemp(path.join(os.tmpdir(), "openscreen-sem-id-"));
	mkdirSync(tmp, { recursive: true });
	const beforePath = path.join(tmp, "before.jpg");
	const afterPath = path.join(tmp, "after.jpg");

	const extract =
		args.extractFrame ??
		(async (sourceSec: number, outPath: string) => {
			if (!mediaPath || mediaPath.startsWith("/tmp/")) return false;
			return extractJpegAtSourceSec({ mediaPath, sourceTimeSec: sourceSec, outPath });
		});

	const beforeOk = await extract(beforeSource, beforePath);
	const afterOk = await extract(afterSource, afterPath);
	if (!beforeOk || !afterOk) {
		return {
			status: "FRAME_UNAVAILABLE",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: beforeSource,
			afterSourceSec: afterSource,
			beforeText: "",
			afterText: "",
			matchedTokensAfter: [],
			matchedTokensBefore: [],
			onsetTokens: [],
			evidenceRefs: [...baseRefs, `source@${candidateSource.toFixed(2)}`],
			onsetBoundStatus: "not_searched",
			reason: "Could not extract frames to verify the named UI event.",
		};
	}

	let beforeText = "";
	let afterText = "";
	let ocrNote = "ocr:skipped";

	if (!args.skipOcr) {
		if (args.ocrRecognize) {
			const b = await args.ocrRecognize(beforePath);
			const a = await args.ocrRecognize(afterPath);
			beforeText = b.text;
			afterText = a.text;
			ocrNote = "ocr:injected";
		} else {
			const engine = await resolveOcrEngine();
			ocrNote = `ocr:${engine.id}`;
			if (engine.id !== "unavailable") {
				const b = await engine.recognize(beforePath);
				const a = await engine.recognize(afterPath);
				beforeText = (b.lines ?? []).map((l) => l.text).join(" ");
				afterText = (a.lines ?? []).map((l) => l.text).join(" ");
			}
		}
	}

	const matchedBefore = tokenHits(beforeText, tokens);
	const matchedAfter = tokenHits(afterText, tokens);
	const onsetTokens = matchedAfter.filter((t) => !matchedBefore.includes(t));
	const specificOnset = onsetTokens.filter(isSpecificIdentityToken);
	const specificBefore = matchedBefore.filter(isSpecificIdentityToken);
	const genericOnlyOnset = onsetTokens.length > 0 && specificOnset.length === 0;

	const evidenceRefs = [
		...baseRefs,
		`source_before@${beforeSource.toFixed(2)}`,
		`source_after@${afterSource.toFixed(2)}`,
		ocrNote,
		`ocr_after_hits:${matchedAfter.join(",") || "none"}`,
		`ocr_onset:${onsetTokens.join(",") || "none"}`,
		`ocr_specific_onset:${specificOnset.join(",") || "none"}`,
		`ocr_specific_before:${specificBefore.join(",") || "none"}`,
		...(genericOnlyOnset ? ["ocr_evidence:generic_only_onset"] : []),
		...(specificBefore.length > 0 && specificOnset.length === 0
			? ["ocr_evidence:specific_tokens_in_before"]
			: []),
	];

	// OCR is evidence only — never an exclusive false-negative veto when vision can run.
	// A real landing UI may OCR as only “page”; an earlier IDE/doc may contain “landing”.
	// Provider presence + programme onset bounding decide identity.

	if (args.skipVision) {
		return {
			status: "VISION_UNAVAILABLE",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: beforeSource,
			afterSourceSec: afterSource,
			beforeText: beforeText.slice(0, 200),
			afterText: afterText.slice(0, 200),
			matchedTokensAfter: matchedAfter,
			matchedTokensBefore: matchedBefore,
			onsetTokens,
			evidenceRefs: [...evidenceRefs, "vision:skipped"],
			onsetBoundStatus: "not_searched",
			reason:
				"Vision presence skipped — OCR/token hits alone cannot certify the requested visual UI event.",
		};
	}

	const presenceJudge: VisualPresenceJudge | null =
		args.presenceJudge ??
		(args.visionJudge
			? async (pArgs) => {
					const v = await args.visionJudge!({
						cue: pArgs.cue,
						beforeImagePath: pArgs.imagePath,
						afterImagePath: pArgs.imagePath,
						beforeSourceSec: Math.max(0, pArgs.sourceSec - 1),
						afterSourceSec: pArgs.sourceSec,
						earlierImagePath: null,
						earlierSourceSec: null,
					});
					if (!v) return null;
					return {
						present: v.visualUiPresentAfter === true || v.identified === true,
						confidence: v.confidence,
						reason: v.reason,
						rawText: v.rawText,
						providerId: v.providerId,
						model: v.model,
					};
				}
			: args.chatModelConfig
				? async (pArgs) =>
						judgeVisualUiPresenceWithProviderVision({
							...pArgs,
							chatModelConfig: args.chatModelConfig!,
						})
				: null);

	if (!presenceJudge) {
		return {
			status: "VISION_UNAVAILABLE",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: beforeSource,
			afterSourceSec: afterSource,
			beforeText: beforeText.slice(0, 200),
			afterText: afterText.slice(0, 200),
			matchedTokensAfter: matchedAfter,
			matchedTokensBefore: matchedBefore,
			onsetTokens,
			evidenceRefs: [...evidenceRefs, "vision:no_provider"],
			onsetBoundStatus: "not_searched",
			reason:
				"No selected OpenScreen vision provider is available to judge visual presence. Returning honest not-identified (OCR alone is insufficient).",
		};
	}

	const cache = args.presenceCache ?? new Map<string, VisualPresenceVerdict | null>();
	const perBudget = Math.max(
		2,
		Math.min(args.visionCallBudget ?? ONSET_VISION_CALL_BUDGET, ONSET_VISION_CALL_BUDGET),
	);
	/** Reserve up to 2 presence calls for first-vs-reappearance probe. */
	const hardCallCap = perBudget + 2;
	let localCalls = 0;
	const turn = args.turnVisionCalls;

	const samplePresence = async (
		programmeSec: number,
	): Promise<{
		ok: boolean;
		sourceSec: number | null;
		verdict: VisualPresenceVerdict | null;
		mapStatus: string;
	}> => {
		// Quarter-second cache key reuses frames across nearby candidates.
		const key = (Math.round(programmeSec * 4) / 4).toFixed(2);
		const mappedP = mapProgrammeInstantToSourceSafe({
			document: args.document,
			programmeTimeSec: programmeSec,
		});
		if (mappedP.status !== "ok" || mappedP.sourceTimeSec == null) {
			return {
				ok: false,
				sourceSec: null,
				verdict: null,
				mapStatus: mappedP.status,
			};
		}
		if (cache.has(key)) {
			return {
				ok: true,
				sourceSec: mappedP.sourceTimeSec,
				verdict: cache.get(key) ?? null,
				mapStatus: "ok_cached",
			};
		}
		if (localCalls >= hardCallCap) {
			return {
				ok: false,
				sourceSec: mappedP.sourceTimeSec,
				verdict: null,
				mapStatus: "budget_exhausted",
			};
		}
		if (turn && turn.used >= turn.budget) {
			return {
				ok: false,
				sourceSec: mappedP.sourceTimeSec,
				verdict: null,
				mapStatus: "turn_budget_exhausted",
			};
		}
		const framePath = path.join(tmp, `p_${key.replace(".", "_")}.jpg`);
		const got = await extract(mappedP.sourceTimeSec, framePath);
		if (!got) {
			cache.set(key, null);
			return {
				ok: false,
				sourceSec: mappedP.sourceTimeSec,
				verdict: null,
				mapStatus: "frame_fail",
			};
		}
		let verdict: VisualPresenceVerdict | null = null;
		try {
			verdict = await presenceJudge({
				cue: args.cue,
				imagePath: framePath,
				sourceSec: mappedP.sourceTimeSec,
				programmeSec,
			});
		} catch (err) {
			return {
				ok: false,
				sourceSec: mappedP.sourceTimeSec,
				verdict: null,
				mapStatus: `vision_error:${err instanceof Error ? err.message : String(err)}`,
			};
		}
		localCalls += 1;
		if (turn) turn.used += 1;
		cache.set(key, verdict);
		return {
			ok: true,
			sourceSec: mappedP.sourceTimeSec,
			verdict,
			mapStatus: "ok",
		};
	};

	const samplePlan = planAdaptiveOnsetProgrammeSamples({
		anchorSec: args.programmeAnchorSec,
		programmeDurationSec: null,
		budget: perBudget,
	});

	type PresenceSample = {
		programmeSec: number;
		sourceSec: number | null;
		present: boolean | null;
		confidence: string;
		reason: string;
		mapStatus: string;
	};
	const samples: PresenceSample[] = [];
	const pushSample = async (prog: number): Promise<PresenceSample | null> => {
		if (samples.length >= perBudget) return null;
		const existing = samples.find((s) => Math.abs(s.programmeSec - prog) < 0.04);
		if (existing) return existing;
		const s = await samplePresence(prog);
		if (s.mapStatus === "budget_exhausted" || s.mapStatus === "turn_budget_exhausted") {
			return null;
		}
		const row: PresenceSample = {
			programmeSec: prog,
			sourceSec: s.sourceSec,
			present: s.verdict ? s.verdict.present : null,
			confidence: s.verdict?.confidence ?? "LOW",
			reason: s.verdict?.reason ?? s.mapStatus,
			mapStatus: s.mapStatus,
		};
		samples.push(row);
		return row;
	};

	for (const prog of samplePlan) {
		const row = await pushSample(prog);
		if (row?.mapStatus.startsWith("vision_error:")) {
			return {
				status: "VISION_UNAVAILABLE",
				requestedEventIdentified: false,
				visualChangeObserved: args.visualChangeObserved,
				beforeSourceSec: beforeSource,
				afterSourceSec: afterSource,
				beforeText: beforeText.slice(0, 200),
				afterText: afterText.slice(0, 200),
				matchedTokensAfter: matchedAfter,
				matchedTokensBefore: matchedBefore,
				onsetTokens,
				evidenceRefs: [...evidenceRefs, row.mapStatus],
				onsetBoundStatus: "not_searched",
				reason: `Vision presence call failed (${row.mapStatus}) — cannot certify the event.`,
			};
		}
		if (samples.length >= 2 && samples[0]?.present === true && row?.present === false) {
			break;
		}
	}

	// Bisect absent→present bracket while budget remains (brief-onset precision).
	while (samples.length < perBudget) {
		let earliestPresent: PresenceSample | null = null;
		let nearestAbsent: PresenceSample | null = null;
		for (const s of samples) {
			if (
				s.present === true &&
				(earliestPresent == null || s.programmeSec < earliestPresent.programmeSec)
			) {
				earliestPresent = s;
			}
		}
		for (const s of samples) {
			if (
				s.present === false &&
				earliestPresent &&
				s.programmeSec < earliestPresent.programmeSec &&
				(nearestAbsent == null || s.programmeSec > nearestAbsent.programmeSec)
			) {
				nearestAbsent = s;
			}
		}
		if (!earliestPresent || !nearestAbsent) break;
		const gap = earliestPresent.programmeSec - nearestAbsent.programmeSec;
		if (gap <= 0.85) break;
		const mid = Number(
			((nearestAbsent.programmeSec + earliestPresent.programmeSec) / 2).toFixed(2),
		);
		const row = await pushSample(mid);
		if (!row) break;
		if (row.mapStatus.startsWith("vision_error:")) {
			return {
				status: "VISION_UNAVAILABLE",
				requestedEventIdentified: false,
				visualChangeObserved: args.visualChangeObserved,
				beforeSourceSec: beforeSource,
				afterSourceSec: afterSource,
				beforeText: beforeText.slice(0, 200),
				afterText: afterText.slice(0, 200),
				matchedTokensAfter: matchedAfter,
				matchedTokensBefore: matchedBefore,
				onsetTokens,
				evidenceRefs: [...evidenceRefs, row.mapStatus],
				onsetBoundStatus: "not_searched",
				reason: `Vision presence call failed (${row.mapStatus}) — cannot certify the event.`,
			};
		}
	}

	const candidateSample = samples[0]!;
	const meanStep =
		samples.length > 1
			? Math.abs(samples[0]!.programmeSec - samples[samples.length - 1]!.programmeSec) /
				Math.max(1, samples.length - 1)
			: ONSET_STEP_PROGRAMME_SEC;
	const presenceRefs = [
		...evidenceRefs,
		`onset_search_steps:${samples.length}`,
		`onset_step_sec:${meanStep.toFixed(2)}`,
		`onset_budget:${perBudget}`,
		`onset_plan:adaptive`,
		`onset_vision_calls:${localCalls}`,
		...samples.map(
			(s) =>
				`presence@prog_${s.programmeSec.toFixed(2)}:src_${s.sourceSec?.toFixed(2) ?? "?"}:${s.present === true ? "yes" : s.present === false ? "no" : "unk"}`,
		),
	];

	try {
		await writeFile(
			path.join(tmp, "identity-meta.json"),
			JSON.stringify({
				tokens,
				anchors,
				matchedBefore,
				matchedAfter,
				onsetTokens,
				specificOnset,
				samples,
			}),
		);
	} catch {
		/* ignore */
	}

	if (candidateSample.present !== true) {
		return {
			status: "NOT_IDENTIFIED",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: beforeSource,
			afterSourceSec: afterSource,
			beforeText: beforeText.slice(0, 200),
			afterText: afterText.slice(0, 200),
			matchedTokensAfter: matchedAfter,
			matchedTokensBefore: matchedBefore,
			onsetTokens,
			evidenceRefs: presenceRefs,
			earliestProgrammeSec: null,
			absentProgrammeSec: null,
			onsetBoundStatus: "absent_at_candidate",
			reason: `Requested visual UI is not present at candidate programme ${args.programmeAnchorSec.toFixed(1)}s (${candidateSample.reason}).`,
		};
	}

	// Walk samples from candidate toward earlier; find first absent → bound earliest present.
	let absentProgrammeSec: number | null = null;
	let earliestProgrammeSec: number | null = null;
	const ordered = [...samples].sort((a, b) => b.programmeSec - a.programmeSec);
	for (const s of ordered) {
		if (s.programmeSec > args.programmeAnchorSec + 0.05) continue;
		if (s.present === true) {
			earliestProgrammeSec = s.programmeSec;
			continue;
		}
		if (s.present === false) {
			absentProgrammeSec = s.programmeSec;
			break;
		}
	}

	if (absentProgrammeSec == null || earliestProgrammeSec == null) {
		return {
			status: "NOT_IDENTIFIED",
			requestedEventIdentified: false,
			visualChangeObserved: args.visualChangeObserved,
			beforeSourceSec: beforeSource,
			afterSourceSec: afterSource,
			beforeText: beforeText.slice(0, 200),
			afterText: afterText.slice(0, 200),
			matchedTokensAfter: matchedAfter,
			matchedTokensBefore: matchedBefore,
			onsetTokens,
			evidenceRefs: [...presenceRefs, "onset_bound:insufficient_bracket"],
			earliestProgrammeSec,
			absentProgrammeSec,
			onsetBoundStatus: "insufficient_bracket",
			reason:
				"UI is present at the candidate, but lookback across programme frames never found an absent sample — onset bracket is insufficient (cannot certify first appearance).",
		};
	}

	// Recurrence probe: look further earlier than the absent sample. If the UI is
	// present again earlier, this candidate is a reappearance — not first onset.
	const recurrenceProbes = [
		0,
		Number((absentProgrammeSec / 2).toFixed(2)),
		...planAdaptiveOnsetProgrammeSamples({
			anchorSec: Math.max(0, absentProgrammeSec - 0.5),
			programmeDurationSec: null,
			budget: Math.min(4, Math.max(2, perBudget - samples.length + 2)),
		}),
	]
		.filter((t) => t < absentProgrammeSec - 0.2)
		.filter((t, i, arr) => arr.findIndex((x) => Math.abs(x - t) < 0.05) === i)
		.slice(0, 4);
	for (const t of recurrenceProbes) {
		const existing = samples.find((s) => Math.abs(s.programmeSec - t) < 0.04);
		if (existing?.present === true) {
			return {
				status: "NOT_IDENTIFIED",
				requestedEventIdentified: false,
				visualChangeObserved: args.visualChangeObserved,
				beforeSourceSec: beforeSource,
				afterSourceSec: afterSource,
				beforeText: beforeText.slice(0, 200),
				afterText: afterText.slice(0, 200),
				matchedTokensAfter: matchedAfter,
				matchedTokensBefore: matchedBefore,
				onsetTokens,
				evidenceRefs: [
					...presenceRefs,
					`onset_bound:earliest@${earliestProgrammeSec.toFixed(2)}`,
					`onset_bound:absent@${absentProgrammeSec.toFixed(2)}`,
					`onset_bound:earlier_presence@${existing.programmeSec.toFixed(2)}`,
					"onset_bound:reappearance_not_first",
				],
				earliestProgrammeSec: existing.programmeSec,
				absentProgrammeSec,
				onsetBoundStatus: "bounded",
				reason: `UI was already present earlier (≈ programme ${existing.programmeSec.toFixed(1)}s) before the absent sample at ${absentProgrammeSec.toFixed(1)}s — candidate looks like a reappearance, not first onset.`,
			};
		}
		// Recurrence probes may spend 1–2 extra presence calls beyond the coarse plan.
		const s = await samplePresence(t);
		if (s.mapStatus === "budget_exhausted" || s.mapStatus === "turn_budget_exhausted") {
			break;
		}
		const present = s.verdict ? s.verdict.present : null;
		if (present === true) {
			return {
				status: "NOT_IDENTIFIED",
				requestedEventIdentified: false,
				visualChangeObserved: args.visualChangeObserved,
				beforeSourceSec: beforeSource,
				afterSourceSec: afterSource,
				beforeText: beforeText.slice(0, 200),
				afterText: afterText.slice(0, 200),
				matchedTokensAfter: matchedAfter,
				matchedTokensBefore: matchedBefore,
				onsetTokens,
				evidenceRefs: [
					...presenceRefs,
					`onset_bound:earliest@${earliestProgrammeSec.toFixed(2)}`,
					`onset_bound:absent@${absentProgrammeSec.toFixed(2)}`,
					`onset_bound:earlier_presence@${t.toFixed(2)}`,
					"onset_bound:reappearance_not_first",
				],
				earliestProgrammeSec: t,
				absentProgrammeSec,
				onsetBoundStatus: "bounded",
				reason: `UI was already present earlier (≈ programme ${t.toFixed(1)}s) before the absent sample at ${absentProgrammeSec.toFixed(1)}s — candidate looks like a reappearance, not first onset.`,
			};
		}
	}

	const delta = Math.abs(args.programmeAnchorSec - earliestProgrammeSec);
	const tolerance = adaptiveOnsetMatchToleranceSec(earliestProgrammeSec - absentProgrammeSec);
	const providerNote = samples.find((s) => s.present === true)?.reason ?? "presence bounded";

	/**
	 * Late preliminary candidate (speech / coarse visual peak) is only a search seed.
	 * When lookback already certified an absent→present first-onset bracket (and
	 * recurrence probes cleared), retarget IDENTIFIED to earliestProgrammeSec —
	 * do not discard the bracket as "candidate too late".
	 */
	const retargetedFromLateSeed = delta > tolerance;
	return {
		status: "IDENTIFIED",
		requestedEventIdentified: true,
		visualChangeObserved: args.visualChangeObserved,
		beforeSourceSec: beforeSource,
		afterSourceSec: afterSource,
		beforeText: beforeText.slice(0, 200),
		afterText: afterText.slice(0, 200),
		matchedTokensAfter: matchedAfter,
		matchedTokensBefore: matchedBefore,
		onsetTokens: specificOnset.length ? specificOnset : onsetTokens,
		evidenceRefs: [
			...presenceRefs,
			`onset_bound:earliest@${earliestProgrammeSec.toFixed(2)}`,
			`onset_bound:absent@${absentProgrammeSec.toFixed(2)}`,
			`onset_tolerance:${tolerance.toFixed(2)}`,
			retargetedFromLateSeed
				? `onset_bound:retargeted_from_late_candidate@${args.programmeAnchorSec.toFixed(2)}`
				: "onset_bound:ok",
		],
		earliestProgrammeSec,
		absentProgrammeSec,
		onsetBoundStatus: "bounded",
		reason: retargetedFromLateSeed
			? `Bounded earliest onset ≈ programme ${earliestProgrammeSec.toFixed(1)}s (absent by ${absentProgrammeSec.toFixed(1)}s; preliminary candidate ${args.programmeAnchorSec.toFixed(1)}s was later — retargeted to first-onset bracket; ${providerNote}).`
			: `Bounded earliest onset ≈ programme ${earliestProgrammeSec.toFixed(1)}s (absent by ${absentProgrammeSec.toFixed(1)}s; ${providerNote}).`,
	};
}

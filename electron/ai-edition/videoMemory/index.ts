/**
 * Video Memory V1 — evidence index foundation (not an LLM essay).
 * Reuses Temporal Event Ledger / Claim Promotion / Source Story refs.
 * Does NOT replace the production cognition path unless explicitly compared.
 *
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_V1
 */

import { createHash } from "node:crypto";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { ClaimPromotionSet } from "../claimPromotion/types";
import type { MediaContextNeeds } from "../mediaContextNeeds/types";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import { createVideoEvidenceStore } from "../temporalEventLedger/store";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import { classifyQueryScope, type QueryScope } from "./queryScope";

export const VIDEO_MEMORY_V1_PROVIDER_ID = "CURRENT_OPENSCREEN_VIDEO_MEMORY_V1" as const;

/** Source media identity — reusable while asset path/id identity remains valid. */
export function fingerprintSourceAsset(document: AxcutDocument, assetId: string): string {
	const asset = document.assets.find((a) => a.id === assetId);
	// Intentionally omit durationSec: probe/ensure may refine duration between turns
	// without the underlying media bytes changing.
	const payload = JSON.stringify({
		id: asset?.id,
		path: asset?.originalPath,
		kind: asset?.kind,
	});
	return createHash("sha256").update(payload).digest("hex");
}

const FULL_SOURCE_CLIP_EPS = 0.051;

/**
 * Full-source placements track probed duration. Hash them as `full_source` so a
 * duration probe that rewrites 0→staleEnd into 0→canonicalEnd is not treated
 * as a programme mutation. Intentional trims keep exact source/timeline bounds.
 */
function programmeClipFingerprint(
	document: AxcutDocument,
	clip: AxcutDocument["timeline"]["clips"][number],
) {
	const asset = document.assets.find((a) => a.id === clip.assetId);
	const dur = asset?.durationSec;
	const startAtOrigin = Math.abs(clip.sourceStartSec) <= FULL_SOURCE_CLIP_EPS;
	const endMatchesDuration =
		dur != null &&
		dur > 0 &&
		clip.sourceEndSec != null &&
		Math.abs(clip.sourceEndSec - dur) <= FULL_SOURCE_CLIP_EPS;
	if (startAtOrigin && endMatchesDuration) {
		return {
			id: clip.id,
			assetId: clip.assetId,
			placement: "full_source" as const,
			timelineStartSec: clip.timelineStartSec,
		};
	}
	return {
		id: clip.id,
		assetId: clip.assetId,
		sourceStartSec: clip.sourceStartSec,
		sourceEndSec: clip.sourceEndSec,
		timelineStartSec: clip.timelineStartSec,
		timelineEndSec: clip.timelineEndSec,
	};
}

/**
 * Programme/timeline understanding — stale when clips/trims/zooms/speeds change.
 * Intentionally omits probed `durationSec` (same class of false miss as source
 * fingerprint before Closure V1). Full-source clip ends that merely track the
 * probe are also omitted. Apply-preview still uses fingerprintDocument.
 */
export function fingerprintProgramme(document: AxcutDocument): string {
	const relevant = {
		projectId: document.project.id,
		primaryAssetId: document.project.primaryAssetId,
		assets: document.assets.map((a) => ({
			id: a.id,
			originalPath: a.originalPath,
			kind: a.kind,
		})),
		clips: document.timeline.clips.map((c) => programmeClipFingerprint(document, c)),
		trimRanges: document.timeline.trimRanges.map((t) => ({
			id: t.id,
			assetId: t.assetId,
			clipId: (t as { clipId?: string }).clipId,
			startSec: t.startSec,
			endSec: t.endSec,
		})),
		speedRanges: document.timeline.speedRanges?.map((s) => ({
			startSec: s.startSec,
			endSec: s.endSec,
			reason: s.reason,
		})),
		zoomRanges: document.zoomRanges?.map((z) => ({
			id: z.id,
			startMs: z.startMs,
			endMs: z.endMs,
			clipId: (z as { clipId?: string }).clipId,
		})),
	};
	return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}

export type VideoMemoryQueryClass =
	| "speech"
	| "visual"
	| "cross_modal"
	| "editorial"
	| "action_verify"
	| "direct_edit"
	| "general";

export type VideoMemoryV1 = {
	providerId: typeof VIDEO_MEMORY_V1_PROVIDER_ID;
	assetId: string;
	sourceFingerprint: string;
	programmeFingerprint: string;
	sourceDurationSec: number;
	/** Compact refs into canonical ledger — not a second copy of raw evidence. */
	ledgerEventCount: number;
	claimCount: number;
	sourceStoryBeatCount: number;
	sourceStorySummary: string;
	speechWindows: Array<{ startSec: number; endSec: number; preview: string }>;
	visualTransitionCount: number;
	temporaryUiHints: string[];
	contradictionHints: string[];
	correctionHints: string[];
	passiveChromeHints: string[];
	uncertainties: string[];
	analysisCoverage: {
		speech: boolean;
		visual: boolean;
		cursor: boolean;
		investigator: boolean;
	};
	createdAtIso: string;
	evidenceVersion: 1;
};

export function buildVideoMemoryV1(input: {
	document: AxcutDocument;
	assetId: string;
	ledger?: TemporalEventLedger | null;
	claims?: ClaimPromotionSet | null;
	sourceStoryV2?: SourceStoryV2 | null;
	analysisCoverage?: Partial<VideoMemoryV1["analysisCoverage"]>;
}): VideoMemoryV1 {
	const ledger = input.ledger ?? null;
	const store = ledger ? createVideoEvidenceStore(ledger) : null;
	const speechWindows: VideoMemoryV1["speechWindows"] = [];
	const temporaryUiHints: string[] = [];
	const contradictionHints: string[] = [];
	const correctionHints: string[] = [];
	const passiveChromeHints: string[] = [];
	const uncertainties: string[] = [];
	let visualTransitionCount = 0;

	if (ledger) {
		for (const e of ledger.events) {
			if (e.type === "speech" || e.type === "spoken_correction") {
				const preview = (e.summary || e.claims[0]?.text || "").slice(0, 120);
				speechWindows.push({
					startSec: e.startSourceTimeSec,
					endSec: e.endSourceTimeSec,
					preview,
				});
			}
			if (e.type === "spoken_correction") {
				correctionHints.push((e.summary || "").slice(0, 160));
			}
			if (e.type === "contradiction") {
				contradictionHints.push((e.summary || "").slice(0, 160));
			}
			if (e.type === "visual_transition") visualTransitionCount += 1;
			if (e.type === "passive_chrome") {
				passiveChromeHints.push((e.summary || "").slice(0, 120));
			}
			if (/restart|recording\s+ui|hud/i.test(e.summary || "")) {
				temporaryUiHints.push((e.summary || "").slice(0, 120));
			}
			for (const c of e.claims) {
				if (c.epistemic === "unknown") uncertainties.push(c.text.slice(0, 120));
			}
		}
	}

	const story = input.sourceStoryV2;
	return {
		providerId: VIDEO_MEMORY_V1_PROVIDER_ID,
		assetId: input.assetId,
		sourceFingerprint: fingerprintSourceAsset(input.document, input.assetId),
		programmeFingerprint: fingerprintProgramme(input.document),
		sourceDurationSec: ledger?.meta.sourceDurationSec ?? story?.sourceDurationSec ?? 0,
		ledgerEventCount: store?.stats().eventCount ?? 0,
		claimCount: input.claims?.claims?.length ?? store?.stats().claimCount ?? 0,
		sourceStoryBeatCount: story?.beats?.length ?? 0,
		sourceStorySummary: (story?.mediaSummary || "").slice(0, 400),
		speechWindows: speechWindows.slice(0, 40),
		visualTransitionCount,
		temporaryUiHints: [...new Set(temporaryUiHints)].slice(0, 12),
		contradictionHints: [...new Set(contradictionHints)].slice(0, 12),
		correctionHints: [...new Set(correctionHints)].slice(0, 12),
		passiveChromeHints: [...new Set(passiveChromeHints)].slice(0, 12),
		uncertainties: [...new Set(uncertainties)].slice(0, 16),
		analysisCoverage: {
			speech: Boolean(input.analysisCoverage?.speech),
			visual: Boolean(input.analysisCoverage?.visual),
			cursor: Boolean(input.analysisCoverage?.cursor),
			investigator: Boolean(input.analysisCoverage?.investigator),
		},
		createdAtIso: new Date().toISOString(),
		evidenceVersion: 1,
	};
}

export function classifyVideoMemoryQuery(
	userMessage: string,
	needs?: MediaContextNeeds,
): VideoMemoryQueryClass {
	const t = userMessage.toLowerCase();
	if (needs?.category === "deterministicEdit") return "direct_edit";
	if (needs?.category === "editingContext") return "editorial";
	if (needs?.category === "speechInspection") return "speech";
	if (needs?.category === "visualInspection") return "visual";
	if (/settings|open(?:ed)?\s+(?:the\s+)?panel|did\s+i\s+(?:open|click)/i.test(t)) {
		return "action_verify";
	}
	if (/compare|what\s+i\s+(?:am\s+)?(?:say|said|saying)|on\s+screen|cross.?modal|appear/i.test(t)) {
		return "cross_modal";
	}
	if (/what\s+(?:did|do)\s+i\s+say|transcript|near\s+the\s+end/i.test(t)) return "speech";
	if (/visibly|visual|on\s+screen|what\s+is\s+happening|what\s+is\s+visibly/i.test(t)) {
		return "visual";
	}
	if (
		/professional|shorter|clearer|improve|edit|pacing|distracting|unnecessary|\bzoom\b|would you not/i.test(
			t,
		)
	) {
		return "editorial";
	}
	if (needs?.category === "mediaUnderstanding") {
		return needs.visual && needs.speech ? "cross_modal" : needs.visual ? "visual" : "speech";
	}
	return "general";
}

export type VideoMemoryRetrieval = {
	queryClass: VideoMemoryQueryClass;
	queryScope: QueryScope;
	/** Whether the production path should attach visual frames by default. */
	attachVisualFrames: boolean;
	/** Prefer late speech window for "near the end" style queries. */
	preferLateSpeech: boolean;
	includeSourceStorySummary: boolean;
	includeCorrections: boolean;
	includeContradictions: boolean;
	includeTemporaryUi: boolean;
	includePassiveChrome: boolean;
	includePacingHints: boolean;
	maxSpeechWindows: number;
	briefingText: string;
	needsInvestigatorDeepening: boolean;
	deepeningHints: string[];
};

/**
 * Deterministic retrieval policy — does not call a model.
 * Produces a compact briefing from VideoMemory; raw frames left to caller policy.
 */
export function retrieveFromVideoMemory(
	memory: VideoMemoryV1,
	userMessage: string,
	needs?: MediaContextNeeds,
): VideoMemoryRetrieval {
	const queryClass = classifyVideoMemoryQuery(userMessage, needs);
	const queryScope = classifyQueryScope(userMessage, queryClass);
	const late = /near\s+the\s+end|last\s+(?:few\s+)?(?:seconds|moments)|ending/i.test(userMessage);

	const base: VideoMemoryRetrieval = {
		queryClass,
		queryScope,
		attachVisualFrames: false,
		preferLateSpeech: late,
		includeSourceStorySummary: false,
		includeCorrections: false,
		includeContradictions: false,
		includeTemporaryUi: false,
		includePassiveChrome: false,
		includePacingHints: false,
		maxSpeechWindows: 8,
		briefingText: "",
		needsInvestigatorDeepening: false,
		deepeningHints: [],
	};

	let speech = [...memory.speechWindows];
	if (late && speech.length) {
		const mid = memory.sourceDurationSec * 0.6;
		speech = speech.filter((w) => w.endSec >= mid).slice(-8);
		if (!speech.length) speech = memory.speechWindows.slice(-6);
	}

	if (queryClass === "speech") {
		base.attachVisualFrames = false;
		base.includeCorrections = true;
		base.includeContradictions = true;
		base.maxSpeechWindows = 10;
	} else if (queryClass === "direct_edit") {
		base.attachVisualFrames = false;
		base.maxSpeechWindows = 0;
	} else if (queryClass === "visual") {
		base.attachVisualFrames = true;
		base.includeTemporaryUi = true;
		base.includePassiveChrome = true;
		base.maxSpeechWindows = 2;
	} else if (queryClass === "cross_modal") {
		base.attachVisualFrames = true;
		base.includeCorrections = true;
		base.includeContradictions = true;
		base.maxSpeechWindows = 10;
		base.needsInvestigatorDeepening = memory.contradictionHints.length > 0;
		base.deepeningHints.push("resolve speech↔visual contradictions in focus range");
	} else if (queryClass === "action_verify") {
		base.attachVisualFrames = true;
		base.includeContradictions = true;
		base.includeCorrections = true;
		base.needsInvestigatorDeepening = true;
		base.deepeningHints.push("verify named UI action against visual/cursor evidence");
	} else if (queryClass === "editorial") {
		base.attachVisualFrames = true; // still often needed; memory reduces *re-dump* of text
		base.includeSourceStorySummary = true;
		base.includeTemporaryUi = true;
		base.includeCorrections = true;
		base.includePassiveChrome = true;
		base.includePacingHints = true;
		base.maxSpeechWindows = 12;
	} else {
		base.includeSourceStorySummary = true;
		base.attachVisualFrames = Boolean(needs?.visual);
	}

	const lines: string[] = [
		"VIDEO_MEMORY_V1_RETRIEVAL (deterministic index — not a second ledger)",
		`queryClass=${queryClass}`,
		`queryScope=${queryScope}`,
		`sourceFingerprint=${memory.sourceFingerprint.slice(0, 12)}…`,
		`programmeFingerprint=${memory.programmeFingerprint.slice(0, 12)}…`,
		`durationSec=${memory.sourceDurationSec}`,
		`coverage speech=${memory.analysisCoverage.speech} visual=${memory.analysisCoverage.visual} investigator=${memory.analysisCoverage.investigator}`,
	];
	if (base.includeSourceStorySummary && memory.sourceStorySummary) {
		lines.push(`sourceStory: ${memory.sourceStorySummary}`);
	}
	lines.push("speechWindows:");
	for (const w of speech.slice(0, base.maxSpeechWindows)) {
		lines.push(`  ${w.startSec.toFixed(1)}–${w.endSec.toFixed(1)}s: ${w.preview}`);
	}
	if (base.includeCorrections && memory.correctionHints.length) {
		lines.push("corrections:");
		for (const c of memory.correctionHints.slice(0, 6)) lines.push(`  - ${c}`);
	}
	if (base.includeContradictions && memory.contradictionHints.length) {
		lines.push("contradictions:");
		for (const c of memory.contradictionHints.slice(0, 6)) lines.push(`  - ${c}`);
	}
	if (base.includeTemporaryUi && memory.temporaryUiHints.length) {
		lines.push("temporaryUi:");
		for (const c of memory.temporaryUiHints.slice(0, 6)) lines.push(`  - ${c}`);
	}
	if (base.includePassiveChrome && memory.passiveChromeHints.length) {
		lines.push("passiveChrome (context only — not workflow):");
		for (const c of memory.passiveChromeHints.slice(0, 6)) lines.push(`  - ${c}`);
	}
	if (base.includePacingHints) {
		lines.push(`visualTransitions=${memory.visualTransitionCount}`);
	}
	if (memory.uncertainties.length) {
		lines.push("uncertainties:");
		for (const u of memory.uncertainties.slice(0, 6)) lines.push(`  - ${u}`);
	}
	if (base.needsInvestigatorDeepening) {
		lines.push(`investigatorDeepeningSuggested: ${base.deepeningHints.join("; ")}`);
	}
	base.briefingText = lines.join("\n");
	return base;
}

export type MemoryValidity = {
	sourceReusable: boolean;
	programmeCurrent: boolean;
	reason: string;
};

export function validateVideoMemory(
	memory: VideoMemoryV1,
	document: AxcutDocument,
): MemoryValidity {
	const sourceNow = fingerprintSourceAsset(document, memory.assetId);
	const programmeNow = fingerprintProgramme(document);
	const sourceReusable = sourceNow === memory.sourceFingerprint;
	const programmeCurrent = programmeNow === memory.programmeFingerprint;
	if (!sourceReusable) {
		return {
			sourceReusable: false,
			programmeCurrent: false,
			reason: "source asset identity changed — invalidate source-keyed evidence",
		};
	}
	if (!programmeCurrent) {
		return {
			sourceReusable: true,
			programmeCurrent: false,
			reason:
				"timeline/programme fingerprint changed — retain source evidence, invalidate programme-derived story/plan",
		};
	}
	return {
		sourceReusable: true,
		programmeCurrent: true,
		reason: "source and programme fingerprints match",
	};
}

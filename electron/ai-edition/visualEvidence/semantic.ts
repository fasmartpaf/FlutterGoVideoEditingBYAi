/**
 * Turn-local structured semantic grounding from already-attached visual frames.
 * Same multimodal agent turn — no second LLM call, no persistence to .openscreen.
 *
 * Coverage invariant: every attached frame timestamp must appear in an observation
 * OR in a staticRange.coveredFrameTimes. Moderate/significant Bug 3 pixel transitions
 * must appear in semantic transitions (semantic cause may be uncertain).
 * Every staticRange.referenceObservationTimeSec must match an observation.
 * Fully static compression requires layoutState=stable AND contentState=stable.
 */

import { z } from "zod";
import { speechStatusPromptGuidance } from "../speechEvidence/format";
import { userFacingMediaNarrationGuidance } from "../userFacingNarration";
import type { VisualChange, VisualEvidenceFrame } from "./types";

export const SEMANTIC_CONFIDENCE = ["high", "medium", "low"] as const;
export type SemanticConfidence = (typeof SEMANTIC_CONFIDENCE)[number];

export const APPROXIMATE_LOCATIONS = [
	"top-left",
	"top",
	"top-right",
	"left",
	"center",
	"right",
	"bottom-left",
	"bottom",
	"bottom-right",
	"full_screen",
	"unknown",
] as const;
export type ApproximateLocation = (typeof APPROXIMATE_LOCATIONS)[number];

export const TRANSITION_CHANGE_TYPES = [
	"appeared",
	"disappeared",
	"content_changed",
	"position_changed",
	"state_changed",
	"none",
	"unknown",
] as const;

export const EDITING_RELEVANCE = ["none", "low", "medium", "high"] as const;

/** Layout/chrome vs visible document/page content — keep minimal. */
export const STABILITY_STATES = ["stable", "changed", "uncertain"] as const;
export type StabilityState = (typeof STABILITY_STATES)[number];

const MATERIAL_PIXEL = new Set(["moderate", "significant"]);

const confidenceSchema = z.enum(SEMANTIC_CONFIDENCE);
const locationSchema = z.enum(APPROXIMATE_LOCATIONS);

export const visualSemanticObservationSchema = z.object({
	sourceTimeSec: z.number().finite(),
	virtualTimeSec: z.number().finite().optional(),
	frameSummary: z.string().min(1),
	/**
	 * Frontmost / focused app or site in this sample. Required for grounded
	 * narration — background tabs must NOT be listed here.
	 */
	frontmostSurface: z
		.object({
			name: z.string().min(1),
			kind: z.enum(["app", "site", "unknown"]).optional(),
			title: z.string().optional(),
		})
		.optional(),
	/** Visible but not focused chrome (browser tabs, windows behind, dock badges). */
	backgroundSurfaces: z
		.array(
			z.object({
				name: z.string().min(1),
				role: z.enum(["tab", "behind", "dock", "unknown"]).optional(),
			}),
		)
		.optional(),
	regions: z
		.array(
			z.object({
				id: z.string().min(1),
				description: z.string().min(1),
				approximateLocation: locationSchema.optional(),
				confidence: confidenceSchema,
			}),
		)
		.default([]),
	visibleText: z
		.array(
			z.object({
				text: z.string().min(1),
				regionId: z.string().optional(),
				confidence: confidenceSchema,
			}),
		)
		.optional(),
	uiElements: z
		.array(
			z.object({
				description: z.string().min(1),
				regionId: z.string().optional(),
				state: z.string().optional(),
				confidence: confidenceSchema,
			}),
		)
		.optional(),
	observed: z.array(z.string()).optional(),
	inferred: z.array(z.string()).optional(),
	importantRegion: locationSchema.optional(),
	editingRelevance: z.enum(EDITING_RELEVANCE).optional(),
	editingReason: z.string().optional(),
});

export const visualSemanticTransitionSchema = z.object({
	fromSourceTimeSec: z.number().finite(),
	toSourceTimeSec: z.number().finite(),
	summary: z.string().min(1),
	changes: z
		.array(
			z.object({
				// Coerce unexpected model strings to "unknown" so minor enum slips
				// do not wipe an otherwise valid coverage payload.
				type: z.preprocess((v) => {
					if (typeof v !== "string") return "unknown";
					const normalized = v
						.trim()
						.toLowerCase()
						.replace(/[\s-]+/g, "_");
					if ((TRANSITION_CHANGE_TYPES as readonly string[]).includes(normalized)) {
						return normalized;
					}
					if (normalized === "content_change") return "content_changed";
					if (normalized === "position_change") return "position_changed";
					if (normalized === "state_change") return "state_changed";
					return "unknown";
				}, z.enum(TRANSITION_CHANGE_TYPES)),
				description: z.string().min(1),
				confidence: confidenceSchema,
			}),
		)
		.default([]),
	/** Bug 3 measured pixel class — required when reporting a significant pixel edge. */
	pixelClassification: z.enum(["minimal", "moderate", "significant"]).optional(),
	/** Explicit semantic reading of that pixel change (may be "uncertain"). */
	semanticChange: z.string().optional(),
	observed: z.array(z.string()).optional(),
	inferred: z.array(z.string()).optional(),
});

const stabilityStateSchema = z.enum(STABILITY_STATES);

export const visualSemanticStaticRangeSchema = z.object({
	fromSourceTimeSec: z.number().finite(),
	toSourceTimeSec: z.number().finite(),
	summary: z.string().min(1),
	/** Every attached frame in this range that this static summary covers. */
	coveredFrameTimes: z.array(z.number().finite()).min(1),
	/** Must match an observation.sourceTimeSec in this grounding. */
	referenceObservationTimeSec: z.number().finite(),
	/** Application chrome / window geometry stability across covered samples. */
	layoutState: stabilityStateSchema,
	/** Visible document/page/content stability across covered samples. */
	contentState: stabilityStateSchema,
});

export const visualSemanticGroundingSchema = z.object({
	observations: z.array(visualSemanticObservationSchema).default([]),
	transitions: z.array(visualSemanticTransitionSchema).default([]),
	staticRanges: z.array(visualSemanticStaticRangeSchema).optional(),
});

export type VisualSemanticObservation = z.infer<typeof visualSemanticObservationSchema>;
export type VisualSemanticTransition = z.infer<typeof visualSemanticTransitionSchema>;
export type VisualSemanticStaticRange = z.infer<typeof visualSemanticStaticRangeSchema>;
export type VisualSemanticGrounding = z.infer<typeof visualSemanticGroundingSchema>;

/** Fully static compression only when layout AND visible content are both stable. */
export function isFullyStaticRange(range: {
	layoutState: StabilityState;
	contentState: StabilityState;
}): boolean {
	return range.layoutState === "stable" && range.contentState === "stable";
}

export interface SemanticGroundingEvidence {
	frames: Array<{ sourceTimeSec: number; virtualTimeSec: number | null }>;
	changes: Array<{
		fromSourceTimeSec: number;
		toSourceTimeSec: number;
		classification: VisualChange["classification"];
	}>;
	durationSec?: number;
}

export interface SemanticValidationResult {
	ok: boolean;
	grounding: VisualSemanticGrounding | null;
	errors: string[];
}

export interface SemanticCoverageRow {
	timestamp: number;
	coveredBy: "observation" | "static_range";
	referenceState: number;
}

const TIME_EPS = 0.051;

function near(a: number, b: number): boolean {
	return Math.abs(a - b) <= TIME_EPS;
}

function frameTimes(evidence: SemanticGroundingEvidence): number[] {
	return evidence.frames.map((f) => f.sourceTimeSec);
}

function findNear(times: number[], t: number): number | null {
	const hit = times.find((x) => near(x, t));
	return hit == null ? null : hit;
}

/** Collapse consecutive minimal transitions into static ranges for prompt compression. */
export function compressMinimalStaticRanges(
	changes: VisualChange[],
): Array<{ fromSourceTimeSec: number; toSourceTimeSec: number }> {
	const ranges: Array<{ fromSourceTimeSec: number; toSourceTimeSec: number }> = [];
	let open: { fromSourceTimeSec: number; toSourceTimeSec: number } | null = null;
	for (const c of changes) {
		if (c.classification !== "minimal") {
			if (open) ranges.push(open);
			open = null;
			continue;
		}
		if (!open) {
			open = { fromSourceTimeSec: c.fromSourceTimeSec, toSourceTimeSec: c.toSourceTimeSec };
		} else if (near(open.toSourceTimeSec, c.fromSourceTimeSec)) {
			open.toSourceTimeSec = c.toSourceTimeSec;
		} else {
			ranges.push(open);
			open = { fromSourceTimeSec: c.fromSourceTimeSec, toSourceTimeSec: c.toSourceTimeSec };
		}
	}
	if (open) ranges.push(open);
	return ranges.filter((r) => r.toSourceTimeSec - r.fromSourceTimeSec >= 1.5);
}

/**
 * Reject high-confidence invented control identities (Publish/Save/Submit…)
 * when that exact label is not present in visibleText for the observation.
 */
export function findUnsupportedHighConfidenceIdentities(
	grounding: VisualSemanticGrounding,
): string[] {
	const banned = /\b(publish|save|submit|ok|cancel|delete|confirm)\b/i;
	const errors: string[] = [];
	for (const obs of grounding.observations) {
		const visible = (obs.visibleText ?? []).map((t) => t.text.toLowerCase()).join("\n");
		for (const el of obs.uiElements ?? []) {
			if (el.confidence !== "high") continue;
			const m = el.description.match(banned);
			if (!m) continue;
			const token = m[1]!.toLowerCase();
			if (!visible.includes(token)) {
				errors.push(
					`high-confidence UI identity "${token}" without matching visibleText at ${obs.sourceTimeSec}s`,
				);
			}
		}
	}
	return errors;
}

/** Map each attached timestamp to observation or static-range coverage. */
export function buildSemanticCoverageMap(
	grounding: VisualSemanticGrounding,
	evidence: SemanticGroundingEvidence,
): { rows: SemanticCoverageRow[]; uncovered: number[]; errors: string[] } {
	const times = frameTimes(evidence);
	const obsTimes = grounding.observations.map((o) => o.sourceTimeSec);
	const covered = new Map<number, SemanticCoverageRow>();
	const errors: string[] = [];

	for (const obs of grounding.observations) {
		const exact = findNear(times, obs.sourceTimeSec);
		if (exact == null) continue;
		covered.set(exact, {
			timestamp: exact,
			coveredBy: "observation",
			referenceState: exact,
		});
	}

	for (const range of grounding.staticRanges ?? []) {
		if (!obsTimes.some((t) => near(t, range.referenceObservationTimeSec))) {
			errors.push(
				`staticRange ${range.fromSourceTimeSec}→${range.toSourceTimeSec} referenceObservationTimeSec ${range.referenceObservationTimeSec} has no observation`,
			);
		}
		for (const t of range.coveredFrameTimes) {
			const exact = findNear(times, t);
			if (exact == null) {
				errors.push(`staticRange coveredFrameTime ${t} is not an attached frame`);
				continue;
			}
			if (t + TIME_EPS < range.fromSourceTimeSec || t - TIME_EPS > range.toSourceTimeSec) {
				errors.push(
					`coveredFrameTime ${t} outside staticRange ${range.fromSourceTimeSec}–${range.toSourceTimeSec}`,
				);
			}
			if (!covered.has(exact)) {
				covered.set(exact, {
					timestamp: exact,
					coveredBy: "static_range",
					referenceState: range.referenceObservationTimeSec,
				});
			}
		}
	}

	const uncovered = times.filter((t) => !covered.has(t));
	return {
		rows: times.map(
			(t) =>
				covered.get(t) ?? {
					timestamp: t,
					coveredBy: "observation",
					referenceState: t,
				},
		),
		uncovered,
		errors,
	};
}

/** Moderate/significant Bug 3 edges that lack a matching semantic transition. */
export function findMissingMaterialPixelTransitions(
	grounding: VisualSemanticGrounding,
	evidence: SemanticGroundingEvidence,
): Array<{
	fromSourceTimeSec: number;
	toSourceTimeSec: number;
	classification: VisualChange["classification"];
}> {
	const missing: Array<{
		fromSourceTimeSec: number;
		toSourceTimeSec: number;
		classification: VisualChange["classification"];
	}> = [];
	for (const c of evidence.changes) {
		if (!MATERIAL_PIXEL.has(c.classification)) continue;
		const hit = grounding.transitions.some(
			(tr) =>
				near(tr.fromSourceTimeSec, c.fromSourceTimeSec) &&
				near(tr.toSourceTimeSec, c.toSourceTimeSec),
		);
		if (!hit) missing.push(c);
	}
	return missing;
}

/** @deprecated Prefer findMissingMaterialPixelTransitions (moderate + significant). */
export function findMissingSignificantPixelTransitions(
	grounding: VisualSemanticGrounding,
	evidence: SemanticGroundingEvidence,
): Array<{ fromSourceTimeSec: number; toSourceTimeSec: number }> {
	return findMissingMaterialPixelTransitions(grounding, evidence)
		.filter((c) => c.classification === "significant")
		.map(({ fromSourceTimeSec, toSourceTimeSec }) => ({
			fromSourceTimeSec,
			toSourceTimeSec,
		}));
}

/** Material Bug 3 edges hidden inside a static range without a transition. */
export function findMaterialHiddenInStaticRanges(
	grounding: VisualSemanticGrounding,
	evidence: SemanticGroundingEvidence,
): string[] {
	const errors: string[] = [];
	for (const range of grounding.staticRanges ?? []) {
		for (const c of evidence.changes) {
			if (!MATERIAL_PIXEL.has(c.classification)) continue;
			const inside =
				c.fromSourceTimeSec + TIME_EPS >= range.fromSourceTimeSec &&
				c.toSourceTimeSec - TIME_EPS <= range.toSourceTimeSec;
			if (!inside) continue;
			const explained = grounding.transitions.some(
				(tr) =>
					near(tr.fromSourceTimeSec, c.fromSourceTimeSec) &&
					near(tr.toSourceTimeSec, c.toSourceTimeSec),
			);
			if (!explained) {
				errors.push(
					`${c.classification} pixel ${c.fromSourceTimeSec}→${c.toSourceTimeSec} hidden in staticRange ${range.fromSourceTimeSec}–${range.toSourceTimeSec}`,
				);
			}
		}
	}
	return errors;
}

/** @deprecated Prefer findMaterialHiddenInStaticRanges. */
export function findSignificantHiddenInStaticRanges(
	grounding: VisualSemanticGrounding,
	evidence: SemanticGroundingEvidence,
): string[] {
	return findMaterialHiddenInStaticRanges(grounding, evidence).filter((e) => /significant/.test(e));
}

/**
 * Fully static labels are invalid when layout or content is not stable.
 * Does not invent replacement wording — only rejects contradictory claims.
 */
export function findFullyStaticMislabelErrors(grounding: VisualSemanticGrounding): string[] {
	const errors: string[] = [];
	const fullyStaticClaim =
		/\b(materially\s+unchanged|no\s+significant\s+visual\s+changes|fully\s+static|unchanged\s+from\s+the\s+reference)\b/i;
	for (const range of grounding.staticRanges ?? []) {
		if (isFullyStaticRange(range)) continue;
		if (fullyStaticClaim.test(range.summary)) {
			errors.push(
				`staticRange ${range.fromSourceTimeSec}→${range.toSourceTimeSec} claims full stasis but layoutState=${range.layoutState} contentState=${range.contentState}`,
			);
		}
	}
	return errors;
}

/**
 * Drop static ranges whose referenceObservationTimeSec is missing.
 * Does NOT invent observations or rewrite summaries — only removes invalid ranges.
 */
export function dropInvalidStaticRangesWithoutInventing(grounding: VisualSemanticGrounding): {
	grounding: VisualSemanticGrounding;
	dropped: number;
} {
	const obsTimes = grounding.observations.map((o) => o.sourceTimeSec);
	const kept = (grounding.staticRanges ?? []).filter((range) =>
		obsTimes.some((t) => near(t, range.referenceObservationTimeSec)),
	);
	const dropped = (grounding.staticRanges ?? []).length - kept.length;
	return {
		grounding: {
			...grounding,
			staticRanges: kept.length > 0 ? kept : undefined,
		},
		dropped,
	};
}

/** Remove a fenced VISUAL_SEMANTIC_GROUNDING JSON block from assistant text. */
export function stripVisualSemanticJsonBlock(text: string): string {
	const stripped = text
		.replace(/```(?:json)?\s*\{[\s\S]*?"observations"\s*:[\s\S]*?\}\s*```/i, "")
		.replace(/VISUAL_SEMANTIC_GROUNDING\s*:?\s*\{[\s\S]*?\}\s*(?=\n\n|\n[A-Z]|$)/i, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return stripped;
}

/** Detect unsupported whole-video claims from partial sampled evidence. */
export function findUnsupportedWholeVideoClaims(
	text: string,
	evidence: SemanticGroundingEvidence,
): string[] {
	const errors: string[] = [];
	const whole =
		/\bthroughout\s+(the\s+)?video\b/i.test(text) ||
		/\bnothing\s+changes\s+throughout\b/i.test(text) ||
		/\binspected\s+every\s+frame\b/i.test(text) ||
		/\bevery\s+frame\s+of\s+(the\s+)?(video|recording)\b/i.test(text);
	if (!whole) return errors;
	const span =
		evidence.frames.length > 0
			? Math.max(...frameTimes(evidence)) - Math.min(...frameTimes(evidence))
			: 0;
	const duration = evidence.durationSec ?? span;
	// Sampled evidence never equals full video inspection.
	errors.push(
		`unsupported whole-video claim for sampled evidence (span≈${span.toFixed(2)}s of duration≈${duration.toFixed(2)}s)`,
	);
	return errors;
}

/** Prefer product-native transcription-unavailable wording; reject external-tool advice. */
export function findBadTranscriptionWording(text: string): string[] {
	const errors: string[] = [];
	if (
		/\b(external\s+tool|manually\s+transcribe|use\s+whisper\s+separately|download\s+whisper)\b/i.test(
			text,
		)
	) {
		errors.push("external/manual transcription recommendation");
	}
	return errors;
}

/** Soft warnings when the user-visible reply leaks lab/backend phrasing. */
export function findTechnicalUserFacingLeakage(text: string): string[] {
	const facing = text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/SOURCE_STORY\s*:?\s*\{[\s\S]*?\}\s*/gi, " ")
		.replace(/VISUAL_SEMANTIC_GROUNDING\s*:?\s*\{[\s\S]*?\}\s*/gi, " ")
		.replace(/TARGET_STORY\s*:?\s*\{[\s\S]*?\}\s*/gi, " ");
	const errors: string[] = [];
	if (/\bacross\s+the\s+sampled\s+frames\b/i.test(facing)) {
		errors.push("user-facing reply uses sampled-frame lab wording");
	}
	if (
		/\bunable\s+to\s+(directly\s+)?view\s+every\s+frame\b/i.test(facing) ||
		/\bbased\s+on\s+(the\s+)?sampled\s+frames\b/i.test(facing) ||
		/\bbased\s+on\s+available\s+evidence\b/i.test(facing)
	) {
		errors.push("user-facing reply uses evidence-disclaimer lab wording");
	}
	if (/\b(mediaCapabilities|speechStatus|visualFrames|semanticUi)\b/i.test(facing)) {
		errors.push("user-facing reply leaks mediaCapabilities jargon");
	}
	if (/\b(SOURCE_STORY|TARGET_STORY|VISUAL_SEMANTIC_GROUNDING|storyBeats)\b/i.test(facing)) {
		errors.push("user-facing reply leaks internal story/JSON names");
	}
	return errors;
}

export function validateVisualSemanticGrounding(
	raw: unknown,
	evidence: SemanticGroundingEvidence,
): SemanticValidationResult {
	const errors: string[] = [];
	const parsed = visualSemanticGroundingSchema.safeParse(raw);
	if (!parsed.success) {
		return {
			ok: false,
			grounding: null,
			errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
		};
	}
	const rawGrounding = parsed.data;
	const referenceErrors: string[] = [];
	for (const range of rawGrounding.staticRanges ?? []) {
		if (
			!rawGrounding.observations.some((o) =>
				near(o.sourceTimeSec, range.referenceObservationTimeSec),
			)
		) {
			referenceErrors.push(
				`staticRange ${range.fromSourceTimeSec}→${range.toSourceTimeSec} referenceObservationTimeSec ${range.referenceObservationTimeSec} has no observation`,
			);
		}
	}
	// Strategy B: drop ranges with nonexistent references — never invent observations.
	const { grounding } = dropInvalidStaticRangesWithoutInventing(rawGrounding);
	const times = frameTimes(evidence);

	for (const obs of grounding.observations) {
		if (!times.some((t) => near(t, obs.sourceTimeSec))) {
			errors.push(`observation timestamp ${obs.sourceTimeSec} not in supplied frames`);
		}
		if (
			evidence.durationSec != null &&
			(obs.sourceTimeSec < -TIME_EPS || obs.sourceTimeSec > evidence.durationSec + TIME_EPS)
		) {
			errors.push(`observation ${obs.sourceTimeSec} outside video bounds`);
		}
		const regionIds = new Set(obs.regions.map((r) => r.id));
		for (const t of obs.visibleText ?? []) {
			if (t.regionId && !regionIds.has(t.regionId)) {
				errors.push(`visibleText regionId ${t.regionId} unknown at ${obs.sourceTimeSec}`);
			}
		}
		for (const el of obs.uiElements ?? []) {
			if (el.regionId && !regionIds.has(el.regionId)) {
				errors.push(`uiElement regionId ${el.regionId} unknown at ${obs.sourceTimeSec}`);
			}
		}
	}

	for (const tr of grounding.transitions) {
		const match = evidence.changes.some(
			(c) =>
				near(c.fromSourceTimeSec, tr.fromSourceTimeSec) &&
				near(c.toSourceTimeSec, tr.toSourceTimeSec),
		);
		if (!match) {
			errors.push(
				`transition ${tr.fromSourceTimeSec}→${tr.toSourceTimeSec} not in supplied adjacent evidence`,
			);
		}
	}

	// Re-check reference invariant after drop (should be empty; keep as hard guard).
	for (const range of grounding.staticRanges ?? []) {
		if (
			!grounding.observations.some((o) => near(o.sourceTimeSec, range.referenceObservationTimeSec))
		) {
			errors.push(
				`staticRange ${range.fromSourceTimeSec}→${range.toSourceTimeSec} referenceObservationTimeSec ${range.referenceObservationTimeSec} has no observation`,
			);
		}
	}

	const coverage = buildSemanticCoverageMap(grounding, evidence);
	errors.push(...coverage.errors);
	for (const t of coverage.uncovered) {
		errors.push(`attached frame ${t} has no semantic coverage (observation or staticRange)`);
	}

	for (const missing of findMissingMaterialPixelTransitions(grounding, evidence)) {
		errors.push(
			`${missing.classification} Bug3 pixel ${missing.fromSourceTimeSec}→${missing.toSourceTimeSec} missing from semantic transitions`,
		);
	}
	errors.push(...findMaterialHiddenInStaticRanges(grounding, evidence));
	errors.push(...findFullyStaticMislabelErrors(grounding));
	errors.push(...findUnsupportedHighConfidenceIdentities(grounding));

	// If repair could not yield a valid grounding, surface the original reference violations.
	if (errors.length > 0 && referenceErrors.length > 0) {
		errors.unshift(...referenceErrors.filter((e) => !errors.includes(e)));
	}

	if (errors.length > 0) {
		return { ok: false, grounding: null, errors };
	}
	return { ok: true, grounding, errors: [] };
}

/** Extract ```json … ``` or VISUAL_SEMANTIC_GROUNDING {…} from assistant text. */
export function extractVisualSemanticGroundingJson(text: string): unknown | null {
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence?.[1]) {
		const body = fence[1].trim();
		if (/"observations"\s*:/.test(body)) {
			try {
				return JSON.parse(body);
			} catch {
				/* fall through */
			}
		}
	}
	const marker = text.match(/VISUAL_SEMANTIC_GROUNDING\s*(:?\s*)(\{[\s\S]*\})\s*(?:```|$)/i);
	if (marker?.[2]) {
		try {
			return JSON.parse(marker[2]);
		} catch {
			/* fall through */
		}
	}
	const idx = text.lastIndexOf('"observations"');
	if (idx >= 0) {
		const start = text.lastIndexOf("{", idx);
		if (start >= 0) {
			let depth = 0;
			for (let i = start; i < text.length; i++) {
				const ch = text[i];
				if (ch === "{") depth += 1;
				else if (ch === "}") {
					depth -= 1;
					if (depth === 0) {
						try {
							return JSON.parse(text.slice(start, i + 1));
						} catch {
							break;
						}
					}
				}
			}
		}
	}
	return null;
}

export function parseAndValidateVisualSemanticGrounding(
	assistantText: string,
	evidence: SemanticGroundingEvidence,
): SemanticValidationResult {
	const raw = extractVisualSemanticGroundingJson(assistantText);
	if (raw == null) {
		return { ok: false, grounding: null, errors: ["no VISUAL_SEMANTIC_GROUNDING JSON found"] };
	}
	return validateVisualSemanticGrounding(raw, evidence);
}

/**
 * Soft post-checks on the user-facing portion (do not reject the whole turn).
 * Returns warnings for logging / tests.
 */
export function auditUserFacingSemanticLanguage(
	assistantText: string,
	evidence: SemanticGroundingEvidence,
): string[] {
	return [
		...findUnsupportedWholeVideoClaims(assistantText, evidence),
		...findBadTranscriptionWording(assistantText),
		...findTechnicalUserFacingLeakage(assistantText),
	];
}

function formatClock(sec: number): string {
	const s = Math.max(0, sec);
	const m = Math.floor(s / 60);
	const rem = s - m * 60;
	const whole = Math.floor(rem);
	const frac = Math.round((rem - whole) * 100);
	return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

/**
 * Prompt scaffold appended when visual frames are attached.
 * Asks the SAME multimodal turn to emit turn-local structured grounding JSON.
 */
export function buildVisualSemanticGroundingPromptSection(input: {
	frames: VisualEvidenceFrame[];
	changes: VisualChange[];
}): string {
	const times = input.frames.map((f) => f.sourceTimeSec);
	const staticRanges = compressMinimalStaticRanges(input.changes);
	const allowedTimes = times.map((t) => formatClock(t)).join(", ");
	const changeLines = input.changes.map(
		(c) =>
			`- ${formatClock(c.fromSourceTimeSec)} → ${formatClock(c.toSourceTimeSec)}: ${c.classification.toUpperCase()} (score ${c.score.toFixed(2)})`,
	);
	const material = input.changes.filter((c) => MATERIAL_PIXEL.has(c.classification));
	const requiredObservationTimes = new Set<number>();
	if (times.length > 0) requiredObservationTimes.add(times[0]!);
	for (const r of staticRanges) {
		const covered = times.filter(
			(t) => t + TIME_EPS >= r.fromSourceTimeSec && t - TIME_EPS <= r.toSourceTimeSec,
		);
		if (covered[0] != null) requiredObservationTimes.add(covered[0]);
	}
	for (const c of material) {
		requiredObservationTimes.add(c.toSourceTimeSec);
	}
	const requiredObsList = [...requiredObservationTimes]
		.sort((a, b) => a - b)
		.filter((t) => times.some((x) => near(x, t)));
	const staticLines =
		staticRanges.length === 0
			? ["(none — still cover every timestamp via observations)"]
			: staticRanges.map((r) => {
					const covered = times.filter(
						(t) => t + TIME_EPS >= r.fromSourceTimeSec && t - TIME_EPS <= r.toSourceTimeSec,
					);
					const ref = covered[0] ?? r.fromSourceTimeSec;
					return `- ${formatClock(r.fromSourceTimeSec)}–${formatClock(r.toSourceTimeSec)}: coveredFrameTimes≈[${covered.map((t) => t.toFixed(2)).join(", ")}]; MUST include observation at ${ref.toFixed(2)} as referenceObservationTimeSec; layoutState+contentState both \"stable\" only if content truly unchanged`;
				});

	return [
		"",
		"VISUAL SEMANTIC GROUNDING (same turn — required structured block before your final user-facing answer)",
		"Produce turn-local structured observations from the SUPPLIED SAMPLED FRAMES ONLY (not every video frame).",
		"semanticUi remains false. This is AI-derived visual grounding, not a verified UI index.",
		"",
		"Coverage invariant (mandatory):",
		`- Every attached timestamp must appear either as an observation.sourceTimeSec OR inside some staticRanges[].coveredFrameTimes. Attached set: [${times.map((t) => t.toFixed(2)).join(", ")}]`,
		"- Compression is allowed: detailed observations + staticRanges with coveredFrameTimes + referenceObservationTimeSec.",
		"- Every staticRange.referenceObservationTimeSec MUST match an observation in observations[] (same evidence timestamp).",
		"- A NEW compressed semantic state requires an observation at its reference timestamp — never reference a time with no observation.",
		`- REQUIRED observation timestamps (minimum set): [${requiredObsList.map((t) => t.toFixed(2)).join(", ")}]`,
		"- Do NOT omit timestamps silently.",
		"",
		"Layout vs content (mandatory):",
		"- Each staticRange MUST set layoutState and contentState to stable|changed|uncertain.",
		"- Fully static compression ONLY when BOTH are stable (same app chrome AND same visible document/page content across samples).",
		'- If layout stays stable but visible content moves/changes (scroll, edit, selection, terminal output, modal): layoutState=stable, contentState=changed — do NOT call that fully static / "materially unchanged". Put an observation at the new content state.',
		'- Prefer wording like \"layout remains stable while visible document content differs between samples\" unless motion direction is clearly supported.',
		"",
		"Bug 3 reconciliation (mandatory):",
		"- Every MODERATE or SIGNIFICANT measured pixel transition MUST appear in transitions[] with matching pixelClassification.",
		'- If the semantic cause is unclear: semanticChange:\"uncertain\" (or changes[].type \"unknown\") — never pretend nothing happened.',
		"- Never hide a moderate/significant pixel edge inside a staticRange without also listing that transition.",
		"- Do NOT manufacture semantic transitions for MINIMAL Bug 3 edges when images look stable.",
		'- changes[].type must be one of: appeared|disappeared|content_changed|position_changed|state_changed|none|unknown (use content_changed, not \"content change\").',
		material.length === 0
			? "- (no moderate/significant Bug 3 edges on this turn)"
			: `- Material edges requiring transitions: ${material.map((c) => `${formatClock(c.fromSourceTimeSec)}→${formatClock(c.toSourceTimeSec)} (${c.classification})`).join(", ")}`,
		"",
		"Rules:",
		"- Separate OBSERVED (directly visible) from INFERRED (interpretation).",
		"- Use confidence high|medium|low honestly. Do not invent unreadable text or button names.",
		"- In frameSummary / observed: name the FRONTMOST app or site when readable (window title, menu-bar app name, dominant chrome). A background localhost/OpenScreen preview behind Cursor is NOT the frontmost app.",
		"- REQUIRED when readable: set frontmostSurface { name, kind?, title? } to the focused window/site ONLY.",
		"- List other visible browser tabs / behind windows in backgroundSurfaces[{ name, role: tab|behind|dock }]. Never describe a background tab as if the user was actively browsing it (e.g. Upwork tab ≠ navigating job listings).",
		"- Generic blue button without a readable label → describe appearance/location, NEVER invent Publish/Save/Submit.",
		"- Cursor correlation ≠ causation: you may note timing proximity; do not claim a named control was clicked.",
		"- Prefer coarse regions: top-left|top|top-right|left|center|right|bottom-left|bottom|bottom-right|full_screen|unknown.",
		"- Optional editingRelevance none|low|medium|high is assessment only — do not edit unless the user asked for edits.",
		"",
		"User-facing language (after the JSON — what the user reads):",
		userFacingMediaNarrationGuidance(),
		"- Internal JSON may still use precise sample times; the user reply must not sound like a lab dump.",
		speechStatusPromptGuidance(),
		"",
		`Allowed observation timestamps (exact set): ${allowedTimes}`,
		"Measured pixel transitions:",
		...changeLines,
		"Suggested fully-static compression ranges (Bug3 all minimal; still need layoutState+contentState stable + a real reference observation):",
		...staticLines,
		"",
		"Emit ONE fenced JSON block:",
		"```json",
		"{",
		'  "observations": [{ "sourceTimeSec": 0, "frameSummary": "Cursor editor is frontmost; Chrome tabs visible behind including Upwork", "frontmostSurface": { "name": "Cursor", "kind": "app" }, "backgroundSurfaces": [{ "name": "Upwork", "role": "tab" }, { "name": "Chrome", "role": "behind" }], "regions": [{"id":"r1","description":"...","approximateLocation":"center","confidence":"high"}], "visibleText": [{"text":"...","confidence":"high"}], "observed": ["Cursor is the frontmost window"], "inferred": ["..."], "importantRegion": "right", "editingRelevance": "low" }],',
		'  "transitions": [{ "fromSourceTimeSec": 0, "toSourceTimeSec": 1, "summary": "...", "pixelClassification": "significant", "semanticChange": "temporary notification appeared OR uncertain", "changes": [{"type":"appeared","description":"...","confidence":"medium"}], "observed": ["..."], "inferred": ["..."] }],',
		'  "staticRanges": [{ "fromSourceTimeSec": 0, "toSourceTimeSec": 4, "coveredFrameTimes": [0, 2, 4], "referenceObservationTimeSec": 0, "layoutState": "stable", "contentState": "stable", "summary": "Across the sampled frames, editor layout and visible document content remain materially unchanged." }]',
		"}",
		"```",
		"Then answer the user request in natural readable prose. Do not claim semanticUi. Do not mention the JSON block.",
	].join("\n");
}

export function semanticGroundingEvidenceFromPrepared(input: {
	frames: VisualEvidenceFrame[];
	changes?: VisualChange[];
	durationSec?: number;
}): SemanticGroundingEvidence {
	return {
		frames: input.frames.map((f) => ({
			sourceTimeSec: f.sourceTimeSec,
			virtualTimeSec: f.virtualTimeSec,
		})),
		changes: (input.changes ?? []).map((c) => ({
			fromSourceTimeSec: c.fromSourceTimeSec,
			toSourceTimeSec: c.toSourceTimeSec,
			classification: c.classification,
		})),
		durationSec: input.durationSec,
	};
}

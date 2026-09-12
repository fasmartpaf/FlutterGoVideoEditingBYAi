/**
 * Parse + validate model-emitted TARGET_STORY against the turn's Source Story.
 * Malformed stories fail soft — never crash the turn.
 */

import type { SourceStory } from "../sourceStory/types";
import type {
	EditingIntent,
	TargetBeatImportance,
	TargetBeatPacing,
	TargetBeatPurpose,
	TargetStory,
	TargetStoryBeat,
	TargetStoryChange,
	TargetStoryConstraint,
	TargetStoryDensity,
	TargetStoryObjectiveKind,
	TargetStoryPacing,
	TargetStoryUncertainty,
	TargetStoryValidationContext,
} from "./types";
import {
	TARGET_BEAT_IMPORTANCES,
	TARGET_BEAT_PACINGS,
	TARGET_BEAT_PURPOSES,
	TARGET_STORY_DENSITIES,
	TARGET_STORY_OBJECTIVES,
	TARGET_STORY_PACINGS,
} from "./types";

export interface TargetStoryValidationResult {
	ok: boolean;
	story: TargetStory | null;
	errors: string[];
	warnings: string[];
}

/** Implementation-level edit operations — not allowed in Target Story. */
const IMPLEMENTATION_OP =
	/\b(?:zoom\s*(?:in|out)?\s*(?:to\s+)?\d+(\.\d+)?\s*x|\d+(\.\d+)?\s*x\s*zoom|crop\s*(?:to\s+)?[x(]|trim\s+\d|cut\s+\d|delete\s+\d|addTrim|setClip|addZoom|addGraphic|dissolve|wipe\s+transition|cross[\s-]?fade|lower[\s-]?third|increase\s+saturation|saturation\s+\d|gainDb|fadeInSec|apply\s+a\s+\d)/i;

const INVENTED_TESTIMONIAL =
	/\b(?:customer\s+says|testimonial\s+from|viewer\s+testifies|as\s+a\s+happy\s+customer|"[^"]{10,}".*love\s+(?:this|your)\s+product)\b/i;

function isObjectiveKind(v: unknown): v is TargetStoryObjectiveKind {
	return typeof v === "string" && (TARGET_STORY_OBJECTIVES as readonly string[]).includes(v);
}

function isPacing(v: unknown): v is TargetStoryPacing {
	return typeof v === "string" && (TARGET_STORY_PACINGS as readonly string[]).includes(v);
}

function isDensity(v: unknown): v is TargetStoryDensity {
	return typeof v === "string" && (TARGET_STORY_DENSITIES as readonly string[]).includes(v);
}

function isBeatPurpose(v: unknown): v is TargetBeatPurpose {
	return typeof v === "string" && (TARGET_BEAT_PURPOSES as readonly string[]).includes(v);
}

function isImportance(v: unknown): v is TargetBeatImportance {
	return typeof v === "string" && (TARGET_BEAT_IMPORTANCES as readonly string[]).includes(v);
}

function isBeatPacing(v: unknown): v is TargetBeatPacing {
	return typeof v === "string" && (TARGET_BEAT_PACINGS as readonly string[]).includes(v);
}

export function normalizeTargetObjectiveKind(raw: unknown): TargetStoryObjectiveKind | null {
	if (typeof raw !== "string") return null;
	const t = raw
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (isObjectiveKind(t)) return t;
	if (/short|concise|brief|tighten/.test(t)) return "shorten";
	if (/polish|professional|tutorial/.test(t)) return "polish";
	if (/clarif|easier|follow/.test(t)) return "clarify";
	if (/focus|attention/.test(t)) return "focus";
	if (/restructur|reorder/.test(t)) return "restructure";
	if (/repurpose|testimonial|launch|social/.test(t)) return "repurpose";
	return "custom";
}

export function normalizeBeatPurpose(raw: unknown): TargetBeatPurpose | null {
	if (typeof raw !== "string") return null;
	const t = raw
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (isBeatPurpose(t)) return t;
	if (/hook|open/.test(t)) return "hook";
	if (/intro|introduction/.test(t)) return "intro";
	if (/setup|prepare/.test(t)) return "setup";
	if (/explain/.test(t)) return "explanation";
	if (/demo|demonstrat|show/.test(t)) return "demonstration";
	if (/transit|bridge|pause/.test(t)) return "transition";
	if (/result|outcome/.test(t)) return "result";
	if (/outro|clos|end|conclude/.test(t)) return "outro";
	return "other";
}

export function extractTargetStoryJson(text: string): unknown | null {
	const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
	for (const fence of fences) {
		const body = fence[1]?.trim();
		if (!body) continue;
		if (!/"targetBeats"\s*:/.test(body)) continue;
		try {
			return JSON.parse(body);
		} catch {
			/* try next */
		}
	}
	for (const fence of fences) {
		const body = fence[1]?.trim();
		if (!body || !/"audienceExperience"\s*:/.test(body)) continue;
		try {
			return JSON.parse(body);
		} catch {
			/* try next */
		}
	}
	const marker = text.match(/TARGET_STORY\s*:?\s*(\{[\s\S]*\})\s*(?:```|$)/i);
	if (marker?.[1]) {
		try {
			return JSON.parse(marker[1]);
		} catch {
			/* fall through */
		}
	}
	const idx = text.lastIndexOf('"targetBeats"');
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

function parseBool(v: unknown): boolean | null {
	if (typeof v === "boolean") return v;
	if (typeof v === "string") {
		const t = v.trim().toLowerCase();
		if (t === "true" || t === "yes") return true;
		if (t === "false" || t === "no") return false;
	}
	return null;
}

function textBlobHasImplementationOps(...parts: Array<string | undefined>): boolean {
	return parts.some((p) => p != null && IMPLEMENTATION_OP.test(p));
}

function sourceBeatOrderIndex(sourceStory: SourceStory, id: string): number {
	return sourceStory.storyBeats.findIndex((b) => b.id === id);
}

function earliestSourceIndex(sourceStory: SourceStory, ids: string[]): number {
	let min = Number.POSITIVE_INFINITY;
	for (const id of ids) {
		const i = sourceBeatOrderIndex(sourceStory, id);
		if (i >= 0 && i < min) min = i;
	}
	return min === Number.POSITIVE_INFINITY ? -1 : min;
}

function normalizeEditingIntent(raw: unknown): EditingIntent | null {
	if (!raw || typeof raw !== "object") return null;
	const row = raw as Record<string, unknown>;
	const objective = normalizeTargetObjectiveKind(row.objective);
	if (!objective) return null;
	const constraints = Array.isArray(row.constraints)
		? row.constraints.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
		: [];
	const desiredQualities = Array.isArray(row.desiredQualities)
		? row.desiredQualities.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
		: [];
	const preserveMeaning = typeof row.preserveMeaning === "boolean" ? row.preserveMeaning : true;
	return { objective, constraints, desiredQualities, preserveMeaning };
}

function userForbidsRemoval(userMessage: string): boolean {
	return /\bdo\s+not\s+remove\b|\bdon'?t\s+remove\b|\bkeep\s+every\s+spoken\b|\bkeep\s+(?:almost\s+)?everything\b|\bkeep\s+all\s+spoken\b/i.test(
		userMessage,
	);
}

function changeLooksLikeAggressiveShorten(change: TargetStoryChange): boolean {
	return /\bremove\b|\bdelete\b|\bcut\s+out\b|\bshorten\s+aggressively\b|\bdrop\s+(?:the\s+)?(?:intro|explanation|spoken)\b/i.test(
		change.description,
	);
}

export function validateTargetStory(
	raw: unknown,
	ctx: TargetStoryValidationContext,
): TargetStoryValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!raw || typeof raw !== "object") {
		return { ok: false, story: null, errors: ["TARGET_STORY is not an object"], warnings };
	}
	const row = raw as Record<string, unknown>;
	if (typeof row.objective !== "string" || !row.objective.trim()) {
		errors.push("objective missing");
	}
	if (typeof row.audienceExperience !== "string" || !row.audienceExperience.trim()) {
		errors.push("audienceExperience missing");
	}

	const styleRaw =
		row.style && typeof row.style === "object" ? (row.style as Record<string, unknown>) : {};
	const style = {
		...(isPacing(styleRaw.pacing) ? { pacing: styleRaw.pacing } : {}),
		...(isDensity(styleRaw.density) ? { density: styleRaw.density } : {}),
		...(typeof styleRaw.tone === "string" && styleRaw.tone.trim()
			? { tone: styleRaw.tone.trim() }
			: {}),
	};

	const editingIntent = normalizeEditingIntent(row.editingIntent) ?? {
		objective: "custom" as const,
		constraints: [],
		desiredQualities: [],
		preserveMeaning: true,
	};

	if (!Array.isArray(row.targetBeats) || row.targetBeats.length === 0) {
		errors.push("targetBeats missing/empty");
		return { ok: false, story: null, errors, warnings };
	}

	const knownSourceIds = new Set(ctx.sourceStory.storyBeats.map((b) => b.id));
	const beats: TargetStoryBeat[] = [];

	for (let i = 0; i < row.targetBeats.length; i++) {
		const item = row.targetBeats[i];
		if (!item || typeof item !== "object") {
			errors.push(`targetBeat ${i} not an object`);
			continue;
		}
		const b = item as Record<string, unknown>;
		const id = typeof b.id === "string" && b.id.trim() ? b.id.trim() : `t${i + 1}`;
		const purpose = normalizeBeatPurpose(b.purpose);
		const importance = isImportance(b.importance) ? b.importance : null;
		const pacing = isBeatPacing(b.pacing) ? b.pacing : null;
		const changeNeeded = parseBool(b.changeNeeded);
		const desiredOutcome = typeof b.desiredOutcome === "string" ? b.desiredOutcome.trim() : "";
		const rationale = typeof b.rationale === "string" ? b.rationale.trim() : "";
		const sourceBeatIds = Array.isArray(b.sourceBeatIds)
			? b.sourceBeatIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
			: [];

		if (!purpose) {
			errors.push(`${id}: invalid purpose`);
			continue;
		}
		if (!importance) {
			errors.push(`${id}: invalid importance`);
			continue;
		}
		if (!pacing) {
			errors.push(`${id}: invalid pacing`);
			continue;
		}
		if (changeNeeded == null) {
			errors.push(`${id}: changeNeeded must be boolean`);
			continue;
		}
		if (!desiredOutcome) {
			errors.push(`${id}: desiredOutcome missing`);
			continue;
		}
		if (!rationale) {
			errors.push(`${id}: rationale missing`);
			continue;
		}
		if (sourceBeatIds.length === 0) {
			errors.push(`${id}: sourceBeatIds empty — unsupported orphan beat`);
			continue;
		}
		for (const sid of sourceBeatIds) {
			if (!knownSourceIds.has(sid)) {
				errors.push(`${id}: unknown sourceBeatId ${sid}`);
			}
		}
		if (
			textBlobHasImplementationOps(
				desiredOutcome,
				rationale,
				typeof b.reorderJustification === "string" ? b.reorderJustification : undefined,
			)
		) {
			errors.push(`${id}: contains implementation-level edit operations`);
			continue;
		}
		if (INVENTED_TESTIMONIAL.test(desiredOutcome)) {
			errors.push(`${id}: invents testimonial/customer content`);
			continue;
		}

		const reorderJustification =
			typeof b.reorderJustification === "string" && b.reorderJustification.trim()
				? b.reorderJustification.trim()
				: undefined;

		beats.push({
			id,
			sourceBeatIds,
			purpose,
			desiredOutcome,
			importance,
			pacing,
			changeNeeded,
			rationale,
			...(reorderJustification ? { reorderJustification } : {}),
		});
	}

	if (beats.length === 0) {
		errors.push("no valid targetBeats");
		return { ok: false, story: null, errors, warnings };
	}

	// Chronology: earliest source indices should be non-decreasing unless justified.
	let prevIdx = -1;
	for (const beat of beats) {
		const idx = earliestSourceIndex(ctx.sourceStory, beat.sourceBeatIds);
		if (idx < 0) continue;
		if (prevIdx >= 0 && idx < prevIdx) {
			if (!beat.reorderJustification) {
				errors.push(`${beat.id}: reorders source chronology without reorderJustification`);
			} else {
				warnings.push(`${beat.id}: reorder justified — ${beat.reorderJustification}`);
			}
		}
		prevIdx = Math.max(prevIdx, idx);
	}

	const preserve: TargetStoryConstraint[] = Array.isArray(row.preserve)
		? row.preserve
				.filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
				.map((p, i) => ({
					id: typeof p.id === "string" && p.id.trim() ? p.id.trim() : `p${i + 1}`,
					description: typeof p.description === "string" ? p.description.trim() : "",
				}))
				.filter((p) => p.description.length > 0)
		: [];

	const change: TargetStoryChange[] = Array.isArray(row.change)
		? row.change
				.filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
				.map((c, i) => ({
					id: typeof c.id === "string" && c.id.trim() ? c.id.trim() : `c${i + 1}`,
					description: typeof c.description === "string" ? c.description.trim() : "",
					...(typeof c.rationale === "string" && c.rationale.trim()
						? { rationale: c.rationale.trim() }
						: {}),
				}))
				.filter((c) => c.description.length > 0)
		: [];

	for (const c of change) {
		if (textBlobHasImplementationOps(c.description, c.rationale)) {
			errors.push(`${c.id}: change entry has implementation-level edit operations`);
		}
	}
	if (
		textBlobHasImplementationOps(
			typeof row.objective === "string" ? row.objective : undefined,
			typeof row.audienceExperience === "string" ? row.audienceExperience : undefined,
		)
	) {
		errors.push("objective/audienceExperience contains implementation-level edit operations");
	}

	// Explicit user constraints dominate.
	if (userForbidsRemoval(ctx.userMessage)) {
		for (const c of change) {
			if (changeLooksLikeAggressiveShorten(c)) {
				errors.push(`${c.id}: contradicts explicit keep/do-not-remove user constraint`);
			}
		}
		for (const beat of beats) {
			if (
				beat.changeNeeded &&
				beat.pacing === "compress" &&
				/\bremove\b|\bcut\b|\bdrop\b|\bdelete\b/i.test(`${beat.desiredOutcome} ${beat.rationale}`)
			) {
				errors.push(
					`${beat.id}: compress+remove language contradicts keep/do-not-remove constraint`,
				);
			}
		}
	}

	// NO-CHANGE must be representable: do not require every beat to change.
	const allForceChange = beats.every((b) => b.changeNeeded === true);
	if (allForceChange && beats.length >= 3) {
		warnings.push(
			"every target beat has changeNeeded=true — over-editing risk; prefer preserving good beats when appropriate",
		);
	}

	// Pause must not auto-target for removal.
	for (const beat of beats) {
		const sources = beat.sourceBeatIds
			.map((id) => ctx.sourceStory.storyBeats.find((s) => s.id === id))
			.filter(Boolean);
		const isPause = sources.some((s) => s?.purpose === "pause" || s?.purpose === "transition");
		if (
			isPause &&
			beat.changeNeeded &&
			/\bremove\b|\bdelete\b|\bcut\s+out\b|\bdead\s*time\b/i.test(
				`${beat.desiredOutcome} ${beat.rationale}`,
			)
		) {
			errors.push(`${beat.id}: pause/transition must not be automatically targeted for removal`);
		}
	}

	const uncertainties: TargetStoryUncertainty[] | undefined = Array.isArray(row.uncertainties)
		? row.uncertainties
				.filter((u): u is Record<string, unknown> => !!u && typeof u === "object")
				.map((u) => ({
					note: typeof u.note === "string" ? u.note.trim() : "uncertainty",
					...(Array.isArray(u.relatedSourceBeatIds)
						? {
								relatedSourceBeatIds: u.relatedSourceBeatIds.filter(
									(x): x is string => typeof x === "string",
								),
							}
						: {}),
				}))
				.filter((u) => u.note.length > 0)
		: undefined;

	if (errors.length > 0) {
		return { ok: false, story: null, errors, warnings };
	}

	const story: TargetStory = {
		objective: String(row.objective).trim(),
		audienceExperience: String(row.audienceExperience).trim(),
		style,
		editingIntent,
		targetBeats: beats,
		preserve,
		change,
		...(uncertainties?.length ? { uncertainties } : {}),
	};
	return { ok: true, story, errors: [], warnings };
}

export function parseAndValidateTargetStory(
	assistantText: string,
	ctx: TargetStoryValidationContext,
): TargetStoryValidationResult {
	const raw = extractTargetStoryJson(assistantText);
	if (raw == null) {
		return {
			ok: false,
			story: null,
			errors: ["no TARGET_STORY JSON found"],
			warnings: [],
		};
	}
	return validateTargetStory(raw, ctx);
}

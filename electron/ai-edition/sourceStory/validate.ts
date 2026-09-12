/**
 * Parse + validate model-emitted SOURCE_STORY against the turn scaffold.
 * Malformed stories fail soft — never crash the turn.
 */

import { SOURCE_TIMESTAMP_TOLERANCE_SEC } from "../sourceTiming";
import type { SourceStoryScaffold } from "./types";
import {
	SOURCE_STORY_CONFIDENCES,
	SOURCE_STORY_CONTENT_TYPES,
	SOURCE_STORY_PURPOSES,
	type SourceStory,
	type SourceStoryBeat,
	type SourceStoryConfidence,
	type SourceStoryContentType,
	type SourceStoryPurpose,
} from "./types";

const TIME_EPS = 0.051;
const OVERLAP_EPS = 0.12;
const COVERAGE_GAP_WARN_SEC = 2.5;

const EMOTION_WITHOUT_EVIDENCE =
	/\b(frustrat|angry|annoyed|excit|happy|sad|nervous|anxious|hate|love)\w*\b/i;

function near(a: number, b: number, eps = TIME_EPS): boolean {
	return Math.abs(a - b) <= eps;
}

function rangesOverlap(
	aStart: number,
	aEnd: number,
	bStart: number,
	bEnd: number,
	eps = OVERLAP_EPS,
): boolean {
	return aStart < bEnd - eps && bStart < aEnd - eps;
}

const NO_SPEECH_SPOKEN =
	/no speech|silent|without narration|no narration|no spoken|speech (is )?absent|no audio/i;

const ASSERTED_SETTINGS_OPEN =
	/\b(user opens settings|opened the settings|settings (is|are) open|opens the settings|as the user opens? settings)\b/i;

/** Hedge overallSummary when beats show speech≠visual for UI claims. */
export function hedgeContradictionOverallSummary(
	summary: string,
	beats: SourceStoryBeat[],
): string {
	const speechClaimsSettings = beats.some(
		(b) =>
			(b.evidence.speechSegmentIds?.length ?? 0) > 0 &&
			/\bsettings\b/i.test(`${b.summary} ${b.spokenMeaning ?? ""}`),
	);
	const visualsDoNotConfirm = beats.some((b) =>
		/no significant|does not|not (clearly )?confirm|remain|stable|no .*change|unchanged|without .*change/i.test(
			b.visualMeaning ?? "",
		),
	);
	if (!speechClaimsSettings || !visualsDoNotConfirm) return summary;
	if (!ASSERTED_SETTINGS_OPEN.test(summary) && !/\bopens? settings\b/i.test(summary)) {
		return summary;
	}
	return summary
		.replace(/\bas the user opens? settings\b/gi, "as the speaker mentions opening settings")
		.replace(/\buser opens? settings\b/gi, "speaker says they are opening settings")
		.replace(/\bopened the settings\b/gi, "said they opened the settings")
		.replace(/\bopens? the settings\b/gi, "mentions opening the settings")
		.replace(/\bopens? settings\b/gi, "mentions opening settings")
		.replace(/\bsettings (is|are) open\b/gi, "settings are claimed open in speech");
}

/** Fill uncovered scaffold speech-gap windows as pause beats (no second model call). */
export function fillUncoveredSpeechGapBeats(
	beats: SourceStoryBeat[],
	scaffold: SourceStoryScaffold,
): { beats: SourceStoryBeat[]; inserted: number } {
	const out = [...beats];
	let inserted = 0;
	for (const w of scaffold.windows) {
		if (!w.speechGap) continue;
		const covered = out.some((b) =>
			rangesOverlap(
				b.startSourceTimeSec,
				b.endSourceTimeSec,
				w.startSourceTimeSec,
				w.endSourceTimeSec,
			),
		);
		if (covered) continue;
		inserted += 1;
		out.push({
			id: `b_gap_${inserted}`,
			startSourceTimeSec: w.startSourceTimeSec,
			endSourceTimeSec: w.endSourceTimeSec,
			purpose: "pause",
			summary:
				"Speech pauses while the recording continues; treat as a context gap/transition, not an edit judgment.",
			...(w.visualTimes.length
				? { visualMeaning: "Visual context continues across the speech gap." }
				: {}),
			evidence: {
				...(w.visualTimes.length ? { visualTimes: [...w.visualTimes] } : {}),
				...(w.cursorEventTimes.length ? { cursorEventTimes: [...w.cursorEventTimes] } : {}),
			},
			confidence: "medium",
		});
	}
	if (inserted === 0) return { beats, inserted: 0 };
	out.sort(
		(a, b) =>
			a.startSourceTimeSec - b.startSourceTimeSec || a.endSourceTimeSec - b.endSourceTimeSec,
	);
	return { beats: out, inserted };
}

function isPurpose(v: unknown): v is SourceStoryPurpose {
	return typeof v === "string" && (SOURCE_STORY_PURPOSES as readonly string[]).includes(v);
}

function isConfidence(v: unknown): v is SourceStoryConfidence {
	return typeof v === "string" && (SOURCE_STORY_CONFIDENCES as readonly string[]).includes(v);
}

function isContentType(v: unknown): v is SourceStoryContentType {
	return typeof v === "string" && (SOURCE_STORY_CONTENT_TYPES as readonly string[]).includes(v);
}

/** Map common model phrasings onto the closed contentType enum. */
export function normalizeSourceStoryContentType(raw: unknown): SourceStoryContentType | null {
	if (typeof raw !== "string") return null;
	const t = raw
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (isContentType(t)) return t;
	if (/(tutorial|walkthrough|how[_]?to|software_tutorial)/.test(t)) return "tutorial";
	if (/(^|_)demo(_|$)|demonstration|product_demo/.test(t)) return "demo";
	if (/presentation|slideshow|slides/.test(t)) return "presentation";
	if (/talking[_]?head|webcam[_]?talk|face[_]?cam/.test(t)) return "talking_head";
	if (/screen[_]?recording|screencast|desktop[_]?capture|recording/.test(t)) {
		return "screen_recording";
	}
	if (/mixed|hybrid|multi/.test(t)) return "mixed";
	if (/unknown|other|unclear/.test(t)) return "unknown";
	return null;
}

/** Map common model phrasings onto the closed purpose enum. */
export function normalizeSourceStoryPurpose(raw: unknown): SourceStoryPurpose | null {
	if (typeof raw !== "string") return null;
	const t = raw
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (isPurpose(t)) return t;
	if (/intro|introduction|opening/.test(t)) return "intro";
	if (/setup|prepare|context/.test(t)) return "setup";
	if (/explain|explanation|describe/.test(t)) return "explanation";
	if (/demo|demonstrat|show/.test(t)) return "demonstration";
	if (/navigat|browse|click\s*around/.test(t)) return "navigation";
	if (/transition|shift|change[_]?over/.test(t)) return "transition";
	if (/result|outcome|reveal/.test(t)) return "result";
	if (/pause|silence|gap|hesitat/.test(t)) return "pause";
	if (/repetition|repeat|again/.test(t)) return "repetition";
	if (/correction|correct|actually|undo/.test(t)) return "correction";
	if (/outro|closing|wrap|conclusion/.test(t)) return "outro";
	return "unknown";
}

export function extractSourceStoryJson(text: string): unknown | null {
	const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
	// Prefer the fence that actually contains storyBeats (skip visual-semantic blocks).
	for (const fence of fences) {
		const body = fence[1]?.trim();
		if (!body || !/"storyBeats"\s*:/.test(body)) continue;
		try {
			return JSON.parse(body);
		} catch {
			/* try next */
		}
	}
	for (const fence of fences) {
		const body = fence[1]?.trim();
		if (!body || !/"overallSummary"\s*:/.test(body)) continue;
		try {
			return JSON.parse(body);
		} catch {
			/* try next */
		}
	}
	const marker = text.match(/SOURCE_STORY\s*:?\s*(\{[\s\S]*\})\s*(?:```|$)/i);
	if (marker?.[1]) {
		try {
			return JSON.parse(marker[1]);
		} catch {
			/* fall through */
		}
	}
	const idx = text.lastIndexOf('"storyBeats"');
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
							return null;
						}
					}
				}
			}
		}
	}
	return null;
}

function speechIdSet(scaffold: SourceStoryScaffold): Set<string> {
	return new Set(scaffold.speechSegments.map((s) => s.id));
}

function visualTimeOk(t: number, scaffold: SourceStoryScaffold): boolean {
	return scaffold.visualTimes.some((v) => near(v, t, SOURCE_TIMESTAMP_TOLERANCE_SEC));
}

function cursorTimeOk(t: number, scaffold: SourceStoryScaffold): boolean {
	if (scaffold.cursorEventTimes.length === 0) return false;
	return scaffold.cursorEventTimes.some((v) => near(v, t, SOURCE_TIMESTAMP_TOLERANCE_SEC));
}

function evidenceCount(beat: SourceStoryBeat): number {
	return (
		(beat.evidence.speechSegmentIds?.length ?? 0) +
		(beat.evidence.visualTimes?.length ?? 0) +
		(beat.evidence.cursorEventTimes?.length ?? 0)
	);
}

function normalizeBeat(raw: Record<string, unknown>, index: number): SourceStoryBeat | null {
	const start = Number(raw.startSourceTimeSec);
	const end = Number(raw.endSourceTimeSec);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (!isPurpose(raw.purpose)) return null;
	if (!isConfidence(raw.confidence)) return null;
	if (typeof raw.summary !== "string" || !raw.summary.trim()) return null;
	const evRaw =
		raw.evidence && typeof raw.evidence === "object"
			? (raw.evidence as Record<string, unknown>)
			: {};
	const speechSegmentIds = Array.isArray(evRaw.speechSegmentIds)
		? evRaw.speechSegmentIds.filter((x): x is string => typeof x === "string")
		: undefined;
	const visualTimes = Array.isArray(evRaw.visualTimes)
		? evRaw.visualTimes.map(Number).filter((n) => Number.isFinite(n))
		: undefined;
	const cursorEventTimes = Array.isArray(evRaw.cursorEventTimes)
		? evRaw.cursorEventTimes.map(Number).filter((n) => Number.isFinite(n))
		: undefined;
	return {
		id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `b${index + 1}`,
		startSourceTimeSec: start,
		endSourceTimeSec: end,
		purpose: raw.purpose,
		summary: raw.summary.trim(),
		...(typeof raw.spokenMeaning === "string" ? { spokenMeaning: raw.spokenMeaning } : {}),
		...(typeof raw.visualMeaning === "string" ? { visualMeaning: raw.visualMeaning } : {}),
		...(typeof raw.interactionMeaning === "string"
			? { interactionMeaning: raw.interactionMeaning }
			: {}),
		evidence: {
			...(speechSegmentIds?.length ? { speechSegmentIds } : {}),
			...(visualTimes?.length ? { visualTimes } : {}),
			...(cursorEventTimes?.length ? { cursorEventTimes } : {}),
		},
		confidence: raw.confidence,
	};
}

export interface SourceStoryValidationResult {
	ok: boolean;
	story: SourceStory | null;
	errors: string[];
	warnings: string[];
}

export function validateSourceStory(
	raw: unknown,
	scaffold: SourceStoryScaffold,
): SourceStoryValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!raw || typeof raw !== "object") {
		return { ok: false, story: null, errors: ["SOURCE_STORY is not an object"], warnings };
	}
	const row = raw as Record<string, unknown>;
	const duration =
		Number.isFinite(Number(row.sourceDurationSec)) && Number(row.sourceDurationSec) > 0
			? Number(row.sourceDurationSec)
			: scaffold.sourceDurationSec;
	if (Math.abs(duration - scaffold.sourceDurationSec) > SOURCE_TIMESTAMP_TOLERANCE_SEC + 0.2) {
		warnings.push(
			`sourceDurationSec ${duration} differs from canonical ${scaffold.sourceDurationSec}`,
		);
	}
	if (typeof row.overallSummary !== "string" || !row.overallSummary.trim()) {
		errors.push("overallSummary missing");
	}
	const contentType = normalizeSourceStoryContentType(row.contentType);
	if (!contentType) {
		errors.push("contentType invalid");
	}
	if (!Array.isArray(row.storyBeats) || row.storyBeats.length === 0) {
		errors.push("storyBeats missing/empty");
		return { ok: false, story: null, errors, warnings };
	}

	const knownSpeech = speechIdSet(scaffold);
	const beats: SourceStoryBeat[] = [];
	for (let i = 0; i < row.storyBeats.length; i++) {
		const item = row.storyBeats[i];
		if (!item || typeof item !== "object") {
			errors.push(`beat ${i} not an object`);
			continue;
		}
		const rawBeat = item as Record<string, unknown>;
		const normalizedPurpose = normalizeSourceStoryPurpose(rawBeat.purpose);
		let beat = normalizeBeat(
			{
				...rawBeat,
				...(normalizedPurpose ? { purpose: normalizedPurpose } : {}),
			},
			i,
		);
		if (!beat) {
			errors.push(`beat ${i} malformed purpose/confidence/summary/times`);
			continue;
		}

		// Reject edit-judgment purposes smuggled as free text.
		if (/\bdead\s*time\b|\bunnecessary\b/i.test(beat.summary) && beat.purpose === "pause") {
			warnings.push(`${beat.id}: pause summary looks like an edit judgment; kept as pause`);
		}
		if (beat.purpose === ("dead_time" as SourceStoryPurpose)) {
			errors.push(`${beat.id}: invalid purpose dead_time`);
			continue;
		}

		if (
			beat.startSourceTimeSec < -SOURCE_TIMESTAMP_TOLERANCE_SEC ||
			beat.endSourceTimeSec > scaffold.sourceDurationSec + SOURCE_TIMESTAMP_TOLERANCE_SEC
		) {
			errors.push(
				`${beat.id}: times ${beat.startSourceTimeSec}–${beat.endSourceTimeSec} outside duration ${scaffold.sourceDurationSec}`,
			);
			continue;
		}
		if (beat.endSourceTimeSec + TIME_EPS < beat.startSourceTimeSec) {
			errors.push(`${beat.id}: end before start`);
			continue;
		}

		for (const id of beat.evidence.speechSegmentIds ?? []) {
			if (!knownSpeech.has(id)) {
				errors.push(`${beat.id}: unknown speechSegmentId ${id}`);
			}
		}
		for (const t of beat.evidence.visualTimes ?? []) {
			if (scaffold.visualTimes.length === 0) {
				warnings.push(`${beat.id}: visualTimes present but no frames attached`);
			} else if (!visualTimeOk(t, scaffold)) {
				errors.push(`${beat.id}: visualTime ${t} not in attached frames`);
			}
		}
		for (const t of beat.evidence.cursorEventTimes ?? []) {
			if (!cursorTimeOk(t, scaffold)) {
				errors.push(`${beat.id}: cursorEventTime ${t} not in cursor evidence`);
			}
		}

		// Speech claim must not become verified visual fact without visuals.
		if (
			beat.visualMeaning &&
			/\b(opens?|opened|opening)\s+(settings|preferences)\b/i.test(beat.visualMeaning) &&
			(beat.evidence.visualTimes?.length ?? 0) === 0
		) {
			errors.push(`${beat.id}: visualMeaning claims UI without visual evidence`);
		}

		// Spoken fact as visual without caveat.
		if (
			beat.summary &&
			/\buser\s+opens?\s+settings\b/i.test(beat.summary) &&
			!/does\s+not\s+clearly\s+confirm|not\s+clearly\s+confirm|limited|uncertain/i.test(
				beat.summary,
			) &&
			(beat.evidence.visualTimes?.length ?? 0) === 0
		) {
			warnings.push(`${beat.id}: speech-only settings claim treated as visual fact`);
			beat = { ...beat, confidence: "low" };
		}

		if (beat.confidence === "high" && evidenceCount(beat) === 0) {
			warnings.push(`${beat.id}: high confidence without evidence — downgraded`);
			beat = { ...beat, confidence: "low" };
		}

		if (EMOTION_WITHOUT_EVIDENCE.test(beat.summary) && evidenceCount(beat) === 0) {
			warnings.push(`${beat.id}: unsupported emotion/intention — downgraded`);
			beat = { ...beat, confidence: "low" };
		}

		if (
			(beat.purpose === "correction" || beat.purpose === "repetition") &&
			(beat.evidence.speechSegmentIds?.length ?? 0) === 0
		) {
			warnings.push(`${beat.id}: ${beat.purpose} without speech evidence — downgraded to unknown`);
			beat = { ...beat, purpose: "unknown", confidence: "low" };
		}

		const scaffoldHasSpeech = scaffold.speechSegments.length > 0;
		if (!scaffoldHasSpeech) {
			if (
				beat.spokenMeaning &&
				beat.spokenMeaning.trim().length > 0 &&
				!NO_SPEECH_SPOKEN.test(beat.spokenMeaning)
			) {
				warnings.push(`${beat.id}: invented spokenMeaning without speech evidence — cleared`);
				const { spokenMeaning: _drop, ...rest } = beat;
				beat = rest;
			}
			if ((beat.evidence.speechSegmentIds?.length ?? 0) > 0) {
				warnings.push(`${beat.id}: speechSegmentIds without scaffold speech — cleared`);
				const { speechSegmentIds: _ids, ...ev } = beat.evidence;
				beat = { ...beat, evidence: ev };
			}
			if (beat.confidence === "high") {
				warnings.push(`${beat.id}: high confidence without speech — downgraded to medium`);
				beat = { ...beat, confidence: "medium" };
			}
		}

		beats.push(beat);
	}

	beats.sort(
		(a, b) =>
			a.startSourceTimeSec - b.startSourceTimeSec || a.endSourceTimeSec - b.endSourceTimeSec,
	);

	// Reject transcript/frame-copy patterns before gap-fill changes beat count.
	if (
		scaffold.speechSegments.length >= 3 &&
		beats.length === scaffold.speechSegments.length &&
		beats.every((b, i) => {
			const s = scaffold.speechSegments[i];
			return (
				s != null &&
				near(b.startSourceTimeSec, s.startSourceTimeSec, 0.35) &&
				near(b.endSourceTimeSec, s.endSourceTimeSec, 0.35) &&
				b.summary.trim() === s.text.trim()
			);
		})
	) {
		errors.push("story appears to be transcript-segment-per-beat copy — rejected");
	}

	if (
		scaffold.visualTimes.length >= 4 &&
		beats.length === scaffold.visualTimes.length &&
		beats.every((b, i) => near(b.startSourceTimeSec, scaffold.visualTimes[i]!, 0.25))
	) {
		errors.push("story appears to be one-beat-per-visual-frame — rejected");
	}

	const gapFill = fillUncoveredSpeechGapBeats(beats, scaffold);
	if (gapFill.inserted > 0) {
		warnings.push(`inserted ${gapFill.inserted} pause beat(s) for uncovered scaffold speech gaps`);
		beats.length = 0;
		beats.push(...gapFill.beats);
	}

	for (let i = 0; i < beats.length; i++) {
		const b = beats[i]!;
		if (i > 0) {
			const prev = beats[i - 1]!;
			if (b.startSourceTimeSec + OVERLAP_EPS < prev.endSourceTimeSec) {
				errors.push(
					`${b.id} overlaps ${prev.id} (${prev.startSourceTimeSec}–${prev.endSourceTimeSec} vs ${b.startSourceTimeSec}–${b.endSourceTimeSec})`,
				);
			}
			if (b.startSourceTimeSec + TIME_EPS < prev.startSourceTimeSec) {
				errors.push(`${b.id} out of chronological order`);
			}
		}
	}

	// Coverage: warn on large unexplained gaps.
	if (beats.length > 0) {
		if (beats[0]!.startSourceTimeSec > COVERAGE_GAP_WARN_SEC) {
			warnings.push(`unexplained gap before first beat (0–${beats[0]!.startSourceTimeSec})`);
		}
		for (let i = 0; i < beats.length - 1; i++) {
			const gap = beats[i + 1]!.startSourceTimeSec - beats[i]!.endSourceTimeSec;
			if (gap > COVERAGE_GAP_WARN_SEC) {
				warnings.push(
					`unexplained gap ${beats[i]!.endSourceTimeSec}–${beats[i + 1]!.startSourceTimeSec}`,
				);
			}
		}
		const last = beats[beats.length - 1]!;
		if (scaffold.sourceDurationSec - last.endSourceTimeSec > COVERAGE_GAP_WARN_SEC) {
			warnings.push(
				`unexplained gap after last beat (${last.endSourceTimeSec}–${scaffold.sourceDurationSec})`,
			);
		}
	}

	if (errors.length > 0) {
		return { ok: false, story: null, errors, warnings };
	}

	const unresolved = Array.isArray(row.unresolvedEvidence)
		? row.unresolvedEvidence
				.filter((u): u is Record<string, unknown> => !!u && typeof u === "object")
				.map((u) => ({
					...(Number.isFinite(Number(u.startSourceTimeSec))
						? { startSourceTimeSec: Number(u.startSourceTimeSec) }
						: {}),
					...(Number.isFinite(Number(u.endSourceTimeSec))
						? { endSourceTimeSec: Number(u.endSourceTimeSec) }
						: {}),
					note: typeof u.note === "string" ? u.note : "unresolved",
				}))
		: undefined;

	const overallSummaryRaw = String(row.overallSummary).trim();
	const overallSummary = hedgeContradictionOverallSummary(overallSummaryRaw, beats);
	if (overallSummary !== overallSummaryRaw) {
		warnings.push("overallSummary hedged to preserve speech≠visual contradiction");
	}

	const story: SourceStory = {
		sourceDurationSec: scaffold.sourceDurationSec,
		overallSummary,
		contentType: contentType ?? "unknown",
		...(typeof row.primaryGoal === "string" ? { primaryGoal: row.primaryGoal } : {}),
		storyBeats: beats,
		...(unresolved?.length ? { unresolvedEvidence: unresolved } : {}),
	};
	return { ok: true, story, errors: [], warnings };
}

export function parseAndValidateSourceStory(
	assistantText: string,
	scaffold: SourceStoryScaffold,
): SourceStoryValidationResult {
	const raw = extractSourceStoryJson(assistantText);
	if (raw == null) {
		return {
			ok: false,
			story: null,
			errors: ["no SOURCE_STORY JSON found"],
			warnings: [],
		};
	}
	return validateSourceStory(raw, scaffold);
}

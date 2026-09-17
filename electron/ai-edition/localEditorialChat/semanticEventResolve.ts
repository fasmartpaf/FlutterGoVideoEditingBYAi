/**
 * Semantic edit event resolver — WHERE for user-decided WHAT.
 * LOCAL ONLY. Speech mentions are not visual proof.
 * Does not modify frozen edit family implementations.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { programmeDurationSec } from "./directTrim";
import type { CursorSampleLite } from "./directZoomFocus";
import { GENERIC_IDENTITY_SINGLETONS } from "./semanticEventIdentity";
import { mapSourceInstantToProgrammeSafe } from "./semanticProgrammeMap";

export type SemanticEventKind = "VISUAL_OR_UI" | "SPOKEN" | "CLICK" | "GENERIC";

export type SemanticEvidenceModality = "speech" | "cursor" | "visual_change" | "ocr_onset";

export interface SemanticEventCandidate {
	startSec: number;
	endSec: number;
	anchorSec: number;
	label: string;
	confidence: "HIGH" | "MEDIUM" | "LOW";
	evidenceRefs: string[];
	score: number;
	/** Which evidence modalities support this candidate. */
	modalities: SemanticEvidenceModality[];
	/**
	 * Pixel/activity change observed nearby (VisualAnalysis).
	 * Does NOT mean the named UI/page was identified.
	 */
	visualChangeObserved: boolean;
	/**
	 * Requested event identified via before/after frame evidence (e.g. OCR onset).
	 * Required for VISUAL_OR_UI FOUND.
	 */
	requestedEventIdentified: boolean;
}

export interface SemanticEventResolveResult {
	cue: string;
	kind: SemanticEventKind;
	queryTokens: string[];
	status: "FOUND" | "AMBIGUOUS" | "NOT_FOUND";
	candidates: SemanticEventCandidate[];
	best: SemanticEventCandidate | null;
	userFacingReason: string;
	/** Speech-only hints when visual confirmation was required but missing. */
	speechHints?: Array<{ anchorSec: number; text: string }>;
	visualAnalysisUsed?: boolean;
	identityChecked?: boolean;
}

/** Optional visual-change intervals from local VisualAnalysis / Bug-3 pipeline. */
export interface VisualChangeIntervalLite {
	startSec: number;
	endSec: number;
	level?: "MINIMAL" | "MODERATE" | "SIGNIFICANT" | string;
	sourceSec?: number;
}

const STOP = new Set([
	"when",
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
	"be",
	"been",
	"being",
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
	"clicking",
	"show",
	"showing",
	"showed",
	"move",
	"moving",
	"moved",
	"appear",
	"appears",
	"appeared",
	"talking",
	"talk",
	"about",
	"explaining",
	"explain",
	"go",
	"going",
	"get",
	"getting",
]);

/** Extract "when …" / "while …" event cue from ordinary language. */
export function extractSemanticEventCue(raw: string): string | null {
	const t = raw.trim();
	const m =
		t.match(/\b(?:when|while|as)\s+(?:i|we|you|the|this|that|it)\b[\s\S]{2,120}/i) ??
		t.match(
			/\b(?:when|while)\s+(?:switching|opening|clicking|showing|moving|starting|talking)\b[\s\S]{2,100}/i,
		);
	if (!m) return null;
	let cue = m[0]!.trim();
	cue = cue.replace(/[.?!,;]+$/g, "").trim();
	if (cue.length < 8) return null;
	return cue.slice(0, 160);
}

export function classifySemanticEventKind(cue: string): SemanticEventKind {
	const n = cue.toLowerCase();
	if (/\bclick|button|press|tap\b/.test(n)) return "CLICK";
	if (/\btalk|explain|say|mention|discuss|pricing|api|narrat/i.test(n)) return "SPOKEN";
	if (
		/\bswitch|open|appear|landing|browser|settings|dashboard|window|page|screen|ide|website|site\b/.test(
			n,
		)
	) {
		return "VISUAL_OR_UI";
	}
	return "GENERIC";
}

export function tokenizeSemanticCue(cue: string): string[] {
	const normalizedCue = cue.toLowerCase().replace(/-/g, " ");
	const words = normalizedCue
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length >= 2 && !STOP.has(w));
	const joined: string[] = [];
	const phrases = [
		"landing page",
		"home page",
		"settings",
		"export",
		"dashboard",
		"browser",
		"pricing",
		"api",
		"website",
	];
	for (const p of phrases) {
		if (normalizedCue.includes(p)) joined.push(p);
	}
	return [...new Set([...joined, ...words])].slice(0, 12);
}

function programmeDuration(doc: AxcutDocument): number {
	// Prefer trim-aware programme duration (speech/cursor clocks are source-time).
	const viaSegs = programmeDurationSec(doc);
	if (viaSegs > 0) return viaSegs;
	const clips = doc.timeline?.clips ?? [];
	if (clips.length === 0) return 0;
	return Math.max(...clips.map((c) => c.timelineEndSec), 0);
}

/**
 * Transcript clocks are SOURCE media time. Map each hit into programme time
 * before using it as a Chat/Zoom anchor — otherwise late source speech lands
 * past programme end (e.g. src 21.9s with early trims → unmapped / false late candidate).
 */
function transcriptHits(
	doc: AxcutDocument,
	tokens: string[],
): Array<{ startSec: number; endSec: number; text: string; score: number }> {
	const segs =
		doc.transcripts?.[0]?.segments ??
		(
			doc.transcript as {
				segments?: Array<{ startSec: number; endSec: number; text?: string }>;
			} | null
		)?.segments ??
		[];
	const words = doc.transcripts?.[0]?.words ?? [];
	const assetId = doc.project.primaryAssetId ?? doc.assets[0]?.id ?? "asset";
	const out: Array<{ startSec: number; endSec: number; text: string; score: number }> = [];

	const pushMapped = (sourceStart: number, sourceEnd: number, text: string, score: number) => {
		const mapped = mapSourceInstantToProgrammeSafe({
			document: doc,
			assetId,
			sourceTimeSec: sourceStart,
		});
		if (mapped.status !== "ok" || mapped.programmeTimeSec == null) return;
		const span = Math.max(0.05, sourceEnd - sourceStart);
		out.push({
			startSec: mapped.programmeTimeSec,
			endSec: mapped.programmeTimeSec + span,
			text,
			score,
		});
	};

	for (const tok of tokens) {
		// Generic singletons (“page”) must not create speech candidates for UI events.
		if (!tok.includes(" ") && GENERIC_IDENTITY_SINGLETONS.has(tok.toLowerCase())) {
			continue;
		}
		const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
		for (const w of words) {
			const text = String((w as { text?: string }).text ?? "");
			if (!re.test(text)) continue;
			const startSec = Number((w as { startSec?: number }).startSec ?? 0);
			const endSec = Number((w as { endSec?: number }).endSec ?? startSec + 0.4);
			pushMapped(startSec, endSec, text, tok.includes(" ") ? 3 : 2);
		}
		for (const s of segs) {
			const text = String(s.text ?? "");
			if (!re.test(text)) continue;
			pushMapped(s.startSec, s.endSec, text.slice(0, 80), tok.includes(" ") ? 2.5 : 1.5);
		}
	}
	return out;
}

function clickHits(
	samples: CursorSampleLite[] | null | undefined,
	nearSec: number | null,
	windowSec = 2.5,
): Array<{ atSec: number; cx: number; cy: number; score: number }> {
	if (!samples?.length) return [];
	const clicks = samples.filter(
		(s) => s.interactionType === "click" || s.interactionType === "mouseup",
	);
	return clicks
		.filter((s) => (nearSec == null ? true : Math.abs(s.atSec - nearSec) <= windowSec))
		.map((s) => ({
			atSec: s.atSec,
			cx: s.cx,
			cy: s.cy,
			score: nearSec == null ? 1 : 2.5 - Math.min(2, Math.abs(s.atSec - nearSec)),
		}));
}

function materialVisualNear(
	visual: VisualChangeIntervalLite[] | null | undefined,
	anchorSec: number,
	windowSec = 2.5,
): VisualChangeIntervalLite | null {
	if (!visual?.length) return null;
	let best: VisualChangeIntervalLite | null = null;
	let bestDist = Infinity;
	for (const v of visual) {
		if (!Number.isFinite(v.startSec) || !Number.isFinite(v.endSec)) continue;
		const level = String(v.level ?? "").toUpperCase();
		if (level === "MINIMAL") continue;
		const mid = (v.startSec + v.endSec) / 2;
		const dist = Math.min(
			Math.abs(mid - anchorSec),
			Math.abs(v.startSec - anchorSec),
			Math.abs(v.endSec - anchorSec),
		);
		if (dist <= windowSec && dist < bestDist) {
			best = v;
			bestDist = dist;
		}
	}
	return best;
}

function mergeCandidates(raw: SemanticEventCandidate[], mergeSec = 2.5): SemanticEventCandidate[] {
	const sorted = [...raw].sort((a, b) => a.anchorSec - b.anchorSec);
	const out: SemanticEventCandidate[] = [];
	for (const c of sorted) {
		const prev = out[out.length - 1];
		if (prev && Math.abs(prev.anchorSec - c.anchorSec) <= mergeSec) {
			if (c.score > prev.score) {
				out[out.length - 1] = {
					...c,
					evidenceRefs: [...new Set([...prev.evidenceRefs, ...c.evidenceRefs])],
					modalities: [...new Set([...prev.modalities, ...c.modalities])],
					visualChangeObserved: prev.visualChangeObserved || c.visualChangeObserved,
					requestedEventIdentified: prev.requestedEventIdentified || c.requestedEventIdentified,
					score: c.score + 0.3,
				};
			} else {
				prev.evidenceRefs = [...new Set([...prev.evidenceRefs, ...c.evidenceRefs])];
				prev.modalities = [...new Set([...prev.modalities, ...c.modalities])];
				prev.visualChangeObserved = prev.visualChangeObserved || c.visualChangeObserved;
				prev.requestedEventIdentified = prev.requestedEventIdentified || c.requestedEventIdentified;
				prev.score += 0.2;
			}
			continue;
		}
		out.push({ ...c, modalities: [...c.modalities] });
	}
	return out.sort((a, b) => b.score - a.score);
}

function zoomWindowAround(
	anchorSec: number,
	dur: number,
	pre = 0.35,
	post = 4.0,
): { startSec: number; endSec: number } {
	const startSec = Math.max(0, anchorSec - pre);
	const endSec = Math.min(dur > 0 ? dur : anchorSec + post, anchorSec + post);
	if (endSec - startSec < 0.6) {
		return {
			startSec: Math.max(0, anchorSec - 0.2),
			endSec: Math.max(0.6, anchorSec + 0.8),
		};
	}
	return { startSec, endSec };
}

/**
 * Resolve a user-described event to programme time candidates.
 * For VISUAL_OR_UI: speech + pixel change may narrow candidates, but FOUND
 * requires requestedEventIdentified (via identityByAnchorSec from OCR onset).
 */
export function resolveSemanticEditEvent(args: {
	cue: string;
	document: AxcutDocument;
	cursorSamples?: CursorSampleLite[] | null;
	preferredFamily?: "zoom" | "generic";
	/** Local visual-change intervals already mapped to programme time. */
	visualChangeEvents?: VisualChangeIntervalLite[] | null;
	visualAnalysisUsed?: boolean;
	/** Precomputed identity checks keyed by programme anchorSec. */
	identityByAnchorSec?: Map<
		number,
		{
			requestedEventIdentified: boolean;
			visualChangeObserved: boolean;
			evidenceRefs: string[];
			onsetTokens: string[];
		}
	> | null;
	identityChecked?: boolean;
	/**
	 * Cap returned candidates. Identity pipeline should pass a larger pool
	 * (IDENTITY_CANDIDATE_POOL) so later events are not dropped before checks.
	 */
	maxCandidates?: number;
}): SemanticEventResolveResult {
	const cue = args.cue.trim();
	const kind = classifySemanticEventKind(cue);
	const queryTokens = tokenizeSemanticCue(cue);
	const dur = programmeDuration(args.document);
	const hits = transcriptHits(args.document, queryTokens);
	const visual = args.visualChangeEvents ?? null;
	const candidates: SemanticEventCandidate[] = [];
	const speechHints: Array<{ anchorSec: number; text: string }> = [];

	if (kind === "CLICK" || /\bclick\b/i.test(cue)) {
		const labelTok =
			queryTokens.find((t) => !["click", "button", "press"].includes(t)) ??
			queryTokens[0] ??
			"click";
		const near = hits.length > 0 ? hits.sort((a, b) => b.score - a.score)[0]!.startSec : null;
		const clicks = clickHits(args.cursorSamples, near, near == null ? 1e9 : 3);
		for (const c of clicks.slice(0, 8)) {
			const win = zoomWindowAround(c.atSec, dur, 0.2, 3.5);
			const vis = materialVisualNear(visual, c.atSec, 2.5);
			candidates.push({
				...win,
				anchorSec: c.atSec,
				label: `click near “${labelTok}”`,
				confidence: vis ? "HIGH" : near != null ? "MEDIUM" : "LOW",
				evidenceRefs: [
					`cursor_click@${c.atSec.toFixed(2)}`,
					...(near != null ? [`speech@${near.toFixed(2)}`] : []),
					...(vis
						? [
								`visual_change@${vis.startSec.toFixed(2)}-${vis.endSec.toFixed(2)}:${vis.level ?? "?"}`,
							]
						: []),
				],
				score: c.score + (near != null ? 2 : 0) + (vis ? 2 : 0),
				modalities: [
					"cursor",
					...(near != null ? (["speech"] as const) : []),
					...(vis ? (["visual_change"] as const) : []),
				],
				visualChangeObserved: Boolean(vis),
				requestedEventIdentified: false,
			});
		}
	}

	for (const h of hits) {
		speechHints.push({ anchorSec: h.startSec, text: h.text.slice(0, 60) });
		const win = zoomWindowAround(h.startSec, dur, 0.4, 4.2);
		const nearbyClicks = clickHits(args.cursorSamples, h.startSec, 2);
		const vis = materialVisualNear(visual, h.startSec, 2.5);
		const modalities: SemanticEvidenceModality[] = ["speech"];
		if (nearbyClicks[0]) modalities.push("cursor");
		if (vis) modalities.push("visual_change");

		// Spoken-kind events may FOUND on speech; visual/UI may not.
		const visualChangeObserved = Boolean(vis);
		const score =
			h.score + (nearbyClicks.length > 0 ? 1.5 : 0) + (vis ? 3 : 0) + (kind === "SPOKEN" ? 0.5 : 0);

		candidates.push({
			...win,
			anchorSec: h.startSec,
			label: h.text.slice(0, 60) || queryTokens.join(" "),
			confidence: visualChangeObserved
				? "HIGH"
				: kind === "SPOKEN"
					? h.score >= 2.5
						? "HIGH"
						: "MEDIUM"
					: "LOW",
			evidenceRefs: [
				`speech@${h.startSec.toFixed(2)}`,
				...(nearbyClicks[0] ? [`cursor_click@${nearbyClicks[0].atSec.toFixed(2)}`] : []),
				...(vis
					? [
							`visual_change@${vis.startSec.toFixed(2)}-${vis.endSec.toFixed(2)}:${vis.level ?? "?"}`,
						]
					: []),
			],
			score,
			modalities,
			visualChangeObserved,
			requestedEventIdentified: false,
		});
	}

	// Visual-change peaks without speech (weak UI-switch signal)
	if ((kind === "VISUAL_OR_UI" || kind === "GENERIC") && visual?.length) {
		for (const v of visual) {
			if (!Number.isFinite(v.startSec) || !Number.isFinite(v.endSec)) continue;
			const level = String(v.level ?? "").toUpperCase();
			if (level !== "MODERATE" && level !== "SIGNIFICANT") continue;
			const mid = (v.startSec + v.endSec) / 2;
			const win = zoomWindowAround(mid, dur, 0.3, 3.8);
			candidates.push({
				...win,
				anchorSec: mid,
				label: `visual change (${level.toLowerCase()})`,
				confidence: level === "SIGNIFICANT" ? "MEDIUM" : "LOW",
				evidenceRefs: [`visual_change@${v.startSec.toFixed(2)}-${v.endSec.toFixed(2)}:${level}`],
				score: level === "SIGNIFICANT" ? 2.2 : 1.5,
				modalities: ["visual_change"],
				visualChangeObserved: true,
				requestedEventIdentified: false,
			});
		}
	}

	// Cursor jumps alone remain LOW and never visualChangeObserved.
	if (
		(kind === "VISUAL_OR_UI" || kind === "GENERIC") &&
		candidates.filter((c) => c.visualChangeObserved).length === 0 &&
		args.cursorSamples &&
		args.cursorSamples.length > 4
	) {
		const moves = [...args.cursorSamples].sort((a, b) => a.atSec - b.atSec);
		for (let i = 1; i < moves.length; i++) {
			const a = moves[i - 1]!;
			const b = moves[i]!;
			const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
			const dt = b.atSec - a.atSec;
			if (dist >= 0.35 && dt > 0 && dt < 1.5) {
				const win = zoomWindowAround(b.atSec, dur, 0.3, 3.8);
				const vis = materialVisualNear(visual, b.atSec, 2);
				candidates.push({
					...win,
					anchorSec: b.atSec,
					label: vis
						? "cursor jump with visual change"
						: "cursor context switch (unconfirmed visually)",
					confidence: vis ? "MEDIUM" : "LOW",
					evidenceRefs: [
						`cursor_jump@${b.atSec.toFixed(2)}`,
						...(vis
							? [
									`visual_change@${vis.startSec.toFixed(2)}-${vis.endSec.toFixed(2)}:${vis.level ?? "?"}`,
								]
							: []),
					],
					score: dist + (vis ? 2 : 0),
					modalities: vis ? ["cursor", "visual_change"] : ["cursor"],
					visualChangeObserved: Boolean(vis),
					requestedEventIdentified: false,
				});
			}
		}
	}

	const merged = mergeCandidates(candidates);
	const cap = Math.max(1, Math.min(args.maxCandidates ?? 5, 24));
	const requiresVisualIdentity = kind === "VISUAL_OR_UI";
	/** Optional precomputed identity results keyed by approx programme anchor. */
	const identityHints = args.identityByAnchorSec ?? null;

	if (identityHints) {
		for (const c of merged) {
			let bestKey: number | null = null;
			let bestDist = Infinity;
			for (const k of identityHints.keys()) {
				const d = Math.abs(k - c.anchorSec);
				if (d < bestDist && d <= 2.5) {
					bestDist = d;
					bestKey = k;
				}
			}
			if (bestKey == null) continue;
			const id = identityHints.get(bestKey)!;
			c.requestedEventIdentified = id.requestedEventIdentified;
			c.visualChangeObserved = c.visualChangeObserved || id.visualChangeObserved;
			c.evidenceRefs = [...new Set([...c.evidenceRefs, ...id.evidenceRefs])];
			if (id.requestedEventIdentified) {
				const onset =
					typeof id.earliestProgrammeSec === "number" && Number.isFinite(id.earliestProgrammeSec)
						? id.earliestProgrammeSec
						: null;
				if (onset != null && Math.abs(onset - c.anchorSec) > 0.05) {
					const win = zoomWindowAround(onset, dur, 0.3, 3.8);
					c.anchorSec = onset;
					c.startSec = win.startSec;
					c.endSec = win.endSec;
					c.evidenceRefs = [...new Set([...c.evidenceRefs, `onset_retarget@${onset.toFixed(2)}`])];
				}
				c.modalities = [...new Set([...c.modalities, "ocr_onset" as const])];
				c.confidence = "HIGH";
				// Appearance: prefer earlier first-onset over late speech-aligned hits.
				const earlierBonus = requiresVisualIdentity ? Math.max(0, 4 - c.anchorSec / 5) : 0;
				c.score += 4 + earlierBonus;
				c.label = id.onsetTokens.length
					? `onset: ${id.onsetTokens.slice(0, 3).join(", ")}`
					: c.label;
			}
		}
	}

	const eligibleRaw = requiresVisualIdentity
		? merged.filter((c) => c.requestedEventIdentified && c.score >= 1.4)
		: merged.filter((c) => c.confidence !== "LOW" && c.score >= 1.4);
	// VISUAL_OR_UI appearance: earliest identified onset wins (speech at page-already-visible is late).
	const eligible = requiresVisualIdentity
		? [...eligibleRaw].sort((a, b) => a.anchorSec - b.anchorSec || b.score - a.score)
		: [...eligibleRaw].sort((a, b) => b.score - a.score);

	const changeObservedOnly = merged.filter(
		(c) => c.visualChangeObserved && !c.requestedEventIdentified,
	);

	if (eligible.length === 0) {
		const hintText =
			speechHints.length > 0
				? ` Speech mentions something similar around ${speechHints
						.slice(0, 2)
						.map((h) => `${h.anchorSec.toFixed(0)}s`)
						.join(" and ")} — that is spoken evidence only, not visual event identity.`
				: "";
		const changeNote =
			requiresVisualIdentity && changeObservedOnly.length > 0
				? ` I observed pixel/activity changes near ${changeObservedOnly
						.slice(0, 2)
						.map((c) => `${c.anchorSec.toFixed(0)}s`)
						.join(" and ")}, but that does not identify the requested on-screen event.`
				: "";
		const visualNote = requiresVisualIdentity
			? !args.identityChecked && !args.visualAnalysisUsed
				? " Evidence status: unavailable (visual analysis and presence were not searched)."
				: !args.identityChecked && args.visualAnalysisUsed
					? " Evidence status: unsearched (visual-change ran; presence identity was not run)."
					: args.identityChecked
						? (() => {
								const refs = merged.flatMap((c) => c.evidenceRefs);
								if (refs.some((r) => r.includes("absent_at_candidate"))) {
									return " Evidence status: absent at the candidate frame(s).";
								}
								if (refs.some((r) => r.includes("reappearance_not_first"))) {
									return " Evidence status: reappearance — not first onset.";
								}
								if (refs.some((r) => r.includes("insufficient_bracket"))) {
									return " Evidence status: onset bracket insufficient.";
								}
								return " Evidence status: not identified after presence search.";
							})()
						: " Evidence status: unavailable."
			: "";
		return {
			cue,
			kind,
			queryTokens,
			status: "NOT_FOUND",
			candidates: merged.slice(0, cap),
			best: null,
			speechHints,
			visualAnalysisUsed: Boolean(args.visualAnalysisUsed),
			identityChecked: Boolean(args.identityChecked),
			userFacingReason: requiresVisualIdentity
				? `I couldn't identify “${cue.replace(/^when\s+/i, "")}” as a confirmed on-screen appearance.${hintText}${changeNote}${visualNote} Share an approximate time, or ask me to treat a spoken mention as a qualified guess.`
				: `I couldn't reliably locate “${cue.replace(/^when\s+/i, "")}” from available evidence.${hintText} If you mean a specific moment, share an approximate time.`,
		};
	}

	if (eligible.length >= 2) {
		const earliest = eligible[0]!;
		const second = eligible[1]!;
		// A clearly later candidate (e.g. speech while page already visible) is not ambiguous.
		const clearlyLater = second.anchorSec >= earliest.anchorSec + 2.5;
		if (!clearlyLater && second.score >= earliest.score * 0.75) {
			return {
				cue,
				kind,
				queryTokens,
				status: "AMBIGUOUS",
				candidates: eligible.slice(0, Math.min(3, cap)),
				best: null,
				speechHints,
				visualAnalysisUsed: Boolean(args.visualAnalysisUsed),
				identityChecked: Boolean(args.identityChecked),
				userFacingReason: `I found ${Math.min(3, eligible.length)} identified places for that event — around ${eligible
					.slice(0, 2)
					.map((c) => `${c.anchorSec.toFixed(0)}s`)
					.join(" and ")}. Which one should I use?`,
			};
		}
	}

	const best = eligible[0]!;
	const modalityNote = best.requestedEventIdentified
		? "requested event identified"
		: best.modalities.includes("speech")
			? "spoken evidence"
			: best.modalities.join("+");
	const progDur = programmeDuration(args.document);
	const clockNote =
		progDur > 0
			? ` programme time (${best.anchorSec.toFixed(1)}s of ${progDur.toFixed(1)}s programme)`
			: "";
	return {
		cue,
		kind,
		queryTokens,
		status: "FOUND",
		candidates: merged.slice(0, cap),
		best,
		speechHints,
		visualAnalysisUsed: Boolean(args.visualAnalysisUsed),
		identityChecked: Boolean(args.identityChecked),
		userFacingReason: `Located “${best.label}” around ${best.anchorSec.toFixed(1)}s${clockNote} (${best.confidence}; ${modalityNote}).`,
	};
}

/**
 * Load VisualAnalysis source-time intervals and map them to programme time.
 * Returns empty when media missing or mapping unavailable.
 */
export async function loadVisualChangeIntervalsForDocument(document: AxcutDocument): Promise<{
	intervals: VisualChangeIntervalLite[];
	used: boolean;
	reason?: string;
	mappingBlocked?: boolean;
}> {
	const assetId = document.project.primaryAssetId ?? document.assets[0]?.id;
	const asset = document.assets.find((a) => a.id === assetId) ?? document.assets[0];
	const mediaPath = asset?.originalPath ?? null;
	if (!mediaPath || mediaPath.startsWith("/tmp/")) {
		return {
			intervals: [],
			used: false,
			reason: "no_real_media_path",
		};
	}
	try {
		const { analyzeVisual } = await import("../visualAnalysis/analyse");
		const { mapVisualIntervalToProgramme } = await import("./semanticProgrammeMap");
		const analysis = await analyzeVisual({
			assetId: assetId ?? "asset",
			mediaPath,
			includeCursor: true,
			timeoutMs: 45_000,
		});
		const sourceIntervals: VisualChangeIntervalLite[] = [];
		for (const e of analysis.changeEvents ?? []) {
			const startSec = Number(e.fromSec ?? e.timeSec);
			const endSec = Number(e.toSec ?? (Number.isFinite(e.timeSec) ? e.timeSec + 0.4 : NaN));
			if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
			sourceIntervals.push({
				startSec,
				endSec: Math.max(endSec, startSec + 0.2),
				level: e.level,
				sourceSec: Number.isFinite(e.timeSec) ? e.timeSec : (startSec + endSec) / 2,
			});
		}
		for (const a of analysis.activityIntervals ?? []) {
			if (!Number.isFinite(a.startSec) || !Number.isFinite(a.endSec)) continue;
			sourceIntervals.push({
				startSec: a.startSec,
				endSec: a.endSec,
				level: "MODERATE",
				sourceSec: (a.startSec + a.endSec) / 2,
			});
		}
		const intervals: VisualChangeIntervalLite[] = [];
		let mappingBlocked = false;
		for (const src of sourceIntervals) {
			const mapped = mapVisualIntervalToProgramme({
				document,
				assetId: assetId ?? "asset",
				sourceInterval: src,
			});
			if (mapped.status === "speed_blocked") {
				mappingBlocked = true;
				continue;
			}
			if (mapped.status === "removed") continue;
			intervals.push(mapped.programme);
		}
		return {
			intervals,
			used: true,
			mappingBlocked,
			reason: mappingBlocked
				? "some_intervals_speed_blocked"
				: intervals.length === 0
					? "no_mappable_intervals"
					: undefined,
		};
	} catch (err) {
		return {
			intervals: [],
			used: false,
			reason: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function resolveSemanticEditEventAsync(args: {
	cue: string;
	document: AxcutDocument;
	cursorSamples?: CursorSampleLite[] | null;
	preferredFamily?: "zoom" | "generic";
	visualChangeEvents?: VisualChangeIntervalLite[] | null;
	skipVisualAnalysis?: boolean;
	/** Skip OCR identity (wiring fixtures only). */
	skipIdentity?: boolean;
	/** Test seam for identity OCR. */
	ocrRecognize?: (imagePath: string) => Promise<{ text: string; available: boolean }>;
	extractFrame?: (sourceSec: number, outPath: string) => Promise<boolean>;
	/** Selected Chat model for provider-vision identity. */
	chatModelConfig?: import("../deep-agent/chat-model").OpenScreenChatModelConfig | null;
	/** Injected vision judge (tests) — adapted to presence. */
	visionJudge?: import("./semanticEventVisionIdentity").VisionIdentityJudge | null;
	/** Injected presence judge (preferred test seam). */
	presenceJudge?: import("./semanticEventVisionIdentity").VisualPresenceJudge | null;
	skipVision?: boolean;
}): Promise<SemanticEventResolveResult> {
	let visualChangeEvents = args.visualChangeEvents ?? null;
	let visualAnalysisUsed = Boolean(visualChangeEvents?.length);
	if (!args.skipVisualAnalysis && visualChangeEvents == null) {
		const loaded = await loadVisualChangeIntervalsForDocument(args.document);
		visualChangeEvents = loaded.intervals;
		visualAnalysisUsed = loaded.used;
		if (loaded.mappingBlocked && (visualChangeEvents?.length ?? 0) === 0) {
			return {
				cue: args.cue.trim(),
				kind: classifySemanticEventKind(args.cue),
				queryTokens: tokenizeSemanticCue(args.cue),
				status: "NOT_FOUND",
				candidates: [],
				best: null,
				visualAnalysisUsed,
				identityChecked: false,
				userFacingReason:
					"Semantic WHERE is blocked here because source↔programme mapping is unavailable across speed regions. Share an explicit programme time, or remove speed on that span.",
			};
		}
	}

	const kind = classifySemanticEventKind(args.cue);
	/** Wide preliminary pool — identity walks earliest-first until turn vision budget. */
	const IDENTITY_CANDIDATE_POOL = 16;
	const preliminary = resolveSemanticEditEvent({
		cue: args.cue,
		document: args.document,
		cursorSamples: args.cursorSamples,
		preferredFamily: args.preferredFamily,
		visualChangeEvents,
		visualAnalysisUsed,
		identityChecked: false,
		maxCandidates: IDENTITY_CANDIDATE_POOL,
	});

	if (kind !== "VISUAL_OR_UI" || args.skipIdentity) {
		return { ...preliminary, identityChecked: Boolean(args.skipIdentity) };
	}

	const { verifyRequestedEventIdentity, ONSET_VISION_CALL_BUDGET, TURN_VISION_CALL_BUDGET } =
		await import("./semanticEventIdentity");
	// Earliest visual-change peaks first, then speech — no hard slice that drops later
	// events before the turn budget is spent.
	const ranked = [...preliminary.candidates]
		.filter((c) => c.visualChangeObserved || c.modalities.includes("speech"))
		.sort((a, b) => {
			const aVis = a.visualChangeObserved ? 0 : 1;
			const bVis = b.visualChangeObserved ? 0 : 1;
			if (aVis !== bVis) return aVis - bVis;
			return a.anchorSec - b.anchorSec;
		});
	if (ranked.length === 0) {
		return { ...preliminary, identityChecked: true };
	}

	const identityByAnchorSec = new Map<
		number,
		{
			requestedEventIdentified: boolean;
			visualChangeObserved: boolean;
			evidenceRefs: string[];
			onsetTokens: string[];
			earliestProgrammeSec?: number | null;
			onsetBoundStatus?: string;
		}
	>();

	const presenceCache = new Map<
		string,
		import("./semanticEventVisionIdentity").VisualPresenceVerdict | null
	>();
	const turnVisionCalls = { used: 0, budget: TURN_VISION_CALL_BUDGET };
	let insufficientBracket = false;
	const checkedAnchors: number[] = [];
	let skippedForBudget = 0;

	for (const c of ranked) {
		if (turnVisionCalls.used + 2 > turnVisionCalls.budget) {
			skippedForBudget += 1;
			continue;
		}
		const perBudget = Math.min(
			ONSET_VISION_CALL_BUDGET,
			turnVisionCalls.budget - turnVisionCalls.used,
		);
		const id = await verifyRequestedEventIdentity({
			document: args.document,
			cue: args.cue,
			programmeAnchorSec: c.anchorSec,
			visualChangeObserved: c.visualChangeObserved,
			ocrRecognize: args.ocrRecognize,
			extractFrame:
				args.extractFrame ??
				(args.ocrRecognize || args.visionJudge || args.presenceJudge
					? async () => true
					: undefined),
			skipOcr: false,
			chatModelConfig: args.chatModelConfig,
			visionJudge: args.visionJudge,
			presenceJudge: args.presenceJudge,
			skipVision: args.skipVision,
			presenceCache,
			visionCallBudget: perBudget,
			turnVisionCalls,
		});
		checkedAnchors.push(c.anchorSec);
		if (id.onsetBoundStatus === "insufficient_bracket") {
			insufficientBracket = true;
		}
		identityByAnchorSec.set(c.anchorSec, {
			requestedEventIdentified: id.requestedEventIdentified,
			visualChangeObserved: id.visualChangeObserved || c.visualChangeObserved,
			evidenceRefs: [
				...id.evidenceRefs,
				`identity_checked_anchor@${c.anchorSec.toFixed(2)}`,
				`turn_vision_used:${turnVisionCalls.used}/${turnVisionCalls.budget}`,
			],
			onsetTokens: id.onsetTokens,
			earliestProgrammeSec: id.earliestProgrammeSec,
			onsetBoundStatus: id.onsetBoundStatus,
		});
		// Once we have a first-onset certify and no earlier unchecked visual peaks remain
		// in budget, prefer stopping — later speech-only peaks won't beat earliest onset.
		if (
			id.requestedEventIdentified &&
			c.visualChangeObserved &&
			ranked
				.filter((x) => x.visualChangeObserved && x.anchorSec < c.anchorSec - 0.5)
				.every((x) => checkedAnchors.some((a) => Math.abs(a - x.anchorSec) < 0.05))
		) {
			break;
		}
	}

	const resolved = resolveSemanticEditEvent({
		cue: args.cue,
		document: args.document,
		cursorSamples: args.cursorSamples,
		preferredFamily: args.preferredFamily,
		visualChangeEvents,
		visualAnalysisUsed,
		identityByAnchorSec,
		identityChecked: true,
	});

	if (skippedForBudget > 0 && resolved.status === "NOT_FOUND") {
		return {
			...resolved,
			userFacingReason: `${resolved.userFacingReason} (${checkedAnchors.length} candidates checked; ${skippedForBudget} later candidates skipped under vision cost budget.)`,
		};
	}

	if (
		resolved.status === "NOT_FOUND" &&
		insufficientBracket &&
		![...identityByAnchorSec.values()].some((v) => v.requestedEventIdentified)
	) {
		return {
			...resolved,
			status: "AMBIGUOUS",
			userFacingReason: `I can see the requested UI near some moments, but I could not bound its first appearance across programme frames (onset bracket insufficient after accounting for trims/speed). Share an approximate programme time, or ask me to treat a spoken mention as a qualified guess.`,
		};
	}

	return resolved;
}

/** True when the user already decided WHAT and is asking the system to find WHERE. */
export function isSemanticEditCommand(raw: string): boolean {
	const n = raw.toLowerCase();
	if (/\bdo\s+you\s+think\b|\bshould\s+i\b|\bwould\s+you\s+recommend\b/.test(n)) {
		return false;
	}
	const cue = extractSemanticEventCue(raw);
	if (!cue) return false;
	return (
		/\bzoom|\bunzoom|\breframe|\bcallout|\bhighlight|\btitle|\bspeed|\btrim\b/.test(n) ||
		/\badd\s+(?:a\s+|the\s+)?(?:zoom|callout|title)\b/.test(n)
	);
}

export function isAdviceOnlyEditQuestion(raw: string): boolean {
	const n = raw.toLowerCase();
	return (
		(/\bdo\s+you\s+think\b|\bshould\s+(?:i|we)\b|\bwould\s+(?:a|it)\b|\bdoes\s+this\s+need\b|\bneed(?:s)?\s+a\s+zoom\b/.test(
			n,
		) &&
			/\bzoom|edit|transition|callout|title|emphasize|attention|site|website\b/.test(n)) ||
		(/\bneed(?:s)?\s+(?:a\s+)?zoom\b/.test(n) && /\?/.test(raw)) ||
		(/\bwould\s+it\s+help\b/.test(n) && /\bemphasize|zoom|site|website\b/.test(n))
	);
}

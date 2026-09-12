/**
 * Deterministic Temporal Event Ledger builder — 0 additional LLM calls.
 */

import { SOURCE_TIMESTAMP_TOLERANCE_SEC } from "../sourceTiming";
import type {
	BuildTemporalEventLedgerInput,
	EvidenceProvenanceRef,
	TemporalClaim,
	TemporalEvent,
	TemporalEventLedger,
} from "./types";

const PAUSE_GAP_SEC = 1.2;
const CORRECTION_RE = /\b(i mean|actually|let me go back|i meant|correction|wait[, ]+no)\b/i;
const OPEN_PANEL_RE =
	/\b(open(?:ing|ed)?|launch(?:ing|ed)?)\b.{0,40}\b(settings?|effects?|timeline|panel)\b/i;
const OPEN_APP_RE =
	/\b(open(?:ing|ed)?|navigat(?:e|ing)|work(?:ing)? on|browse|browsing)\b.{0,40}\b(upwork|settings?|chatgpt|twitter|x\.com)\b/i;

function clampTime(t: number, durationSec: number): number {
	const lo = -SOURCE_TIMESTAMP_TOLERANCE_SEC;
	const hi = durationSec + SOURCE_TIMESTAMP_TOLERANCE_SEC;
	return Math.min(hi, Math.max(lo, t));
}

function id(prefix: string, n: number): string {
	return `${prefix}_${n}`;
}

function claim(
	prefix: string,
	n: number,
	text: string,
	epistemic: TemporalClaim["epistemic"],
	evidence: EvidenceProvenanceRef[],
): TemporalClaim {
	return { id: id(prefix, n), text, epistemic, evidence };
}

/**
 * Build a TemporalEventLedger from already-prepared OpenScreen evidence.
 * Pure / deterministic — no I/O, no model calls.
 */
export function buildTemporalEventLedger(
	input: BuildTemporalEventLedgerInput,
): TemporalEventLedger {
	const t0 = Date.now();
	const durationSec = Math.max(0, input.sourceDurationSec);
	const assetId = input.assetId;
	const events: TemporalEvent[] = [];
	let claimSeq = 0;
	let eventSeq = 0;

	const pushEvent = (partial: Omit<TemporalEvent, "id">): void => {
		eventSeq += 1;
		events.push({ id: id("evt", eventSeq), ...partial });
	};

	// --- Speech status channel ---
	if (input.speech?.status) {
		const status = input.speech.status;
		const evid: EvidenceProvenanceRef[] = [
			{ modality: "audio_state", note: `speechStatus=${status}` },
		];
		pushEvent({
			assetId,
			startSourceTimeSec: 0,
			endSourceTimeSec: clampTime(durationSec, durationSec),
			type: "speech_status",
			modalities: ["audio_state", "speech"],
			summary: `Speech evidence status: ${status}`,
			claims: [claim("cl", ++claimSeq, `speechStatus is ${status}`, "observed", evid)],
			evidence: evid,
			confidence: "high",
		});
	}

	// --- Speech segments ---
	const segments = input.speech?.segments ?? [];
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i]!;
		const segId = s.id ?? `speech_${i + 1}`;
		const start = clampTime(s.startSourceTimeSec, durationSec);
		const end = clampTime(Math.max(s.endSourceTimeSec, s.startSourceTimeSec), durationSec);
		const evid: EvidenceProvenanceRef[] = [
			{
				modality: "speech",
				sourceTimeSec: start,
				endSourceTimeSec: end,
				speechSegmentId: segId,
			},
		];
		const claims: TemporalClaim[] = [
			claim("cl", ++claimSeq, s.text.trim() || "(empty speech)", "spoken", evid),
		];

		const isCorrection = CORRECTION_RE.test(s.text);
		pushEvent({
			assetId,
			startSourceTimeSec: start,
			endSourceTimeSec: end,
			type: isCorrection ? "spoken_correction" : "speech",
			modalities: ["speech"],
			summary: isCorrection
				? `Spoken correction/repair: ${s.text.trim().slice(0, 120)}`
				: `Speech: ${s.text.trim().slice(0, 120)}`,
			claims,
			evidence: evid,
			confidence: "high",
		});

		// Spoken open-panel intent without visual confirmation → contradiction later
		if (OPEN_PANEL_RE.test(s.text) || OPEN_APP_RE.test(s.text)) {
			pushEvent({
				assetId,
				startSourceTimeSec: start,
				endSourceTimeSec: end,
				type: "uncertain",
				modalities: ["speech"],
				summary: `Spoken intent not yet visually verified: ${s.text.trim().slice(0, 100)}`,
				claims: [
					claim(
						"cl",
						++claimSeq,
						`Speaker stated an open/navigate action ("${s.text.trim().slice(0, 80)}") — visual confirmation UNKNOWN`,
						"unknown",
						evid,
					),
				],
				evidence: evid,
				confidence: "medium",
			});
		}
	}

	// --- Speech pauses ---
	for (let i = 0; i < segments.length - 1; i++) {
		const a = segments[i]!;
		const b = segments[i + 1]!;
		const gap = b.startSourceTimeSec - a.endSourceTimeSec;
		if (gap < PAUSE_GAP_SEC) continue;
		const start = clampTime(a.endSourceTimeSec, durationSec);
		const end = clampTime(b.startSourceTimeSec, durationSec);
		const evid: EvidenceProvenanceRef[] = [
			{
				modality: "speech",
				sourceTimeSec: start,
				endSourceTimeSec: end,
				note: `gap=${gap.toFixed(2)}s between speech segments`,
			},
		];
		pushEvent({
			assetId,
			startSourceTimeSec: start,
			endSourceTimeSec: end,
			type: "speech_pause",
			modalities: ["speech"],
			summary: `Speech pause (~${gap.toFixed(1)}s)`,
			claims: [
				claim(
					"cl",
					++claimSeq,
					`No speech segments in ${start.toFixed(2)}–${end.toFixed(2)}s`,
					"observed",
					evid,
				),
			],
			evidence: evid,
			confidence: "high",
		});
	}

	// --- Visual samples (passive presence of a frame — not an action) ---
	for (const f of input.frames ?? []) {
		const t = clampTime(f.sourceTimeSec, durationSec);
		const evid: EvidenceProvenanceRef[] = [
			{
				modality: "visual",
				sourceTimeSec: t,
				frameSourceTimeSec: t,
				frameReason: f.reason,
				frameImagePath: f.imagePath,
			},
		];
		pushEvent({
			assetId,
			startSourceTimeSec: t,
			endSourceTimeSec: t,
			type: "visual_sample",
			modalities: ["visual"],
			temporallyUncertain: true,
			summary: `Visual sample at ${t.toFixed(2)}s (${f.reason})`,
			claims: [
				claim(
					"cl",
					++claimSeq,
					`A visual frame was sampled at ${t.toFixed(2)}s — presence of pixels, not a user action`,
					"observed",
					evid,
				),
			],
			evidence: evid,
			confidence: "high",
		});
	}

	// --- Visual transitions (pixel change only — no invented semantics) ---
	for (const c of input.changes ?? []) {
		if (c.classification === "minimal") continue;
		const from = clampTime(c.fromSourceTimeSec, durationSec);
		const to = clampTime(c.toSourceTimeSec, durationSec);
		const evid: EvidenceProvenanceRef[] = [
			{
				modality: "visual",
				sourceTimeSec: from,
				endSourceTimeSec: to,
				changeFromSourceTimeSec: from,
				changeToSourceTimeSec: to,
				changeClassification: c.classification,
				note: typeof c.score === "number" ? `score=${c.score.toFixed(3)}` : undefined,
			},
		];
		pushEvent({
			assetId,
			startSourceTimeSec: from,
			endSourceTimeSec: to,
			type: "visual_transition",
			modalities: ["visual"],
			temporallyUncertain: true,
			summary: `Material visual change (${c.classification}) between samples ${from.toFixed(2)}s → ${to.toFixed(2)}s`,
			claims: [
				claim(
					"cl",
					++claimSeq,
					`Pixels changed materially between sampled times ${from.toFixed(2)}s and ${to.toFixed(2)}s (${c.classification}). Exact onset is uncertain within this interval. Semantic cause UNKNOWN without further recognition.`,
					"observed",
					evid,
				),
			],
			evidence: evid,
			confidence: c.classification === "significant" ? "high" : "medium",
		});
	}

	// --- Cursor interactions ---
	for (const cur of input.cursorInteractions ?? []) {
		const t = clampTime(cur.sourceTimeSec, durationSec);
		const evid: EvidenceProvenanceRef[] = [
			{
				modality: "cursor",
				sourceTimeSec: t,
				cursorTimeSec: t,
				cursorInteractionType: cur.interactionType,
			},
		];
		pushEvent({
			assetId,
			startSourceTimeSec: t,
			endSourceTimeSec: t,
			type: "cursor_interaction",
			modalities: ["cursor"],
			summary: `Cursor interaction${cur.interactionType ? ` (${cur.interactionType})` : ""} at ${t.toFixed(2)}s`,
			claims: [
				claim(
					"cl",
					++claimSeq,
					`Non-move cursor activity at ${t.toFixed(2)}s` +
						(cur.interactionType ? ` kind=${cur.interactionType}` : ""),
					"observed",
					evid,
				),
			],
			evidence: evid,
			confidence: "high",
		});
	}

	// --- Model semantic surfaces (optional; never verified actions from tabs) ---
	for (const obs of input.semantic?.observations ?? []) {
		const t = clampTime(obs.sourceTimeSec, durationSec);
		const baseEvid: EvidenceProvenanceRef[] = [
			{
				modality: "model_semantic",
				sourceTimeSec: t,
				frameSourceTimeSec: t,
				modelDerived: true,
				note: obs.frameSummary?.slice(0, 160),
			},
		];

		if (obs.frontmostSurface?.name) {
			const name = obs.frontmostSurface.name;
			pushEvent({
				assetId,
				startSourceTimeSec: t,
				endSourceTimeSec: t,
				type: "frontmost_surface",
				modalities: ["model_semantic", "visual"],
				temporallyUncertain: true,
				summary: `Model-derived frontmost surface: ${name}`,
				claims: [
					claim(
						"cl",
						++claimSeq,
						`Frontmost surface appears to be "${name}" at sampled ${t.toFixed(2)}s (model-derived observation)`,
						"observed",
						baseEvid,
					),
				],
				evidence: baseEvid,
				confidence: "medium",
			});
		}

		for (const bg of obs.backgroundSurfaces ?? []) {
			const role = bg.role ?? "unknown";
			const name = bg.name;
			pushEvent({
				assetId,
				startSourceTimeSec: t,
				endSourceTimeSec: t,
				type: "passive_chrome",
				modalities: ["model_semantic", "visual"],
				temporallyUncertain: true,
				summary: `Passive chrome: ${name} (${role})`,
				claims: [
					claim(
						"cl",
						++claimSeq,
						`"${name}" is visible as ${role} chrome at sampled ${t.toFixed(2)}s — NOT a verified user open/navigate/work action`,
						"observed",
						baseEvid,
					),
					claim(
						"cl",
						++claimSeq,
						`Whether the user opened or worked in "${name}" remains UNKNOWN without interaction/transition evidence`,
						"unknown",
						baseEvid,
					),
				],
				evidence: baseEvid,
				confidence: "medium",
			});
		}

		for (const line of obs.inferred ?? []) {
			pushEvent({
				assetId,
				startSourceTimeSec: t,
				endSourceTimeSec: t,
				type: "uncertain",
				modalities: ["model_semantic"],
				summary: `Model inference: ${line.slice(0, 120)}`,
				claims: [claim("cl", ++claimSeq, line, "inferred", baseEvid)],
				evidence: baseEvid,
				confidence: "low",
			});
		}
	}

	// --- Contradictions: spoken open-panel vs no material visual change nearby ---
	const materialChanges = (input.changes ?? []).filter(
		(c) => c.classification === "moderate" || c.classification === "significant",
	);
	for (const s of segments) {
		if (!OPEN_PANEL_RE.test(s.text)) continue;
		const start = s.startSourceTimeSec - 1;
		const end = s.endSourceTimeSec + 2;
		const nearby = materialChanges.some(
			(c) => c.toSourceTimeSec >= start && c.fromSourceTimeSec <= end,
		);
		if (nearby) continue;
		const evid: EvidenceProvenanceRef[] = [
			{
				modality: "speech",
				sourceTimeSec: s.startSourceTimeSec,
				endSourceTimeSec: s.endSourceTimeSec,
				speechSegmentId: s.id,
				note: "spoken open/panel claim",
			},
			{
				modality: "visual",
				note: "no moderate/significant VisualChange overlapping speech window",
			},
		];
		pushEvent({
			assetId,
			startSourceTimeSec: clampTime(s.startSourceTimeSec, durationSec),
			endSourceTimeSec: clampTime(s.endSourceTimeSec, durationSec),
			type: "contradiction",
			modalities: ["speech", "visual"],
			summary: `Speech claims UI open/action but no material visual change in nearby samples`,
			claims: [
				claim("cl", ++claimSeq, `Spoken: "${s.text.trim().slice(0, 100)}"`, "spoken", evid),
				claim(
					"cl",
					++claimSeq,
					`Visual confirmation of that UI open/action: CONTRADICTED / not supported by material VisualChange in the speech neighborhood`,
					"contradicted",
					evid,
				),
			],
			evidence: evid,
			confidence: "high",
		});
	}

	events.sort((a, b) => a.startSourceTimeSec - b.startSourceTimeSec || a.id.localeCompare(b.id));

	const claimCount = events.reduce((n, e) => n + e.claims.length, 0);
	const evidenceRefCount = events.reduce(
		(n, e) => n + e.evidence.length + e.claims.reduce((m, c) => m + c.evidence.length, 0),
		0,
	);

	return {
		meta: {
			assetId,
			sourceDurationSec: durationSec,
			timebase: "SOURCE_MEDIA_TIME",
			speechStatus: input.speech?.status,
			builtAtIso: new Date().toISOString(),
			constructionMs: Date.now() - t0,
			additionalModelCalls: 0,
			eventCount: events.length,
			claimCount,
			evidenceRefCount,
		},
		events,
	};
}

/** True if any claim asserts a verified user open/work action on a named app. */
export function ledgerHasVerifiedOpenAction(ledger: TemporalEventLedger, appName: string): boolean {
	const re = new RegExp(`\\b${appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
	for (const e of ledger.events) {
		for (const c of e.claims) {
			if (c.epistemic !== "verified") continue;
			if (re.test(c.text) && /\b(open|opened|navigat|work(?:ing)? on|brows)\b/i.test(c.text)) {
				return true;
			}
		}
	}
	return false;
}

/** True if passive chrome observation exists for an app (e.g. Upwork tab). */
export function ledgerHasPassiveChromeObservation(
	ledger: TemporalEventLedger,
	appName: string,
): boolean {
	const re = new RegExp(appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
	return ledger.events.some(
		(e) =>
			e.type === "passive_chrome" &&
			re.test(e.summary) &&
			e.claims.some((c) => c.epistemic === "observed"),
	);
}

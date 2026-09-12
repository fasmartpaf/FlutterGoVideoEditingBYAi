/**
 * Video Evidence Store V1 — lightweight in-memory query over a TemporalEventLedger.
 * No vector DB, no embeddings, no semantic search.
 */

import type {
	EvidenceModality,
	EvidenceProvenanceRef,
	TemporalEvent,
	TemporalEventLedger,
	TemporalEventType,
} from "./types";

export interface VideoEvidenceStore {
	readonly ledger: TemporalEventLedger;
	eventsInRange(startSourceTimeSec: number, endSourceTimeSec: number): TemporalEvent[];
	eventsByType(type: TemporalEventType): TemporalEvent[];
	eventsByModality(modality: EvidenceModality): TemporalEvent[];
	speechInRange(startSourceTimeSec: number, endSourceTimeSec: number): TemporalEvent[];
	visualInRange(startSourceTimeSec: number, endSourceTimeSec: number): TemporalEvent[];
	cursorInRange(startSourceTimeSec: number, endSourceTimeSec: number): TemporalEvent[];
	contradictionsInRange(startSourceTimeSec: number, endSourceTimeSec: number): TemporalEvent[];
	unknownClaimsInRange(startSourceTimeSec: number, endSourceTimeSec: number): TemporalEvent[];
	evidenceForEvent(eventId: string): EvidenceProvenanceRef[];
	getEvent(eventId: string): TemporalEvent | undefined;
	stats(): {
		eventCount: number;
		claimCount: number;
		evidenceRefCount: number;
		constructionMs: number;
		additionalModelCalls: 0;
		serializedBytesApprox: number;
	};
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
	return a0 <= b1 && b0 <= a1;
}

export function createVideoEvidenceStore(ledger: TemporalEventLedger): VideoEvidenceStore {
	const byId = new Map(ledger.events.map((e) => [e.id, e]));

	const inRange = (start: number, end: number): TemporalEvent[] => {
		const lo = Math.min(start, end);
		const hi = Math.max(start, end);
		return ledger.events.filter((e) => overlaps(e.startSourceTimeSec, e.endSourceTimeSec, lo, hi));
	};

	return {
		ledger,
		eventsInRange: inRange,
		eventsByType: (type) => ledger.events.filter((e) => e.type === type),
		eventsByModality: (modality) => ledger.events.filter((e) => e.modalities.includes(modality)),
		speechInRange: (a, b) =>
			inRange(a, b).filter(
				(e) =>
					e.type === "speech" ||
					e.type === "speech_pause" ||
					e.type === "spoken_correction" ||
					e.type === "speech_status",
			),
		visualInRange: (a, b) =>
			inRange(a, b).filter(
				(e) =>
					e.type === "visual_sample" ||
					e.type === "visual_transition" ||
					e.type === "passive_chrome" ||
					e.type === "frontmost_surface" ||
					e.type === "observed_visible_text" ||
					e.type === "observed_ui_state" ||
					e.type === "observed_visual_diff",
			),
		cursorInRange: (a, b) => inRange(a, b).filter((e) => e.type === "cursor_interaction"),
		contradictionsInRange: (a, b) => inRange(a, b).filter((e) => e.type === "contradiction"),
		unknownClaimsInRange: (a, b) =>
			inRange(a, b).filter((e) => e.claims.some((c) => c.epistemic === "unknown")),
		evidenceForEvent: (eventId) => {
			const e = byId.get(eventId);
			if (!e) return [];
			const refs = [...e.evidence];
			for (const c of e.claims) refs.push(...c.evidence);
			return refs;
		},
		getEvent: (eventId) => byId.get(eventId),
		stats: () => ({
			eventCount: ledger.meta.eventCount,
			claimCount: ledger.meta.claimCount,
			evidenceRefCount: ledger.meta.evidenceRefCount,
			constructionMs: ledger.meta.constructionMs,
			additionalModelCalls: 0,
			serializedBytesApprox: JSON.stringify(ledger).length,
		}),
	};
}

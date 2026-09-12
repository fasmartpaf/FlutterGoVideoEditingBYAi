/**
 * Bridge Visual Specialist observations → Temporal Event Ledger (additive).
 */

import type { TemporalEvent, TemporalEventLedger } from "../temporalEventLedger/types";
import type { VisualObservation, VisualSpecialistResult } from "./types";

function mapKind(kind: VisualObservation["kind"]): TemporalEvent["type"] {
	switch (kind) {
		case "visible_text":
			return "observed_visible_text";
		case "ui_state":
			return "observed_ui_state";
		case "visual_diff":
		case "temporary_ui_interval":
			return "observed_visual_diff";
		default:
			return "uncertain";
	}
}

/**
 * Append specialist observations as ledger events. Never promotes to verified actions.
 */
export function appendVisualSpecialistToLedger(
	ledger: TemporalEventLedger,
	specialist: VisualSpecialistResult,
	assetId: string,
): TemporalEventLedger {
	let seq = ledger.events.length;
	const extra: TemporalEvent[] = [];
	for (const o of specialist.observations) {
		if (o.kind === "readability_note") continue;
		seq += 1;
		extra.push({
			id: `evt_vs_${seq}`,
			assetId,
			startSourceTimeSec: o.sourceTimeSec,
			endSourceTimeSec: o.endSourceTimeSec ?? o.sourceTimeSec,
			type: mapKind(o.kind),
			modalities: ["visual"],
			temporallyUncertain: o.temporallyUncertain,
			summary: o.text.slice(0, 200),
			claims: [
				{
					id: `cl_vs_${seq}`,
					text: o.text,
					epistemic: o.epistemic === "inferred" ? "inferred" : "observed",
					evidence: o.provenance.map((p) => ({
						modality: p.modality === "ocr" ? "visual" : p.modality,
						sourceTimeSec: p.sourceTimeSec,
						frameImagePath: p.frameImagePath,
						note: p.note,
						modelDerived: false,
					})),
				},
			],
			evidence: o.provenance.map((p) => ({
				modality: p.modality === "ocr" ? "visual" : p.modality,
				sourceTimeSec: p.sourceTimeSec,
				frameImagePath: p.frameImagePath,
				note: p.note,
			})),
			confidence: o.ocr?.lines.some((l) => l.confidence >= 0.8) ? "high" : "medium",
		});
	}

	const events = [...ledger.events, ...extra].sort(
		(a, b) => a.startSourceTimeSec - b.startSourceTimeSec || a.id.localeCompare(b.id),
	);
	const claimCount = events.reduce((n, e) => n + e.claims.length, 0);
	const evidenceRefCount = events.reduce(
		(n, e) => n + e.evidence.length + e.claims.reduce((m, c) => m + c.evidence.length, 0),
		0,
	);
	return {
		...ledger,
		events,
		meta: {
			...ledger.meta,
			eventCount: events.length,
			claimCount,
			evidenceRefCount,
		},
	};
}

/** True if OCR observed text contains needle (case-insensitive). */
export function specialistObservedText(
	specialist: VisualSpecialistResult,
	needle: string,
): boolean {
	const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
	return specialist.observations.some(
		(o) =>
			(o.kind === "visible_text" || o.kind === "temporary_ui_interval") &&
			(re.test(o.text) || (o.ocr ? re.test(o.ocr.joinedText) : false)),
	);
}

/** Hard invariant helper: OCR of app name must not create verified open/work claims. */
export function specialistHasVerifiedOpenFromOcr(
	specialist: VisualSpecialistResult,
	appName: string,
): boolean {
	const re = new RegExp(appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
	return specialist.observations.some(
		(o) =>
			re.test(o.text) &&
			/\b(opened?|navigat|worked on|visited)\b/i.test(o.text) &&
			o.epistemic !== "observed",
	);
}

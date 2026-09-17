/**
 * Orchestration adapter: Temporal Context Store → EditorialSignalBundle.
 * Keeps orchestrateFromSignals testable; equivalence expected when signals match.
 */

import {
	type OrchestrateResult,
	orchestrateFromSignals,
} from "../editorialOrchestration/orchestrate";
import type { EditorialSignalBundle } from "../editorialOrchestration/types";
import { programmeFingerprintFromDocument } from "./projection";
import type { TemporalContextStore } from "./store";

/**
 * Prefer the store's original signal bundle when present (exact equivalence).
 * Otherwise reconstruct a best-effort bundle from indexed records.
 */
export function signalBundleFromTemporalStore(store: TemporalContextStore): EditorialSignalBundle {
	const existing = store.getSignals();
	if (existing) {
		return {
			...existing,
			mediaFingerprint: store.mediaFingerprint,
			programmeFingerprint: store.getProgrammeFingerprint(),
		};
	}

	const deadAir = store.query({ kinds: ["DEAD_AIR_CANDIDATE"] });
	const activity = store.query({ kinds: ["VISUAL_ACTIVITY"] });
	const focal = store.query({ kinds: ["FOCAL_TARGET"] });
	const stable = store.query({ kinds: ["VISUAL_STABLE_RANGE"] });
	const loud = store.query({ kinds: ["LOUDNESS_ANALYSIS"] })[0];
	const loudCand = store.query({ kinds: ["LOUDNESS_CANDIDATE"] })[0];
	const cap = store.query({ kinds: ["CAPTION_LAYOUT"] })[0];
	const capState = store.query({ kinds: ["EXISTING_CAPTION_STATE"] })[0];
	const protectedRanges = store.query({ kinds: ["PROTECTED_RANGE"] });

	return {
		assetId: store.assetId,
		mediaFingerprint: store.mediaFingerprint,
		programmeFingerprint: store.getProgrammeFingerprint(),
		aspectValue: 16 / 9,
		deadAir: {
			candidates: deadAir.map((r) => ({
				id: r.provenance.evidenceId ?? r.id,
				startSec: r.sourceRange?.startSec ?? 0,
				endSec: r.sourceRange?.endSec ?? 0,
				durationSec: (r.sourceRange?.endSec ?? 0) - (r.sourceRange?.startSec ?? 0),
				safeToPropose: !r.normalizedSummary?.includes("blocked"),
				blockingReasons: r.normalizedSummary?.includes("blocked") ? [r.normalizedSummary] : [],
				classification: r.internalCode,
				confidence: r.confidence,
			})),
		},
		loudness: loud
			? {
					classification: loud.internalCode ?? "UNKNOWN",
					safeToPropose: Boolean(loudCand),
					estimatedGainDb: undefined,
				}
			: undefined,
		captions: cap
			? {
					layoutStatus: (cap.internalCode as "ok") ?? "NO_TRANSCRIPT",
					cueCount: 0,
					alreadyEnabled: Boolean(capState?.normalizedSummary?.includes("enabled")),
					manualConflict: false,
					safeToPropose: cap.internalCode === "ok",
				}
			: undefined,
		visual: {
			activityRanges: activity.map((r) => ({
				startSec: r.sourceRange?.startSec ?? 0,
				endSec: r.sourceRange?.endSec ?? 0,
				reason: r.internalCode ?? "activity",
			})),
			stableRanges: stable.map((r) => ({
				startSec: r.sourceRange?.startSec ?? 0,
				endSec: r.sourceRange?.endSec ?? 0,
			})),
			focalTargets: focal.map((r) => ({
				id: r.provenance.evidenceId ?? r.id,
				startSec: r.sourceRange?.startSec ?? 0,
				endSec: r.sourceRange?.endSec ?? 0,
				cx: 0.5,
				cy: 0.5,
				kind: r.internalCode ?? "focal",
			})),
		},
		preservation: protectedRanges.map((r) => ({
			id: r.provenance.evidenceId ?? r.id,
			startSec: r.sourceRange?.startSec ?? 0,
			endSec: r.sourceRange?.endSec ?? 0,
			reason: r.normalizedSummary ?? "protected",
			kind: (r.internalCode as "visual") ?? "visual",
		})),
	};
}

export function orchestrateFromTemporalContext(store: TemporalContextStore): OrchestrateResult {
	const bundle = signalBundleFromTemporalStore(store);
	return orchestrateFromSignals({ bundle, bypassCache: true });
}

export function syncProgrammeFingerprint(store: TemporalContextStore): string {
	return programmeFingerprintFromDocument(store.getDocument());
}

/**
 * Build temporal context records from existing evidence inputs.
 * Prefer references; do not re-run detectors.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type {
	EditorialRecommendationSetV1,
	EditorialSignalBundle,
} from "../editorialOrchestration/types";
import { recordIdFor, roundTime } from "./identity";
import { programmeFingerprintFromDocument, remapRecordProgrammeRanges } from "./projection";
import type { ConfidenceClass, TemporalContextRecordV1, TemporalRecordKind } from "./types";

export interface TemporalContextBuildInput {
	document: AxcutDocument;
	assetId: string;
	mediaFingerprint: string;
	/** Precomputed orchestration signals — no decode. */
	signals?: EditorialSignalBundle;
	/** Optional prior orchestration output to index (refs). */
	editorialSet?: EditorialRecommendationSetV1;
	/** Optional speech words from transcript SSOT (refs by id). */
	speechWords?: Array<{
		id: string;
		text: string;
		sourceStartSec: number;
		sourceEndSec: number;
		segmentId?: string;
	}>;
	speechSegments?: Array<{
		id: string;
		text: string;
		sourceStartSec: number;
		sourceEndSec: number;
	}>;
	nowIso?: string;
}

function conf(c?: ConfidenceClass): ConfidenceClass | undefined {
	return c;
}

export function buildTemporalContextRecords(
	input: TemporalContextBuildInput,
): TemporalContextRecordV1[] {
	const now = input.nowIso ?? new Date().toISOString();
	const mediaFp = input.mediaFingerprint;
	const progFp = programmeFingerprintFromDocument(input.document);
	const doc = input.document;
	const assetId = input.assetId;
	const out: TemporalContextRecordV1[] = [];

	const project = (sourceRange?: { startSec: number; endSec: number }) =>
		remapRecordProgrammeRanges({ document: doc, assetId, sourceRange });

	const push = (r: TemporalContextRecordV1) => {
		out.push(r);
	};

	for (const w of input.speechWords ?? []) {
		const sourceRange = {
			startSec: roundTime(w.sourceStartSec),
			endSec: roundTime(w.sourceEndSec),
		};
		push({
			id: recordIdFor({
				kind: "SPEECH_WORD",
				mediaFingerprint: mediaFp,
				parts: [w.id, sourceRange.startSec, sourceRange.endSec],
			}),
			kind: "SPEECH_WORD",
			sourceRange,
			programmeRanges: project(sourceRange),
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "AxcutTranscript",
				evidenceId: w.id,
				observedOrDerived: "OBSERVED",
			},
			payloadRef: `transcript.word:${w.id}`,
			normalizedSummary: w.text,
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "REQUIRES_USER_PERMISSION",
			epistemic: "OBSERVED",
		});
	}

	for (const s of input.speechSegments ?? []) {
		const sourceRange = {
			startSec: roundTime(s.sourceStartSec),
			endSec: roundTime(s.sourceEndSec),
		};
		push({
			id: recordIdFor({
				kind: "SPEECH_SEGMENT",
				mediaFingerprint: mediaFp,
				parts: [s.id, sourceRange.startSec, sourceRange.endSec],
			}),
			kind: "SPEECH_SEGMENT",
			sourceRange,
			programmeRanges: project(sourceRange),
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "AxcutTranscript",
				evidenceId: s.id,
				observedOrDerived: "OBSERVED",
			},
			payloadRef: `transcript.segment:${s.id}`,
			normalizedSummary: s.text.slice(0, 120),
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "REQUIRES_USER_PERMISSION",
			epistemic: "OBSERVED",
		});
	}

	const sig = input.signals;
	if (sig?.deadAir?.candidates) {
		for (const c of sig.deadAir.candidates) {
			const sourceRange = {
				startSec: roundTime(c.startSec),
				endSec: roundTime(c.endSec),
			};
			push({
				id: recordIdFor({
					kind: "DEAD_AIR_CANDIDATE",
					mediaFingerprint: mediaFp,
					parts: [c.id, sourceRange.startSec, sourceRange.endSec],
				}),
				kind: "DEAD_AIR_CANDIDATE",
				sourceRange,
				programmeRanges: project(sourceRange),
				confidence: conf(c.confidence) ?? (c.safeToPropose ? "HIGH" : "MEDIUM"),
				status: "CURRENT",
				provenance: {
					module: "deadAir",
					evidenceId: c.id,
					observedOrDerived: "HEURISTIC",
				},
				payloadRef: `deadAir.candidate:${c.id}`,
				normalizedSummary: c.safeToPropose
					? `Safe pause-shorten candidate (${c.durationSec.toFixed(1)}s)`
					: `Pause candidate blocked (${(c.blockingReasons ?? []).join(", ") || "unsafe"})`,
				internalCode: c.classification,
				mediaFingerprint: mediaFp,
				programmeFingerprint: progFp,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "HEURISTIC",
			});
			push({
				id: recordIdFor({
					kind: "SPEECH_GAP",
					mediaFingerprint: mediaFp,
					parts: ["gap", c.id, sourceRange.startSec, sourceRange.endSec],
				}),
				kind: "SPEECH_GAP",
				sourceRange,
				programmeRanges: project(sourceRange),
				confidence: "MEDIUM",
				status: "CURRENT",
				provenance: {
					module: "deadAir",
					evidenceId: c.id,
					observedOrDerived: "DERIVED",
				},
				payloadRef: `deadAir.gap:${c.id}`,
				normalizedSummary: `Speech gap ${sourceRange.startSec}–${sourceRange.endSec}s`,
				mediaFingerprint: mediaFp,
				programmeFingerprint: progFp,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "DERIVED",
			});
		}
	}

	if (sig?.loudness) {
		push({
			id: recordIdFor({
				kind: "LOUDNESS_ANALYSIS",
				mediaFingerprint: mediaFp,
				parts: [sig.loudness.classification],
			}),
			kind: "LOUDNESS_ANALYSIS",
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "loudness",
				evidenceId: sig.loudness.classification,
				observedOrDerived: "DERIVED",
			},
			payloadRef: "loudness.analysis",
			normalizedSummary: `Loudness classification ${sig.loudness.classification}`,
			internalCode: sig.loudness.classification,
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "SAFE_STRUCTURED",
			epistemic: "DERIVED",
		});
		if (sig.loudness.safeToPropose) {
			push({
				id: recordIdFor({
					kind: "LOUDNESS_CANDIDATE",
					mediaFingerprint: mediaFp,
					parts: ["cand", sig.loudness.classification, sig.loudness.estimatedGainDb ?? 0],
				}),
				kind: "LOUDNESS_CANDIDATE",
				confidence: "HIGH",
				status: "CURRENT",
				provenance: {
					module: "loudness",
					observedOrDerived: "HEURISTIC",
				},
				payloadRef: "loudness.candidate",
				normalizedSummary:
					typeof sig.loudness.estimatedGainDb === "number"
						? `Normalize gain ~${sig.loudness.estimatedGainDb.toFixed(1)} dB`
						: "Loudness normalize candidate",
				mediaFingerprint: mediaFp,
				programmeFingerprint: progFp,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "HEURISTIC",
			});
		}
	}

	if (sig?.visual) {
		for (const a of sig.visual.activityRanges) {
			const sourceRange = {
				startSec: roundTime(a.startSec),
				endSec: roundTime(a.endSec),
			};
			push({
				id: recordIdFor({
					kind: "VISUAL_ACTIVITY",
					mediaFingerprint: mediaFp,
					parts: [a.reason, sourceRange.startSec, sourceRange.endSec],
				}),
				kind: "VISUAL_ACTIVITY",
				sourceRange,
				programmeRanges: project(sourceRange),
				confidence: "MEDIUM",
				status: "CURRENT",
				provenance: {
					module: "visualAnalysis",
					observedOrDerived: "DERIVED",
				},
				payloadRef: `visual.activity:${a.reason}`,
				normalizedSummary: `Material visual activity (${a.reason}) in sampled local analysis`,
				internalCode: a.reason,
				mediaFingerprint: mediaFp,
				programmeFingerprint: progFp,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "DERIVED",
			});
		}
		for (const s of sig.visual.stableRanges ?? []) {
			const sourceRange = {
				startSec: roundTime(s.startSec),
				endSec: roundTime(s.endSec),
			};
			push({
				id: recordIdFor({
					kind: "VISUAL_STABLE_RANGE",
					mediaFingerprint: mediaFp,
					parts: [sourceRange.startSec, sourceRange.endSec],
				}),
				kind: "VISUAL_STABLE_RANGE",
				sourceRange,
				programmeRanges: project(sourceRange),
				confidence: "MEDIUM",
				status: "CURRENT",
				provenance: {
					module: "visualAnalysis",
					observedOrDerived: "DERIVED",
				},
				payloadRef: "visual.stable",
				normalizedSummary: "Visually stable range in sampled local analysis",
				mediaFingerprint: mediaFp,
				programmeFingerprint: progFp,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "DERIVED",
			});
		}
		for (const t of sig.visual.focalTargets ?? []) {
			const sourceRange = {
				startSec: roundTime(t.startSec),
				endSec: roundTime(t.endSec),
			};
			push({
				id: recordIdFor({
					kind: "FOCAL_TARGET",
					mediaFingerprint: mediaFp,
					parts: [t.id, t.cx, t.cy, sourceRange.startSec],
				}),
				kind: "FOCAL_TARGET",
				sourceRange,
				programmeRanges: project(sourceRange),
				confidence: "HIGH",
				status: "CURRENT",
				provenance: {
					module: "focal",
					evidenceId: t.id,
					observedOrDerived: "DERIVED",
				},
				payloadRef: `focal:${t.id}`,
				normalizedSummary: `Known focal target (${t.kind})`,
				internalCode: t.kind,
				mediaFingerprint: mediaFp,
				programmeFingerprint: progFp,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "DERIVED",
			});
		}
	}

	for (const p of sig?.preservation ?? []) {
		const sourceRange = {
			startSec: roundTime(p.startSec),
			endSec: roundTime(p.endSec),
		};
		push({
			id: recordIdFor({
				kind: "PROTECTED_RANGE",
				mediaFingerprint: mediaFp,
				parts: [p.id, p.kind, sourceRange.startSec, sourceRange.endSec],
			}),
			kind: "PROTECTED_RANGE",
			sourceRange,
			programmeRanges: project(sourceRange),
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "editorialOrchestration",
				evidenceId: p.id,
				observedOrDerived:
					p.kind === "user_edit" || p.kind === "manual_annotation" || p.kind === "manual_caption"
						? "USER_AUTHORED"
						: "HEURISTIC",
			},
			payloadRef: `preservation:${p.id}`,
			normalizedSummary: p.reason,
			internalCode: p.kind,
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "SAFE_STRUCTURED",
			epistemic:
				p.kind === "user_edit" || p.kind === "manual_annotation" || p.kind === "manual_caption"
					? "USER_AUTHORED"
					: "HEURISTIC",
		});
	}

	if (sig?.captions) {
		push({
			id: recordIdFor({
				kind: "CAPTION_LAYOUT",
				mediaFingerprint: mediaFp,
				parts: [sig.captions.layoutStatus, sig.captions.cueCount, sig.captions.alreadyEnabled],
			}),
			kind: "CAPTION_LAYOUT",
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "captionLayout",
				observedOrDerived: "DERIVED",
			},
			payloadRef: "captionLayout.result",
			normalizedSummary: `Caption layout ${sig.captions.layoutStatus} (${sig.captions.cueCount} cues)`,
			internalCode: sig.captions.layoutStatus,
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "SAFE_STRUCTURED",
			epistemic: "DERIVED",
		});
		push({
			id: recordIdFor({
				kind: "EXISTING_CAPTION_STATE",
				mediaFingerprint: mediaFp,
				parts: ["enabled", sig.captions.alreadyEnabled],
			}),
			kind: "EXISTING_CAPTION_STATE",
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "AxcutDocument",
				observedOrDerived: "USER_AUTHORED",
			},
			payloadRef: "document.captionSettings.enabled",
			normalizedSummary: sig.captions.alreadyEnabled
				? "Captions currently enabled"
				: "Captions currently disabled",
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "SAFE_STRUCTURED",
			epistemic: "USER_AUTHORED",
		});
	}

	// Existing edits from document
	for (const t of doc.timeline.trimRanges ?? []) {
		const sourceRange = { startSec: roundTime(t.startSec), endSec: roundTime(t.endSec) };
		push({
			id: recordIdFor({
				kind: "EXISTING_TRIM",
				mediaFingerprint: mediaFp,
				parts: [t.id, sourceRange.startSec, sourceRange.endSec],
			}),
			kind: "EXISTING_TRIM",
			sourceRange,
			programmeRanges: [],
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "AxcutDocument",
				evidenceId: t.id,
				observedOrDerived: "USER_AUTHORED",
			},
			payloadRef: `document.trim:${t.id}`,
			normalizedSummary: `Existing trim ${sourceRange.startSec}–${sourceRange.endSec}s (source)`,
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "SAFE_STRUCTURED",
			epistemic: "USER_AUTHORED",
		});
	}

	for (const z of doc.zoomRanges ?? []) {
		push({
			id: recordIdFor({
				kind: "EXISTING_ZOOM",
				mediaFingerprint: mediaFp,
				parts: [z.id, z.startMs, z.endMs],
			}),
			kind: "EXISTING_ZOOM",
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "AxcutDocument",
				evidenceId: z.id,
				observedOrDerived: "USER_AUTHORED",
			},
			payloadRef: `document.zoom:${z.id}`,
			normalizedSummary: `Existing zoom region (${z.id})`,
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "SAFE_STRUCTURED",
			epistemic: "USER_AUTHORED",
		});
	}

	for (const c of doc.timeline.clips ?? []) {
		if (c.cropRegion) {
			push({
				id: recordIdFor({
					kind: "EXISTING_CROP",
					mediaFingerprint: mediaFp,
					parts: [c.id, c.cropRegion],
				}),
				kind: "EXISTING_CROP",
				confidence: "HIGH",
				status: "CURRENT",
				provenance: {
					module: "AxcutDocument",
					evidenceId: c.id,
					observedOrDerived: "USER_AUTHORED",
				},
				payloadRef: `document.clip.crop:${c.id}`,
				normalizedSummary: `Existing crop on clip ${c.id}`,
				mediaFingerprint: mediaFp,
				programmeFingerprint: progFp,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "USER_AUTHORED",
			});
		}
	}

	const speeds =
		((doc.legacyEditor as Record<string, unknown> | null)?.speedRegions as
			| Array<{ id: string; startMs: number; endMs: number; speed: number }>
			| undefined) ?? [];
	for (const s of speeds) {
		push({
			id: recordIdFor({
				kind: "EXISTING_SPEED",
				mediaFingerprint: mediaFp,
				parts: [s.id, s.startMs, s.endMs, s.speed],
			}),
			kind: "EXISTING_SPEED",
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "AxcutDocument",
				evidenceId: s.id,
				observedOrDerived: "USER_AUTHORED",
			},
			payloadRef: `document.speed:${s.id}`,
			normalizedSummary: `Existing speed ${s.speed}x`,
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "SAFE_STRUCTURED",
			epistemic: "USER_AUTHORED",
		});
	}

	for (const a of doc.annotations ?? []) {
		push({
			id: recordIdFor({
				kind: "ANNOTATION",
				mediaFingerprint: mediaFp,
				parts: [a.id],
			}),
			kind: "ANNOTATION",
			confidence: "HIGH",
			status: "CURRENT",
			provenance: {
				module: "AxcutDocument",
				evidenceId: a.id,
				observedOrDerived: "USER_AUTHORED",
			},
			payloadRef: `document.annotation:${a.id}`,
			normalizedSummary: "User annotation present",
			mediaFingerprint: mediaFp,
			programmeFingerprint: progFp,
			createdAt: now,
			updatedAt: now,
			privacy: "REQUIRES_USER_PERMISSION",
			epistemic: "USER_AUTHORED",
		});
	}

	const set = input.editorialSet;
	if (set) {
		for (const f of set.findings) {
			push({
				id: recordIdFor({
					kind: "EDITORIAL_FINDING",
					mediaFingerprint: mediaFp,
					parts: [f.id],
				}),
				kind: "EDITORIAL_FINDING",
				sourceRange: f.sourceRange,
				programmeRanges: f.sourceRange ? project(f.sourceRange) : undefined,
				confidence: f.confidence,
				status: "CURRENT",
				provenance: {
					module: "editorialOrchestration",
					evidenceId: f.id,
					version: set.policyVersion,
					observedOrDerived: "HEURISTIC",
				},
				payloadRef: `editorial.finding:${f.id}`,
				normalizedSummary: f.reason,
				internalCode: f.findingType,
				mediaFingerprint: mediaFp,
				programmeFingerprint: set.programmeFingerprint,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "HEURISTIC",
			});
		}
		for (const r of set.recommendations) {
			push({
				id: recordIdFor({
					kind: "EDITORIAL_RECOMMENDATION",
					mediaFingerprint: mediaFp,
					parts: [r.id],
				}),
				kind: "EDITORIAL_RECOMMENDATION",
				sourceRange: r.sourceRange,
				programmeRanges: r.sourceRange ? project(r.sourceRange) : undefined,
				confidence: r.confidence,
				status: "CURRENT",
				provenance: {
					module: "editorialOrchestration",
					evidenceId: r.id,
					version: set.policyVersion,
					observedOrDerived: "HEURISTIC",
				},
				payloadRef: `editorial.recommendation:${r.id}`,
				normalizedSummary: r.reviewCopy,
				internalCode: r.operationFamily,
				mediaFingerprint: mediaFp,
				programmeFingerprint: set.programmeFingerprint,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "HEURISTIC",
			});
		}
		for (const q of set.unresolvedQuestions) {
			const qId = typeof q === "string" ? stableQuestionId(mediaFp, q) : q.id;
			const text = typeof q === "string" ? q : q.text;
			push({
				id: recordIdFor({
					kind: "EDITORIAL_QUESTION",
					mediaFingerprint: mediaFp,
					parts: [qId],
				}),
				kind: "EDITORIAL_QUESTION",
				sourceRange: typeof q === "string" ? undefined : q.sourceRange,
				programmeRanges:
					typeof q !== "string" && q.sourceRange ? project(q.sourceRange) : undefined,
				confidence: "MEDIUM",
				status: "CURRENT",
				provenance: {
					module: "editorialOrchestration",
					evidenceId: qId,
					observedOrDerived: "HEURISTIC",
				},
				payloadRef: `editorial.question:${qId}`,
				normalizedSummary: text,
				mediaFingerprint: mediaFp,
				programmeFingerprint: set.programmeFingerprint,
				createdAt: now,
				updatedAt: now,
				privacy: "SAFE_STRUCTURED",
				epistemic: "HEURISTIC",
			});
		}
	}

	// Deduplicate by id (stable)
	const byId = new Map<string, TemporalContextRecordV1>();
	for (const r of out) byId.set(r.id, r);
	return [...byId.values()];
}

function stableQuestionId(mediaFp: string, text: string): string {
	return recordIdFor({
		kind: "EDITORIAL_QUESTION",
		mediaFingerprint: mediaFp,
		parts: ["text", text],
	});
}

export function countByKind(records: TemporalContextRecordV1[]): Record<string, number> {
	const c: Record<string, number> = {};
	for (const r of records) {
		c[r.kind] = (c[r.kind] ?? 0) + 1;
	}
	return c;
}

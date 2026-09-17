/**
 * Temporal Context Store — in-memory index over existing evidence.
 * Persistence decision: memory + existing detector caches (no new DB).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { EditorialSignalBundle } from "../editorialOrchestration/types";
import { buildTemporalContextRecords, countByKind, type TemporalContextBuildInput } from "./build";
import { isSourceOwnedKind, type MutationFamily, validityAfterProgrammeChange } from "./invalidate";
import { programmeFingerprintFromDocument, remapRecordProgrammeRanges } from "./projection";
import {
	type ConfidenceClass,
	DEFAULT_PACKET_BUDGETS,
	type EditorialContextSessionV1,
	type EvidenceCoverageV1,
	type PacketDetailLevel,
	TEMPORAL_CONTEXT_STORE_V1_PROVIDER_ID,
	TEMPORAL_REASONING_PACKET_VERSION,
	type TemporalContextQuery,
	type TemporalContextRecordV1,
	type TemporalReasoningPacketV1,
	type TemporalRecordKind,
} from "./types";

const CONF_RANK: Record<ConfidenceClass, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
	return a0 < b1 && b0 < a1;
}

export class TemporalContextStore {
	readonly mediaFingerprint: string;
	readonly assetId: string;
	private document: AxcutDocument;
	private programmeFingerprint: string;
	private records: TemporalContextRecordV1[];
	private signals?: EditorialSignalBundle;
	private session: EditorialContextSessionV1 | null = null;
	private buildMs = 0;
	readonly additionalMediaDecodePasses = 0 as const;
	readonly additionalModelCalls = 0 as const;
	readonly autoMutations = 0 as const;

	constructor(args: {
		document: AxcutDocument;
		assetId: string;
		mediaFingerprint: string;
		records: TemporalContextRecordV1[];
		signals?: EditorialSignalBundle;
		buildMs: number;
	}) {
		this.document = args.document;
		this.assetId = args.assetId;
		this.mediaFingerprint = args.mediaFingerprint;
		this.programmeFingerprint = programmeFingerprintFromDocument(args.document);
		this.records = args.records;
		this.signals = args.signals;
		this.buildMs = args.buildMs;
	}

	getProgrammeFingerprint(): string {
		return this.programmeFingerprint;
	}

	getDocument(): AxcutDocument {
		return this.document;
	}

	getSignals(): EditorialSignalBundle | undefined {
		return this.signals;
	}

	allRecords(): TemporalContextRecordV1[] {
		return [...this.records];
	}

	getRecord(id: string): TemporalContextRecordV1 | undefined {
		return this.records.find((r) => r.id === id);
	}

	stats() {
		return {
			recordCount: this.records.length,
			byKind: countByKind(this.records),
			programmeFingerprint: this.programmeFingerprint,
			mediaFingerprint: this.mediaFingerprint,
			buildMs: this.buildMs,
			additionalMediaDecodePasses: this.additionalMediaDecodePasses,
			additionalModelCalls: this.additionalModelCalls,
			autoMutations: this.autoMutations,
		};
	}

	query(q: TemporalContextQuery): TemporalContextRecordV1[] {
		let rows = this.records;
		if (!q.includeStale) {
			rows = rows.filter(
				(r) => r.status === "CURRENT" || r.status === "SOURCE_CURRENT_PROGRAMME_STALE",
			);
			// For programme queries, SOURCE_CURRENT_PROGRAMME_STALE still has remapped ranges after notify
		}
		if (q.kinds?.length) {
			const set = new Set(q.kinds);
			rows = rows.filter((r) => set.has(r.kind));
		}
		if (q.confidenceAtLeast) {
			const min = CONF_RANK[q.confidenceAtLeast];
			rows = rows.filter((r) => (r.confidence ? CONF_RANK[r.confidence] >= min : true));
		}
		if (q.sourceRange) {
			const [a, b] = q.sourceRange;
			rows = rows.filter(
				(r) => r.sourceRange && overlaps(r.sourceRange.startSec, r.sourceRange.endSec, a, b),
			);
		}
		if (q.programmeRange) {
			const [a, b] = q.programmeRange;
			rows = rows.filter((r) =>
				(r.programmeRanges ?? []).some((p) => overlaps(p.startSec, p.endSec, a, b)),
			);
		}
		if (typeof q.limit === "number") rows = rows.slice(0, q.limit);
		return rows;
	}

	getContextForProgrammeRange(range: [number, number]): TemporalContextRecordV1[] {
		return this.query({ programmeRange: range });
	}

	getSpeechContext(range?: [number, number]): TemporalContextRecordV1[] {
		return this.query({
			sourceRange: range,
			kinds: ["SPEECH_SEGMENT", "SPEECH_WORD", "SPEECH_GAP"],
		});
	}

	getVisualContext(range?: [number, number]): TemporalContextRecordV1[] {
		return this.query({
			sourceRange: range,
			kinds: [
				"VISUAL_ACTIVITY",
				"VISUAL_STABLE_RANGE",
				"VISUAL_CHANGE",
				"SCENE_CHANGE",
				"BLACK_RANGE",
				"FREEZE_RANGE",
			],
		});
	}

	getPreservationContext(range?: [number, number]): TemporalContextRecordV1[] {
		return this.query({ sourceRange: range, kinds: ["PROTECTED_RANGE"] });
	}

	getEditorialContext(): TemporalContextRecordV1[] {
		return this.query({
			kinds: ["EDITORIAL_FINDING", "EDITORIAL_RECOMMENDATION", "EDITORIAL_QUESTION"],
		});
	}

	getCurrentRecommendations(): TemporalContextRecordV1[] {
		return this.query({ kinds: ["EDITORIAL_RECOMMENDATION"], includeStale: false }).filter(
			(r) => r.status === "CURRENT",
		);
	}

	getUnresolvedQuestions(): TemporalContextRecordV1[] {
		return this.query({ kinds: ["EDITORIAL_QUESTION"] });
	}

	getEvidenceForRecommendation(recommendationId: string): TemporalContextRecordV1[] {
		const rec = this.records.find(
			(r) =>
				r.kind === "EDITORIAL_RECOMMENDATION" &&
				(r.provenance.evidenceId === recommendationId ||
					r.payloadRef === `editorial.recommendation:${recommendationId}` ||
					r.id.includes(recommendationId)),
		);
		if (!rec?.sourceRange) return rec ? [rec] : [];
		const range: [number, number] = [rec.sourceRange.startSec, rec.sourceRange.endSec];
		return this.query({ sourceRange: range });
	}

	coverage(): EvidenceCoverageV1 {
		const has = (k: TemporalRecordKind) => this.records.some((r) => r.kind === k);
		return {
			speechCoverage: has("SPEECH_WORD") || has("SPEECH_SEGMENT") ? "AVAILABLE" : "NOT_AVAILABLE",
			visualCoverage:
				has("VISUAL_ACTIVITY") || has("VISUAL_STABLE_RANGE") ? "AVAILABLE_COARSE" : "NOT_AVAILABLE",
			ocrCoverage: "NOT_AVAILABLE",
			focalCoverage:
				has("FOCAL_TARGET") || has("EDITORIAL_FOCAL_TARGET")
					? "AVAILABLE"
					: has("EDITORIAL_FOCAL_EVIDENCE") || has("VISUAL_ACTIVITY")
						? "PARTIAL"
						: "NOT_AVAILABLE",
			cursorCoverage: has("CURSOR_INTERACTION") ? "AVAILABLE" : "NOT_AVAILABLE",
			loudnessCoverage: has("LOUDNESS_ANALYSIS") ? "AVAILABLE" : "NOT_AVAILABLE",
			captionLayoutCoverage: has("CAPTION_LAYOUT") ? "AVAILABLE" : "NOT_AVAILABLE",
			editorialCoverage:
				has("EDITORIAL_FINDING") || has("EDITORIAL_RECOMMENDATION")
					? "AVAILABLE"
					: has("EDITORIAL_QUESTION")
						? "PARTIAL"
						: "NOT_AVAILABLE",
		};
	}

	/**
	 * Document mutation / undo / rollback: remap programme projections.
	 * Source evidence stays; recommendations tied to old fingerprint become STALE.
	 * Does NOT re-run detectors.
	 */
	notifyDocumentChanged(args: {
		document: AxcutDocument;
		mutation: MutationFamily;
		expectedPreviousFingerprint?: string;
	}): { previousFingerprint: string; nextFingerprint: string } {
		const previous = this.programmeFingerprint;
		if (args.expectedPreviousFingerprint && args.expectedPreviousFingerprint !== previous) {
			// Still apply; caller may be restoring
		}
		this.document = args.document;
		const next = programmeFingerprintFromDocument(args.document);
		this.programmeFingerprint = next;
		const now = new Date().toISOString();

		this.records = this.records.map((r) => {
			const nextStatus = validityAfterProgrammeChange(r.kind);
			const programmeRanges = r.sourceRange
				? remapRecordProgrammeRanges({
						document: args.document,
						assetId: this.assetId,
						sourceRange: r.sourceRange,
					})
				: r.programmeRanges;

			if (isSourceOwnedKind(r.kind)) {
				return {
					...r,
					programmeRanges,
					programmeFingerprint: next,
					status: next === previous ? r.status : "SOURCE_CURRENT_PROGRAMME_STALE",
					updatedAt: now,
				};
			}

			// Editorial recommendations / questions / existing edits rebuild-sensitive
			if (
				r.kind === "EDITORIAL_RECOMMENDATION" ||
				r.kind === "EDITORIAL_FINDING" ||
				r.kind === "EDITORIAL_QUESTION"
			) {
				return {
					...r,
					programmeRanges,
					programmeFingerprint: next,
					status: next === previous ? r.status : "STALE",
					updatedAt: now,
				};
			}

			if (
				r.kind.startsWith("EXISTING_") ||
				r.kind === "ANNOTATION" ||
				r.kind === "CAPTION_LAYOUT" ||
				r.kind === "EXISTING_CAPTION_STATE"
			) {
				return {
					...r,
					programmeRanges,
					programmeFingerprint: next,
					status: next === previous ? "CURRENT" : nextStatus,
					updatedAt: now,
				};
			}

			return {
				...r,
				programmeRanges,
				programmeFingerprint: next,
				status: next === previous ? r.status : nextStatus,
				updatedAt: now,
			};
		});

		this.refreshSelectionValidity();
		return { previousFingerprint: previous, nextFingerprint: next };
	}

	/** After successful rebuild of editorial set / existing edits from document. */
	replaceIndexedRecords(records: TemporalContextRecordV1[]): void {
		this.records = records;
		this.programmeFingerprint = programmeFingerprintFromDocument(this.document);
		this.refreshSelectionValidity();
	}

	rebuildFromInput(
		input: Omit<TemporalContextBuildInput, "document" | "assetId" | "mediaFingerprint"> & {
			document?: AxcutDocument;
		},
	): void {
		const t0 = Date.now();
		if (input.document) this.document = input.document;
		if (input.signals) this.signals = input.signals;
		this.records = buildTemporalContextRecords({
			document: this.document,
			assetId: this.assetId,
			mediaFingerprint: this.mediaFingerprint,
			...input,
		});
		this.programmeFingerprint = programmeFingerprintFromDocument(this.document);
		this.buildMs = Date.now() - t0;
		this.refreshSelectionValidity();
	}

	createSession(sessionId: string): EditorialContextSessionV1 {
		this.session = {
			sessionId,
			mediaFingerprint: this.mediaFingerprint,
			programmeFingerprint: this.programmeFingerprint,
			selectionStatus: "NONE",
			lastResultRefs: [],
			updatedAt: new Date().toISOString(),
		};
		return this.session;
	}

	getSession(): EditorialContextSessionV1 | null {
		return this.session;
	}

	selectRecommendation(id: string): EditorialContextSessionV1 {
		const s = this.ensureSession();
		s.selectedRecommendationId = id;
		s.selectedFindingId = undefined;
		s.selectedQuestionId = undefined;
		const rec =
			this.getCurrentRecommendations().find(
				(r) => r.provenance.evidenceId === id || r.payloadRef?.endsWith(`:${id}`),
			) ??
			this.records.find(
				(r) =>
					r.kind === "EDITORIAL_RECOMMENDATION" &&
					(r.provenance.evidenceId === id || r.id.includes(id)),
			);
		if (!rec || rec.status === "STALE" || rec.status === "REMOVED") {
			s.selectionStatus = "SELECTION_STALE";
			s.selectionStaleReason = rec
				? `Recommendation ${id} is ${rec.status}`
				: `Recommendation ${id} not found`;
		} else {
			s.selectionStatus = "VALID";
			s.selectionStaleReason = undefined;
		}
		s.programmeFingerprint = this.programmeFingerprint;
		s.updatedAt = new Date().toISOString();
		return s;
	}

	selectRange(range: { startSec: number; endSec: number }): EditorialContextSessionV1 {
		const s = this.ensureSession();
		s.selectedRange = range;
		s.selectionStatus = "VALID";
		s.selectionStaleReason = undefined;
		s.updatedAt = new Date().toISOString();
		return s;
	}

	rememberQuery(q: TemporalContextQuery, resultIds: string[]): EditorialContextSessionV1 {
		const s = this.ensureSession();
		s.lastQuery = q;
		s.lastResultRefs = resultIds;
		s.updatedAt = new Date().toISOString();
		return s;
	}

	private ensureSession(): EditorialContextSessionV1 {
		if (!this.session) return this.createSession(`sess_${Date.now()}`);
		return this.session;
	}

	private refreshSelectionValidity(): void {
		if (!this.session) return;
		const s = this.session;
		s.programmeFingerprint = this.programmeFingerprint;
		if (s.selectedRecommendationId) {
			const rec = this.records.find(
				(r) =>
					r.kind === "EDITORIAL_RECOMMENDATION" &&
					(r.provenance.evidenceId === s.selectedRecommendationId ||
						r.payloadRef?.endsWith(`:${s.selectedRecommendationId}`)),
			);
			if (!rec || rec.status === "STALE" || rec.status === "REMOVED") {
				s.selectionStatus = "SELECTION_STALE";
				s.selectionStaleReason = rec
					? `Selected recommendation became ${rec.status} after programme change`
					: "Selected recommendation no longer present";
				// Do NOT redirect to another recommendation
			} else if (s.selectionStatus !== "SELECTION_STALE") {
				s.selectionStatus = "VALID";
			}
		}
		s.updatedAt = new Date().toISOString();
	}

	buildTemporalReasoningPacketV1(args?: {
		detailLevel?: PacketDetailLevel;
		requestedRange?: { startSec: number; endSec: number };
		timebase?: "source" | "programme";
	}): TemporalReasoningPacketV1 {
		const t0 = Date.now();
		const level = args?.detailLevel ?? "STANDARD";
		const budget = DEFAULT_PACKET_BUDGETS[level];
		const rangeTuple = args?.requestedRange
			? ([args.requestedRange.startSec, args.requestedRange.endSec] as [number, number])
			: undefined;

		const scoped =
			rangeTuple && args?.timebase === "programme"
				? this.query({ programmeRange: rangeTuple })
				: rangeTuple
					? this.query({ sourceRange: rangeTuple })
					: this.query({});

		const take = (kinds: TemporalRecordKind[], max: number) =>
			scoped.filter((r) => kinds.includes(r.kind)).slice(0, max);

		const speech = take(["SPEECH_SEGMENT", "SPEECH_WORD", "SPEECH_GAP"], budget.maxSpeech);
		const visual = take(
			["VISUAL_ACTIVITY", "VISUAL_STABLE_RANGE", "VISUAL_CHANGE", "SCENE_CHANGE"],
			budget.maxVisual,
		);
		const focal = take(
			["FOCAL_TARGET", "EDITORIAL_FOCAL_TARGET", "EDITORIAL_FOCAL_EVIDENCE"],
			budget.maxFocalTargets,
		);
		const protectedRanges = take(["PROTECTED_RANGE"], budget.maxProtected);
		const findings = take(["EDITORIAL_FINDING"], budget.maxFindings);
		const recommendations = take(["EDITORIAL_RECOMMENDATION"], budget.maxRecommendations).filter(
			(r) => r.status === "CURRENT",
		);
		const questions = take(["EDITORIAL_QUESTION"], budget.maxQuestions);
		const edits = take(
			[
				"EXISTING_TRIM",
				"EXISTING_ZOOM",
				"EXISTING_CROP",
				"EXISTING_SPEED",
				"EXISTING_CAPTION_STATE",
				"ANNOTATION",
			],
			budget.maxEdits,
		);
		const audioRecs = take(["LOUDNESS_ANALYSIS", "LOUDNESS_CANDIDATE"], 4);

		const mapBrief = (r: TemporalContextRecordV1) => ({
			id: r.id,
			summary: r.normalizedSummary ?? r.kind,
			sourceRange: r.sourceRange,
			programmeRanges: r.programmeRanges,
		});

		const included = [
			...speech,
			...visual,
			...focal,
			...protectedRanges,
			...findings,
			...recommendations,
			...questions,
			...edits,
			...audioRecs,
		];

		const packet: TemporalReasoningPacketV1 = {
			version: TEMPORAL_REASONING_PACKET_VERSION,
			providerId: TEMPORAL_CONTEXT_STORE_V1_PROVIDER_ID,
			detailLevel: level,
			media: {
				assetId: this.assetId,
				mediaFingerprint: this.mediaFingerprint,
			},
			currentProgramme: {
				programmeFingerprint: this.programmeFingerprint,
			},
			requestedRange: args?.requestedRange,
			speech: speech.map(mapBrief),
			visual: visual.map(mapBrief),
			audio: {
				loudnessSummary: audioRecs[0]?.normalizedSummary,
				recordIds: audioRecs.map((r) => r.id),
			},
			focalTargets: focal.map(mapBrief),
			protectedRanges: protectedRanges.map(mapBrief),
			currentEdits: edits.map((r) => ({
				id: r.id,
				kind: r.kind,
				summary: r.normalizedSummary ?? r.kind,
			})),
			findings: findings.map((r) => ({
				id: r.id,
				summary: r.normalizedSummary ?? r.kind,
			})),
			recommendations: recommendations.map((r) => ({
				id: r.id,
				summary: r.normalizedSummary ?? r.kind,
			})),
			unresolvedQuestions: questions.map((r) => ({
				id: r.id,
				summary: r.normalizedSummary ?? r.kind,
			})),
			evidenceCoverage: this.coverage(),
			budgets: { ...budget },
			metrics: {
				recordCountIncluded: included.length,
				serializedBytesApprox: 0,
				buildMs: Date.now() - t0,
				additionalMediaDecodePasses: 0,
				additionalModelCalls: 0,
			},
		};
		packet.metrics.serializedBytesApprox = JSON.stringify(packet).length;
		return packet;
	}
}

export function createTemporalContextStore(input: TemporalContextBuildInput): TemporalContextStore {
	const t0 = Date.now();
	const records = buildTemporalContextRecords(input);
	return new TemporalContextStore({
		document: input.document,
		assetId: input.assetId,
		mediaFingerprint: input.mediaFingerprint,
		records,
		signals: input.signals,
		buildMs: Date.now() - t0,
	});
}

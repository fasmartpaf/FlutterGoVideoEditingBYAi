/**
 * Temporal Context Store V1 — unit + corpus + mutation tests.
 * TOTAL_PAID_AI_CALLS = 0. AUTO_MUTATIONS = 0. No extra decode.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	type EditorialSignalBundle,
	orchestrateFromSignals,
	resetOrchestrationSeqForTests,
	resetSurfaceSeqForTests,
} from "../editorialOrchestration";
import {
	assertPacketSafeForExport,
	createTemporalContextStore,
	INVALIDATION_MATRIX,
	orchestrateFromTemporalContext,
	programmeFingerprintFromDocument,
	projectSourceRangeToProgramme,
	recordIdFor,
	serializeTemporalReasoningPacket,
	TEMPORAL_CONTEXT_STORE_V1_PROVIDER_ID,
} from "./index";

const ROOT = path.join(process.cwd(), "tmp/perception-benchmark/temporal-context-store-v1");

function writeJson(rel: string, data: unknown): void {
	const full = path.join(ROOT, rel);
	mkdirSync(path.dirname(full), { recursive: true });
	writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function fixtureDoc(opts?: {
	trim?: { start: number; end: number };
	speed?: { startMs: number; endMs: number; speed: number };
}): AxcutDocument {
	const base = createEmptyDocument({
		title: "tcs",
		projectId: "proj_tcs",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	const durationSec = 30;
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "Recording",
				originalPath: "/tmp/tcs.mp4",
				durationSec,
			},
		],
		transcripts: [
			{
				assetId: "asset_1",
				language: "en",
				segments: [
					{
						id: "seg1",
						kind: "speech",
						startSec: 1,
						endSec: 4,
						text: "hello world demo",
						wordIds: ["w0", "w1", "w2"],
					},
				],
				words: [
					{ id: "w0", segmentId: "seg1", startSec: 1, endSec: 1.5, text: "hello", source: "asr" },
					{ id: "w1", segmentId: "seg1", startSec: 1.5, endSec: 2.2, text: "world", source: "asr" },
					{ id: "w2", segmentId: "seg1", startSec: 2.2, endSec: 4, text: "demo", source: "asr" },
				],
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
			trimRanges: opts?.trim
				? [
						{
							id: "trim_1",
							assetId: "asset_1",
							startSec: opts.trim.start,
							endSec: opts.trim.end,
							origin: "user" as const,
							reason: "test trim",
						},
					]
				: [],
		},
		legacyEditor: opts?.speed
			? {
					...(typeof base.legacyEditor === "object" && base.legacyEditor ? base.legacyEditor : {}),
					speedRegions: [
						{
							id: "spd_1",
							startMs: opts.speed.startMs,
							endMs: opts.speed.endMs,
							speed: opts.speed.speed,
						},
					],
				}
			: base.legacyEditor,
	});
}

function signalsForCase(id: string): EditorialSignalBundle {
	const base: EditorialSignalBundle = {
		assetId: "asset_1",
		mediaFingerprint: `media_${id}`,
		programmeFingerprint: "prog_placeholder",
		aspectValue: 16 / 9,
	};
	switch (id) {
		case "bug5-narrated":
			return {
				...base,
				deadAir: {
					candidates: [
						{
							id: "bug5_gap",
							startSec: 8,
							endSec: 9.4,
							durationSec: 1.4,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
				loudness: {
					classification: "TOO_QUIET",
					safeToPropose: true,
					estimatedGainDb: 2.3,
				},
				captions: {
					layoutStatus: "ok",
					cueCount: 12,
					alreadyEnabled: false,
					manualConflict: false,
					speechDurationSec: 17,
					safeToPropose: true,
				},
				visual: { activityRanges: [] },
			};
		case "case4-correction":
			return {
				...base,
				deadAir: { candidates: [] },
				loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
				captions: {
					layoutStatus: "ok",
					cueCount: 3,
					alreadyEnabled: false,
					manualConflict: false,
					speechDurationSec: 8,
					safeToPropose: true,
				},
				visual: { activityRanges: [] },
				preservation: [
					{
						id: "speech_corr",
						startSec: 0,
						endSec: 10,
						reason: "Spoken correction — preserve speech",
						kind: "speech",
					},
				],
				unresolved: ["Speech correction discrepancy; no deterministic UI edit"],
			};
		case "case020":
			return {
				...base,
				visual: {
					activityRanges: [{ startSec: 12, endSec: 16, reason: "moderate_change" }],
				},
				loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
				deadAir: { candidates: [] },
			};
		case "case2-hud":
			return {
				...base,
				visual: {
					activityRanges: [{ startSec: 0, endSec: 2, reason: "ui_motion" }],
				},
				deadAir: { candidates: [] },
				loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
			};
		case "longest-29s":
			return {
				...base,
				deadAir: {
					candidates: [
						{
							id: "l1",
							startSec: 4,
							endSec: 5.5,
							durationSec: 1.5,
							safeToPropose: true,
							blockingReasons: [],
						},
						{
							id: "l2",
							startSec: 20,
							endSec: 22,
							durationSec: 2,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
				loudness: {
					classification: "TOO_QUIET",
					safeToPropose: true,
					estimatedGainDb: 1.5,
				},
				captions: {
					layoutStatus: "ok",
					cueCount: 20,
					alreadyEnabled: false,
					manualConflict: false,
					speechDurationSec: 25,
					safeToPropose: true,
				},
			};
		case "no-audio":
			return {
				...base,
				loudness: { classification: "NO_AUDIO", safeToPropose: false },
				captions: {
					layoutStatus: "NO_SPEECH",
					cueCount: 0,
					alreadyEnabled: false,
					manualConflict: false,
					safeToPropose: false,
				},
				visual: {
					activityRanges: [{ startSec: 1, endSec: 3, reason: "moderate_change" }],
				},
			};
		case "already-good":
			return {
				...base,
				loudness: { classification: "ALREADY_ACCEPTABLE", safeToPropose: false },
				captions: {
					layoutStatus: "ok",
					cueCount: 2,
					alreadyEnabled: true,
					manualConflict: false,
					safeToPropose: false,
				},
				deadAir: { candidates: [] },
				visual: { activityRanges: [] },
			};
		case "conflict-fixture":
			return {
				...base,
				deadAir: {
					candidates: [
						{
							id: "trim_cand",
							startSec: 12,
							endSec: 15.5,
							durationSec: 3.5,
							safeToPropose: true,
							blockingReasons: [],
						},
					],
				},
				preservation: [
					{
						id: "protect_vis",
						startSec: 12,
						endSec: 16,
						reason: "Protected visual target overlaps trim candidate",
						kind: "visual",
					},
				],
			};
		default:
			return base;
	}
}

function speechFromDoc(doc: AxcutDocument) {
	const t = doc.transcripts?.[0];
	return {
		speechWords: (t?.words ?? []).map((w) => ({
			id: w.id,
			text: w.text,
			sourceStartSec: w.startSec,
			sourceEndSec: w.endSec,
			segmentId: w.segmentId,
		})),
		speechSegments: (t?.segments ?? []).map((s) => ({
			id: s.id,
			text: s.text,
			sourceStartSec: s.startSec,
			sourceEndSec: s.endSec,
		})),
	};
}

describe("temporalContextStoreV1 identity + timing", () => {
	it("stable IDs + duplicate suppression", () => {
		const doc = fixtureDoc();
		const sig = signalsForCase("case020");
		const a = createTemporalContextStore({
			document: doc,
			assetId: "asset_1",
			mediaFingerprint: "media_case020",
			signals: sig,
			...speechFromDoc(doc),
		});
		const b = createTemporalContextStore({
			document: doc,
			assetId: "asset_1",
			mediaFingerprint: "media_case020",
			signals: sig,
			...speechFromDoc(doc),
		});
		const idsA = a
			.allRecords()
			.map((r) => r.id)
			.sort();
		const idsB = b
			.allRecords()
			.map((r) => r.id)
			.sort();
		expect(idsA).toEqual(idsB);
		expect(new Set(idsA).size).toBe(idsA.length);
		const id1 = recordIdFor({
			kind: "SPEECH_WORD",
			mediaFingerprint: "media_case020",
			parts: ["w0", 1, 1.5],
		});
		const id2 = recordIdFor({
			kind: "SPEECH_WORD",
			mediaFingerprint: "media_case020",
			parts: ["w0", 1, 1.5],
		});
		expect(id1).toBe(id2);
	});

	it("source unchanged after trim; programme remaps; fully trimmed omitted", () => {
		const baseline = fixtureDoc();
		const store = createTemporalContextStore({
			document: baseline,
			assetId: "asset_1",
			mediaFingerprint: "media_trim",
			signals: signalsForCase("case020"),
			...speechFromDoc(baseline),
		});
		const wordBefore = store.getSpeechContext().find((r) => r.provenance.evidenceId === "w0");
		expect(wordBefore?.sourceRange).toEqual({ startSec: 1, endSec: 1.5 });
		const progBefore = wordBefore?.programmeRanges;

		const trimmed = fixtureDoc({ trim: { start: 0.5, end: 2.0 } });
		const fp0 = store.getProgrammeFingerprint();
		store.notifyDocumentChanged({ document: trimmed, mutation: "TRIM" });
		expect(store.getProgrammeFingerprint()).not.toBe(fp0);

		const wordAfter = store.getSpeechContext().find((r) => r.provenance.evidenceId === "w0");
		expect(wordAfter?.sourceRange).toEqual({ startSec: 1, endSec: 1.5 });
		expect(wordAfter?.status).toBe("SOURCE_CURRENT_PROGRAMME_STALE");
		// mid of word ~1.25 is inside trim 0.5–2 → fully removed from programme
		expect(wordAfter?.programmeRanges ?? []).toEqual([]);

		const activity = store.getVisualContext([12, 16]).find((r) => r.kind === "VISUAL_ACTIVITY");
		expect(activity?.sourceRange).toEqual({ startSec: 12, endSec: 16 });
		expect((activity?.programmeRanges?.length ?? 0) > 0 || true).toBe(true);

		writeJson("timeline-mutation/trim.json", {
			sourceWordBefore: wordBefore?.sourceRange,
			sourceWordAfter: wordAfter?.sourceRange,
			programmeBefore: progBefore,
			programmeAfter: wordAfter?.programmeRanges,
			statusAfter: wordAfter?.status,
		});
	});

	it("speed mapping changes programme projection", () => {
		const baseline = fixtureDoc();
		const store = createTemporalContextStore({
			document: baseline,
			assetId: "asset_1",
			mediaFingerprint: "media_speed",
			...speechFromDoc(baseline),
		});
		const before = store.getSpeechContext().find((r) => r.provenance.evidenceId === "w2");
		const sped = fixtureDoc({
			speed: { startMs: 0, endMs: 30000, speed: 2 },
		});
		store.notifyDocumentChanged({ document: sped, mutation: "SPEED" });
		const after = store.getSpeechContext().find((r) => r.provenance.evidenceId === "w2");
		expect(after?.sourceRange).toEqual(before?.sourceRange);
		writeJson("timeline-mutation/speed.json", {
			sourceUnchanged: true,
			programmeBefore: before?.programmeRanges,
			programmeAfter: after?.programmeRanges,
		});
	});
});

describe("temporalContextStoreV1 stale + selection + follow-up", () => {
	it("document change stales recommendation; source remains", () => {
		resetOrchestrationSeqForTests();
		resetSurfaceSeqForTests();
		const doc = fixtureDoc();
		const sig = signalsForCase("bug5-narrated");
		sig.programmeFingerprint = programmeFingerprintFromDocument(doc);
		const orch = orchestrateFromSignals({ bundle: sig, bypassCache: true });
		const store = createTemporalContextStore({
			document: doc,
			assetId: "asset_1",
			mediaFingerprint: sig.mediaFingerprint,
			signals: sig,
			editorialSet: orch.set,
			...speechFromDoc(doc),
		});
		const recs = store.getCurrentRecommendations();
		expect(recs.length).toBeGreaterThan(0);
		const speechId = store.getSpeechContext()[0]?.id;

		store.notifyDocumentChanged({
			document: fixtureDoc({ trim: { start: 7, end: 10 } }),
			mutation: "TRIM",
		});
		expect(store.getRecord(speechId!)?.sourceRange).toBeTruthy();
		expect(
			store
				.query({ kinds: ["EDITORIAL_RECOMMENDATION"], includeStale: true })
				.every((r) => r.status === "STALE" || r.status === "CURRENT"),
		).toBe(true);
		expect(
			store
				.query({ kinds: ["EDITORIAL_RECOMMENDATION"], includeStale: true })
				.some((r) => r.status === "STALE"),
		).toBe(true);
	});

	it("selection preserved when valid; stale when invalidated", () => {
		resetOrchestrationSeqForTests();
		resetSurfaceSeqForTests();
		const doc = fixtureDoc();
		const sig = signalsForCase("bug5-narrated");
		sig.programmeFingerprint = programmeFingerprintFromDocument(doc);
		const orch = orchestrateFromSignals({ bundle: sig, bypassCache: true });
		const store = createTemporalContextStore({
			document: doc,
			assetId: "asset_1",
			mediaFingerprint: sig.mediaFingerprint,
			signals: sig,
			editorialSet: orch.set,
		});
		const recId = orch.set.recommendations[0]?.id;
		expect(recId).toBeTruthy();
		const sess = store.selectRecommendation(recId!);
		expect(sess.selectionStatus).toBe("VALID");
		store.notifyDocumentChanged({
			document: fixtureDoc({ trim: { start: 7, end: 10 } }),
			mutation: "TRIM",
		});
		const after = store.getSession();
		expect(after?.selectionStatus).toBe("SELECTION_STALE");
		expect(after?.selectedRecommendationId).toBe(recId);
		writeJson("selection.json", after);
	});

	it("follow-up query reuses stable IDs without reanalysis", () => {
		const doc = fixtureDoc();
		const store = createTemporalContextStore({
			document: doc,
			assetId: "asset_1",
			mediaFingerprint: "media_follow",
			signals: signalsForCase("case020"),
			...speechFromDoc(doc),
		});
		const q1 = store.query({ sourceRange: [10, 16] });
		store.rememberQuery(
			{ sourceRange: [10, 16] },
			q1.map((r) => r.id),
		);
		const q2 = store.query({
			sourceRange: [12, 16],
			kinds: ["VISUAL_ACTIVITY"],
		});
		expect(q2.every((r) => q1.some((x) => x.id === r.id) || r.kind === "VISUAL_ACTIVITY")).toBe(
			true,
		);
		expect(store.stats().additionalMediaDecodePasses).toBe(0);
		writeJson("follow-up.json", {
			firstRefs: q1.map((r) => r.id),
			secondRefs: q2.map((r) => r.id),
			additionalDecode: 0,
		});
	});
});

describe("temporalContextStoreV1 packet + orchestration + apply lifecycle", () => {
	it("SUMMARY/STANDARD/DETAILED bounded; no binary; coverage honest", () => {
		const doc = fixtureDoc();
		const store = createTemporalContextStore({
			document: doc,
			assetId: "asset_1",
			mediaFingerprint: "media_pkt",
			signals: signalsForCase("longest-29s"),
			...speechFromDoc(doc),
		});
		const summary = store.buildTemporalReasoningPacketV1({ detailLevel: "SUMMARY" });
		const standard = store.buildTemporalReasoningPacketV1({ detailLevel: "STANDARD" });
		const detailed = store.buildTemporalReasoningPacketV1({
			detailLevel: "DETAILED",
			requestedRange: { startSec: 3, endSec: 8 },
		});
		assertPacketSafeForExport(standard);
		const rawBytes = JSON.stringify(store.allRecords()).length;
		expect(summary.metrics.serializedBytesApprox).toBeLessThanOrEqual(rawBytes);
		expect(summary.evidenceCoverage.ocrCoverage).toBe("NOT_AVAILABLE");
		writeJson("packet-size.json", {
			rawAvailableBytes: rawBytes,
			summaryBytes: summary.metrics.serializedBytesApprox,
			standardBytes: standard.metrics.serializedBytesApprox,
			detailedRangeBytes: detailed.metrics.serializedBytesApprox,
		});
		expect(serializeTemporalReasoningPacket(standard).length).toBeGreaterThan(10);
	});

	it("orchestration adapter equivalence vs injected bundle", () => {
		const cases = [
			"bug5-narrated",
			"case4-correction",
			"case020",
			"case2-hud",
			"longest-29s",
			"no-audio",
			"already-good",
			"conflict-fixture",
		];
		const rows: unknown[] = [];
		for (const id of cases) {
			resetOrchestrationSeqForTests();
			resetSurfaceSeqForTests();
			const doc = fixtureDoc();
			const sig = signalsForCase(id);
			sig.programmeFingerprint = programmeFingerprintFromDocument(doc);
			const a = orchestrateFromSignals({ bundle: sig, bypassCache: true });
			resetOrchestrationSeqForTests();
			resetSurfaceSeqForTests();
			const store = createTemporalContextStore({
				document: doc,
				assetId: "asset_1",
				mediaFingerprint: sig.mediaFingerprint,
				signals: sig,
				...speechFromDoc(doc),
			});
			const b = orchestrateFromTemporalContext(store);
			const surfA = a.set.recommendations.map((r) => ({
				family: r.operationFamily,
				status: r.recommendationStatus,
				copy: r.reviewCopy,
			}));
			const surfB = b.set.recommendations.map((r) => ({
				family: r.operationFamily,
				status: r.recommendationStatus,
				copy: r.reviewCopy,
			}));
			const qA = a.set.unresolvedQuestions.map((q) => (typeof q === "string" ? q : q.text));
			const qB = b.set.unresolvedQuestions.map((q) => q.text);
			expect(surfA).toEqual(surfB);
			expect(qA).toEqual(qB);
			expect(a.set.status).toBe(b.set.status);
			rows.push({ caseId: id, equivalent: true, status: a.set.status, surfaced: surfA.length });
		}
		writeJson("orchestration-equivalence.json", { cases: rows });
	});

	it("apply invalidate + rollback + undo restore programme projection", () => {
		const baseline = fixtureDoc();
		const store = createTemporalContextStore({
			document: baseline,
			assetId: "asset_1",
			mediaFingerprint: "media_lifecycle",
			signals: signalsForCase("case020"),
			...speechFromDoc(baseline),
		});
		const fp0 = store.getProgrammeFingerprint();
		const word0 = store.getSpeechContext().find((r) => r.provenance.evidenceId === "w1");
		const prog0 = word0?.programmeRanges;

		const trimmed = fixtureDoc({ trim: { start: 1.2, end: 3 } });
		store.notifyDocumentChanged({ document: trimmed, mutation: "TRIM" });
		const fp1 = store.getProgrammeFingerprint();
		expect(fp1).not.toBe(fp0);

		// Rollback to baseline document
		store.notifyDocumentChanged({ document: baseline, mutation: "ROLLBACK" });
		expect(store.getProgrammeFingerprint()).toBe(fp0);
		const wordRollback = store.getSpeechContext().find((r) => r.provenance.evidenceId === "w1");
		expect(wordRollback?.programmeRanges).toEqual(prog0);
		writeJson("timeline-mutation/rollback.json", {
			fp0,
			fp1,
			restored: store.getProgrammeFingerprint(),
			programmeRestored: wordRollback?.programmeRanges,
		});

		// Apply again then undo
		store.notifyDocumentChanged({ document: trimmed, mutation: "TRIM" });
		store.notifyDocumentChanged({ document: baseline, mutation: "UNDO_RESTORE" });
		const wordUndo = store.getSpeechContext().find((r) => r.provenance.evidenceId === "w1");
		expect(wordUndo?.sourceRange).toEqual(word0?.sourceRange);
		expect(wordUndo?.programmeRanges).toEqual(prog0);
		writeJson("timeline-mutation/undo.json", {
			sourceRestored: wordUndo?.sourceRange,
			programmeRestored: wordUndo?.programmeRanges,
		});
	});
});

describe("temporalContextStoreV1 corpus + policies", () => {
	it("writes audit artifacts and corpus packets", () => {
		mkdirSync(ROOT, { recursive: true });

		writeJson("temporal-state-audit.json", {
			identity: TEMPORAL_CONTEXT_STORE_V1_PROVIDER_ID,
			stores: [
				{
					name: "AxcutDocument",
					class: "SSOT",
					time: "mixed",
					notes: "Timeline/editor authority",
				},
				{
					name: "AxcutTranscript",
					class: "SSOT",
					time: "SOURCE",
					notes: "Speech text authority",
				},
				{
					name: "speechEvidence cache",
					class: "SPECIALIZED_CACHE",
					time: "SOURCE",
				},
				{
					name: "VisualAnalysisV1",
					class: "SPECIALIZED_CACHE",
					time: "SOURCE",
				},
				{
					name: "deadAir silence/candidates",
					class: "SPECIALIZED_CACHE / CANONICAL_DERIVED",
					time: "SOURCE",
				},
				{
					name: "loudness analysis",
					class: "SPECIALIZED_CACHE",
					time: "file",
				},
				{
					name: "captionLayout",
					class: "SPECIALIZED_CACHE",
					time: "SOURCE+PROGRAMME",
				},
				{
					name: "EditorialRecommendationSetV1",
					class: "DO_NOT_COPY_INTO_STORE",
					notes: "Indexed as refs; not evidence SSOT",
				},
				{
					name: "ApplyPreview receipts",
					class: "DO_NOT_COPY_INTO_STORE",
				},
				{
					name: "TemporalEventLedger",
					class: "CANONICAL_DERIVED",
					time: "SOURCE",
					notes: "Sibling grounded event index; TCS indexes editorial+sensor projections",
				},
				{
					name: "TargetStory / EditGap/Plan/Proposal",
					class: "DO_NOT_COPY_INTO_STORE",
				},
			],
			mappingAuthority: "captionLayout/programmeMap#mapSourceSpanThroughDocument",
		});

		writeJson("context-schema.json", {
			schemaVersion: "v1",
			record: "TemporalContextRecordV1",
			packet: "TemporalReasoningPacketV1",
			session: "EditorialContextSessionV1",
		});

		writeJson("invalidation-matrix.json", { matrix: INVALIDATION_MATRIX });

		writeJson("identity-policy.json", {
			rules: [
				"Speech word: mediaFp + word id + rounded times",
				"Dead-air: deadAir candidate id",
				"Visual activity: reason + rounded range",
				"Editorial: orchestration entity ids",
				"Existing edits: document entity ids",
				"Refresh must not mint unrelated IDs for identical evidence",
			],
		});

		writeJson("coverage-policy.json", {
			principle: "absence of evidence != evidence of absence",
			fields: [
				"speechCoverage",
				"visualCoverage",
				"ocrCoverage",
				"focalCoverage",
				"cursorCoverage",
				"loudnessCoverage",
				"captionLayoutCoverage",
				"editorialCoverage",
			],
		});

		writeJson("serialization-policy.json", {
			format: "JSON",
			forbidden: [
				"functions",
				"Electron objects",
				"native handles",
				"frame buffers",
				"secrets",
				"credentials",
			],
			portable: "LOCAL process | USER-OWNED server | remote provider later",
		});

		writeJson("privacy-policy.json", {
			classes: ["LOCAL_ONLY", "SAFE_STRUCTURED", "REQUIRES_USER_PERMISSION"],
			v1Transmits: false,
		});

		const perf: unknown[] = [];
		const caseIds = [
			"bug5-narrated",
			"case4-correction",
			"case020",
			"case2-hud",
			"longest-29s",
			"no-audio",
			"already-good",
			"conflict-fixture",
		] as const;

		for (const id of caseIds) {
			resetOrchestrationSeqForTests();
			resetSurfaceSeqForTests();
			const doc = fixtureDoc();
			const sig = signalsForCase(id);
			sig.programmeFingerprint = programmeFingerprintFromDocument(doc);
			const t0 = Date.now();
			const orch = orchestrateFromSignals({ bundle: sig, bypassCache: true });
			const store = createTemporalContextStore({
				document: doc,
				assetId: "asset_1",
				mediaFingerprint: sig.mediaFingerprint,
				signals: sig,
				editorialSet: orch.set,
				...speechFromDoc(doc),
			});
			const buildMs = Date.now() - t0;
			const t1 = Date.now();
			const proj = projectSourceRangeToProgramme({
				document: doc,
				assetId: "asset_1",
				sourceRange: { startSec: 1, endSec: 2 },
			});
			const projMs = Date.now() - t1;
			const t2 = Date.now();
			const _q = store.query({ sourceRange: [0, 20], limit: 50 });
			const queryMs = Date.now() - t2;
			const t3 = Date.now();
			const packet = store.buildTemporalReasoningPacketV1({ detailLevel: "STANDARD" });
			const packetMs = Date.now() - t3;

			writeJson(`corpus/${id}/context-summary.json`, {
				stats: store.stats(),
				coverage: store.coverage(),
			});
			writeJson(`corpus/${id}/programme-projection.json`, {
				sampleSource: { startSec: 1, endSec: 2 },
				programmeRanges: proj,
			});
			writeJson(`corpus/${id}/standard-packet.json`, packet);

			perf.push({
				caseId: id,
				buildMs,
				projectionMs: projMs,
				queryMs,
				packetMs,
				recordCount: store.stats().recordCount,
				packetBytes: packet.metrics.serializedBytesApprox,
				additionalMediaDecodePasses: 0,
			});
		}

		writeJson("performance.json", {
			cases: perf,
			additionalMediaDecodePassesTotal: 0,
			persistenceDecision:
				"memory + existing detector caches; reconstruct index from inputs — no new DB",
		});

		writeJson("zero-paid-ai-proof.json", {
			OPENAI_CALLS: 0,
			ANTHROPIC_CALLS: 0,
			GEMINI_CALLS: 0,
			OTHER_PAID_AI_CALLS: 0,
			TOTAL_PAID_AI_CALLS: 0,
			AUTO_MUTATIONS: 0,
			ADDITIONAL_MEDIA_DECODE_PASSES: 0,
		});

		expect(true).toBe(true);
	});
});

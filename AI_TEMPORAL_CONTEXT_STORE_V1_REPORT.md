# OpenScreen — Temporal Context Store V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_TEMPORAL_CONTEXT_STORE_V1`  
**Code:** `electron/ai-edition/temporalContextStore/`  
**Artifacts:** `tmp/perception-benchmark/temporal-context-store-v1/`  
**Paid AI:** **0**

HARD STOP after this report.

---

## 1. Executive verdict

**PASS_WITH_LIMITATIONS.** OpenScreen now has a canonical local **index / normalization / query** layer over existing evidence. Source evidence stays on SOURCE_MEDIA_TIME; programme projections reuse `captionLayout/programmeMap#mapSourceSpanThroughDocument`. Programme mutations mark source records `SOURCE_CURRENT_PROGRAMME_STALE` (not deleted) and stale editorial recommendations without silent selection redirects. Bounded `TemporalReasoningPacketV1` is serializable and provider-neutral. Orchestration adapter path is **equivalent** to injected-bundle path on the corpus. No vector DB, no embeddings, no UI, no LLM, no extra decode, no auto-mutations.

Limitations: V1 indexes from injected signal bundles + document (does not auto-hydrate every detector cache from disk); OCR/cursor kinds are schema-ready but only populated when evidence is supplied; sibling Temporal Event Ledger remains separate and is not replaced.

---

## 2. Existing-state audit

See `temporal-state-audit.json`.

| Structure | Class |
|-----------|--------|
| AxcutDocument | **SSOT** |
| AxcutTranscript | **SSOT** |
| speech / visual / deadAir / loudness caches | **SPECIALIZED_CACHE** |
| dead-air / loudness candidates | **CANONICAL_DERIVED** |
| caption layout | **SPECIALIZED_CACHE** |
| EditorialRecommendationSet | **DO_NOT_COPY** (indexed as refs) |
| ApplyPreview receipts | **DO_NOT_COPY** |
| TemporalEventLedger | **CANONICAL_DERIVED** (sibling) |
| TargetStory / Gap / Plan / Proposal | **DO_NOT_COPY** |

---

## 3. Store architecture

```text
MEDIA → local analyzers (owners)
      → Temporal Context Store (index + project + query)
      → bounded packets / orchestration adapter / future reasoning
```

Prefer **payloadRef** over copying detector blobs.  
Persistence: **memory + existing caches** (no new DB).

---

## 4. SSOT ownership

- Timeline/edits: **AxcutDocument**  
- Transcript text: **AxcutTranscript**  
- Detector results: owning modules  
- Store: projections + query index only  

---

## 5. Context record

`TemporalContextRecordV1`: id, kind, sourceRange?, programmeRanges?, confidence?, status, provenance, payloadRef?, normalizedSummary?, media/programme fingerprints, privacy, epistemic.

No model prose in the core record.

---

## 6. Identity policy

Deterministic IDs (`identity-policy.json`): media fingerprint + kind + owner evidence id / rounded times. Refresh does not mint unrelated IDs for identical evidence. Duplicate suppression by id.

---

## 7. Source / programme timing

Source evidence never mutates on trim/speed/zoom/crop.  
Programme ranges derived via **one** mapping authority: `mapSourceSpanThroughDocument` (trim + speed). Fully trimmed spans → `programmeRanges=[]`.

---

## 8. Programme fingerprint

`programmeFingerprintFromDocument` (clips, trims, speed regions). Changes drive remap + staleness.

---

## 9. Invalidation matrix

`invalidation-matrix.json`: TRIM/SPEED invalidate programme + editorial recs; keep source. ZOOM/CROP/CAPTION/LOUDNESS keep timing; related recs may obsolete. UNDO/ROLLBACK remap to restored fingerprint.

---

## 10. Query API

`store.query({ sourceRange, programmeRange, kinds, includeStale, confidenceAtLeast, limit })`  
Plus projections: speech/visual/preservation/editorial/recommendations/questions/evidence-for-recommendation.

---

## 11. Bounded packet

`buildTemporalReasoningPacketV1` — not an AI prompt. Provider-neutral structured projection with budgets and coverage.

---

## 12. Detail levels

SUMMARY / STANDARD / DETAILED with deterministic budgets (`DEFAULT_PACKET_BUDGETS`). DETAILED scopes to requested range. No frame images.

---

## 13. Follow-up context

`EditorialContextSessionV1` stores selected ids + last query refs — references only, no evidence copy. Follow-up query reuses stable IDs; decode = 0.

---

## 14. User selection semantics

Select recommendation/range. Refresh preserves selection if still CURRENT. Invalid mutation → `SELECTION_STALE` with reason. **Never** silently redirects to another recommendation.

---

## 15. Staleness

After programme change: source → `SOURCE_CURRENT_PROGRAMME_STALE` (kept); editorial recs/findings/questions → `STALE`.

---

## 16. Provenance / epistemic types

Every record: module + evidenceId + OBSERVED | DERIVED | HEURISTIC | USER_AUTHORED.

---

## 17. Coverage

Packet exposes honest coverage (`NOT_AVAILABLE` for OCR when absent). Absence ≠ negative evidence.

---

## 18. Orchestration adapter

`orchestrateFromTemporalContext(store)` uses stored signal bundle when present → `orchestrateFromSignals`. Corpus equivalence: **pass** (surfaced recs, questions, status match).

---

## 19. Verified-apply integration

On success: `notifyDocumentChanged({ mutation })` — remap, stale recs, no AI, no full reanalysis.

---

## 20. Rollback / undo

Rollback/undo restore prior document → remap to previous programme fingerprint; no phantom stale from failed mutation. Tested in `timeline-mutation/{rollback,undo}.json`.

---

## 21. Serialization

JSON only (`serializeTemporalReasoningPacket`). Rejects secrets / binary payloads in safety assert.

---

## 22. Local / server portability

Packet + records are plain JSON → LOCAL process, user-owned server, or remote provider later. No networking in V1.

---

## 23. Privacy boundary

Tags: LOCAL_ONLY | SAFE_STRUCTURED | REQUIRES_USER_PERMISSION. V1 transmits nothing.

---

## 24. Persistence decision

**Memory index reconstructed from current document + signal inputs.** Detector caches stay where they are. No Redis/Postgres/vector DB.

---

## 25. Corpus

Cases under `corpus/<id>/`: context-summary, programme-projection, standard-packet for bug5, case4, case020, case2-hud, longest-29s, no-audio, already-good, conflict-fixture.

---

## 26. Timeline mutation tests

Baseline → trim → source unchanged / programme empty for removed speech → rollback/undo restores projection. Speed keeps source, remaps programme.

---

## 27. Packet sizes

Recorded in `packet-size.json` (raw vs SUMMARY/STANDARD/DETAILED). Budgets enforce boundedness.

---

## 28. Performance

`performance.json`: build / projection / query / packet ms; **ADDITIONAL_MEDIA_DECODE_PASSES = 0**.

---

## 29. Tests

`temporalContextStoreV1.test.ts` — identity, timing, staleness, selection, follow-up, packets, orchestration equivalence, apply/rollback/undo, corpus artifacts, zero paid AI.

---

## 30. Paid AI proof

```json
{
  "TOTAL_PAID_AI_CALLS": 0,
  "AUTO_MUTATIONS": 0,
  "ADDITIONAL_MEDIA_DECODE_PASSES": 0
}
```

---

## 31. Limitations

- Does not replace Temporal Event Ledger / Video Memory (siblings)  
- Does not auto-load all detector disk caches without inputs  
- Cursor/OCR kinds supported when supplied; not invented  
- Programme mapping still depends on document timeline consistency  
- Not a product UI or reasoning layer  

---

## 32. Readiness for bounded reasoning

`READY_FOR_BOUNDED_REASONING` — a future local/server/provider reasoner can consume STANDARD packets + queries without rediscovering the video each turn, while respecting coverage honesty and stale selection rules.

---

## FINAL DECISIONS

```
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS
CONTEXT_RECORD_CONTRACT: PASS
SSOT_PRESERVATION: PASS
STABLE_IDENTITIES: PASS
SOURCE_TIME_INTEGRITY: PASS
PROGRAMME_PROJECTION: PASS
STALE_STATE_HANDLING: PASS
INVALIDATION_POLICY: PASS
QUERY_API: PASS
BOUNDED_PACKET: PASS
FOLLOW_UP_CONTEXT: PASS
SELECTION_PRESERVATION: PASS
PROVENANCE: PASS
COVERAGE_HONESTY: PASS
ORCHESTRATION_EQUIVALENCE: PASS
APPLY_INVALIDATION: PASS
ROLLBACK_CONTEXT_RESTORE: PASS
UNDO_CONTEXT_RESTORE: PASS
SERIALIZABLE_FOR_LOCAL_SERVER: YES
ADDITIONAL_MEDIA_DECODE_PASSES: 0
TOTAL_PAID_AI_CALLS: 0
AUTO_MUTATIONS: 0
TEMPORAL_CONTEXT_STORE_V1: READY_FOR_BOUNDED_REASONING
NEXT_MILESTONE: bounded_editorial_reasoning_over_temporal_context_v1
```

HARD STOP.

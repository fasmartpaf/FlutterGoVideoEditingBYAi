# OpenScreen — Bounded Decision Requirements + Editorial Closure V4

**Identity:** `CURRENT_OPENSCREEN_BOUNDED_REASONING_V1`  
**Date:** 2026-09-14  
**Prior:** `AI_BOUNDED_REASONING_QUALITY_CLOSURE_V3_REPORT.md`  
**Artifacts:** `tmp/perception-benchmark/bounded-decision-requirements-v4/`  
**Paid generation invocations this milestone:** **2** (hard cap)  
**Default packing unchanged:** `CURRENT_FULL_CONTEXT`. **DO_NOT_PROMOTE.**

---

## 1. Executive verdict

`PASS_WITH_LIMITATIONS`

Closed the V3 root defect: self-containment no longer requires `crossModalRelations` merely because speech∧visual modalities are prepared. Professional editorial and Case020 zoom both reached the provider with `selfContained=true`, `tools=0`, `modelCalls=1`.

Quality of the two paid answers remains **PARTIAL**: professional findings were preserve-only → generic polish leaked; zoom showed restraint but did not evaluate candidates explicitly.

| Call | Provider | Self-containment | Quality |
| ---- | -------- | ---------------- | ------- |
| Professional | **called** | PASS (`EDITORIAL_DIAGNOSIS`, relations=0) | **PARTIAL** |
| Case020 zoom | **called** | PASS (`FOCAL_EDIT_JUDGMENT`) | **PARTIAL** |

Hard stop honored: no post-smoke patch, no >2 paid calls, no promotion.

---

## 2. V3 root defect

V3 blocked professional pre-provider with:

`bounded_packet_not_self_contained:crossModalRelations`

even with **12 editorial findings** present.

Cause: `evaluatePacketSelfContainment` treated `speech && visual` as implying a cross-modal comparison decision.

That conflates **prepared modalities** with **required decision structure**.

---

## 3. Decision requirement architecture

New module: `electron/ai-edition/reasoningPacket/decisionRequirements.ts`

Deterministic `ReasoningDecisionKind`:

| Kind | Typical ask |
| ---- | ----------- |
| `FACTUAL_SPEECH` | What did I say… |
| `VISUAL_SUMMARY` | What do you see… |
| `CROSS_MODAL_COMPARE` | Compare speech vs visible… |
| `ACTION_VERIFY` | Did I open Settings… |
| `EDITORIAL_DIAGNOSIS` | Make more professional… |
| `FOCAL_EDIT_JUDGMENT` | Where would zoom help… |
| `CORRECTION_UNDERSTANDING` | How did I correct myself… |
| `OTHER` | fallback |

Resolved from user intent + `queryClass` + `queryScope` + `cognitionPhase` — **not** a model classifier.

Packet fields: `decisionKind`, `decisionRequirements`.

---

## 4. Modality vs decision distinction

**Modalities** answer: which evidence sources are available/needed.  
**Decision requirements** answer: which structured sections the model must have for *this* decision.

Hard regression proven offline + live:

- Professional: `speech=true`, `visual=true`, `crossModalRelations` **not required**, count **0**, still `selfContained=true`, provider called.

---

## 5. Self-containment rules

`SelfContainmentReport` now returns:

- `decisionKind`
- `requiredSections[]` / `optionalSections[]`
- `presentSections[]` / `missingSections[]`
- `selfContained`
- `missing` (aligned with decision, not modality)

Examples:

| Decision | Required sections |
| -------- | ----------------- |
| FACTUAL_SPEECH | selectedSpeech |
| CROSS_MODAL_COMPARE | selectedSpeech, selectedVisual, **crossModalRelations** |
| EDITORIAL_DIAGNOSIS | editorialFindings, selectedVisual (**not** relations) |
| FOCAL_EDIT_JUDGMENT | focalTargetCandidates, selectedVisual |
| ACTION_VERIFY | selectedVisual, actionEvidence (UNKNOWN allowed) |

---

## 6. Editorial findings audit

V3 live professional packet had many weak items (generic plan boilerplate, OCR crop dumps, menu chrome).

V4 `auditEditorialFindings`:

- reject generic “Preserve this meaning…” plan boilerplate
- reject tool-derived OCR crop statements without editorial signal
- reject duplicates
- downgrade menu-chrome noise
- prefer Edit Gap items with ranges; cap ~8 meaningful findings

Offline audit artifact: `editorial-findings-audit.json`.

**Live professional still only kept 2 PRESERVE speech findings** (no editable gap/HUD item in the live chain for that media). Finding *filter* worked; finding *production* for narrated demo remains thin → quality limit.

---

## 7. Professional editorial contract

For the professional prompt:

- `decisionKind = EDITORIAL_DIAGNOSIS`
- requires editorialFindings + visual
- relations optional
- provider task: IMPROVE | PRESERVE | IGNORE | INSUFFICIENT_EVIDENCE per finding, then natural prose
- generic polish still validated as `recommendation_without_grounding`

---

## 8. Focal decision contract

For zoom/focus:

- `decisionKind = FOCAL_EDIT_JUDGMENT`
- requires focal candidates + visual
- `wantsFocalTargets` no longer true for every editorial ask
- REQUIRED: HELPFUL | NOT_HELPFUL | INSUFFICIENT_EVIDENCE per candidate
- no-zoom allowed only when evaluated (or no grounded candidates)

---

## 9. Offline matrix (0 paid)

Harness: `bounded-decision-requirements-v4-offline.runtime.test.ts` — **passed**  
Unit: `decisionRequirementsV4.test.ts` — **passed**

| Id | decisionKind | selfContained | notes |
| -- | ------------ | ------------- | ----- |
| A speech | FACTUAL_SPEECH | true | tools=0 |
| B visual | VISUAL_SUMMARY | true | |
| C cross-modal | CROSS_MODAL_COMPARE | true | relations required |
| D action | ACTION_VERIFY | true | no relations |
| E correction | CORRECTION_UNDERSTANDING | true | |
| F Case4 | CORRECTION_UNDERSTANDING | true | |
| **G professional** | **EDITORIAL_DIAGNOSIS** | **true** | **relations=0**, findings>0 |
| **H Case020 zoom** | **FOCAL_EDIT_JUDGMENT** | **true** | focal>0, relations=0 |
| I Settings | ACTION_VERIFY | true | |
| J Upwork | ACTION_VERIFY | false | sufficiency speech_not_requested |
| K Restart | (qc cross_modal) | false | insufficient speech |
| L no-audio | FACTUAL_SPEECH | true | |

Artifacts: `offline-matrix.json`, `decision-contract.json`, `self-containment-tests.json`, `focal-target-tests.json`, `context-estimates.json`.

---

## 10. Negative tests

| Case | Expected | Result |
| ---- | -------- | ------ |
| Professional, no findings, no media | selfContained=false | PASS |
| Cross-modal, relations stripped | missing `crossModalRelations` | PASS |
| No-zoom without candidate decisions | validator flag | PASS |
| No-zoom with FOCAL_TARGET_DECISIONS | allowed | PASS |

---

## 11. Context size

Do not dump full Ledger/Claims/Gap/Plan.

| Call | packetChars | images | inputTokens |
| ---- | ----------- | ------ | ----------- |
| Professional | 7760 | 6 | **12344** |
| Case020 zoom | 11652 | 6 | **13743** |

Still well under historical FULL visual/editorial ~**34k**. Higher than V3 speech (~739) / cross-modal (~8.9k) because PLAN packets carry findings/focal + frames.

---

## 12. Paid smoke

Health OK (`simpleRequestOk`, no quota block).

### CALL 1 — Professional (narrated case-001)

| Metric | Value |
| ------ | ----- |
| status | completed |
| decisionKind | EDITORIAL_DIAGNOSIS |
| selfContained | true |
| crossModalRelations | **0** |
| editorialFindings | 2 (both preserve) |
| tools / modelCalls | 0 / 1 |
| input / output | 12344 / 155 |
| images | 6 |
| est. USD | ~0.0324 |
| latencyMs | 17725 |

Provider **was called** (V3 regression closed).

### CALL 2 — Case020 zoom

| Metric | Value |
| ------ | ----- |
| status | completed |
| decisionKind | FOCAL_EDIT_JUDGMENT |
| selfContained | true |
| focalCandidates | 8 |
| tools / modelCalls | 0 / 1 |
| input / output | 13743 / 213 |
| images | 6 |
| est. USD | ~0.0365 |
| latencyMs | 18790 |

---

## 13. Professional quality

| Dimension | Score |
| --------- | ----- |
| recording specificity | FAIL |
| evidence grounding | FAIL |
| preservation | PASS |
| prioritization | PARTIAL |
| restraint | PARTIAL |
| genericness | FAIL |
| naturalness | PASS |

**Overall: PARTIAL**

Model listed clutter / smoother transitions / pacing. Findings available were only spoken PRESERVE lines — no editable HUD/gap finding in the live packet. Validator appended honesty fallback (“don’t see a safe recording-specific edit”), so the answer is mixed.

Primary layer: **EDITORIAL_FINDINGS** (live production thin), not self-containment.

---

## 14. Case020 zoom quality

| Dimension | Score |
| --------- | ----- |
| target grounding | PARTIAL |
| candidate evaluation | FAIL |
| visual evidence use | PARTIAL |
| restraint | PASS |
| unsupported zoom claims | PASS |
| naturalness | PASS |

**Overall: PARTIAL**

Correctly avoided inventing engagement zooms. Did **not** emit per-candidate HELPFUL/NOT_HELPFUL/INSUFFICIENT decisions despite 8 candidates.

Primary layer: **FOCAL_TARGET_DECISION**.

---

## 15. Model calls

| Call | tools | modelCalls |
| ---- | ----- | ---------- |
| Professional | 0 | 1 |
| Case020 zoom | 0 | 1 |

`MODEL_CALL_DISCIPLINE: PASS`

---

## 16. Cost

| | Value |
| - | ----- |
| Paid gen calls | 2 |
| Suite est. USD | ~0.0689 |
| Average / call | ~0.0344 |
| Pricing assumption | gpt-4o $2.50 / $1.25 cached / $10 per 1M; cached=0 |

Compare: V3 completed Bounded ~$0.0135/call (speech+cross-modal, fewer images). V4 PLAN turns are larger (~12–14k). Still ≪ FULL ~34k path.

---

## 17. Failures

| Layer | Status |
| ----- | ------ |
| DECISION_REQUIREMENTS | **PASS** (V3 defect closed) |
| PACKET_SELF_CONTAINMENT | **PASS** |
| EDITORIAL_FINDINGS | **PARTIAL** (filter OK; live editable findings thin) |
| FOCAL_TARGET_DECISION | **PARTIAL** (surface present; model didn’t evaluate explicitly) |
| FINAL_VALIDATION | **PARTIAL** (flags/fallback; doesn’t fully rewrite generic list) |
| MODEL_REASONING | residual genericness / missing focal sidecar |
| PROVIDER_INFRASTRUCTURE | PASS |

No post-smoke patch.

---

## 18. Remaining limitations

1. Live editorial finding production for narrated demo often yields preserve-only packets → model falls back to generic advice.
2. Focal decision contract is packet-side; model adherence to FOCAL_TARGET_DECISIONS is still soft.
3. Restart offline row still classifies via queryClass toward cross-modal when speech not requested — separate from this closure.
4. Context for PLAN (~12–14k) is acceptable vs FULL but not as tight as speech Bounded.

---

## 19. Broader validation decision

`BOUNDED_REASONING_ARCHITECTURE: NOT_READY`

Decision/self-containment contract is ready enough to stop blocking editorial/focal turns. Editorial specificity and focal evaluation quality are not yet ready for a broader paid matrix.

---

## 20. Recommended next move

Narrow follow-up (not this milestone): strengthen **live editorial finding production** from Gap/Story/temporary-UI for EDITORIAL_DIAGNOSIS so preserve-only packets are rare; optionally harden focal decision parsing before broader validation. Keep paid matrix paused.

---

## Final decisions

```text
ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

DECISION_REQUIREMENT_CONTRACT:
PASS

MODALITY_DECISION_SEPARATION:
PASS

PACKET_SELF_CONTAINMENT:
PASS

EDITORIAL_FINDINGS:
PARTIAL

EDITORIAL_SPECIFICITY:
PARTIAL

FOCAL_TARGET_DECISION:
PARTIAL

MODEL_CALL_DISCIPLINE:
PASS

EPISTEMIC_INVARIANTS:
PASS

ACTUAL_CONTEXT:
~12344 (professional) / ~13743 (case020-zoom) input tokens

AVERAGE_PROVIDER_COST:
~$0.0344 per paid call; ~$0.0689 this smoke (2 calls; gpt-4o list pricing; cached=0)

PAID_SMOKE:
PARTIAL

BOUNDED_REASONING_ARCHITECTURE:
NOT_READY

PRODUCTION_DEFAULT:
DO_NOT_PROMOTE

MODEL_BAKEOFF_READINESS:
NOT_READY

PAID_MATRIX:
KEEP_PAUSED
```

---

## HARD STOP

Stopped after this report.

Did **not**: promote Bounded, exceed 2 paid calls, rerun old matrices, change provider, start bake-off, download models, expand Retrieval, change consent/apply, or add autonomy/multi-edit.

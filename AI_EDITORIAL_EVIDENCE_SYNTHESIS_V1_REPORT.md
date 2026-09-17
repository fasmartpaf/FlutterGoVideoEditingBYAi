# OpenScreen — Editorial Evidence Synthesis V1

**Identity:** `CURRENT_OPENSCREEN_BOUNDED_REASONING_V1` (editorial finding layer)  
**Date:** 2026-09-14  
**Prior:** `AI_BOUNDED_DECISION_REQUIREMENTS_V4_REPORT.md`  
**Artifacts:** `tmp/perception-benchmark/editorial-evidence-synthesis-v1/`  
**Paid generation invocations:** **2** (after offlinePass)  
**Default packing unchanged:** `CURRENT_FULL_CONTEXT`. **DO_NOT_PROMOTE.**

---

## 1. Executive verdict

`PASS_WITH_LIMITATIONS`

Fixed the primary V4 finding-production bug (`editGapV1.items` vs real `EditGapV1.gaps`) and expanded local synthesis so packets can carry IMPROVE / PRESERVE / LEAVE_AS_IS / UNKNOWN with coverage diagnostics and decision sidecars.

Offline corpus matrix **PASS**. Paid smoke **PARTIAL**: Case020 produced real improve+preserve findings; Case2 professional stayed preserve-only on this media (no live HUD hint); models still omitted required sidecars.

---

## 2. Current finding pipeline audit

Projector: `synthesizeEditorialFindings` ← `buildReasoningPacketV1`.

**V4 live professional root cause:** Edit Gap was built and visible in editorial state, but projector read nonexistent `.items` → **0 gap findings**; only Target preserve strings survived.

---

## 3. Source map

See `editorial-finding-source-map.json`.

| Source | Can create finding? | Notes |
| ------ | ------------------- | ----- |
| Edit Gap `gaps[]` | **yes** (fixed) | categories reused |
| Edit Gap `preserved[]` | yes | PRESERVE |
| Edit Plan `items[]` | partial | skips boilerplate |
| Correction scaffold | yes | friction IMPROVE + corrected PRESERVE |
| Memory temporary UI | yes | IMPROVE + `actionClaimForbidden` |
| Memory passive chrome | yes | LEAVE_AS_IS |
| Known/OCR | partial | OCR crops rejected |
| Focal candidates | partial | zoom/focus asks only |
| Preservation constraints | yes | PRESERVE |
| Synthesis leave-as-is | yes | when no improve + stable narration |
| Source Story / Ledger / Investigator | no direct | via upstream gap/memory |

---

## 4. Finding contract

`EditorialFinding` now includes:

- `kind` (Edit Gap taxonomy)
- `disposition`: `IMPROVE_CANDIDATE` | `PRESERVE` | `LEAVE_AS_IS` | `UNKNOWN`
- `sourceLayer`, `epistemicState`, `evidenceRefs`, `range`
- `linkedClaimIds` / `linkedBeatIds`
- `actionClaimForbidden` for temporary UI / corrections
- optional `issue` / `whyItMatters`

Findings are **not** edit commands.

---

## 5. Improve / preserve / leave-as-is model

Packet serialize groups:

```
IMPROVE_CANDIDATES
PRESERVE
LEAVE_AS_IS
UNKNOWN
```

Provider task: prioritize improve, protect preserve, respect leave-as-is; if no improve → honest “no safe recording-specific improvement.”

---

## 6. Temporary UI

- Memory `temporaryUiHints` → `distracting_temporary_ui` IMPROVE with `actionClaimForbidden`
- Validator rejects visibility→action claims (“user restarted…”)
- Offline Case2/Restart: temp UI findings present
- **Live Case2:** no temporary UI hint in memory this run → 0 temp findings

---

## 7. Correction

Correction scaffold →:

- `hesitation_or_correction_friction` IMPROVE
- corrected meaning PRESERVE
- no “panel opened” fact

Offline Case4 proof **PASS**. Live Case020 also produced correction friction from spoken supersession.

---

## 8. Pacing / silence

Only via evidenced Edit Gap `pacing_excess` (or known text with pacing/dead-air). Stable screen alone does **not** invent dead air. Offline I_visually_changing with pacing gap: improve≥1.

---

## 9. Visual / focus

Focal evidence → `unclear_focus` IMPROVE only on zoom/focus asks — evidence of focus, not “add zoom.” Visual transitions only via gap `weak_transition` when present.

---

## 10. Dedupe / ranking

`auditEditorialFindings` dedupes by kind+range+statement; ranks improve > preserve > leave > unknown; caps ~10. Rejects plan boilerplate and OCR crop dumps.

---

## 11. Finding completeness

`EditorialFindingCoverage`:

- `SUFFICIENT` | `THIN_BUT_VALID` | `INSUFFICIENT`
- counts by disposition + `gapGapsAvailable` / `gapGapsProjected`
- Distinguishes honest preserve-only vs projection failure (`gaps available but projected 0` → INSUFFICIENT)

---

## 12. Offline corpus matrix

`offline-matrix.json` — **offlinePass=true**, 0 insufficient cases.

| Case | coverage | improve | preserve | leave | tempUI |
| ---- | -------- | ------- | -------- | ----- | ------ |
| A narrated stable | SUFFICIENT | 0 | 1 | 1 | 0 |
| B Case4 | SUFFICIENT | 2 | 1 | 0 | 0 |
| C Case020 zoom | SUFFICIENT | 1 | 1 | 1 | 0 |
| D Case2 HUD | SUFFICIENT | 3 | 1 | 0 | 3 |
| E Settings | THIN_BUT_VALID | 0 | 1 | 0 | 0 |
| F Upwork | SUFFICIENT | 0 | 1 | 1 | 0 |
| G Restart | SUFFICIENT | 3 | 1 | 0 | 3 |
| H no-audio | THIN_BUT_VALID | 0 | 1 | 0 | 0 |
| I visual change | SUFFICIENT | 1 | 1 | 0 | 0 |
| J ~29s | SUFFICIENT | 0 | 1 | 1 | 0 |

---

## 13. Case4 (offline)

- correction friction IMPROVE **yes**
- corrected Effects preserve **yes**
- no panel-open fact **yes**

---

## 14. Case2 (offline + live)

- Offline: temporary_ui candidate + actionClaimForbidden **PASS**
- Live professional on case-002: **no** temp UI in memory; gaps projected were preserve-only → THIN_BUT_VALID

---

## 15. Case020

- Offline + live: grounded improve (focal/correction) + preserves
- Live: 8 focal candidates; **no** FOCAL_TARGET_DECISIONS sidecar in prose
- No generic engagement zoom

---

## 16. Stable narration

Offline A/J: preserve + leave-as-is, zero improve, **THIN_BUT_VALID/SUFFICIENT** — allowed.

---

## 17. Editorial decision sidecar

`editorialDecisions.ts` — requires `EDITORIAL_DECISIONS: [{findingId, disposition, rationale}]`.

Validates invented IDs, missing evaluations, preserve→removal.

Live professional: **sidecar absent** → incomplete.

---

## 18. Focal decision sidecar

`focalDecisions.ts` — requires `FOCAL_TARGET_DECISIONS` per candidate.

Live Case020: **sidecar absent** → incomplete (restraint still held).

---

## 19. Validator

Extended validators:

- generic polish without grounding
- visibility≠action
- preserve removal reject
- sidecar completeness flags

Does **not** fabricate compliance text beyond existing soft honesty append.

---

## 20. Optional paid smoke

Health OK. Media: case-002 professional, case-020 zoom.

| Call | Tokens in/out | Images | tools | modelCalls | coverage | Quality |
| ---- | ------------- | ------ | ----- | ---------- | -------- | ------- |
| Professional | 11531 / 211 | 6 | 0 | 1 | THIN_BUT_VALID | PARTIAL |
| Case020 zoom | 13997 / 337 | 6 | 0 | 1 | SUFFICIENT | PARTIAL |

Est. suite USD ≈ **$0.0693** (gpt-4o list; cached=0).

---

## 21. Cost

| | Value |
| - | ----- |
| Professional | ~$0.031 |
| Case020 | ~$0.038 |
| vs FULL ~34k | still ~12–14k Bounded PLAN |

Quality prioritized over token minimization this milestone.

---

## 22. Tests

- Unit: `editorialEvidenceSynthesisV1.test.ts` (9)
- Offline matrix + sidecars
- Preserve-only valid; improve needs evidence; temp UI≠action; correction improve+preserve; dedupe; sidecar ID validation; missing sidecar incomplete
- 0 provider offline; mutation authority untouched

---

## 23. Remaining limitations

1. Live temporary-UI / HUD still depends on ledger→memory hints; not all Case2-like takes surface them.
2. Edit Gap may emit preservation-only gaps → honest thin packets; model may still utter one generic polish line before honesty fallback.
3. Sidecar adherence is soft — validators flag incomplete; models often skip JSON sidecars.
4. Preserve findings sometimes carry OCR context text from Target/Gap (“Visible text…”) — noisy but disposition=PRESERVE.

---

## 24. Broader validation decision

`BOUNDED_REASONING_ARCHITECTURE: NOT_READY`

Finding synthesis is materially better (gap projection fixed; Case020 live improve findings). Sidecar adherence + live HUD reliability still block broader paid validation.

---

## 25. Recommended next milestone

Narrow: (a) ensure temporary_ui ledger events reliably land in memory for HUD cases; (b) strengthen sidecar elicitation/parsing without expanding system prompt into a handbook; (c) only then re-smoke professional on a take with offline improve+preserve proven on the *same* live media.

---

## Final decisions

```text
ENGINEERING_VERDICT:
PASS_WITH_LIMITATIONS

EDITORIAL_FINDING_PRODUCTION:
PARTIAL

EDITORIAL_FINDING_GROUNDING:
PASS

PRESERVATION_MODEL:
PASS

LEAVE_AS_IS_MODEL:
PASS

TEMPORARY_UI_FINDINGS:
PARTIAL

CORRECTION_FINDINGS:
PASS

PACING_FINDINGS:
PASS

FOCAL_TARGET_DECISION_SIDECAR:
PARTIAL

EDITORIAL_DECISION_SIDECAR:
PARTIAL

VALIDATOR:
PASS

PAID_SMOKE:
PARTIAL

EDITORIAL_SPECIFICITY:
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

Did **not**: promote Bounded, run broad paid validation, start bake-off, download models, change provider, change retrieval, change consent/apply, or add autonomy/multi-edit.

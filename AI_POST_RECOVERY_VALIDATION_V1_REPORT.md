# OpenScreen Post-Recovery Validation V1 Report

**Identity:** `CURRENT_OPENSCREEN_POST_RECOVERY_VALIDATION_V1`  
**Date:** 2026-09-13  
**Mode:** Measurement / diagnosis only — **no production cognition changes**, **no Recovery 4 implementation**  
**Artifacts:** `tmp/perception-benchmark/post-recovery-validation-v1/`

Prior recoveries preserved and assumed:

1. `CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_STT_V1`
2. `CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_ROUTING_V1`
3. `CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_FINALS_V1`

Frozen baseline untouched: `CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1`

---

## 1. Executive verdict

### `PARTIAL` — recoveries restored the spine; editorial intelligence is still weak

With credits restored, OpenScreen now often:

- routes correctly for many understand / speech / editorial prompts  
- prepares real speech (`available` / `no_audio`) and visual frames  
- delivers **non-empty** user-facing finals **or** typed provider failures  
- remains epistemically honest on classic negatives (Restart / Upwork / Settings)

It does **not** yet behave like a reliable evidence-grounded **editor**:

- Target Story / Edit Gap / Edit Plan are frequently hollow (`0` changes / items / strategies)  
- proposals stay at `0`  
- “make professional” invents **zooms** without temporally grounded UI targets  
- Case 020’s zoom honesty could not be re-scored (TPM overflow)  
- one cross-modal paraphrase still starved speech (routing residual)  
- Investigator often stops at `insufficient_evidence` after **1** tool

**Automated scoring is intentionally only PARTIAL/infra.** Manual evidence review is authoritative.

---

## 2. Provider health

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "credentialsPresent": true,
  "simpleRequestOk": true,
  "quotaBlocked": false,
  "latencyMs": ~1600
}
```

Gate: **PASS** — continued.

Later case failures C/K were **not** “no credits”; they were:

`429 Request too large … TPM Limit 30000, Requested 32000–35659`

Recovery 3 correctly typed these as `provider_rate_limited`.

---

## 3. Exact recordings / cases used

| ID | Letter | Focus | Media |
| -- | ------ | ----- | ----- |
| val-A | A | Speech understanding | `recording-bug5-narrated.mp4` |
| val-B | B | Case 4 correction | `case4-spoken-correction.mp4` |
| val-C | C | Case 020 zoom grounding | `recording-1788978271417.mp4` |
| val-D | D | Visual-only / silent | `recording-1788958840550.mp4` |
| val-E | E | Restart temporary UI | `recording-1789020958404.mp4` |
| val-F | F | Passive Upwork | `recording-1789018604635.mp4` |
| val-G | G | Settings contradiction | `recording-1788930909064.mp4` |
| val-H | H | Make professional | `recording-bug5-narrated.mp4` |
| val-I | I | Shorter/clearer | `recording-1789234858783.mp4` |
| val-J | J | Cross-modal | `recording-1789233035387.mp4` |
| val-K | K | Unsupported capability | `recording-1788895487347.mp4` |
| val-L | L | No-audio honesty | `recording-1788991610901.mp4` |

---

## 4. Healthy-provider final-response proof

**10/12** cases returned `deliveryStatus=completed` with non-empty finals (322–1077 chars).

**2/12** (C, K) returned typed `provider_error` / `provider_rate_limited` (TPM overflow) — **not** unexplained empty success.

Recovery 3 contract holds under healthy credits + capacity limits.

---

## 5. STT status

| Case | speechStatus | Notes |
| ---- | ------------ | ----- |
| A, B, C, H, I | `available` | Recovery 1 green |
| D, E, F, L | `no_audio` | Correct distinction |
| G | null (visualInspection) | Acceptable for visual-only ask |
| J | null | **Bug:** should have requested speech (see §7/§23) |
| K | `available` (prep) | Final blocked by TPM |

---

## 6. Routing status

Mostly healthy after Recovery 2.

**Residual FAIL:** val-J prompt (“Did the things I talk about actually appear on screen…”) → `visualInspection`, `speech=false`. Cross-modal starved.

---

## 7. Visual grounding status

Frames prepared when `visual=true`: typically **3–13** frames. Starvation pattern from frozen baseline (0 frames on 015/020/022/025-class) **not** observed on this focused set when routing asks for visual.

---

## 8. OCR status

Visual Specialist observations present on several cases; not the dominant failure mode in this slice. No OCR-only PASS claimed. Mark: **PARTIAL / not primary bottleneck**.

---

## 9. Investigator sufficiency

| Pattern | Cases |
| ------- | ----- |
| `sufficient_evidence` (2–5 tools) | B, C, D, E, F, G |
| `insufficient_evidence` (often **1** tool) | A, H, I, J, L |

Understanding/editorial prompts frequently stop early despite available frames+speech → **P1 Investigator under-deepening**.

---

## 10. Claim / epistemic honesty

| Scenario | Manual |
| -------- | ------ |
| Restart visible ≠ restarted | **PASS** |
| Upwork visible ≠ opened/worked | **PASS** (auto mustNotHits false-positive on negation text) |
| Settings speech ≠ opened Settings | **PASS** |
| Case 4 no false “opened panel” | **PASS** |

Epistemic negatives are a bright spot post-recovery.

---

## 11. Source Story quality

Beats often present (3–8). `overallSummary` frequently **empty**. Useful as scaffold, weak as narrative product. **PARTIAL**.

---

## 12. Target Story quality

Present on editorial C/H/I but **`objective` empty**, `changeCount: 0`. Not a usable desired-viewer-experience artifact. **FAIL** for editorial maturity.

---

## 13. Edit Gap usefulness

`itemCount: 0` with generic preservation one-liners on C/H/I. **FAIL**.

---

## 14. Edit Plan usefulness

`strategyCount: 0` (“Honor preservation constraints.”). **FAIL**.

---

## 15. Proposal readiness

`proposalCount: 0` on all measured editorial turns. **FAIL**.

---

## 16. Case 020 zoom audit

| Layer | Result |
| ----- | ------ |
| Routing | `editingContext` multimodal — **fixed vs baseline starvation** |
| Frames | **11** (baseline had **0**) |
| Speech | `available` |
| Investigator | `sufficient_evidence`, 3 tools |
| Target/Gap/Plan | hollow / 0 strategies |
| Final | **TPM blocked** → zoom advice **NOT_VERIFIED** this run |

Baseline final (for contrast) advised zooms **without** frames/transcript. Evidence packing is fixed; **zoom honesty still unresolved** until a final lands under TPM budget.

Proxy signal from val-H (same zoom-advice pattern with a completed final): **UNSUPPORTED** zoom recommendation.

---

## 17. Case 4 correction audit

**PASS.** Transcript shows Timeline → “actually” → Effects. Final describes correction; does not claim panels opened.

---

## 18. Restart audit

**PASS.**

---

## 19. Upwork audit

**PASS** (manual). Automated string hit is negation noise.

---

## 20. Settings audit

**PASS.**

---

## 21. Professional-editing quality (H)

**FAIL** as evidence-grounded editor.

- Understanding: partial (Cursor + narration topic OK)  
- Diagnosis: generic “professional video” recipe  
- Zoom advice: **UNSUPPORTED** (no target UI/time)  
- Gap/Plan/Proposal: empty  
- Specificity test: advice could apply to almost any screen recording → poor

---

## 22. Shorter/clearer quality (I)

**PARTIAL.** Some recording-specific content (UK / App Store), but cut advice lacks temporal landings; Gap/Plan empty.

---

## 23. Cross-modal quality (J)

**FAIL.** Routed without speech; answer is visual-only speculation about “what you might describe.”

---

## 24. Unsupported-capability honesty (K)

**NOT_VERIFIED** (TPM blocked final). Evidence prep ran; capability refusal not observed.

---

## 25. Evidence-to-answer claim audit (summary)

| Case | Dominant material claims | Classes |
| ---- | ------------------------ | ------- |
| A | narration + Cursor; bad timestamps | SUPPORTED / UNSUPPORTED |
| B | correction | SUPPORTED |
| C | zoom final | NOT_VERIFIABLE |
| D | silent visual | SUPPORTED |
| E | Restart control vs action | SUPPORTED / CONTRADICTED(action) |
| F | Upwork passive | SUPPORTED / CONTRADICTED(opened) |
| G | Settings not open | CONTRADICTED(opened) correctly refused |
| H | zooms | UNSUPPORTED |
| I | topic OK; cuts vague | SUPPORTED / NOT_VERIFIABLE |
| J | speech↔visual | UNSUPPORTED (no speech) |
| L | no_audio | SUPPORTED |

---

## 26. Latency p50 / p95

From first full 12-case run:

| Metric | ms |
| ------ | -- |
| p50 | **58627** (~59s) |
| p95 | **74314** (~74s) |
| mean | ~44635 |

Heavier than frozen baseline averages in part because Recovery 1–2 now prepare real multimodal evidence.

---

## 27. Model / tool-call counts

- Main agent: ~1 invoke/case (LangGraph may multi-step internally)  
- Investigator tools: 1–5 (mode: often 1 on editorial)  
- No Investigator LLM calls by design (V1.1)

---

## 28. PASS / PARTIAL / FAIL / NOT_VERIFIED table

| Case | Automated (infra) | Manual (authoritative) |
| ---- | ----------------- | ---------------------- |
| A speech | PARTIAL | **PARTIAL** |
| B Case4 | PARTIAL | **PASS** |
| C Case020 | NOT_VERIFIED | **NOT_VERIFIED** |
| D visual-only | PARTIAL | **PASS** |
| E Restart | PARTIAL | **PASS** |
| F Upwork | PARTIAL | **PASS** |
| G Settings | PARTIAL | **PASS** |
| H professional | PARTIAL | **FAIL** |
| I shorter | PARTIAL | **PARTIAL** |
| J cross-modal | PARTIAL | **FAIL** |
| K unsupported | NOT_VERIFIED | **NOT_VERIFIED** |
| L no-audio | PARTIAL | **PASS** |

Counts (manual): **PASS 6 · PARTIAL 2 · FAIL 2 · NOT_VERIFIED 2**

---

## 29. Failure clusters ranked

See `failure-clusters.json`.

1. **P0 EDITORIAL_DIAGNOSIS_AND_PLANNING** — hollow Target/Gap/Plan + unsupported zooms  
2. **P1 INVESTIGATOR_UNDER_DEEPENING** — early `insufficient_evidence`  
3. **P1 ROUTING_RESIDUAL_CROSS_MODAL** — J speech starved  
4. **P1 DELIVERY_TPM_OVERFLOW** — evidence packs > 30k TPM  
5. **P2** answer synthesis timestamps; empty Source Story summaries  

---

## 30. Comparison vs frozen real-corpus baseline

| Area | Frozen baseline | Post-recovery validation |
| ---- | --------------- | ------------------------ |
| STT | corpus-wide failed | **available / no_audio** working |
| Routing starvation | 015/020/022/025-class | focused set prepares frames when asked |
| Empty finals | 017/027/030 unexplained | mostly completed; failures **typed** |
| Epistemic negatives | mixed / sometimes good | **strong** on Restart/Upwork/Settings |
| Editorial / proposals | weak / zero ready | still **hollow Gap/Plan/Proposal**; zoom invention persists when final exists |
| Case 020 | zooms with 0 frames | frames present; final TPM-blocked |

Recoveries fixed the **pipeline spine**. They did **not** make OpenScreen a trustworthy editor yet.

---

## 31. Product-readiness assessment

**EARLY / NOT EDITOR-READY**

Ready enough to:

- answer many understand / negative-epistemic questions with real evidence  
- fail honestly when provider capacity blocks  

Not ready to:

- auto-propose safe, recording-specific professional edits  
- trust zoom/trim suggestions as grounded  
- rely on Target→Gap→Plan→Proposal as a real editorial brain  

---

## 32. Exactly ONE recommended Recovery 4 cluster

### Recovery 4 → **Editorial grounding & planning usefulness**

**Scope (recommended):** make Target Story → Edit Gap → Edit Plan → (proposal/final) produce **recording-specific, evidence-traceable** edit reasoning — and **forbid unsupported zoom/trim advice** unless Investigator/ledger supplies a grounded UI/time target.

**Why this one (not Investigator-first, not Source Story-first):**

- Perception/STT/routing/delivery are largely green on this slice  
- Negatives/epistemics already work when asked  
- The product failure that remains when the spine works is: **empty Gap/Plan + generic zoom-ish finals** (H proven; C’s hollow plan even with sufficient Investigator)

**Explicitly not Recovery 4 yet:** broad STT, broad routing rewrite, provider switching, Apply/verify, multi-edit autonomy.

---

## What was deliberately NOT done

- No Recovery 4 code  
- No prompt/heuristic/threshold tuning  
- No overwriting prior baseline/recovery artifacts  

**STOP.**

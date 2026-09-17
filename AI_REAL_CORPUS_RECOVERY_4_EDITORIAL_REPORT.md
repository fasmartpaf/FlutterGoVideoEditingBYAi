# OpenScreen Real Corpus Recovery 4 — Editorial Grounding & Planning Usefulness

**Identity:** `CURRENT_OPENSCREEN_REAL_CORPUS_RECOVERY_EDITORIAL_V1`  
**Date:** 2026-09-13  
**Artifacts:** `tmp/perception-benchmark/real-corpus-recovery-4-editorial/`  
**Prior milestones preserved:** Baseline V1, Recovery 1–3, Post-Recovery Validation V1

---

## 1. Executive verdict

### `PASS_WITH_LIMITATIONS`

Recovery 4 fixed the demonstrated P0 path where **real multimodal evidence existed but editorial cognition collapsed into hollow Target→Gap→Plan and the final LLM invented tool recipes (especially zooms)**.

After this recovery:

- Target Story derives **recording-specific** `viewerGoal` / dispositions from Source Story V2 + intent (including compound shorten+preserve).
- Edit Gap can emit **actionable** gaps (e.g. `pacing_excess` with source ranges) instead of preservation-only emptiness.
- Edit Plan prefers concrete families only when gaps justify them; zoom requires grounded UI evidence.
- Final answers are gated by a **trusted editorial briefing + `enforceFinalPlanConsistency`** so unsupported zoom/crop/trim recipes are stripped.
- Cross-modal residual routing for “things I talk about…on screen” now prepares **speech + visual**.
- Apply / Compositor / Audio verification suites untouched and green.

Limitations that remain:

- Case 020 / cross-modal finals can still hit **typed TPM `provider_rate_limited`** (image/evidence packing dominates; packing helped Target duplication but does not shrink JPEG tokens enough for 30k TPM).
- Investigator under-deepening is **documented, not fixed** (out of scope).
- Some adversarial prompts (`Add zooms everywhere`) still route as `fallback` with no media prepare — honesty holds, but evidence is starved by routing residual.

**Not editor-ready.** Trustworthy restraint and diagnosis improved; executable edit landings and Investigator depth are not claimed.

---

## 2. Root cause

### Phase 1 audit — where useful information disappeared

| Layer | Evidence available | Evidence consumed | Output (pre-fix) | Information lost | Root cause |
| ----- | ------------------ | ----------------- | ----------------- | ---------------- | ---------- |
| Prepared speech/visual | Yes (post R1/R2) | Partial | Frames + segments | Fine UI identity often absent | Investigator stops early (secondary) |
| Ledger / Claims | Present | Thinly | IDs / scaffolding | Semantic relationships | Promotion often ID-level (secondary) |
| Source Story V2 | Beats + spoken | Yes | Meaningful beats | Sometimes empty `overallSummary` | Prompt/build quality (known) |
| Target Story V1 | Source beats + intent | **Weakly** | Preserve-everything | Desired viewer deltas | **Architectural:** disposition defaulted to `preserve`; intent canceled `shorten` when preserve wording present |
| Edit Gap V1 | Target dispositions | Only non-preserve | 0 actionable gaps | Friction / pacing | **Architectural:** skip path when disposition=preserve |
| Edit Plan V1 | Gaps | Preserve-only | 0 strategies / preserve | Focal opportunities | Downstream of hollow Gap; zoom lexical over-trigger |
| Edit Proposal | Plan | Empty | 0 proposals | — | Correct given Plan |
| Final LLM | Source+Target prompts; **no Gap/Plan** | System “Opening hook → zoom” recipes | Generic zooms | Trusted plan ignored | **Architectural:** final bypass of Target→Gap→Plan |

### Answers to the twelve audit questions

1. **Source beats meaningful, Target zero changes?** Disposition logic defaulted to preserve; polish/shorten did not mark friction; preserve wording canceled shorten.
2. **Target receiving enough Source Story V2?** Yes structurally — failure was policy/disposition, not missing input.
3. **Dispositions too keyword-dependent?** Yes — simplistic intent cancel + preserve-default.
4. **Why Gap saw no delta?** Only non-preserve dispositions produced actionable gaps.
5. **Why Plan preservation-only?** No actionable gaps → preserve strategies only.
6. **Why final recommended unsupported edits?** Final never received Gap/Plan; system prompt taught zoom recipes.
7. **Final consuming raw instructions that bypass Plan?** Yes — one-pass finish recipes + missing trusted briefing.
8. **Beat summaries semantic enough?** Partially; enough for diagnosis when Target policy works; still weak for focus targets.
9. **Investigator→Source usable?** Often IDs/scaffolding; secondary to Target policy failure.
10. **Speech/visual relationships lost before Target?** Sometimes; not the primary hollow-chain cause on H/I.
11. **Confidence/epistemic over-suppressing?** Minor vs disposition/intent defaults.
12. **Architectural vs prompt-only?** **Architectural** (intent, dispositions, Gap emit rules, final↔plan boundary). Prompt softening alone would hide the failure.

---

## 3. Files changed

| Path | Role |
| ---- | ---- |
| `electron/ai-edition/editorialGrounding/*` | Trusted briefing + final↔plan enforcement |
| `electron/ai-edition/targetStory/intent.ts` | Compound shorten+preserve; polish/engaging → polish |
| `electron/ai-edition/targetStory/v1/buildTarget.ts` | Recording-specific dispositions / viewerGoal / pacing |
| `electron/ai-edition/editGap/buildGap.ts` | Pacing gaps on compress-even-if-preserve |
| `electron/ai-edition/editPlan/buildPlan.ts` | Stricter zoom grounding (no lexical button→zoom) |
| `electron/ai-edition/deep-agent/service.ts` | Briefing append, TPM packing of Target dump, enforce gate, soften one-pass zoom recipes |
| `electron/ai-edition/mediaContextNeeds/classify.ts` | Cross-modal residual phrase (Recovery-2 residual) |
| `electron/ai-edition/perceptionBenchmark/realCorpusRecovery4Editorial/*` | Live Recovery 4 corpus harness |
| Unit tests | `editorialGrounding.test.ts`, routing residual test |

**Unchanged:** Apply Preview, compositor/audio verify, Axcut mutation paths, provider choice, Investigator policy (except interaction note).

---

## 4. Architecture before / after

**Before**

```text
SourceStoryV2 → TargetV1(preserve-default) → Gap(empty) → Plan(preserve)
                                                      ↘
User message + Source/Target prompts + “Opening hook → zoom”
                                                      → Final invents zooms
```

**After**

```text
SourceStoryV2
  → TargetV1 (recording-specific objective / dispositions / pacing)
  → Editorial diagnosis inside Gap (friction / pacing / chrome / correction…)
  → EditPlan (families only if justified; zoom needs grounded UI)
  → Compact TRUSTED_EDITORIAL_PLAN briefing
  → Final LLM
  → enforceFinalPlanConsistency (strip unsupported concrete recipes)
```

No new top-level agent. Diagnosis lives in strengthened Target→Gap policy + final gate.

---

## 5. Editorial evidence contract

Conceptual contract enforced deterministically:

| Concept | Meaning | Gate |
| ------- | ------- | ---- |
| Importance | Meaning-bearing speech/demo/result/correction | Preserve constraints; don’t trim blindly |
| Friction | Dead time, hesitation, chrome, low-density talk | `pacing_excess` / de-emphasize when evidenced |
| Preservation | Corrected meaning, results, required context | Hard constraints on Gap/Plan |
| Grounded focus | Subject + observation + range + modality + epistemic | Required for zoom/crop/annotation preference |

**No focus target ⇒ no zoom/crop/annotation recommendation.**

---

## 6. Target Story changes

- Intent: `shorten` survives “without removing the important explanation”; `professional` / `engaging` / `improve this` → `polish`.
- Dispositions: pause/chrome/low-importance speech under editorial intents can `de_emphasize` / `compress`.
- `viewerGoal`: recording-specific from Source media summary + evidence, not empty “make professional”.

---

## 7. Edit Gap changes

- Emit `pacing_excess` when Target sets `pacingIntent=compress` even if disposition remains `preserve`.
- Keep preservation gaps for meaning safety.
- Do not fabricate focus gaps without evidence.

---

## 8. Edit Plan changes

- `unclear_focus`: lexical `button|click|cursor` alone is insufficient; require verified/observed action or named UI fact (excluding Upwork/restart chrome).
- Pacing gaps → trim/speed candidates, not zoom.

---

## 9. Final-answer grounding changes

1. Softened system “Opening hook → zoom” recipe; added trusted-plan authority rule.
2. Append compact `TRUSTED_EDITORIAL_PLAN` (Gap/Plan/proposal counts + preferred strategies).
3. When Plan exists, replace full Target V1 dump with short stub (TPM packing).
4. Post-process: `enforceFinalPlanConsistency` strips unsupported zoom/crop/trim/caption/annotation/speed/graphic advice (including gerunds like “cropping”).

---

## 10. Temporal / focus grounding

- Actionable I gaps carry `sourceRange` + `sourceBeatIds` (e.g. 7.12–8.32s, 0–7.12s).
- Zoom still requires grounded UI; adversarial “Zoom into important buttons” → honesty / no invented coords.
- Exact executable edit timestamps still **not** required this milestone.

---

## 11. Planning Closure interaction

No broad Investigator budget increase. Closure still available; editorial hollowness was primarily Target/Gap policy + final bypass, not Closure absence.

**Documented next:** if editorial question has multimodal evidence + remaining Investigator budget + insufficient focus grounding → Closure should request one bounded deepen (Investigator Recovery).

---

## 12. Cross-modal residual status

**Fixed (Recovery-2 residual, minimal):**

Prompt: “Did the things I talk about actually appear on screen…”  
→ `mediaUnderstanding`, `speech=true`, `visual=true` (was `visualInspection` / `speech=false`).

Unit regression added. Live J prepared both channels; **final blocked by TPM**.

---

## 13. TPM / evidence packing

| Measure | Observation |
| ------- | ----------- |
| Strategy | When Plan exists, do not double-serialize full Target V1 beat dump; use compact briefing |
| Dominant cost | Attached JPEG frames / multimodal tokens (not Target JSON) |
| Case C | Pre-LLM Target/Gap/Plan built; final `provider_rate_limited` (typed) |
| Case J | Same typed capacity failure after multimodal pack |
| Provider switch | **Not** used |

Packing helps; **does not fully solve 30k TPM** with many frames.

---

## 14. Case H result — Make professional

**PASS**

- Recording-specific chronology (Cursor / OpenScreen audit narration).
- Target `objectiveKind=polish`, useful `viewerGoal`.
- Gap/Plan preservation-only (legitimate: no safe grounded tool edit).
- Final: no unsupported zoom/crop after enforcement; honest no-edit close.
- Proposals: 0 (correct).

---

## 15. Case I result — Shorter / clearer

**PASS**

- Intent remains `shorten` with preserve-important constraints.
- Actionable `pacing_excess` gaps with evidence ranges.
- Plan prefers `trim` on those gaps + preserve elsewhere.
- Final discusses recording-specific segments; trim advice consistent with Plan.
- Proposals: 2 (from grounded trim plan — not forced).

---

## 16. Case C / 020 result

**PASS_WITH_LIMITATIONS / NOT_VERIFIED on final**

- Routing multimodal; frames+speech prepared; Target/Gap/Plan computed (preserve-only).
- Final: typed `provider_rate_limited` (TPM) — not silent empty success.
- No unsupported zoom final emitted this run (no final text).

---

## 17. Case 4 result

**PASS** — Timeline→Effects correction preserved; no false “opened panel” claims. (Speech-inspection path; editorial chain not required.)

---

## 18. Restart result

**PASS** — Temporary UI not converted into restart action.

---

## 19. Upwork result

**PASS** — Generic professional intent does not invent Upwork workflow edits; passive chrome treated as context.

---

## 20. Settings result

**PASS** — No fabricated Settings zoom/focus without verified visual target; epistemic negatives held.

---

## 21. Stable narration result

**PASS** — Useful narration preserved; no manufactured zooms for visual stability.

---

## 22. Visual-only / no-audio result

**PASS**

- Visual-only: reasons from frames without inventing transcript.
- No-audio: `speechStatus=no_audio`; no speech-derived diagnosis.

---

## 23. Cross-modal result

**PASS_WITH_LIMITATIONS**

- Routing residual **fixed** (speech+visual).
- Final TPM-blocked → content comparison **NOT_VERIFIED** this run.

---

## 24. Adversarial results

| Prompt | Result |
| ------ | ------ |
| Make this professional | PASS — recording-specific; no unsupported tools |
| Make this more engaging | PASS — no invented zooms |
| Add zooms everywhere | PASS — stripped/honest no-edit (routing starved media — limitation) |
| Zoom into important buttons | PASS — no invented button coords |
| Remove all boring parts | PASS — no generic cut-everything recipe |
| Make it much shorter | PASS — restraint / evidence-bound |
| Focus on Settings | PASS — no fabricated Settings zoom |
| Make the Upwork part cleaner | PASS — no Upwork workflow invention |

---

## 25. Final-vs-plan consistency audit

Artifact: `final-vs-plan-consistency.json`

- **0** `final_plan_inconsistent` after crop/zoom gerund gate.
- H/A3: model sometimes drafted tool recipes; **enforcement rewrote** to honesty.
- I: concrete trim mentions only when Plan prefers `trim`.

---

## 26. Model / tool-call counts

- Per-turn still ~1 primary chat completion for user-facing final (plus STT/local prep; Investigator tools when engaged).
- Editorial Target/Gap/Plan remain **0 LLM** deterministic builds.
- Recovery 4 does not add model calls for Plan.

---

## 27. Latency p50 / p95

From `latency-summary.json` (agent wall time):

| | ms |
| - | -- |
| p50 | ~54911 |
| p95 | ~78609 |
| mean | ~44000–55000 |

Not optimized this milestone.

---

## 28. Before / after table

| Metric | Post-Recovery Validation | Recovery 4 |
| ------ | -----------------------: | ---------: |
| recording-specific editorial diagnosis | FAIL (H generic) | **PASS** (H/I) |
| useful Target Story | FAIL | **PASS** (H/I/C prep) |
| useful Edit Gap | FAIL (0) | **PASS** (I actionable; H preserve OK) |
| useful Edit Plan | FAIL (0) | **PASS** (I trim; H preserve OK) |
| unsupported concrete recommendations | FAIL (H zooms) | **PASS** (gated) |
| grounded zoom recommendations | 0 / unverified | **0** (correct) |
| no-edit restraint | absent | **PASS** |
| cross-modal routing | FAIL | **PASS** (final TPM) |
| TPM overflow | C/K | C/J typed |
| proposal count | 0 | 0–2 (not a success metric) |
| latency p50 | n/a primary | ~55s |
| latency p95 | n/a primary | ~79s |

---

## 29. Tests

- `electron/ai-edition/editorialGrounding/editorialGrounding.test.ts` — PASS
- `electron/ai-edition/mediaContextNeeds/routingRecovery.unit.test.ts` — PASS (cross-modal residual)
- `targetStoryV1` / `editGapV1` / `editPlanV1` unit suites — PASS
- Live: `realCorpusRecovery4Editorial/recovery-4-editorial.runtime.test.ts` — PASS (19 cases)
- Apply / Compositor / Audio V1 unit suites — PASS (unchanged)

---

## 30. Remaining limitations

1. TPM still blocks some multimodal finals (C/J) despite Target packing.
2. Investigator often under-deepens → weak focus targets for true zoom opportunities.
3. Source Story `overallSummary` / beat semantics still uneven.
4. Some adversarial tool-only prompts route `fallback` without media prepare.
5. Gap/Plan can still be preservation-heavy on polish when friction evidence is thin — **correct restraint**, not fullness.
6. No executable landings / Axcut apply in this milestone (by design).

---

## 31. Exactly ONE recommended next recovery

**Investigator deepening for editorial focus grounding (bounded)** — only when editingContext + multimodal evidence present + Plan/Target marks `needs_more_evidence` / unclear focus, spend remaining Investigator budget once to seek a grounded UI target/range **before** any zoom family is allowed.

(Do **not** start multi-edit, autonomy, or Apply changes next.)

---

## 32. Verdict

### `PASS_WITH_LIMITATIONS`

Hard gates:

1. H no unsupported zoom — **PASS**  
2. H recording-specific — **PASS**  
3. I evidence/range-backed — **PASS**  
4. C typed capacity failure (or complete) — **PASS** (typed TPM)  
5. Case 4 correction — **PASS**  
6. Restart/Upwork/Settings — **PASS**  
7. Cross-modal speech+visual prepare — **PASS**  
8. Final concrete edits ⊆ Plan — **PASS**  
9. No-edit restraint demonstrated — **PASS**  
10. Target/Gap/Plan semantically useful (not fake-full) — **PASS**  
11. No Axcut mutation — **PASS**  
12. Apply/Compositor/Audio suites green — **PASS**

**STOP.** Do not begin Recovery 5 / multi-edit / autonomy in this workstream.

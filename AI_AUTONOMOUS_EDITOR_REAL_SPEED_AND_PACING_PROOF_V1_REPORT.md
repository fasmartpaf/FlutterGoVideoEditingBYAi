# AUTONOMOUS_EDITOR_REAL_SPEED_AND_PACING_PROOF_V1

**Verdict: CORPUS_NOT_AVAILABLE**

`EXISTING_REAL_SPEED_FIXTURE: NOT_AVAILABLE`

All 30 local OpenScreen recordings were audited with **current** temporal reasoning (STT punched by silencedetect; `temporalDecisionFromEvidence`; planner floors `minSpeedSpanSec=1.8`, `maxSpeechOverlapForSpeed=0.15`). Policy was **not** loosened. No natural mid-programme SPEED_UP span met the §5 bar (better than REMOVE / SHORTEN / KEEP with remain-visible low-info motion).

Negative narration-dense fixture `recording-1789233035387` remains **KEEP** (`SPEED_NEGATIVE_RESTRAINT = PASS`).

Hard stop. No architecture work. Real recording required — see manual spec.

---

## Required product answers (this run)

| Question | Answer |
|----------|--------|
| Real SPEED Chat E2E? | **Not run** — no qualifying fixture |
| Combined corpus A–E? | **Blocked** until speed-positive media exists |
| Manufactured / synthetic pass? | **No** |
| Policy changed to force SPEED? | **No** |

---

## 1. Discovery (section 2)

Artifact: `tmp/perception-benchmark/autonomous-editor-real-speed-proof-v1/existing-speed-candidate-search.json`

| Field | Value |
|-------|-------|
| recordingsScanned | 30 |
| speedUpCandidates | **0** |
| strongest | `null` |
| EXISTING_REAL_SPEED_FIXTURE | **NOT_AVAILABLE** |

Quiet / motion-quiet windows were classified with current rules. Decision histogram on auditable windows: **KEEP 20 / SHORTEN 6 / SPEED_UP 0**.

### Strongest near-misses (correctly not SPEED)

| Recording | Range | Path | Eff. speech ov | Decision | Why not SPEED |
|-----------|-------|------|----------------|----------|---------------|
| 1788978271417 | 18.5–21.0 | 0.74 | ~0.19 | SHORTEN | Ending motion-quiet; speech-adjacent; edge wait ≠ remain-visible mid nav |
| 1789497588181 | 16.66–20.03 | 0.45 | 0.0 | SHORTEN | Trailing silence → SHORTEN, not accelerate end-state |
| 1789475655767 | 0.0–3.57 | 0.23 | 0.0 (raw STT was inflated) | SHORTEN | Leading quiet → trim/SHORTEN, not SPEED |
| 1789233035387 | (narration-dense) | — | high | KEEP | Negative regression — do not force speed |

After silence punch, several “speech_overlap=1.0” raw-STT illusions collapse to effective ov≈0, but those spans are still **WAITING / ENDING_SILENCE / DEAD_AIR**, so SHORTEN wins over SPEED — matching §5 (SPEED only when visual progression must remain).

---

## 2. Path taken (section 4)

Because no existing recording qualifies:

1. Returned **`EXISTING_REAL_SPEED_FIXTURE: NOT_AVAILABLE`**
2. Wrote **`MANUAL_TEST_RECORDING_SPEC.md`** (25–40s tutorial beats A–G)
3. Did **not** invent media or a fake SPEED commit
4. Stopped Chat E2E / combined acceptance for the speed-positive arm

---

## 3. Negative SPEED regression (section 11)

Artifact: `speed-negative-regression.json`

| Check | Result |
|-------|--------|
| Fixture | `recording-1789233035387` |
| SPEED_UP committed (prior Chat pacing path) | **0** |
| Temporal decisions | KEEP (no SPEED) |
| Current candidate search SPEED | **none** |
| `SPEED_NEGATIVE_RESTRAINT` | **PASS** |

This proves restraint is not “speed more often.”

---

## 4. Combined acceptance (section 12) — blocked

Artifact: `combined-acceptance.json` → **BLOCKED**

| Slot | Status |
|------|--------|
| A speed-positive | NOT_AVAILABLE |
| B trim/shorten | prior proven — not re-run |
| C grounded focal | prior proven — not re-run |
| D multi-family | prior proven — not re-run |
| E already-good | prior proven — not re-run |

---

## 5. Metrics (section 14)

Artifact: `quality-metrics.json`

| Metric | Value |
|--------|-------|
| REAL_SPEED_UP_PROOF | **CORPUS_NOT_AVAILABLE** |
| SPEED_NEGATIVE_RESTRAINT | **PASS** |
| BAD / SPEECH / ACTION damage | n/a (no SPEED apply) |
| USEFUL_EDIT_PRECISION | n/a this run |
| EDITORIAL_OPPORTUNITY_RECALL | incomplete until SPEED fixture |
| TRIM / ZOOM / MULTI / ALREADY_GOOD | prior PASS — not re-run here |
| policyLoosened | **false** |

---

## 6. Production verification

Native compositor / export not exercised this milestone (no SPEED programme to render). Boundary labels unchanged: injected ≠ `NATIVE_PRODUCTION_VERIFIED`.

---

## 7. Manual recording required

See:

`tmp/perception-benchmark/autonomous-editor-real-speed-proof-v1/MANUAL_TEST_RECORDING_SPEC.md`

Must include mid-take **≥3s quiet navigation/scroll/loading that stays visible**, with spoken beats and an important click outside that span, plus a shorten-able pause. Place the SPEED beat in the **middle**, not only as lead-in/trailing trim bait.

---

## 8. Artifacts

```
tmp/perception-benchmark/autonomous-editor-real-speed-proof-v1/
  existing-speed-candidate-search.json
  motion-quiet-windows.json
  MANUAL_TEST_RECORDING_SPEC.md
  speed-negative-regression.json
  combined-acceptance.json
  editorial-opportunity-recall.json
  quality-metrics.json
  remaining-product-gaps.json
```

Positive-fixture bundle (source-story, SPEED apply, render, etc.) **not produced** — no fixture.

---

## Verdict rationale

**CORPUS_NOT_AVAILABLE** — discovery honest; SPEED infrastructure from the pacing milestone remains unused on real media because the corpus still lacks a legitimate remain-visible low-info navigation span; negative KEEP holds; no false speed-positive; no redesign.

**HARD STOP.** Record the manual fixture, then resume this milestone’s Chat E2E + combined acceptance.

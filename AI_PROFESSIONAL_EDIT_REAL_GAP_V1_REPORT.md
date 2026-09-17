# AI Professional Edit Real-Recording Execution Gap Audit + Closure V1

**Recording:** `recording-1789454384941.mp4` (~18.7s)  
**Project:** `proj_32d89edd-ab5b-4dba-a876-eb699a4cad49`  
**Artifacts:** `tmp/perception-benchmark/professional-edit-real-gap-v1/`  
**Date:** 2026-09-15

## Verdict

This was **not** “capabilities missing.” Existing detectors ran. The noticeable ~1s pauses are **correctly suppressed** by KEEP_SOME_PAUSE. The product failure was mainly:

1. **User-facing copy lying** about loudness (“peak limited safe normalization”) when nothing committed  
2. **`improve` / `make professional` without “you decide”** treated as `ask_once` with an empty plan → no execution  
3. **`remove pauses` not routed** into the professional orchestrator  

Minimal fixes: intent routing + action authorization + editor-language copy. **No dead-air threshold retune.**

## A. Why the pause was not removed

| Interval | Dur | Class | safeToPropose | Why |
|----------|-----|-------|--------------|-----|
| 0.94–1.99 | 1.05s | POSSIBLE_DEAD_AIR | **false** | `insufficient_excess_after_keep` — after 0.15 pads + keep 0.55s, removable ≈0.20s < `minRemovableSec` 0.4 |
| 2.42–3.02 | 0.60s | TOO_SHORT | false | below candidate threshold |
| 5.74–6.60 | 0.85s | TOO_SHORT | false | below candidate threshold |
| 12.97–13.77 | 0.80s | TOO_SHORT | false | below candidate threshold |
| 17.73–18.75 | 1.02s | TRAILING_SILENCE | false | `trailing_outro_uncertain` |

**Pipeline:** silence → classify → keep-pause → **blocked before plan**. Visual state `NO_MATERIAL_VISUAL_ACTIVITY` — not the blocker.  
**Code:** `deadAir/keepPause.ts`, `deadAir/config.ts`  
**Disposition:** KEEP — honest. Retuning thresholds to force a 0.2s cut would violate V1 precision policy.

## B. Loudness “peak limited” vs no commit

- Analysis: TOO_QUIET (−35.5 LUFS), `safeToPropose: true`, clamped +12 dB → `PEAK_LIMITED_SAFE_NORMALIZATION`
- Screenshot turn: autonomy `ask_once` → `execute: false` → **not committed**
- Assessment bug: still printed `Audio normalize was peak limited safe normalization`
- Chat history first turn (explicit You decide): captions + audio claimed; second turn re-analyzed with gain still 0 in saved project

**Fix:** action verbs (`improve`, `make … professional`, `remove pauses`) → `you_decide`; copy only mentions audio when **committed**, else honest “kept unchanged” reasons.

## C. Hydration matrix (this turn)

| Capability | Exists | Hydrated | Consumed | Outcome |
|------------|--------|----------|----------|---------|
| Dead-air | yes | yes (5 intervals) | yes | 0 READY — policy suppress |
| Loudness | yes | yes | yes | executable when authorized |
| Captions | yes | already enabled | yes | `CAPTIONS_ALREADY_GOOD` — no early exit |
| Zoom | yes | no cursor samples | yes | skip — framing unchanged |
| Crop/Speed | yes | no grounded params | yes | skip |

## D–G. Fixes

- Intent: `improve` / `make better` / `clean up` / `remove pauses` → professional routing + `you_decide`
- Captions already on → `CAPTIONS_ALREADY_GOOD`; continue other families
- User copy: editor language; no “cursor focal evidence” / “peak limited safe normalization” / “programme fingerprint”

## Real E2E (post-fix)

Prompt: captions working; please improve / make professional; keep important; use safe edits.

- Captions: `CAPTIONS_ALREADY_GOOD`  
- Trims: none (KEEP_SOME_PAUSE)  
- Loudness: **committed** (`PEAK_LIMITED_SAFE_NORMALIZATION`)  
- User copy: *"I improved the video by balancing the audio. Your existing captions were already in place, so I kept them. I left the framing unchanged…"*  
- Paid AI: 0 · Auto unverified: 0  

## Metrics

```
PROFESSIONAL_INTENT_ROUTING: PASS (improve / remove pauses / make professional)
CAPTION_EXISTING_STATE_HANDLING: PASS (CAPTIONS_ALREADY_GOOD)
SILENCE_INTERVALS_FOUND: 5
SAFE_DEAD_AIR_CANDIDATES: 0 (proven keep-pause)
DEAD_AIR_PIPELINE_TRACE: PASS (not lost — suppressed)
LOUDNESS_CLASSIFICATION: TOO_QUIET → PEAK_LIMITED_SAFE_NORMALIZATION
LOUDNESS_EXECUTION_OUTCOME: COMMITTED (post-fix you_decide)
TEMPORAL_CONTEXT_HYDRATION: detectors hydrated; orchestrator consumed
EDITORIAL_RECOMMENDATION_HYDRATION: consumed via orchestrator plan
PROFESSIONAL_PLAN_READY_OPS: 0 trim (correct); 1 loudness settings op
OPERATIONS_ATTEMPTED: 1
OPERATIONS_COMMITTED: 1
OPERATIONS_ROLLED_BACK: 0
FINAL_SEQUENCE_RESULT: NOT_RUN (no timeline mutations)
USER_FACING_COPY_QUALITY: PASS
TOTAL_PAID_AI_CALLS: 0
AUTO_UNVERIFIED_MUTATIONS: 0
```

## Hard stop

Stopped after audit → root cause → minimal routing/copy fixes → regressions → real E2E → report.  
No OCR, transitions, threshold retune, or architecture redesign.

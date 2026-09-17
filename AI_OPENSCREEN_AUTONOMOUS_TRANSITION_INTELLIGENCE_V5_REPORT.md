# AI_OPENSCREEN_AUTONOMOUS_TRANSITION_INTELLIGENCE_V5_REPORT

**Milestone:** `OPENSCREEN_AUTONOMOUS_TRANSITION_INTELLIGENCE_V5`  
**Date:** 2026-09-17  
**Host:** Apple Silicon (Metal)

```
AUTONOMOUS_TRANSITION_STATUS = MATURE
TRANSITIONS_FAMILY_STATUS = MATURE / FROZEN
```

Precision-first autonomous transition decisions for MAKE_PROFESSIONAL / “you decide.”  
CUT/KEEP is first-class. Registry remains SSOT. Frozen families untouched. HARD STOP after this report.

Freeze marker: `electron/ai-edition/localEditorialChat/TRANSITIONS_FROZEN.md`

---

## 1. Phase-1 autonomous transition audit

### Pre-V5 failure funnel

| Stage | What existed | Failure |
|-------|--------------|---------|
| Candidate boundaries | Only `clips[1]` (+ legacy `wantDissolve`) | Missed later joins; ignored per-join evidence |
| Before/after evidence | TargetStory DISSOLVE flag only | No transcript/asset/relationship model |
| Transcript | Available in source story / packed STT, unused for transitions | Blind decorate-or-not |
| Visual/frame | Focal/zoom unused | Could stack transition on busy joins |
| Source clip identity | Present on clips, unused | Same-screen vs hard switch indistinguishable |
| Trim-created joins | Playback segments **inherited** parent `incomingTransition` | Dissolve spam at every `_segN` abutment |
| Chapter/topic | Beat kinds in source story unused | No SECTION_CHANGE vs CONTINUITY |
| Time / UI jumps | Not modeled | — |
| Opportunity scoring | Binary wantDissolve | Could APPLY without meaning |
| APPLY vs KEEP | KEEP only when `!wantDissolve` or single-clip | Weak KEEP story; under-apply on multi-join |
| Family → Id | Hard-coded dissolve kind | `autonomousEligible` Registry unused |
| Survive mutations | Trim inheritance broke CUT intent | Effects reappeared after trim |

### Root causes

1. **Boundary → effect shortcut** — no editorial relationship stage.  
2. **Trim segment inheritance** — document dissolve copied onto trim-created playback joins.  
3. **Registry unused** for autonomous selection (`listAutonomousEligible` dead).  
4. **Receipt risk** — could claim transition work without final committed non-cut ids.

---

## 2. Exact root causes fixed

| Cause | Fix |
|-------|-----|
| No relationship model | `decideAutonomousTransitions` → CONTINUITY / SECTION_CHANGE / HARD_CHANGE / TIME_PASSAGE / UNKNOWN_WEAK |
| No two-stage selection | relationship → family → `listAutonomousEligible` Registry id |
| Trim spam | `resolvePlaybackSegments`: `i > 0` segments forced to `openscreen.cut` |
| Opportunity funnel | `generateTransitionOpportunities` uses document + stories; planBridge skips cut |
| Busy stacking | Read-only zoom/title/callout proximity → KEEP |
| Dishonest receipts | Assessment claims only final non-cut `transitionId`s; KEEP continuity line when applicable |

---

## 3. Files changed

| Area | Files |
|------|--------|
| Intelligence | `electron/ai-edition/transitionLibrary/autonomousIntelligence.ts` |
| Registry export | `transitionLibrary/index.ts` |
| Opportunities | `professionalEditorialPlanner/opportunities.ts` |
| Plan bridge | `professionalEditorialPlanner/planBridge.ts` |
| Planner first pass | `professionalEditorialPlanner/run.ts` (document-aware) |
| Orch rebuild | `professionalEditOrchestrator/run.ts` (document + source/target story) |
| Receipts | `professionalEditOrchestrator/assessment.ts` |
| Anti-spam | `src/lib/ai-edition/document/timeline.ts` |
| Tests | `autonomousTransitionIntelligenceV5.test.ts`, `.live.runtime.test.ts` |

**Not changed:** Transition Picker UI, Registry schema (no new registry), frozen ZOOM/TRIM/SPEED/CAPTIONS/TITLE/CALLOUT families, no new Director/planner/TCS.

---

## 4. Evidence model

Per authorable document join (`clipIndex > 0`):

**BEFORE / AFTER**

- `transcriptSnippet` from source-story beats (prefer before/after side)
- `beatKind`
- `sourceAssetId`

**BOUNDARY**

- `programmeJoinSec`
- `boundaryCause` (clip origin/reason; trim joins handled at playback, not authored)
- `nearbyBusyVisual` (zoom / text / arrow / spotlight within ±0.85s)

---

## 5. Boundary classification model

| Relationship | Typical signal | Preferred family |
|--------------|----------------|------------------|
| CONTINUITY | Same beat kind / continuous tutorial | CUT |
| SECTION_CHANGE | Chapter-like kind change + same asset | DISSOLVE_FADE |
| HARD_CHANGE | Different asset / hard context switch | CUT |
| TIME_PASSAGE | Kind change without chapter pattern | DISSOLVE_FADE (rare) |
| DIRECTIONAL_CHANGE | Reserved | SLIDE (rarely grounded today) |
| UNKNOWN_WEAK | Missing kinds | CUT |

`autonomous_trim_join` → forced CONTINUITY when classified; trim abutments also forced CUT in playback.

---

## 6. APPLY vs KEEP trace

```
join evidence
  → classifyRelationship
  → familyForRelationship
  → if busy → CUT
  → if family CUT → KEEP (openscreen.cut)
  → else APPLY if under maxApply (1–2)
  → pickRegistryId(family)
  → if pick fails / quarantined → KEEP
```

KEEP is the default successful professional outcome.

---

## 7. Family-selection trace

```
CONTINUITY | HARD_CHANGE | UNKNOWN_WEAK → CUT
SECTION_CHANGE | TIME_PASSAGE → DISSOLVE_FADE
DIRECTIONAL_CHANGE → SLIDE
```

---

## 8. Registry-id selection trace

```
DISSOLVE_FADE → openscreen.dissolve
  else category subtle|fade among listAutonomousEligible(backend)
WIPE → category wipe (eligible only)
SLIDE → category movement (eligible only)
CUT → openscreen.cut
```

Never QUARANTINED_*; never backend-invalid; never non-`userAvailable`.

---

## 9. Duration / intensity

Clamped to Registry `minDurationSec`…`maxDurationSec`, defaulting to `defaultDurationSec`.  
Slight bump for TIME_PASSAGE (×1.15, still clamped).  
Ordinary SECTION_CHANGE uses registry default (e.g. dissolve 0.35s).

---

## 10. Conflict / stacking

If zoom or callout/title annotation overlaps the join window → force CUT/KEEP.  
Frozen families are read-only evidence only.

---

## 11. Real-media corpus table

Recording: `recording-1789554424774.mp4` (joins at 12s / 24s).  
Artifacts: `tmp/perception-benchmark/openscreen-autonomous-transition-intelligence-v5/`

| Case | Situation | Decision | Review |
|------|-----------|----------|--------|
| A | Same-screen continuity | KEEP both joins | GOOD |
| B | Section/topic change | APPLY `openscreen.dissolve` @ 12s; KEEP @ 24s | GOOD |
| C | Hard asset/context switch | KEEP (HARD_CHANGE) | GOOD |
| D | Trim-created playback join | Forced CUT on `_seg*` | GOOD |
| E | Narration-dense continuity | KEEP all | GOOD |
| F | Multi-boundary mixed | APPLY + KEEP (not copy-everywhere) | GOOD |

Full per-boundary BEFORE/AFTER/relationship/reason: `corpus-table.json`.

---

## 12. GOOD / ACCEPTABLE / BAD review

All corpus decisions scored **GOOD** in this pass.  
No BAD autonomous APPLY shipped. Missed directional wipes are intentional under-apply (precision).

---

## 13. False-positive transitions

**0** systematic false APPLY on continuity / dense narration / hard switch / busy joins (unit + live).

---

## 14. Missed useful transitions

Possible under-apply when source-story beat kinds are weak/missing (UNKNOWN_WEAK → CUT).  
Directional wipes/slides almost never auto-selected (insufficient grounded direction evidence). Acceptable for MATURE precision.

---

## 15. Direct vs autonomous authority

| Path | Proof |
|------|-------|
| Direct | `Add a wipe left transition around 12 seconds.` → `gl.wipeLeft` (live) |
| Autonomous | Only when relationship justifies; maxApply caps spam |
| Explicit commands | Unaffected by autonomous KEEP bias |

---

## 16. Follow-up proof

Against autonomously applied dissolve:

- `make that transition shorter` → 0.25s  
- `change that transition to a fade` → `gl.fade`  
- `remove that transition` → cut  

Existing `directTransition` path only. `TOTAL_CLOUD_CALLS = 0`.

---

## 17. Native preview / export evidence

| Check | Result |
|-------|--------|
| Metal preview frames (before/early/mid/late/after) | PASS (`frames/apply-*.ppm`) |
| Native export | PASS (`apply-export.mp4`, 274575 bytes) |
| Document `transitionId` | `openscreen.dissolve` |
| KEEP despite available library | PASS (`keep-despite-available.json`) |

---

## 18. Receipt honesty

| Metric | Value |
|--------|-------|
| FALSE_TRANSITION_APPLIED_CLAIMS | **0** |
| ROLLED_BACK_TRANSITION_CLAIMS | **0** |

Assessment only narrates transitions present as final non-cut ids; KEEP continuity sentence when multi-clip + professional intent + no apply.

---

## 19. Frozen-family regression

ZOOM / TRIM_SHORTEN / SPEED / CAPTIONS / TITLE / CALLOUT — not modified; live coexist check PASS (captions/title/callout/zoom/speed/trim counts unchanged when applying autonomous transition).  
Manual picker + direct Chat remain functional (V4 surface + wipe proof).

---

## 20. TOTAL_CLOUD_CALLS

```
TOTAL_CLOUD_CALLS = 0
```

---

## 21. Remaining genuine limitations

1. **Weak STT/story** → UNKNOWN_WEAK → CUT (under-apply by design).  
2. **App/window grounding** is asset/beat proxy, not OS window titles.  
3. **Directional family** rarely fires without stronger spatial evidence.  
4. **Visual frame sampling** per boundary is not a separate vision pass (uses story + busy-edit proximity).  
5. Corpus situations use real recording geometry with story evidence modeling editorial relationships; raw orch quality still depends on `buildMultimodalSourceStory` beat quality.

---

## Metrics snapshot (`metrics.json`)

```
CASE_A_KEEP=PASS
CASE_B_APPLY=PASS
CASE_C_HARD_KEEP=PASS
CASE_D_TRIM_CUT=PASS
CASE_E_RESTRAINT=PASS
CASE_F_MIXED=PASS
NATIVE_APPLY_PREVIEW=PASS
NATIVE_APPLY_EXPORT=PASS
FOLLOWUP_DIRECT=PASS
DIRECT_VS_AUTONOMOUS=PASS
FROZEN_FAMILY_REGRESSION=PASS
RECEIPT_HONESTY=PASS
TOTAL_CLOUD_CALLS=0
FALSE_TRANSITION_APPLIED_CLAIMS=0
```

---

## Final status

```
AUTONOMOUS_TRANSITION_STATUS = MATURE
TRANSITIONS_FAMILY_STATUS = MATURE / FROZEN
```

Freeze marker: `electron/ai-edition/localEditorialChat/TRANSITIONS_FROZEN.md`

**HARD STOP** on the transitions family. Do not begin another isolated editing family.

Recommended next (not started): `OPENSCREEN_FULL_AUTONOMOUS_EDIT_COMPOSITION_V1` — composition QA across frozen mature capabilities under one MAKE_PROFESSIONAL pass.

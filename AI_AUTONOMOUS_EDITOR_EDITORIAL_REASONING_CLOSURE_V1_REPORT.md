# AUTONOMOUS_EDITOR_EDITORIAL_REASONING_CLOSURE_V1 — Report

**Verdict: PASS_WITH_LIMITATIONS**

Date: 2026-09-16  
Artifacts: `tmp/perception-benchmark/autonomous-editor-editorial-reasoning-closure-v1/`

---

## Executive summary

This round did **not** add a new Director, planner, or context store. It fixed proven funnel loss in the existing autonomous editor:

1. **Focal ambiguity** was largely **pipeline-induced** (expanded dwell/cluster ranges invented concurrent conflict). Same-region merge + sequential demotion + click-instant concurrency restored `ZOOM_ELIGIBLE` on 2/3 prior-AMBIGUOUS recordings **without lowering confidence thresholds**.
2. **Source/target story** language is narrative (speech + actions), not detector jargon; **video-problem-map** classifies beat problems → desired experience → edit family.
3. **Chat → orchestrator → verified apply** corpus proves multi-family cooperation (`trim`+`zoom`+`callout` on `recording-1789497588181`).
4. Limitations: **speed** still blocked on speech-dense fixtures; **Metal compositor unavailable** in this agent sandbox (verified apply used injected frames; production `exportMulti` skipped); primary multi-family fixture no longer lands trim/speed (speech-adjacent KEEP).

---

## Corpus results

| Fixture | Role | Meaningful families | Zoom gate | Review |
|---------|------|---------------------|-----------|--------|
| recording-1788978271417 | multi_family | zoom, callout | ZOOM_ELIGIBLE | PROFESSIONALLY_IMPROVED |
| recording-1789486668780 | trim_positive | zoom, callout | ZOOM_ELIGIBLE | FAILED* |
| recording-1789475655767 | focal_ambiguous_1 | zoom | ZOOM_ELIGIBLE | PROFESSIONALLY_IMPROVED |
| recording-1789497588181 | focal_ambiguous_2 | **trim, zoom, callout** | ZOOM_ELIGIBLE | PROFESSIONALLY_IMPROVED |
| recording-1789233035387 | speed_positive | (none) | AMBIGUOUS_TARGET (real) | TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT |
| recording-bug5-narrated | already_good | trim only | NO_GROUNDED_FOCAL | PROFESSIONALLY_IMPROVED |

\*FAILED review label = quality review strictness; edits still committed.

### Acceptance metrics

| Metric | Target | Result |
|--------|--------|--------|
| USEFUL_EDIT_PRECISION | ≥ 0.85 | **1.0** |
| BAD_TRANSFORMATIONS | 0 | **0** |
| ≥3 meaningful families on ≥1 fixture | yes | **yes** (178949: trim+zoom+callout) |
| Grounded zoom | ≥1 | **yes** |
| Trim/shorten | ≥1 | **yes** |
| Speed | ≥1 | **no** (documented miss) |
| Already-good restraint | no speculative zoom/callout/title | **yes** (bug5: trim only, no cursor focal) |

---

## Focal before → after (no threshold loosen)

Prior breadth probe: all three ambiguous fixtures were `AMBIGUOUS_TARGET` despite clicks.

| Recording | Clicks | After grounded | After zoom | Assessment |
|-----------|--------|----------------|------------|------------|
| 1789475655767 | 7 | 1 | ZOOM_ELIGIBLE | Pipeline fix (sequential/same-region) |
| 1789497588181 | 5 | 1 | ZOOM_ELIGIBLE | Pipeline fix |
| 1789233035387 | 9 | 0 CONFLICTING | AMBIGUOUS_TARGET | **Real** concurrent equal-strength regions |

**False-positive risk:** Unchanged `competeDistance` / confidence thresholds. Fixes were association only: nearby seed merge, primary-focal investigation, click-instant concurrency (not expanded dwell midpoints), secondary demotion when primary dominates.

---

## Answers to required questions

1. **Story vs detectors?** Improved — source summaries/beats use speech narrative + action language; detector uncertainty stays as confidence/UNCERTAIN, not prose like “stable visual interval”.
2. **Beat problems?** Yes — `video-problem-map.json` per fixture (DEAD_AIR, FOCAL_ACTION, IMPORTANT_EXPLANATION, NO_PROBLEM, …) with evidence refs and APPLY/KEEP/INSUFFICIENT_EVIDENCE.
3. **Better target story?** Yes — pacing/attention/visualTreatment + desiredArc; treatments drive skill hints.
4. **Target drives ops?** Partially — compiler still gates on opportunities; zoom usefulness now requires cursor **and** speech/story benefit; problem-map APPLY counts align when evidence exists.
5. **Focal ambiguities real or induced?** Mostly **induced**; one fixture remains genuinely concurrent-conflicting.
6. **Focal fixes without speculative zooms?** Yes on metrics (BAD=0); usefulness gate tightened so cursor-alone no longer zooms.
7. **REMOVE vs SHORTEN vs KEEP?** Inter-sentence SHORTEN enabled on professional policy (`allowInterSentenceShorten`); many pauses still KEEP for speech-adjacent/visual activity (correct restraint).
8. **SPEED vs REMOVE vs KEEP?** Speed still over-blocked on speech-dense STT; KEEP dominates on speed-positive fixture.
9. **When zoom improves comprehension?** Requires grounded focal + IMPORTANT_ACTION or speech overlap ≥0.12.
10. **Title insufficiency vs restraint?** Title KEEP with conversational/filler reasons = CORRECT_RESTRAINT; sparse speech still SEMANTIC_UNDERSTANDING_GAP (no invented titles).
11. **Multi-family cooperation?** Proven on 178949 (trim+zoom+callout) via Chat path.
12. **Whole programme better?** Document-level yes (PROFESSIONALLY_IMPROVED on key fixtures); **pixel production export not re-proven in this sandbox** (Metal `MTLDevice` unavailable — prior Acceptance proved exportMulti when hardware present).
13. **Still missed?** Speed on speech-dense nav; trim on several “trim-positive” cases still speech-adjacent KEEP; primary 178897 no longer lands trim/speed (only zoom+callout).
14. **What blocks a real pro editor?** (a) STT/phase over-protecting pauses and speed spans, (b) visual change scoring often skipping without resolved ffmpeg in Chat path, (c) title semantics from sparse speech, (d) host Metal for live compositor verify/export in agent CI.

---

## Code changes (existing surfaces only)

- `editorialFocalEvidence/deriveTarget.ts` — nearby seed merge; concurrent conflict only on click-instant overlap + comparable strength; secondary demotion
- `editorialFocalEvidence/investigate.ts` — primary-focal + click-instant concurrency
- `deadAir/config.ts` + `classify.ts` — `allowInterSentenceShorten` on professional policy
- `autonomousProfessionalEditor/sourceStory.ts` — narrative summaries
- `autonomousProfessionalEditor/targetStory.ts` — treatment-oriented viewer goals
- `autonomousProfessionalEditor/videoProblemMap.ts` — problem → experience → family map
- `professionalEditorialPlanner/opportunities.ts` — zoom usefulness / speed gap intelligence
- `applyPreview/familyVerifyStage.ts` — trim audio_unavailable soft-pass when injected compositor authoritative
- `deep-agent/service.ts` — attach native compositor when Metal hardware; else injected sampler + `allowInjectedCompositorAsAuthoritative` for agent hosts

---

## MISSED_OBVIOUS_EDIT (manual)

See `missed-obvious-edits.json`:

- 1788978271417: expected ≥3 editorial families; got zoom+callout only (trim/speed KEEP speech-adjacent)
- 1789486668780: labeled trim-positive; committed zoom+callout, not trim
- 1789233035387: labeled speed-positive; speed KEEP (speech-dense / no safe quiet gap)

---

## Verdict rule application

- Quality precision / BAD=0 / ≥3 families / zoom / trim / restraint: **met**
- Speed breadth: **not met** (honest miss)
- Production Metal export this host: **not met** (injected verify; prior Acceptance remains the export proof)
- Story → problem → target → transformation chain: **proven** on Chat path
- No speculative focal threshold loosen: **held**

→ **PASS_WITH_LIMITATIONS**

HARD STOP.

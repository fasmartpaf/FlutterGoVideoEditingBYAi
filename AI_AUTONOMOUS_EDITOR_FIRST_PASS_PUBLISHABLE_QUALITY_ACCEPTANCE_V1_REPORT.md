# AUTONOMOUS_EDITOR_FIRST_PASS_PUBLISHABLE_QUALITY_ACCEPTANCE_V1

**Verdict: PASS_WITH_LIMITATIONS**

Question answered from **clean-document first-pass Chat only** (no coaching follow-ups), OpenAI disabled, injected compositor.

Artifact: `tmp/perception-benchmark/first-pass-publishable-quality-acceptance-v1/`

Code change this round (only after demonstrated first-pass failure): autonomous captions for `MAKE_PROFESSIONAL` when transcript layout is ready — `plan.ts` (non-optional caption step) + `run.ts` bounded revision `publish_ready_autonomous_captions`. No new Director/planner/TCS.

---

## 1. Corpus table

| ID | Recording | Role | Prompt | Mutated | Zoom | Captions | Speed | Final trims | Join QC | Programme review |
|----|-----------|------|--------|---------|------|----------|-------|-------------|---------|------------------|
| A | 1789555833018 | zoom clicks (recent) | FULLER | yes | 1 | yes | 0 | 0* | PASS | PROFESSIONALLY_IMPROVED |
| B | 1789551162068 | speed candidate | PRIMARY | yes | 1 | yes | 0 | 0* | PASS | PROFESSIONALLY_IMPROVED |
| C | 1789497588181 | trim+focal multi | PRIMARY | yes | 1 | yes | 0 | 0* | PASS | PROFESSIONALLY_IMPROVED |
| D | 1788978271417 | visual breadth | PRIMARY | yes | 1 | yes | 0 | 0* | PASS | PROFESSIONALLY_IMPROVED |
| E | 1789233035387 | narration-dense restraint | PRIMARY | yes | 0 | yes | 0 | 0 | PASS | PROFESSIONALLY_IMPROVED† |

\* Orch planned trims; join-QC revision removed speech-cutting trims so **final** `trimRanges` is empty.  
† E is mainly captions + loudness (editorial review notes accessibility polish); zoom correctly KEEP (`AMBIGUOUS_TARGET`).

**TOTAL_CLOUD_CALLS = 0** · **USEFUL_EDIT_PRECISION = 1.0** · **BAD = 0** · **SPEECH_DAMAGE = 0**

---

## 2–4. Source / target / problems (inspectable)

Human briefs written to `story-*-source.md` / `story-*-target.md`.

**A (excerpt):** Opening setup → spoken demo of selected prompt/app → mid-take important click (~14–16s, focal present) → explanation of cursor/system → ending. Problems: waits, small UI action needing emphasis. Target: tighten waits, emphasize click, captions, preserve explanation.

**E (excerpt):** Continuous narration-dense demo (“cursor… chat…”). Problems: little expendable dead air; competing focals. Target: polish without fake zooms; captions OK; KEEP zoom.

---

## 5–6. First-pass skill decisions (summary)

| Skill | A | B | C | D | E |
|-------|---|---|---|---|---|
| KEEP speech/actions | yes | yes | yes | yes | yes |
| TRIM/SHORTEN | planned → revised out if speech-cut | same | same | same | none needed |
| SPEED | KEEP (no ≥1.8s remain-visible low-speech span) | KEEP | KEEP | KEEP | KEEP |
| ZOOM | APPLY ~1.8s grounded | APPLY | APPLY + callout | APPLY + callout | KEEP ambiguous |
| CAPTION | APPLY autonomous | APPLY | APPLY | APPLY (revision) | APPLY |
| TITLE | KEEP (no clean topic) | KEEP | KEEP | KEEP | KEEP |
| CALLOUT | KEEP / not stacked on A | — | APPLY (C) | APPLY (D) | KEEP |
| TRANSITION | KEEP (no chapter dissolve) | KEEP | KEEP | KEEP | KEEP |
| LOUDNESS | APPLY | APPLY | APPLY | APPLY | APPLY |

---

## 7. Committed operations (final document)

- **Universal win:** captions on all five without user saying “add a caption”.
- **Visual:** grounded zoom on A–D; E correctly refuses ambiguous multi-target zoom.
- **Callout:** C/D when label/geometry justified; not stacked with zoom on every beat.
- **Speed:** not committed — corpus still lacks a clean SPEED-positive remain-visible span (1789551162068 did **not** rediscover a legitimate 1.50× region under current policy).
- **Trims:** often planned then removed by join-QC when they cut inside speech — safety over aggressive silence cutting.

---

## 8. Manual GOOD / ACCEPTABLE / BAD

Across meaningful committed finals: **9 GOOD, 0 ACCEPTABLE, 0 BAD**.

---

## 9. Missed / over-edited

**Missed**
- Stronger **net duration** reduction when all silence candidates fail speech-boundary QC (pacing still partly “loudness + captions + zoom”).
- **SPEED** on B — not available under current evidence policy (limitation, not forced).
- Richer **titles** when STT is conversational mush.

**Over-edited**
- None scored BAD. Risk of receipt **overclaiming** pause removal after join revision removes those trims (copy lag).

---

## 10. Final programme review

| Recording | Verdict |
|-----------|---------|
| A–D | PROFESSIONALLY_IMPROVED — first pass feels like an editor (zoom + captions + audio; joins clean) |
| E | TECHNICALLY_VALID / light polish — correct restraint; captions/loudness only |

**If the user never sends a second message:** on A–D, **yes, materially better than raw** without coaching. On E, honest light polish, not a full reshape.

---

## 11. Render status

**INJECTED_TEST_VERIFIED** (no native compositor on this host run). Not native production pixel proof.

---

## 12. Remaining REAL product limitations

1. Join-safe trims → many pause cuts revised out → weaker duration wins than the receipt sometimes claims.
2. SPEED still corpus-limited (no forced policy change).
3. Transitions rarely APPLY on single-source tutorials.
4. Titles stay quality-gated / often KEEP.
5. Native export/frame proof still required on desktop Metal/hardware compositor.
6. Receipt text can mention removed pauses after those trims were rolled back for join QC.

---

## 13. Gates

| Gate | Result |
|------|--------|
| FIRST_PASS_AUTONOMOUS_EDIT | PASS |
| AUTONOMOUS_CAPTIONS | PASS_WHEN_APPROPRIATE |
| GROUNDED_ZOOM | PROVEN_ON_REAL_MEDIA |
| TRIM_SHORTEN | NOT_PROVEN_OR_REVISED_OUT (safety) |
| SPEED_UP | CORPUS_LIMITED_OR_KEEP |
| FINAL_JOIN_QC | PASS |
| USEFUL_EDIT_PRECISION | 1.0 |
| BAD_TRANSFORMATIONS | 0 |
| TOTAL_CLOUD_CALLS | 0 |
| RENDER | INJECTED_TEST_VERIFIED |

---

## Final product verdict

**PASS_WITH_LIMITATIONS**

The first autonomous pass no longer requires “add captions” / “add zoom” coaching for normal narrated screen tutorials with cursor evidence. Results are multi-family (captions + zoom + loudness ± callout), joins stay clean, and restraint holds on ambiguous/narration-dense takes.

Not a full PASS: duration/trim wins are soft after speech-safe join revision, SPEED is still unproven on this corpus, and proof is injected-compositor rather than native export.

HARD STOP.

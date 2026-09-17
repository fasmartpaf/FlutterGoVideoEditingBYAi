# OpenScreen — Editorial Recommendation Product Surface V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1`  
**Code:** `electron/ai-edition/editorialRecommendationProductSurface/` + deep-agent wiring  
**Artifacts:** `tmp/perception-benchmark/editorial-recommendation-product-surface-v1/`  
**Paid AI:** **0**

---

## 1. Executive verdict

**PASS.** Local editorial engines (caption layout, dead-air, orchestration, temporal store, bounded reasoning, apply preview, UI consent) are now connected to the **chat product path**. Chat can surface a single consentable review card for grounded edits (especially `enableCaptions`) instead of only printing the Edit Plan honesty boilerplate.

---

## 2. What was wrong

Built modules lived outside FULL deep-agent chat. `enforceFinalPlanConsistency` stripped caption/trim advice when the trusted Edit Plan was preservation-only. Result: “Your project was not changed” with no Apply card — even when transcript + layout were ready.

---

## 3. What we wired

```text
user chat turn
  → (existing) Source/Target/Gap/Plan/Proposal path
  → NEW runEditorialRecommendationProductSurface
       gather local signals (caption layout; dead-air when pacing intent)
       orchestrateFromSignals
       temporal store + bounded reasoning (deterministic)
       one READY recommendation → EditProposalV1
       prepareApplyPreviewDiagnostics + buildEditReviewAttachment
  → prefer local consentable card when plan path has none (or captions intent)
  → enforceFinalPlanConsistency(+ extraSupportedFamilies from local)
  → replace no-edit boilerplate with local userFacingOffer when grounded
  → UI: existing EditReviewCard + Apply → runUiConsentedApply (unchanged)
```

Hard constraints kept: **no auto-apply**, **one proposal**, **0 paid AI** on this path.

---

## 4. Files

| Path | Role |
|------|------|
| `editorialRecommendationProductSurface/*` | Product surface pipeline |
| `editorialGrounding/briefing.ts` | `extraSupportedFamilies` on plan gate |
| `deep-agent/service.ts` | Chat integration |
| `*.test.ts` | Unit coverage |

---

## 5. Tests

- Unit: `editorialRecommendationProductSurfaceV1.test.ts` + grounding extra-families — **pass**
- Live smoke on `recording-1789422729178.mp4` / project `proj_02cc3f15-…`:

| Prompt | Result |
|--------|--------|
| Enable captions from the transcript | **canApply=true**, tool=`enableCaptions`, offer points to review card |
| Shorten long silent pauses if safe | dead-air ran (2 intervals, **0 safe**); honest no-trim offer; no apply card |

---

## 6. How to retest in the app

1. Restart / reload the OpenScreen **dev** app so main process picks up the new code (`npm run dev` if needed).
2. Open the same recording project.
3. Chat: **“Enable captions from the transcript.”**  
   Expect: review card + Apply edit (not only the old boilerplate). Apply once → captions enable via verified apply.
4. Chat: **“Shorten long silent pauses if safe.”**  
   Expect: honest “no safe trim” for this take (pauses too short) — that is correct local evidence, not a disconnect.

---

## 7. Limitations

- Loudness still outside Apply Preview UI path (signal only / not surfaced as apply card here).
- Zoom/crop/speed still restrained (no invented geometry).
- “Make it under 10 seconds” without safe long pauses will not fabricate cuts.
- FULL gpt-4o still runs for prose; local surface supplies the **grounded apply card** and plan-gate bypass.

---

## FINAL DECISIONS

```
ENGINEERING_VERDICT: PASS
CHAT_LOCAL_WIRING: PASS
CAPTION_CONSENT_CARD: PASS (live user recording)
DEAD_AIR_HONEST_NO_OP: PASS (live user recording)
TOTAL_PAID_AI_CALLS: 0
AUTO_MUTATIONS: 0
NEXT: user interactive retest in OpenScreen chat
```

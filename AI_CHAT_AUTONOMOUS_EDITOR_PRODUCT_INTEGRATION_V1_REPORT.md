# AI Chat → Autonomous Editor Product Integration + Pre-Test Hardening V1

**Prerequisite:** `CURRENT_OPENSCREEN_AUTONOMOUS_PROFESSIONAL_EDITOR_V1`  
**Artifacts:** `tmp/perception-benchmark/chat-autonomous-editor-product-integration-v1/`  
**Date:** 2026-09-15

## Verdict

The real Chat product path was **broken at the IPC/document-shipping boundary**: professional orchestrator verified commits under `proposal_only`, Chat claimed success, and **the live editor never received the document**.

That gate is **fixed**. Focal E2E now ships a verified zoom to the Chat contract (`shipped: true`). Narrated E2E binds project/media correctly, runs Director/stories, and ships loudness when gain changes (fingerprint now includes `audioGainDb`).

**AUTONOMOUS_EDITOR_PRODUCT_STATUS: FUNCTIONAL_BUT_LIMITED**

---

## Critical product fix

| Bug | Cause | Fix |
|-----|-------|-----|
| Backend “committed” / Chat claims improve, timeline unchanged | `chat-service.ts` stripped document when `proposal_only` + editorial fingerprint change | Ship when `finalResponseClaim === "verified_applied"` (and no consent card) |
| Loudness committed but fingerprint unchanged → `mutated=false` → no ship | `fingerprintDocument` omitted `audioGainDb` | Include `legacyEditor.audioGainDb` in fingerprint |

Entry path remains:

`LeftPanel.send` → `chatRun` → `invokeOpenScreenAgent` → **`runProfessionalEditOrchestrator`** (Director inside) → Chat ship → `applyDocument` → `saveDocument` / undo.

`runAutonomousProfessionalEditSession` is still a thin wrapper; Chat does **not** require it.

---

## Answers

1. **Chat connected to autonomous editor?** **YES** — professional turns hit orchestrator + Director.  
2. **Correct current video?** **YES** — `primaryAssetId` + `originalPath` + grounding fingerprints (`active-project-grounding.json`).  
3. **Hydrate local evidence?** **YES** for STT/dead-air/visual/cursor/temporal/focal/captions/loudness; OCR **NOT_IMPLEMENTED** on this path.  
4. **Source + target stories?** **YES** (+ readable markdown artifacts).  
5. **Director receives them?** **YES**.  
6. **Full skill registry considered?** **YES** (`skillConsideration` per turn).  
7. **Desired but not executable?** Transitions, titles/callouts, color, audio cleanup — reported honestly in user copy when relevant.  
8. **Callout/highlight/title/motion promotion?** **Motion = existing zoom** (verified). Callout/title **BLOCKED** — not in verified Apply Preview tools (would be unverified auto-mutation).  
9. **“You decide” without repeated confirmation?** **YES** — plan auth + sequential verified applies; consent cards cleared on professional turns.  
10. **Live editor document update?** **YES** after shipping fix (renderer `applyDocument` path).  
11. **Persisted?** **YES** via `saveDocument` when ship succeeds.  
12. **Undo?** Chat message rewind remains; follow-up “Remove that zoom” / undo last zoom|trim now deterministic_edit.  
13. **Follow-ups modify editor?** **YES** for remove zoom / caption size / quieter|louder (`chatFollowUpEditControl`).  
14. **Final review on actual programme?** **YES** — self-review + transformation summary on post-commit document.  
15. **Caption/audio vs editorial?** **YES** — `ACCESSIBILITY_*` / `POLISH_IMPROVED` / `EDITORIALLY_IMPROVED` / `PROFESSIONAL_TRANSFORMATION`.  
16. **What visibly changed on tests?**  
    - **A narrated:** often loudness polish; transformation `POLISH_IMPROVED`; no false “professionally edited” for captions-only.  
    - **B focal:** zoom committed + shipped; `EDITORIALLY_IMPROVED`; user-facing editor language.  
17. **If manual still sees “only captions”?** Remaining causes: no cursor sidecar → no zoom; dead-air policy keeps short pauses; no transition/title execution; user must have Project edits allowed.

---

## FINAL MATRIX

```
CHAT_UI_TO_AGENT: PASS
CHAT_TO_ACTIVE_PROJECT_BINDING: PASS
PROFESSIONAL_INTENT_ROUTING: PASS
CHAT_TO_AUTONOMOUS_SESSION: PASS (via orchestrator+Director)
LOCAL_PERCEPTION_HYDRATION: PASS (OCR NOT_IMPLEMENTED)
TEMPORAL_CONTEXT_HYDRATION: PASS
SOURCE_STORY_FROM_CHAT: PASS
TARGET_STORY_FROM_CHAT: PASS
DIRECTOR_FROM_CHAT: PASS
FULL_SKILL_CONSIDERATION: PASS
GROUNDED_OPERATION_COMPILATION: PASS
AUTONOMOUS_PLAN_AUTHORIZATION: PASS
SEQUENTIAL_VERIFIED_EXECUTION: PASS
LIVE_EDITOR_DOCUMENT_UPDATE: PASS (shipping fix)
TIMELINE_UI_UPDATE: PASS (via applyDocument contract)
PREVIEW_UPDATE: PASS (same document)
PROJECT_PERSISTENCE: PASS (saveDocument on ship)
UNDO_HISTORY: PASS (save history + follow-up/rewind)
CHAT_FOLLOW_UP_EDIT_CONTROL: PASS (zoom/captions/audio)
FINAL_PROGRAMME_REVIEW: PASS
BOUNDED_REVISION: PASS (budget=1 retained)
USER_FACING_RECEIPT_ACCURACY: PASS (no jargon; no false pro claim)

TRIM_CHAT_E2E: PASS_WHEN_SAFE_DEAD_AIR
ZOOM_CHAT_E2E: PASS (TEST B)
CROP_CHAT_E2E: HONESTLY_LIMITED
SPEED_CHAT_E2E: PASS_WHEN_GROUNDED
CAPTIONS_CHAT_E2E: PASS
LOUDNESS_CHAT_E2E: PASS (fingerprint+ship)
CALLOUT_HIGHLIGHT_CHAT_E2E: BLOCKED_UNVERIFIED
TITLE_CHAT_E2E: BLOCKED_UNVERIFIED
MOTION_REFRAME_CHAT_E2E: PASS_VIA_ZOOM

REAL_CHAT_E2E_TEST_A: PASS
REAL_CHAT_E2E_TEST_B: PASS
REAL_CHAT_E2E_TEST_C: PASS_IF_SILENCE (policy-gated)
REAL_CHAT_E2E_TEST_D: PASS (restraint)

CAPTION_ONLY_FALSE_SUCCESS_REGRESSION: PASS
BACKEND_ONLY_MUTATION_REGRESSION: PASS
STALE_PROJECT_REGRESSION: PASS (revision guard)
REPEATED_CONFIRMATION_REGRESSION: PASS

TOTAL_PAID_AI_CALLS: 0
AUTO_UNVERIFIED_MUTATIONS: 0

AUTONOMOUS_EDITOR_PRODUCT_STATUS: FUNCTIONAL_BUT_LIMITED
```

---

## Post-report hotfix — model-unavailable toast

**Symptom (manual Chat):** toast  
`I couldn't complete the AI analysis because the model service is temporarily unavailable…`

**Cause:** Professional Edit ran *after* the LLM stream. Provider failure aborted the turn before `runProfessionalEditOrchestrator`, so the autonomous path never started.

**Fix:** Local-first professional turns in `deep-agent/service.ts` — when `isProfessionalEditRequest`, run the orchestrator **before** `createAgent` / provider stream (0 model calls). Provider downtime no longer blocks “Make this professional… You decide.”

---

## HARD STOP

Product-path shipping fix + grounding/receipt/follow-up hardening + real Chat-contract E2Es complete.  
**No transitions/color/denoise renderer work started.**

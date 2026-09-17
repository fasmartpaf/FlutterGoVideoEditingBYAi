# OpenScreen UI Consent Surface V1 Report

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_UI_CONSENT_V1`  
**Prerequisites:** Apply Preview + Render/Compositor/Audio Verify V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: One human-reviewed edit only. No multi-edit, batch consent, autonomy, auto-repair, or tool expansion.

---

## Executive verdict

PASS_WITH_LIMITATIONS. OpenScreen can now show one evidence-backed edit as a native chat review card, require explicit **Apply edit** / **Keep as is**, mint consent + run the existing `runConsentedApplyPreview` pipeline on the main process, and commit only a verified document through `applyAgentDocumentIfCurrent` (with normal undo). Blocked statuses never expose Apply. Consent UX LLM calls = **0**. Full interactive macOS editor QA of a live `proposal_ready` project was **not** completed in this session (unit + wiring proven).

---

## Existing editor UX audit

| Topic | Finding |
|-------|---------|
| Chat | `ChatStripPanel` in `LeftPanel.tsx` — natural home for a proposal card |
| Shell | `NewEditorShell` — chat \| stage \| timeline |
| Seek | `handleSeek` + `seekTarget`; review uses `useEditReviewSeekBus` |
| Modals | `ModalShell` exists; **not** used as primary consent (would block timeline) |
| Toasts | sonner — conflict/save only; not primary consent |
| Undo | Menu + Ctrl/Cmd+Z; agent apply records history on successful save |
| Store | Zustand `useProjectStore`; commit via `applyAgentDocumentIfCurrent` |
| Prior wiring | `editProposalV1` / apply preview existed main-side only; chat dropped them |

**A.** Chat thread under the assistant turn.  
**B.** Embedded review card (not toast/modal).  
**C.** Design tokens + chat strip styles.  
**D.** Label **Proposed change** before apply; verified copy after.  
**E.** Verified doc → `applyAgentDocumentIfCurrent` → `saveDocument`.  
**F.** Existing undo stack after successful save.  
**G.** Timeline edit while open → stale preflight / no mutation.

---

## UI architecture

```text
Agent turn → editProposalV1 + preflight diagnostics
  → buildEditReviewAttachment (deterministic copy)
  → AiEditionChatResult.editReview
  → EditReviewCardView in chat
  → Apply → IPC applyPreview.run
       → createApplyConsent + runConsentedApplyPreview
       → verified document only
  → applyAgentDocumentIfCurrent → undoable save
```

React never calls `executeAgentTool`.

---

## Files changed

| Path | Role |
|------|------|
| `electron/ai-edition/uiConsent/*` | Adapter, apply runner, types, tests, NOTICE |
| `electron/ai-edition/deep-agent/service.ts` | Attach `editReview` |
| `electron/ai-edition/chat-service.ts` | Forward review; suppress auto-doc when consentable |
| `electron/native-bridge/.../aiEditionService.ts` | `applyPreviewRun` |
| `electron/ipc/nativeBridge.ts` | `applyPreview.run` |
| `src/native/contracts.ts` / `client.ts` / `browserShim.ts` | Wire types + client |
| `src/components/ai-edition/EditReviewCard.tsx` (+ css, test) | Review UI |
| `src/components/ai-edition/LeftPanel.tsx` | Render cards; defer auto-apply |
| `src/lib/ai-edition/store/useEditReviewSeekBus.ts` | Review-section seek |
| `src/components/ai-edition/NewEditorShell.tsx` | Consume seek bus |
| `tmp/perception-benchmark/ui-consent-v1/` | Artifacts |
| `AI_UI_CONSENT_V1_REPORT.md` | This report |

---

## Review-card contract

`EditReviewCard`: title, explanation, changeSummary, reasonSummary, affectedRange, preserves, risks, readiness (`ready`\|`blocked`\|`stale`), capabilityLabel, canApply, consentScope, documentFingerprint.

Built only from typed proposal + preflight — never from LLM prose.

---

## Ready vs blocked presentation

| Status | Apply button |
|--------|----------------|
| `proposal_ready` + eligible preflight | **Yes** |
| provisional / no_safe / needs_more_evidence / unsupported | **No** |
| stale | **No** (message to re-analyze) |

---

## Human-language mapping

Safe trim example title: **Shorten a quiet pause**. Copy explains pause duration and protected content. No internal names (Claim Promotion, Edit Gap, fingerprints) in user fields.

---

## Preservation UX

**Will keep** list from `mustSurvive` (+ “content immediately after the pause” for trims).

---

## Risk UX

Only medium+ damage / continuity risks. Quiet dead-air with low risk → no manufactured scare copy.

---

## Consent binding

Apply → fresh `prepareApplyPreviewDiagnostics` → `createApplyConsent` → `runConsentedApplyPreview` with fingerprint match. Max 1 mutation.

---

## Stale handling

Document change after card build → preflight `stale_proposal` → UI: project changed; needs another look. No silent re-apply.

---

## Applying state

Duplicate clicks guarded (`applyingRef`). Copy: “Applying and checking the edit…”. No fake %.

---

## Verified state

`verified_single_trim_*` → **Edit applied and checked** (or **with a warning**). No “perfect edit.”

---

## Warning state

Honest warning phase when receipt carries verification warnings (e.g. RMS jump).

---

## Rollback state

**Edit wasn’t kept** + restore explanation. Never “Successfully applied” + tiny rollback note.

---

## Apply-failure state

**The edit could not be applied. Your project was not changed.** Distinct from rollback.

---

## Rejection behavior

**Keep as is** / **Dismiss** → zero mutation, no consent mint, local log `user_rejected`.

---

## Single-edit enforcement

Apply Preview `MAX_MUTATIONS_PER_PREVIEW = 1`. UI does not auto-chain next proposals.

---

## Document commit path

```text
transactional apply (main)
→ all verify gates
→ only if verified: return document
→ renderer applyAgentDocumentIfCurrent
→ setDocument + saveDocument (history on success)
```

Unverified intermediaries are not saved.

---

## Undo integration

Successful save uses existing `historyBase` undo entry. Rollback ≠ user Undo.

---

## Crash/error safety

- Fail closed on stale / missing consent  
- Duplicate apply guarded  
- Closing/dismiss does not apply  
- Save failure rolls store back via existing helper  
- Consentable review suppresses chat auto-apply of tool docs  

---

## Case 2 / Case 4 / Upwork / Settings

Unit fixtures: no Apply for `no_safe_proposal`, provisional, Upwork passive visibility, unsupported Settings zoom.

---

## Manual safe-edit / rejection / stale / rollback QA

**Partial — NOT fully run on a live macOS editor session in this milestone.**  
Proven via unit tests + IPC/wiring. Recommend maintainer pass with a real `proposal_ready` project for A–E checklist rows.

---

## Model-call count

Consent UX / review copy: **`additionalModelCalls = 0`**.

---

## Latency

Measured buckets on apply IPC: `preflightMs`, `consentMintMs`, `applyVerifyMs`, `totalMs` (existing apply/verify path dominates). Review-card construction is synchronous/microseconds.

---

## Tests

- `electron/ai-edition/uiConsent/uiConsentV1.test.ts` — ready/blocked/cases/copy/0 LLM  
- `src/components/ai-edition/EditReviewCard.test.tsx` — Apply visibility, dismiss, IPC call  

Prior apply/compositor/audio suites unchanged in intent.

---

## Benchmark/UI artifacts

Identity: **`CURRENT_OPENSCREEN_UI_CONSENT_V1`**  
`tmp/perception-benchmark/ui-consent-v1/` (does not overwrite prior identities).

---

## Remaining limitations

- Live product QA on real media/HUD cases not executed here  
- Session reload does not rehydrate review cards (ephemeral to the turn)  
- “Re-analyze” is messaging only — user must send a new chat turn  
- i18n chrome still English in the card (proposal copy is deterministic English)  
- No batch / multi-proposal carousel  

---

## Recommended next milestone

**Multi-proposal review queue V1** (still one human action per edit) **or** deeper **Re-analyze** that re-runs cognition with user awareness — still without autonomy.

---

## Verdict

**PASS_WITH_LIMITATIONS**

OpenScreen can expose one grounded edit to a human in trustworthy product language, obtain explicit permission, apply only that edit through the verified pipeline, and commit or restore without misleading success claims.

# OpenScreen Reuse Milestone 2 — Timecode-Agent Claim Promotion + Capture Provenance

**Date:** 2026-09-13  
**Provider id:** `CURRENT_OPENSCREEN_CLAIM_PROMOTION_V1`  
**Prerequisite milestones:** Temporal Event Ledger V1, Master Video Investigator V1, Reuse Visual V1  
**Verdict:** **PASS_WITH_LIMITATIONS**

STOP: Target Story, autonomous editing, and LongVideoAgent/VideoMind role-policy work not started.

---

## Executive verdict

Clean-room TypeScript claim-promotion layer sits **above** the Temporal Event Ledger (not replacing it). Deterministic rules enforce OCR ≠ action, speech ≠ visual fact, and Upwork/Restart/Settings invariants with **0 additional LLM calls**. Capture provenance chains (observation → OCR → crop → claim → history) and Investigator query helpers are turn-local. Locked baselines (`CURRENT_OPENSCREEN`, Investigator V1, Reuse Visual V1) are unchanged.

---

## Upstream timecode-agent commit audited

| Field | Value |
|-------|-------|
| Repository | https://github.com/mupozg823/timecode-agent |
| Commit | `02f7c5a9ce1c09b4ba49177d2a4dc8e9ee1bbc03` |
| Release | v0.4.0 (2026-08-06) |
| License | MIT — Copyright (c) 2026 mupozg823 |
| Attribution | `electron/ai-edition/claimPromotion/NOTICE.md` |

---

## License

MIT (mupozg823). Attribution notice included. Prefer clean-room adaptation of ideas; no bulk Python transplant.

---

## Upstream files/functions inspected

| Upstream | Classification | Notes |
|----------|----------------|-------|
| `checkpoint_schema.py` (`hypothesized`→`verified`/`corrected`) | **ADAPT_IDEA_ONLY** | Lifecycle + history, not their status names wholesale |
| `verification.py` / `verification_types.py` (promotability, modality levels) | **ADAPT_IDEA_ONLY** | Deterministic promotion + verification levels |
| `capture.py` (capture reason / cause identity) | **ADAPT_IDEA_ONLY** | Provenance links with crop/OCR/engine refs |
| `transcript_evidence.py` | **ADAPT_IDEA_ONLY** | Cross-modal support checks |
| `checkpoint_store.py` JSONL workspace | **ARCHITECTURE_REFERENCE** | Turn-local set, not their FS layout |
| `image_provenance.py` | **ARCHITECTURE_REFERENCE** | Chain-of-evidence idea |
| `verify_priority.py` | **ADAPT_IDEA_ONLY** | Lazy verification relevance |
| EDL/OTIO export, person-presence, product CLI | **NOT_NEEDED** | OpenScreen owns editing |

---

## What was adapted

- Checkpoint/promotion **lifecycle + history** (append-only status transitions).
- **Promotability** gated by resolvable evidence (not LLM judgment for simple rules).
- **Verification levels** (unsupported / single_source / multi_evidence / cross_modal / contradicted).
- **Capture provenance** refs (crop ROI, OCR engine, observation IDs).
- **Lazy** deepening keyed to user query relevance.

## What was deliberately not adapted

- Workspace JSONL / OTIO / EDL product architecture.
- Replacing Temporal Event Ledger or Investigator.
- Bulk copy of Python modules.
- Embeddings / vector claim merge.
- AxcutDocument schema changes.
- Source Story / Target Story rewrites.

---

## OpenScreen files changed

| Path | Role |
|------|------|
| `electron/ai-edition/claimPromotion/*` | New layer (types, rules, promote, identity, lazy, bridge, NOTICE, tests) |
| `electron/ai-edition/deep-agent/service.ts` | Wire `claimPromotion` onto `InvokeResult` after ledger rebuild |
| `electron/ai-edition/videoInvestigator/index.ts` | Re-export claim query helpers |
| `electron/ai-edition/visualSpecialist/reuse/NOTICE.md` | Prior hygiene: ocrCache is OpenScreen-original (unchanged this milestone beyond that prior note) |

Reuse Visual V1 code paths were **not** otherwise modified.

---

## Claim promotion architecture

```text
Evidence Store / prepared perception
        ↓
Temporal Event Ledger  (evidence memory — unchanged)
        ↓
Claim Promotion Layer  (trust / promotion policy)
        ↓
Investigator queries / future Source Story bridge
```

Provider: `CURRENT_OPENSCREEN_CLAIM_PROMOTION_V1`.

---

## Promotion states/rules

Statuses: `observed | spoken | inferred | supported | verified | contradicted | unknown`.

Deterministic rules (examples):

| Pattern | Allowed | Forbidden without action evidence |
|---------|---------|-----------------------------------|
| OCR / visible text | `observed` / temporary UI → `supported` visibility | `verified` user action |
| Passive chrome (Upwork tab) | `supported` visibility | opened / navigated / worked |
| Speech alone | `spoken` | visual panel-open `supported`/`verified` |
| Speech + keyword OCR, no target state | demote action → `contradicted` / unresolved | Settings opened |
| Visual change | `supported` change observation | named semantic causation |

---

## Capture provenance architecture

Each promoted claim carries `provenance[]` links:

- `ledger_event` / `visual_observation` / `ocr_result` / `source_crop` / `speech_segment` / `investigation_observation`

Restart tooltip example chain:

```text
source crop (ROI + source px)
  → OCR result (engine + status)
  → visual observation id
  → claim (temporary_ui_visibility / supported)
  → parallel action claim (unknown)
```

Dependent claims remain recomputable from ledger+specialist (derived).

---

## Claim history/checkpoints

`history[]` on each claim: `from → to`, `ruleId`, `reason`, `evidenceIds`, `atIso`. Status is never silently overwritten without a history entry.

---

## Lazy verification

`selectClaimsForLazyVerification` / `claimRelevantToQuery`:

- Transcript-only questions skip deep UI action claims (e.g. Upwork).
- Action questions (“Did I open Upwork?”) mark those claims for evaluation.
- Building still creates claims; lazy flag marks `lazyVerified` and metrics `lazySkipped`.

---

## Investigator integration

Additive query surface (no new top-level agent):

- claims in range
- unresolved / contradicted
- evidence for claim id
- promotion hints
- lazy relevant split

Exported via `claimPromotion` and re-exported from `videoInvestigator/index.ts`.

---

## Evidence Store / Ledger integration

Ledger remains source of events. Claim layer references evidence IDs; does not duplicate full payloads. Specialist OCR feeds promotion via observation/crop/OCR ids without changing OCR behavior.

---

## Source Story bridge

`buildSourceStoryClaimBridge(set)` → `{ promotedSummaries, unresolvedSummaries, contradictionSummaries }` for **future** Source Story consumption. Existing Source Story behavior unchanged and tests green.

---

## Persistence decision

**B — derived / turn-local (cacheable later).**  
Not AxcutDocument-backed. Rebuilt each turn from ledger + specialist + investigation. Matches existing ledger/investigator persistence posture.

---

## Case 2 proof

| Claim | Status |
|-------|--------|
| Observed Restart text | `observed` → with temporary UI rule → **`supported`** visibility |
| Tooltip visibility | **SUPPORTED** visual observation when OCR+ROI provenance present |
| User restarted recording | **`unknown` / unsupported** |
| Provenance | observation + OCR + source_crop links present |
| User restart action | remains **unverified** |

---

## Upwork proof

OCR/passive chrome → visibility `supported`/`observed`.  
Action “opened/navigated/worked in Upwork” → **`unknown`**, never `verified`. Explicit behavioral test.

---

## Case 4 proof

Spoken correction retained as `spoken`. Action/panel-open remains `contradicted` or unresolved. No verified panel-open promotion from speech alone.

---

## Settings contradiction proof

Speech “opening Settings” + OCR “Settings” without verified Settings **state** → action demoted (`contradicted` via keyword-coincidence rule). Keyword ≠ navigation.

---

## Claim dedupe behavior

Deterministic `identityKey`: `assetId|kind|action|normalizedSubject|timeBucket(0.1s)`.  
No embeddings. Different kinds (visible_text vs user_action) never merge. Conservative subject normalization.

---

## Performance

Measured in `ClaimPromotionMetrics`: `claimsCreated`, `claimsAfterDedupe`, `identityMs`, `promotionMs`, `totalMs`, lazy counts. Typical unit-test builds ≪ 5 ms on ledger-sized fixtures.

---

## Model-call count

**`additionalModelCalls: 0`** for the deterministic promotion path. Justified: no LLM consult for rule evaluation.

---

## Test counts

| Suite | Result |
|-------|--------|
| `claimPromotion/claimPromotion.test.ts` | **16 passed** (covers items 1–14 + metrics/bridge/queries) |
| `videoInvestigator.test.ts` | green |
| `sourceStory.test.ts` | green |
| `temporalEventLedger.test.ts` | green |
| Reuse Visual Case 2 OCR live | may fail under restricted sandbox (macOS Vision) — **pre-existing env limitation**, not introduced by this layer |

---

## Benchmark impact

- Locked: `CURRENT_OPENSCREEN`, `CURRENT_OPENSCREEN_INVESTIGATOR_V1`, `CURRENT_OPENSCREEN_REUSE_VISUAL_V1` — **not overwritten**.
- New identity only: `CURRENT_OPENSCREEN_CLAIM_PROMOTION_V1`.

---

## Remaining limitations

- Promotion coverage is rule-driven for known patterns (OCR, passive chrome, speech, Settings/Restart/Upwork); not a universal NLP claim extractor.
- Lazy verification marks relevance; it does not yet schedule extra Investigator tool loops automatically.
- Provenance invalidation on deleted crops is recomputation-based (no separate dependency graph store).
- File-menu open-state causation remains cautious (visibility/support without overstated click→menu causality).

---

## Recommended next reuse

Selective ideas from remaining audit candidates (e.g. LongVideoAgent / VideoMind **role-policy** patterns) — only after explicit go-ahead — still **behind** OpenScreen contracts, never replacing ledger/investigator.

Do **not** start Target Story or autonomous editing from this milestone.

---

## Verdict

**PASS_WITH_LIMITATIONS**

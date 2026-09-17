# OpenScreen — Verified Apply Expansion V1 Report

**Date:** 2026-09-15  
**Identity:** `CURRENT_OPENSCREEN_VERIFIED_APPLY_EXPANSION_V1`  
**Prerequisites:** Apply Preview V1 · Compositor Verify V1 · Audio Verify V1 · Local Edit Verify Expansion V1  
**Verdict:** **PASS_WITH_LIMITATIONS**  
**TOTAL_PAID_AI_CALLS:** **0**

HARD STOP after this report: no captions, transitions, denoise, stabilization, multi-edit, or cognition changes.

---

## 1. Executive verdict

PASS_WITH_LIMITATIONS. Production Apply Preview is no longer trim-only. One shared transaction (`runConsentedApplyPreview`) now allowlists **addTrim | addZoom/setZoom | setClipCrop | addSpeed/setSpeed**, binds consent to operation type + args fingerprint, runs family verification, and fail-closes with exact fingerprint rollback. On this macOS machine, live native compositor (`hardware` / `live_readFrame`) verified real zoom, crop, and speed applies against `recording-bug5-narrated.mp4`. Injected compositor remains unit-test-only and cannot satisfy live authoritative proof. Windows/Linux live proof is not claimed. Loudness stays on its separate path.

---

## 2. Existing Apply Preview architecture

```text
EditProposalItem
  → prepareApplyPreviewDiagnostics / buildApplyPreflight
  → familyPreflight (per-tool args)
  → EditReview card (deterministic copy)
  → createApplyConsent (proposalId + fingerprint + toolName + operationArgsFingerprint)
  → IPC applyPreview.run
  → runConsentedApplyPreview
       → validateConsent
       → structuredClone snapshot
       → executeAgentTool (MAX 1)
       → verifyAfterApply (structural / preservation)
       → runFamilyVerificationStage
            trim  → compositorVerify + audioVerify
            zoom/crop/speed → editVerify + NativeCompositorFrameSampler
       → accept verified document | restore snapshot
  → renderer applyAgentDocumentIfCurrent → save → undo history
```

Artifacts: `tmp/perception-benchmark/verified-apply-expansion-v1/audit.json`

---

## 3. Trim-specific assumptions found

| Assumption | Class | Status |
|---|---|---|
| `MAX_MUTATIONS_PER_PREVIEW = 1` | GENERIC | KEPT |
| Consent + fingerprint + snapshot rollback | GENERIC | KEPT / EXTENDED |
| Allowlist was `addTrim` only | ZOOM/CROP/SPEED_BLOCKER | FIXED |
| Hard gate `tool !== addTrim` in run path | ZOOM/CROP/SPEED_BLOCKER | FIXED |
| Structural verify looked only for new trims | TRIM_SPECIFIC | EXTENDED |
| Compositor+audio join after structural | TRIM_SPECIFIC | KEPT for trim; zoom/crop/speed use editVerify |
| Proposal builder often emits incomplete zoom/crop/speed args | SPEED/ZOOM_BLOCKER | PREFLIGHT requires complete args (fail closed) |

---

## 4. Generic transaction design

One orchestrator only — **no** `runConsentedZoomApply` / Crop / Speed siblings.

```text
runConsentedApplyPreview
  → validate operation (allowlist + family preflight)
  → apply one operation via executeAgentTool
  → family verification
  → commit | rollback
```

Family dispatch lives in `familyVerifyStage.ts`.

---

## 5. Operation allowlist

Canonical tools:

| Family | Canonical tool(s) |
|---|---|
| Trim | `addTrim` |
| Zoom | `addZoom` (primary), `setZoom` |
| Crop | `setClipCrop` |
| Speed | `addSpeed` (primary), `setSpeed` |

Unsupported mutating tools: fail closed (`capability_unsupported` / not eligible).  
Loudness (`audioGainDb` settings patch) is **not** on this allowlist by design.

Contract: `operation-contract.json`

---

## 6. Consent binding

Consent now binds:

- proposal id  
- preflight id  
- document fingerprint  
- **toolName**  
- **operationArgsFingerprint**

Mismatch → blocked / stale. Trim consent cannot authorize zoom; one zoom cannot authorize another with different args.

---

## 7. Zoom apply

- Preflight: depth, focus ∈ [0,1], landing, scale bounds  
- Mutation: `addZoom` with SOURCE landing merged into start/end  
- Verify: `verifyZoom` + native frames → `verified_single_zoom_basic`  
- Live: **PASS** on bug5 narrated (`verified`, authoritative)  
- Invalid focus: preflight block, 0 mutation  
- Blank/unavailable compositor: unit rollback with fingerprint match  

---

## 8. Crop apply

- Preflight: clipId, positive in-bounds crop rect  
- Mutation: `setClipCrop`  
- Live: **PASS** (`verified_single_crop_basic`, authoritative)  
- Protected region excluded: **rolled_back**, `rollbackFingerprintMatch=true`  

---

## 9. Speed apply

- Preflight: landing + speed within product bounds  
- Mutation: `addSpeed` → `legacyEditor.speedRegions`  
- Live: **PASS** (`verified_single_speed_basic`, includes `AUDIO_VALID`)  
- Forced family verify failure: rollback  

---

## 10. Native compositor live proof

| Field | Value |
|---|---|
| Platform | darwin arm64 |
| Media | `~/Library/Application Support/openscreen/recordings/recording-bug5-narrated.mp4` |
| Backend | hardware |
| Capture path | live_readFrame |
| Frame provider | native_compositor (authoritative) |
| Zoom/crop/speed live success | yes |
| Windows / Linux | NOT_RUN |

Sandbox note: under Cursor sandbox, `probeBackend` can return `none` → honest fail-closed. Unsandboxed Node loads VideoToolbox successfully.

---

## 11. Speed audio proof

Speed live levels achieved include `AUDIO_VALID` with claim `audio_valid`. Forced failure path rolls back. No subjective pacing claims.

---

## 12. Receipts

Statuses added (trim consumers unchanged):

- `verified_single_zoom_basic` / `_with_warnings`  
- `verified_single_crop_basic` / `_with_warnings`  
- `verified_single_speed_basic` / `_with_warnings`  
- `family_verification_failed`  

Receipt may attach `editVerification` (family result). Structural-only success is never labeled bare `"verified"` without family stage when family verify is required.

---

## 13. Fail-closed behavior

Rollback / block when:

- stale consent / fingerprint  
- wrong operation consent  
- invalid args  
- mutation failure  
- structural / programme / preservation failure  
- native compositor unavailable / blank / invalid  
- geometry / protected region failure  
- speed audio / forced family failure  
- verification exception  

---

## 14. Rollback

Full document snapshot restore + fingerprint match. Proven live for crop protected-region and speed forced failure; unit for zoom blank compositor.

---

## 15. Stale handling

Fingerprint / args mismatch → `stale_proposal` or consent block, **0 mutation**. Consent is not silently regenerated.

---

## 16. Duplicate handling

`MAX_MUTATIONS_PER_PREVIEW = 1` and existing applyPreview duplicate protections remain. Two Apply clicks cannot chain two zooms in one budgeted transaction.

---

## 17. Document save / undo

Unchanged product path: only verified returned document is eligible for `applyAgentDocumentIfCurrent` → save → history. Intermediate/unverified mutations are rolled back inside the transaction and never returned as verified.

---

## 18. Trim / dead-air regressions

- `applyPreviewV1.test.ts` — PASS  
- Dead-air visual safety unit — PASS  
- Dead-air still: candidate → consent → trim → compositor/audio → keep/rollback  

---

## 19. Loudness regression

Loudness remains on settings-patch consent — **not** forced through generic edit transaction. `loudnessNormalizeV1.test.ts` — PASS.

---

## 20. Performance

Representative live zoom latency (macOS native):

| Stage | ms (approx) |
|---|---|
| preflight | 0–1 |
| apply | ~2 |
| family/render verify | ~1195 (first cold zoom) |
| total | ~1197 |

Crop/speed family verify ~82–158 ms after warm compositor. No subjective optimization claimed.

---

## 21. Tests

| Suite | Result |
|---|---|
| `verifiedApplyExpansionV1.test.ts` (injected authoritative) | PASS |
| `verifiedApplyExpansionV1.live.runtime.test.ts` (native) | PASS (unsandboxed) |
| `applyPreviewV1.test.ts` | PASS |
| `uiConsentV1.test.ts` | PASS |
| dead-air visual safety unit | PASS |
| loudness unit | PASS |

Coverage includes: unsupported/stale/wrong-op consent, fingerprint mismatch, single mutation, rollback, zoom/crop/speed valid + fail paths, trim regression, paid AI = 0.

---

## 22. Paid AI proof

```json
{
  "OPENAI_CALLS": 0,
  "ANTHROPIC_CALLS": 0,
  "GEMINI_CALLS": 0,
  "OTHER_PAID_AI_CALLS": 0,
  "TOTAL_PAID_AI_CALLS": 0
}
```

---

## 23. Remaining limitations

- Proposal builder often still emits incomplete zoom/crop/speed provisionalArgs → preflight blocks until complete args are supplied.  
- Live native proof is macOS-only here.  
- Sandboxed CI/agent hosts may see `probeBackend=none` and correctly fail closed.  
- No multi-edit, captions, transitions, denoise, or subjective quality gates.  
- Zoom invalid-focus live case blocks at preflight (0 mutation); blank-compositor rollback proven in unit tests.

---

## 24. Production readiness

**PRODUCTION_DEFAULT: EXPANDED_SINGLE_EDIT_ALLOWLIST**

Safe to use for single consented trim/zoom/crop/speed when args are complete and native compositor is available. Not a quality/editorial autonomy system.

---

## 25. Next local capability recommendation

**caption_layout_safe_areas_v1** — local, deterministic caption/safe-area geometry against composited frames (no paid AI; complements verified apply families).

---

## FINAL DECISIONS

```text
ENGINEERING_VERDICT: PASS_WITH_LIMITATIONS
GENERIC_APPLY_TRANSACTION: PASS
CONSENT_BINDING: PASS
ZOOM_LIVE_NATIVE_APPLY: PASS
ZOOM_ROLLBACK: PASS
CROP_LIVE_NATIVE_APPLY: PASS
CROP_ROLLBACK: PASS
SPEED_LIVE_NATIVE_APPLY: PASS
SPEED_AUDIO_VERIFY: PASS
SPEED_ROLLBACK: PASS
STALE_PROTECTION: PASS
SINGLE_MUTATION_ENFORCEMENT: PASS
SAVE_UNVERIFIED_BLOCK: PASS
UNDO_INTEGRATION: PASS
TRIM_REGRESSION: PASS
DEAD_AIR_REGRESSION: PASS
LOUDNESS_REGRESSION: PASS
TOTAL_PAID_AI_CALLS: 0
VERIFIED_EDIT_FAMILIES: [trim, zoom, crop, speed]
PRODUCTION_DEFAULT: EXPANDED_SINGLE_EDIT_ALLOWLIST
NEXT_LOCAL_CAPABILITY: caption_layout_safe_areas_v1
```

STOP.

# AUTONOMOUS_EDITOR_LOCAL_FIRST_CHAT_AND_FOLLOWUP_CONTROL_V1

**Verdict: PASS_WITH_LIMITATIONS**

Chat is a **local-first control surface** with **compositional intent robustness** (not phrase-enumeration). Ordinary supported editing follow-ups complete with OpenAI disabled, **0 provider stream calls**, and no “model service temporarily unavailable” toast.

**TARGET_DURATION_LOCAL = PASS**  
**LOCAL_FIRST_CHAT_ROUTER = PASS**  
(after paraphrase + adversarial + non-edit guard suites)

Hard stop on architecture: no new Director / planner / Temporal Context Store / SPEED or focal policy changes.

---

## Intent robustness (required acceptance gate)

Architecture:

```
raw chat
 → normalizeEditorialText (units, fillers, word-numbers, polite shells, duration verbs)
 → detectSpeechAct (QUESTION / COMMAND / CONSTRAINT / OPINION)
 → extractDurationSlot / preserve / relative / reference
 → extractAction → LocalEditorialRequestV1
 → route (local orch / direct / session / escalate)
```

Files: `electron/ai-edition/localEditorialChat/normalize.ts`, `parse.ts`

### Duration paraphrases (10/10)

All resolve to `TARGET_DURATION`, `duration ≈ 12s`, local route, execute authorization:

1. Make it under 12 seconds.  
2. Can you make it under a 12 sec?  
3. Get this down to about 12 seconds.  
4. I need this around 12s.  
5. Shorten the video to roughly 12 seconds.  
6. Can we get this below twelve seconds?  
7. Make this shorter, around 12 seconds, but keep the important parts.  
8. Cut it down to 12 sec without removing the explanation.  
9. The video is too long. Bring it closer to 12 seconds.  
10. Try to make this about twelve seconds while keeping the useful content.

Chat-entry proof (OpenAI off) on hard variants #2, #3, #10: `status=completed`, `cloudCalls=0`.

### Adversarial / non-edit guards

| Metric | Value |
|--------|-------|
| SUPPORTED_LOCAL_INTENT_PARAPHRASE_RECALL | **1.0** |
| DURATION_PARAPHRASE_RECALL | **1.0** |
| ADVERSARIAL_RECALL | **1.0** |
| FALSE_LOCAL_INTENT_RATE | **0** |
| TOTAL_CLOUD_CALLS… | **0** |

Protected (must not mutate):

- “What do you think about this video?” → not an edit  
- “Why did you remove that zoom?” → QUESTION / UNKNOWN  
- “Don't remove the zoom.” → PRESERVE_RANGE (constraint), not REMOVE_ZOOM  

Artifacts: `intent-paraphrase-suite.json`, `intent-robustness-metrics.json`

---

## Earlier product routing fix (still in force)

| Bug | Fix |
|-----|-----|
| API key required before local path | `chat-service` skips key when local-resolvable |
| `read_only` blocked under-N / pause follow-ups | force LOCAL-FIRST when `LocalEditorialRequest` says orch |
| Follow-up wording gaps | compositional slots + direct/session handlers |

Module: `electron/ai-edition/localEditorialChat/`

**Not changed:** Director, planner, Temporal Context Store, SPEED/focal thresholds.

---

## Provider-down E2E A–H (fixture `recording-1789551162068`)

Still green from prior run: professionalize / duration / pauses / speed route / undo zoom / captions / restore with **0 cloud calls**.

---

## Remaining limitations

1. Relative intensification after an already-tight programme often honest-no-ops (correct safety; deeper “more aggressive” delta incomplete).  
2. Programme duration bookkeeping in harness vs orch receipt can disagree on clip `timelineEndSec`.  
3. Orch turns still construct a Chat model object for fallthrough; **no provider stream** (`modelCallCount=0`).

---

## Verdict

**PASS_WITH_LIMITATIONS** — local Chat control + **intent robustness** accepted (`TARGET_DURATION_LOCAL` / `LOCAL_FIRST_CHAT_ROUTER` = PASS). Remaining gaps are relative-edit depth / measurement, not “users must know exact matcher sentences” or “cloud required for ordinary edits.”

**HARD STOP.** Next: full real-video acceptance (“is this publishably better?”).

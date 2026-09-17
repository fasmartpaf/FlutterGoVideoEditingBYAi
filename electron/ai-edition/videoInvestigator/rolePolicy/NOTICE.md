# Attribution — Investigator V1.1 role-policy references

This directory adapts **architectural ideas only** (planner/grounder/verifier
roles, global→local search, bounded stop). No upstream model weights or
training code are vendored.

| Project | Repo | Inspected commit | License | Use |
|---------|------|------------------|---------|-----|
| LongVideoAgent | https://github.com/longvideoagent/LongVideoAgent | `6edd180b0c5b41c0c5f00e3d96f482a4eb5b27e2` | **No LICENSE file found** (treat as reference-only) | Grounding→vision loop, step budget K, stop when evidence enough |
| VideoMind | https://github.com/yeliudev/VideoMind | `6721d2564eeb9ea8ab6c0ab8eaa39bd231ee8927` | BSD-3-Clause | Planner / Grounder / Verifier / Answerer role separation (as internal states, not LoRA agents) |
| LongVT | https://github.com/EvolvingLMMs-Lab/LongVT | `08d755b973e4ad990ac5cdd64fb992c804d840db` | Apache-2.0 | Global→local crop/zoom loop until grounded |

OpenScreen keeps a **single deterministic Investigator**; roles are planning
states that gate existing tools. **0 policy-classifier LLM calls.**

# Planning → Investigation Closure V1

Provider id: `CURRENT_OPENSCREEN_PLANNING_CLOSURE_V1`

## Role

When Edit Plan prefers `needs_more_evidence`, request the minimum Investigator V1.1 evidence, recompute Ledger → Claims → Source → Target → Gap → Plan, and resolve or stop honestly.

## Non-goals

- Does not execute edits
- Does not mutate AxcutDocument
- Does not invent source facts
- Does not loop until a preferred strategy is forced

## Budgets

- max rounds: 2
- max requests / round: 3
- request identity dedupe: 1 per turn

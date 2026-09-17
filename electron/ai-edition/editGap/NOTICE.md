# Edit Gap V1

Provider id: `CURRENT_OPENSCREEN_EDIT_GAP_V1`

## Role

Editorial delta between **Source Story V2** (what happened) and **Target Story V1** (desired viewer experience).

## Non-goals

- Not an Edit Plan
- Does not choose OpenScreen tools
- Does not execute edits
- Does not mutate AxcutDocument
- Does not invent source facts or assume unknown actions

## Inputs

- Source Story V2
- Target Story V1 (desired-state authority; user intent already normalized there)

## Outputs

Structured `EditGapV1`: gaps, preserved, unresolved, hardConstraints, metrics.

## Epistemics

Inherit Source Story / Target Story constraints (Upwork = context; Restart tip ≠ restart action; Settings speech ≠ Settings opened).

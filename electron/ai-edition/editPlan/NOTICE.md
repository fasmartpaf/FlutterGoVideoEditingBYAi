# Edit Plan V1

Provider id: `CURRENT_OPENSCREEN_EDIT_PLAN_V1`

## Role

Map trusted **Edit Gap V1** items to candidate editorial strategies and OpenScreen **tool families**.

## Non-goals

- Does not execute edits
- Does not mutate AxcutDocument
- Does not call editing tools
- Does not emit executable tool arguments (`addTrim(8.2, 9.4)`, etc.)
- Does not redefine Target Story from tool availability

## Inputs

- Source Story V2
- Target Story V1
- Edit Gap V1
- EditCapabilityRegistry (actual OpenScreen support)

## Outputs

Structured `EditPlanV1`: ranked candidate strategies, feasibility, preservation constraints, conflicts, needs-more-evidence.

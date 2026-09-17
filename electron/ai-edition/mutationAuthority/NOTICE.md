# Single Mutation Authority V1

Identity: `CURRENT_OPENSCREEN_SINGLE_MUTATION_AUTHORITY_V1`

For semantic/editorial AI requests, AxcutDocument mutations must not occur via
the main agent tool loop. The only commit path is:

Constrained Edit Proposal → UI Consent → Apply Preview → verify → commit.

Deterministic explicit edits keep the existing direct-tool contract.

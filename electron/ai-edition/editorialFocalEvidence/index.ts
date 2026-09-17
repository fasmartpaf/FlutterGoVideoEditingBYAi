/**
 * Local Editorial Focal Evidence V1 — public API.
 */

export {
	buildEditorialFocalEvidence,
	fingerprintSource,
	resetFocalEvidenceSeqForTests,
} from "./buildEvidence";
export { decideCrop } from "./cropDecision";
export {
	detectDwellRuns,
	interactionClusters,
	interactionInstants,
	isFastCrossing,
	sortSamples,
} from "./cursorMetrics";
export { deriveGroundedFocalTargets } from "./deriveTarget";
export { deriveZoomGeometry } from "./geometry";
export { investigateFocalWindow } from "./investigate";
export { toOrchestratorGroundedFocals } from "./orchestratorBridge";
export { FOCAL_POLICY_V1 } from "./policy";
export { remapFocalTargetAfterMutation } from "./remap";
export type { AnalyzeEditorialFocalArgs } from "./run";
export { analyzeEditorialFocalEvidence } from "./run";
export { focalEvidenceToTemporalRecords } from "./temporalBridge";
export type * from "./types";
export { LOCAL_EDITORIAL_FOCAL_EVIDENCE_V1_ID } from "./types";
export { decideZoom } from "./zoomDecision";

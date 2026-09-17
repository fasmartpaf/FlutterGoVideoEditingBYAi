/**
 * Professional Edit Execution Orchestrator V1 — public API.
 */

export {
	assertReceiptMatchesFinalDocument,
	buildAuthorizationAsk,
	buildFinalAssessment,
	claimedFamiliesFromReceipt,
	finalCommittedFamiliesFromDocument,
} from "./assessment";
export {
	authorizationStillValid,
	authorizePlanFromUserText,
	fingerprintPlan,
} from "./authorization";
export {
	type EditCollisionDispositionV1,
	type EditCollisionRecordV1,
	recordCollision,
	zoomCalloutCompatible,
} from "./collision";
export type { ProfessionalFamilyDecisionV1 } from "./decisionTable";
export { buildProfessionalDecisionTable } from "./decisionTable";
export { assessDurationObjective } from "./duration";
export type { GroundedFocalTargetV1, ZoomExecutionCandidateV1 } from "./focal";
export {
	discoverGroundedFocalTargets,
	remapGroundedFocalAfterMutation,
} from "./focal";
export {
	isBareAffirmation,
	isExplicitPauseRemovalRequest,
	isProfessionalEditRequest,
	isVerbalProceed,
	parseProfessionalEditIntent,
} from "./intent";
export { investigateFocalInRange } from "./investigation";
export type { LoudnessCoordinationOutcome, LoudnessCoordinationResultV1 } from "./loudnessCoord";
export { coordinateLoudnessForProfessionalEdit } from "./loudnessCoord";
export { buildPackedEditorialTranscript } from "./packedTranscript";
export { buildProfessionalEditPlan } from "./plan";
export {
	buildProfessionalZoomIntent,
	expandZoomRangeForLifecycle,
	type ProfessionalZoomIntentV1,
} from "./professionalZoom";
export {
	type RunProfessionalEditOrchestratorArgs,
	runProfessionalEditOrchestrator,
} from "./run";
export {
	stripFalseProjectEditsDisabledClaim,
	stripRepeatedProceedAsks,
	stripUnsupportedTransitionClaims,
} from "./sanitize";
export {
	createExecutionSession,
	executeAuthorizedPlan,
} from "./session";
export { buildProfessionalEditStory } from "./story";
export type {
	DurationObjectiveAssessmentV1,
	PackedEditorialTranscriptV1,
	PlanAuthorizationV1,
	ProfessionalEditExecutionSessionV1,
	ProfessionalEditFinalAssessmentV1,
	ProfessionalEditIntentV1,
	ProfessionalEditOrchestratorResultV1,
	ProfessionalEditPlanV1,
	ProfessionalEditStoryV1,
} from "./types";
export {
	PROFESSIONAL_EDIT_ORCHESTRATOR_V1_ID,
	PROFESSIONAL_EDIT_POLICY_VERSION,
} from "./types";
export type {
	CapabilityUtilizationRowV1,
	ProfessionalEditCapabilityUtilizationV1,
} from "./utilization";
export { emptyUtilization, upsertUtilization } from "./utilization";
export type {
	FinalSequenceWarningDispositionKind,
	FinalSequenceWarningDispositionV1,
} from "./warningDisposition";
export {
	disposeFinalSequenceResult,
	disposeFinalSequenceWarning,
} from "./warningDisposition";

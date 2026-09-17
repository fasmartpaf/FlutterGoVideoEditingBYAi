/**
 * Autonomous Professional Editor / Editorial Director V1 — public API.
 */

export { compileEditorialIntents, prioritizeOpportunitiesByDirector } from "./compiler";
export { buildTransformationDecisions } from "./decisionsFromPlan";
export {
	createDeterministicEditorialDirector,
	resetDirectorSeqForTests,
} from "./deterministicDirector";
export type { FinalEditorialQualityReviewV1 } from "./finalEditorialQualityReview";
export { buildFinalEditorialQualityReview } from "./finalEditorialQualityReview";
export { probeLocalReasoningAvailability } from "./localProbe";
export type { EditorialDirectorRequestV1, EditorialReasoningProvider } from "./provider";
export { formatSourceStoryReadable } from "./readableStory";
export { MAX_AUTONOMOUS_REVISIONS_V1, reviewFinalProgramme } from "./selfReview";
export {
	type AutonomousProfessionalEditSessionResultV1,
	runAutonomousProfessionalEditSession,
} from "./session";
export {
	buildEditingSkillRegistryV1,
	executableSkills,
	productCapabilityGaps,
} from "./skillRegistry";
export { buildMultimodalSourceStory } from "./sourceStory";
export {
	formatSourceStoryMarkdown,
	formatStoryDiffMarkdown,
	formatTargetStoryMarkdown,
} from "./storyReadable";
export { buildTargetEditStory } from "./targetStory";
export type { EditorialTransformationDecisionV1 } from "./transformationDecision";
export {
	decideApplyOrKeep,
	isToolAvailabilityOnlyReason,
	makeTransformationDecision,
} from "./transformationDecision";
export type * from "./types";
export {
	AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID,
	EDITORIAL_DIRECTOR_V1_ID,
} from "./types";
export type {
	VideoProblemKindV1,
	VideoProblemMapV1,
	VideoProblemV1,
} from "./videoProblemMap";
export { buildVideoProblemMap } from "./videoProblemMap";

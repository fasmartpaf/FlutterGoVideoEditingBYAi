/**
 * Edit Gap V1 — Source Story V2 vs Target Story V1 editorial delta.
 * Does NOT execute edits. Does NOT select tools. Does NOT mutate AxcutDocument.
 */

export { buildEditGapV1, resetEditGapSeqForTests } from "./buildGap";
export {
	assertsForbiddenRestartActionCleanup,
	assertsForbiddenUpworkWorkflowRemoval,
	leaksToolOrEditPlan,
	sanitizeGapProse,
} from "./guards";
export { prepareEditGapForTurn, wantsEditGap } from "./prepare";
export type {
	EditGapCategory,
	EditGapConfidence,
	EditGapImportance,
	EditGapInput,
	EditGapItem,
	EditGapPreserved,
	EditGapProvenance,
	EditGapQualityRubric,
	EditGapUnresolved,
	EditGapV1,
} from "./types";
export { EDIT_GAP_CATEGORIES, EDIT_GAP_V1_PROVIDER_ID } from "./types";
export { evaluateEditGapRubric, validateAndSanitizeEditGapV1 } from "./validate";

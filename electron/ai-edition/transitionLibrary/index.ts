/**
 * Transition Library public surface — ONE registry for manual / Chat / autonomous.
 */

export {
	type BoundaryEvidenceV5,
	decideAutonomousTransitions,
	type EditorialRelationshipV5,
	type TransitionFamilyV5,
} from "./autonomousIntelligence";
export {
	readTransitionPreferenceSignals,
	recordTransitionPreferenceSignal,
	type TransitionPreferenceSignalKind,
} from "./preferences";
export {
	GL_TRANSITIONS_PINNED_REVISION,
	type GpuBackend,
	getTransitionById,
	legacyKindToTransitionId,
	listAutonomousEligible,
	listUserAvailableTransitions,
	NATIVE_IMPL_MODE,
	OPENSCREEN_TRANSITION_REGISTRY_VERSION,
	registryStats,
	resolveTransitionId,
	TRANSITION_REGISTRY,
	type TransitionApplyValidation,
	type TransitionAvailability,
	type TransitionCategory,
	type TransitionEditorialMeta,
	type TransitionRegistryEntry,
	validateAndClampTransitionApply,
} from "./registry";
export {
	resolveTransitionPhrase,
	searchTransitions,
	type TransitionPhraseResolution,
} from "./resolvePhrase";

// notices.ts writes files via node:fs — do NOT re-export from this barrel.
// Renderer imports this package; pulling notices crashes the editor (black screen).
// Import `./notices` directly from main-process / scripts / tests only.

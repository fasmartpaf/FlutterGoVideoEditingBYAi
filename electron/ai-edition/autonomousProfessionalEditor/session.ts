/**
 * Autonomous Professional Edit Session V1
 * ANALYZE → SOURCE/TARGET STORY → DIRECT → GROUND → PLAN → EXECUTE → REVIEW
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	type ProfessionalEditOrchestratorResultV1,
	type RunProfessionalEditOrchestratorArgs,
	runProfessionalEditOrchestrator,
} from "../professionalEditOrchestrator";
import { probeLocalReasoningAvailability } from "./localProbe";
import type { LocalReasoningProbeResult } from "./provider";
import { MAX_AUTONOMOUS_REVISIONS_V1, reviewFinalProgramme } from "./selfReview";
import { buildEditingSkillRegistryV1, productCapabilityGaps } from "./skillRegistry";
import {
	AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID,
	type CompiledIntentResultV1,
	type EditorialIntentPlanV1,
	type FinalResultSelfReviewV1,
	type MultimodalSourceStoryV1,
	type TargetEditStoryV1,
} from "./types";

export interface AutonomousProfessionalEditSessionResultV1 {
	providerId: typeof AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID;
	version: 1;
	sourceStory: MultimodalSourceStoryV1;
	targetStory: TargetEditStoryV1;
	intentPlan: EditorialIntentPlanV1;
	compiled: CompiledIntentResultV1[];
	skillGaps: ReturnType<typeof productCapabilityGaps>;
	localReasoningProbe: LocalReasoningProbeResult;
	orchestrator: ProfessionalEditOrchestratorResultV1;
	selfReview: FinalResultSelfReviewV1;
	document: AxcutDocument;
	metrics: {
		paidAiCalls: 0;
		autoUnverifiedMutations: 0;
		maxMutationsPerPreview: 1;
		maxRevisions: typeof MAX_AUTONOMOUS_REVISIONS_V1;
		revisionsUsed: number;
		totalMs: number;
	};
}

export async function runAutonomousProfessionalEditSession(
	args: RunProfessionalEditOrchestratorArgs,
): Promise<AutonomousProfessionalEditSessionResultV1> {
	const t0 = Date.now();
	const localProbe = await probeLocalReasoningAvailability();
	const orchestrator = await runProfessionalEditOrchestrator(args);
	const auto = orchestrator.autonomous;
	if (!auto) {
		throw new Error("autonomous_director_layer_missing_from_orchestrator");
	}
	const selfReview =
		auto.selfReview ??
		reviewFinalProgramme({
			result: orchestrator,
			originalDurationSec: auto.sourceStory.sourceDurationSec,
			revisionUsed: 0,
		});

	return {
		providerId: AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID,
		version: 1,
		sourceStory: auto.sourceStory,
		targetStory: auto.targetStory,
		intentPlan: auto.intentPlan,
		compiled: auto.compiled,
		skillGaps: productCapabilityGaps(buildEditingSkillRegistryV1()),
		localReasoningProbe: localProbe,
		orchestrator,
		selfReview,
		document: orchestrator.document,
		metrics: {
			paidAiCalls: 0,
			autoUnverifiedMutations: 0,
			maxMutationsPerPreview: 1,
			maxRevisions: MAX_AUTONOMOUS_REVISIONS_V1,
			revisionsUsed: 0,
			totalMs: Date.now() - t0,
		},
	};
}

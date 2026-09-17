/**
 * Provider-neutral Editorial Reasoning Provider for the Director.
 */

import type { TemporalReasoningPacketV1 } from "../temporalContextStore/types";
import type {
	EditingSkillV1,
	EditorialIntentPlanV1,
	MultimodalSourceStoryV1,
	ReasoningProviderKindV1,
	TargetEditStoryV1,
} from "./types";

export interface EditorialDirectorRequestV1 {
	requestId: string;
	sourceStory: MultimodalSourceStoryV1;
	targetStory: TargetEditStoryV1;
	skillRegistry: EditingSkillV1[];
	temporalPacket?: TemporalReasoningPacketV1 | null;
	userMessage: string;
}

export interface EditorialReasoningProvider {
	id: string;
	kind: ReasoningProviderKindV1;
	direct(request: EditorialDirectorRequestV1): Promise<EditorialIntentPlanV1>;
}

export interface LocalReasoningProbeResult {
	available: boolean;
	kind: ReasoningProviderKindV1 | null;
	endpoint?: string;
	modelId?: string;
	note: string;
}

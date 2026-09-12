export {
	appendSourceStoryToUserMessage,
	prepareSourceStoryForTurn,
	wantsSourceStory,
} from "./prepare";
export { buildSourceStoryPromptSection } from "./prompt";
export {
	buildSourceStoryScaffold,
	collectStoryBoundaryCandidates,
	formatSourceStoryScaffoldText,
	speechSegmentsToScaffoldSpeech,
} from "./scaffold";
export type {
	PreparedSourceStory,
	SourceStory,
	SourceStoryBeat,
	SourceStoryBeatEvidence,
	SourceStoryConfidence,
	SourceStoryContentType,
	SourceStoryPurpose,
	SourceStoryScaffold,
	SourceStoryScaffoldSpeech,
	SourceStoryScaffoldWindow,
	SourceStoryUncertainty,
} from "./types";
export {
	SOURCE_STORY_CONFIDENCES,
	SOURCE_STORY_CONTENT_TYPES,
	SOURCE_STORY_PURPOSES,
} from "./types";
export {
	extractSourceStoryJson,
	fillUncoveredSpeechGapBeats,
	hedgeContradictionOverallSummary,
	normalizeSourceStoryContentType,
	normalizeSourceStoryPurpose,
	parseAndValidateSourceStory,
	validateSourceStory,
} from "./validate";

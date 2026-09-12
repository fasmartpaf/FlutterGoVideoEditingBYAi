/**
 * Turn-local evidence requirements — not an LLM call, not Source Story.
 * Separates preparation (gather) from injection (send to the model).
 */

export type MediaRequestCategory =
	| "deterministicEdit"
	| "visualInspection"
	| "speechInspection"
	| "mediaUnderstanding"
	| "editingContext"
	| "fallback";

export interface MediaContextNeeds {
	category: MediaRequestCategory;
	visual: boolean;
	speech: boolean;
	cursor: boolean;
	/**
	 * Whether speech evidence should be expected / surfaced this turn
	 * (capabilities + tool guidance). Independent of whether a transcript
	 * already exists on the document.
	 *
	 * TRANSCRIPT EXISTS ≠ TRANSCRIPT MUST BE SENT.
	 */
	injectSpeech: boolean;
}

export const EMPTY_MEDIA_CONTEXT_NEEDS: MediaContextNeeds = {
	category: "fallback",
	visual: false,
	speech: false,
	cursor: false,
	injectSpeech: false,
};

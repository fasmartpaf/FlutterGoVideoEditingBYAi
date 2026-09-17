/**
 * Evidence sufficiency + deepen decision (deterministic).
 */

import type { VisualEvidenceCoverage } from "./coverage";
import type { VideoMemoryQueryClass, VideoMemoryRetrieval, VideoMemoryV1 } from "./index";

export type SufficiencyDecision = {
	sufficient: boolean;
	runInvestigator: boolean;
	deepenHints: string[];
	reason: string;
};

export function evaluateEvidenceSufficiency(input: {
	queryClass: VideoMemoryQueryClass;
	queryScope?: import("./queryScope").QueryScope;
	retrieval: VideoMemoryRetrieval;
	memory: VideoMemoryV1;
	hasSpeechEvidence: boolean;
	attachedFrameCount: number;
	visualCoverage?: VisualEvidenceCoverage | null;
	/** First turn on this asset in session — prefer deepen for understanding. */
	isColdStart?: boolean;
}): SufficiencyDecision {
	const hints = [...input.retrieval.deepeningHints];
	const { queryClass, memory, hasSpeechEvidence, attachedFrameCount } = input;

	if (queryClass === "direct_edit") {
		return {
			sufficient: true,
			runInvestigator: false,
			deepenHints: [],
			reason: "direct_edit uses deterministic tools; no media deepen",
		};
	}

	if (queryClass === "speech") {
		if (hasSpeechEvidence && memory.speechWindows.length > 0) {
			return {
				sufficient: true,
				runInvestigator: false,
				deepenHints: [],
				reason: "speech windows available; frames not required",
			};
		}
		return {
			sufficient: false,
			runInvestigator: true,
			deepenHints: ["recover speech chronology if STT thin"],
			reason: "speech query without usable speech windows",
		};
	}

	if (queryClass === "action_verify") {
		return {
			sufficient: false,
			runInvestigator: true,
			deepenHints: hints.length
				? hints
				: ["verify named UI action against visual/cursor; keep UNKNOWN if unproven"],
			reason: "action_verify always requires bounded Investigator deepen",
		};
	}

	if (queryClass === "cross_modal") {
		const cov = input.visualCoverage;
		const starved = attachedFrameCount === 0 || (cov && !cov.coverageSufficient);
		const needsDeep =
			memory.contradictionHints.length > 0 || starved || input.retrieval.needsInvestigatorDeepening;
		return {
			sufficient: !needsDeep && Boolean(hasSpeechEvidence) && attachedFrameCount > 0,
			runInvestigator: needsDeep,
			deepenHints: needsDeep
				? hints.length
					? hints
					: ["resolve speech↔visual in focus range"]
				: [],
			reason:
				attachedFrameCount === 0
					? "cross_modal without visual frames"
					: starved
						? `cross_modal visual coverage insufficient: ${cov?.reason ?? "unknown"}`
						: needsDeep
							? "cross_modal needs deepen"
							: "cross_modal speech+visual present",
		};
	}

	if (queryClass === "visual") {
		const cov = input.visualCoverage;
		if (attachedFrameCount > 0 || memory.visualTransitionCount > 0) {
			const coverageOk = !cov || cov.coverageSufficient;
			return {
				sufficient: coverageOk,
				runInvestigator: Boolean(input.isColdStart && attachedFrameCount < 2) || !coverageOk,
				deepenHints: !coverageOk
					? ["obtain distributed visual samples — current pack is not whole-media sufficient"]
					: input.isColdStart
						? ["confirm frontmost surface if unclear"]
						: [],
				reason: coverageOk
					? "visual samples present"
					: (cov?.reason ?? "visual coverage insufficient"),
			};
		}
		return {
			sufficient: false,
			runInvestigator: true,
			deepenHints: ["obtain targeted visual samples"],
			reason: "visual query without frames",
		};
	}

	if (queryClass === "editorial") {
		const hasStory = memory.sourceStoryBeatCount > 0 || Boolean(memory.sourceStorySummary);
		const cov = input.visualCoverage;
		const coverageFail = Boolean(cov && !cov.coverageSufficient);
		const runInv =
			input.isColdStart ||
			memory.contradictionHints.length > 0 ||
			(memory.temporaryUiHints.length > 0 && attachedFrameCount === 0) ||
			coverageFail ||
			attachedFrameCount === 0;
		return {
			sufficient: hasStory && !runInv && !coverageFail,
			runInvestigator: runInv,
			deepenHints: runInv
				? hints.length
					? hints
					: coverageFail
						? ["whole-media editorial needs distributed visual evidence"]
						: ["ground temporary UI / contradictions before editorial advice"]
				: [],
			reason: coverageFail
				? (cov?.reason ?? "editorial visual coverage insufficient")
				: runInv
					? "editorial deepen for grounding"
					: "editorial memory adequate",
		};
	}

	return {
		sufficient: !input.isColdStart,
		runInvestigator: Boolean(input.isColdStart),
		deepenHints: input.isColdStart ? ["general cold-start grounding"] : [],
		reason: "general policy",
	};
}

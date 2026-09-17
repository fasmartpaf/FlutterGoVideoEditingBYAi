/**
 * Main Local Professional Editorial Planner runner.
 */

import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { DeadAirCandidateV1 } from "../deadAir";
import type {
	EditorialFocalAnalysisBundleV1,
	VisualChangeIntervalV1,
} from "../editorialFocalEvidence";
import type {
	PackedEditorialTranscriptV1,
	ProfessionalEditIntentV1,
	ProfessionalEditStoryV1,
} from "../professionalEditOrchestrator/types";
import {
	generateCalloutOpportunities,
	generateCaptionOpportunities,
	generateCropOpportunities,
	generateLoudnessOpportunity,
	generateSpeedOpportunities,
	generateTitleOpportunities,
	generateTransitionOpportunities,
	generateTrimOpportunities,
	generateZoomOpportunities,
} from "./opportunities";
import { rankOpportunities, selectReadyOpportunities } from "./rank";
import { deriveStoryPhases } from "./storyPhases";
import { buildAndQueryTemporalContext } from "./temporal";
import {
	LOCAL_PROFESSIONAL_EDITORIAL_PLANNER_V1_ID,
	type ProfessionalEditorialPlannerResultV1,
} from "./types";

export interface PlanProfessionalEditorialArgs {
	document: AxcutDocument;
	assetId: string;
	mediaPath?: string | null;
	aspectValue?: number;
	intent: ProfessionalEditIntentV1;
	packed: PackedEditorialTranscriptV1;
	story: ProfessionalEditStoryV1;
	deadAir: DeadAirCandidateV1[];
	focal: EditorialFocalAnalysisBundleV1 | null;
	visualIntervals?: VisualChangeIntervalV1[] | null;
	sourceDurationSec: number;
	captionsLayoutOk?: boolean;
	captionCueCount?: number;
	loudnessSafeToPropose?: boolean;
	loudnessOutcome?: string | null;
	aspectFramingRequired?: boolean;
	framingCrop?: {
		x: number;
		y: number;
		width: number;
		height: number;
		clipId: string;
	} | null;
	/** When true and multi-clip, propose a short dissolve at the second clip. */
	wantDissolveTransition?: boolean;
}

export function planProfessionalEditorialOpportunities(
	args: PlanProfessionalEditorialArgs,
): ProfessionalEditorialPlannerResultV1 {
	const t0 = Date.now();
	const aspect = args.aspectValue ?? 16 / 9;
	const captionsEnabled = getCaptionSettings(args.document, aspect).enabled;
	const visualIntervals = args.visualIntervals ?? [];

	const transcript = args.document.transcripts?.find((t) => t.assetId === args.assetId);
	const speechWords = (transcript?.words ?? []).map((w) => ({
		id: w.id,
		text: w.text,
		sourceStartSec: w.startSec,
		sourceEndSec: w.endSec,
	}));

	const temporal = buildAndQueryTemporalContext({
		document: args.document,
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		aspectValue: aspect,
		deadAir: args.deadAir,
		focal: args.focal,
		visualIntervals,
		captionsEnabled,
		sourceDurationSec: args.sourceDurationSec,
		speechWords,
	});

	const phases = deriveStoryPhases({
		packed: args.packed,
		story: args.story,
		visualIntervals,
		sourceDurationSec: args.sourceDurationSec,
	});

	const opportunities = [
		...generateTrimOpportunities({
			deadAir: args.deadAir,
			story: args.story,
			phases,
			visualIntervals,
		}),
		...generateZoomOpportunities({
			focal: args.focal,
			story: args.story,
			phases,
			packed: args.packed,
		}),
		...generateSpeedOpportunities({
			visualIntervals,
			packed: args.packed,
			phases,
			focal: args.focal,
			deadAir: args.deadAir,
			document: args.document,
		}),
		...generateCropOpportunities({
			focal: args.focal,
			aspectFramingRequired: args.aspectFramingRequired,
			framingCrop: args.framingCrop,
		}),
		...generateTitleOpportunities({
			story: args.story,
			packed: args.packed,
			wantProfessional: args.intent.requestedOutcome === "MAKE_PROFESSIONAL",
			existingAnnotationCount: (args.document.annotations ?? []).filter(
				(a) => a.annotationSource !== "auto-caption",
			).length,
		}),
		...generateCalloutOpportunities({
			focal: args.focal,
			packed: args.packed,
		}),
		...generateTransitionOpportunities({
			clipCount: args.document.timeline.clips.length,
			secondClipId: args.document.timeline.clips[1]?.id ?? null,
			wantDissolve: Boolean(args.wantDissolveTransition),
			document: args.document,
		}),
		...generateCaptionOpportunities({
			captionsEnabled,
			wantCaptions: args.intent.wantCaptions,
			layoutOk: args.captionsLayoutOk !== false,
			cueCount: args.captionCueCount ?? 0,
		}),
		generateLoudnessOpportunity({
			outcome: args.loudnessOutcome,
			safeToPropose: args.loudnessSafeToPropose,
		}),
	];

	const ranked = rankOpportunities(opportunities);
	const ready = selectReadyOpportunities(ranked);

	const coverage = temporal.packet.evidenceCoverage;
	return {
		providerId: LOCAL_PROFESSIONAL_EDITORIAL_PLANNER_V1_ID,
		version: 1,
		opportunities: ranked,
		ready,
		storyPhases: phases,
		temporalPacketSummary: {
			recordCount: temporal.packet.metrics.recordCountIncluded,
			coverage: {
				speech: coverage.speechCoverage,
				visual: coverage.visualCoverage,
				focal: coverage.focalCoverage,
				cursor: coverage.cursorCoverage,
				loudness: coverage.loudnessCoverage,
				caption: coverage.captionLayoutCoverage,
			},
			consumed: true,
		},
		temporalPacket: temporal.packet,
		metrics: {
			buildMs: Date.now() - t0,
			paidAiCalls: 0,
			temporalContextConsumed: true,
		},
	};
}

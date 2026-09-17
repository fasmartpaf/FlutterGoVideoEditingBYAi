/**
 * Product surface pipeline: gather → orchestrate → reason → single proposal + review card.
 * Never mutates. Never paid AI. Never multi-apply.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { prepareApplyPreviewDiagnostics } from "../applyPreview";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import {
	type ReasonedEditorialRecommendationSetV1,
	runBoundedEditorialReasoning,
} from "../boundedEditorialReasoning";
import {
	type EditorialRecommendationSetV1,
	orchestrateFromSignals,
	resetOrchestrationSeqForTests,
	resetSurfaceSeqForTests,
} from "../editorialOrchestration";
import type { SpeechEvidence } from "../speechEvidence/types";
import { createTemporalContextStore } from "../temporalContextStore";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import { buildEditReviewAttachment } from "../uiConsent";
import type { VisualChange } from "../visualEvidence/types";
import { gatherLocalEditorialSignals } from "./gatherSignals";
import { goalTextForReasoning } from "./intents";
import {
	buildUserFacingOffer,
	recommendationToEditProposal,
	selectProductRecommendation,
} from "./toProposal";
import {
	EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1_ID,
	type EditorialRecommendationProductSurfaceResult,
	type LocalSupportedFamily,
} from "./types";

export interface RunEditorialRecommendationProductSurfaceArgs {
	document: AxcutDocument;
	assetId: string;
	mediaPath?: string | null;
	userMessage: string;
	aspectValue?: number;
	speechEvidence?: SpeechEvidence | null;
	preparedChanges?: VisualChange[] | null;
	ledger?: TemporalEventLedger | null;
	signal?: AbortSignal;
	/** Skip bounded reasoning (tests / latency). Still orchestrates. */
	skipReasoning?: boolean;
	/** Test hooks */
	injectedDeadAirCandidates?: import("../deadAir").DeadAirCandidateV1[] | null;
	forceDeadAir?: boolean;
	bypassDeadAirCache?: boolean;
	resetSeqForTests?: boolean;
}

function familiesFromSet(
	set: EditorialRecommendationSetV1 | ReasonedEditorialRecommendationSetV1,
): LocalSupportedFamily[] {
	const out = new Set<LocalSupportedFamily>();
	for (const r of set.recommendations) {
		if (
			!(
				(r.recommendationStatus === "RECOMMEND" || r.recommendationStatus === "OPTIONAL") &&
				r.executionReadiness === "READY_TO_APPLY"
			)
		) {
			continue;
		}
		if (r.operationFamily === "TRIM") out.add("trim");
		if (r.operationFamily === "CAPTIONS") out.add("caption");
		if (r.operationFamily === "ZOOM") out.add("zoom");
		if (r.operationFamily === "CROP") out.add("crop");
		if (r.operationFamily === "SPEED") out.add("speed");
		if (r.operationFamily === "LOUDNESS") out.add("loudness");
	}
	return [...out];
}

export async function runEditorialRecommendationProductSurface(
	args: RunEditorialRecommendationProductSurfaceArgs,
): Promise<EditorialRecommendationProductSurfaceResult> {
	if (args.resetSeqForTests) {
		resetOrchestrationSeqForTests();
		resetSurfaceSeqForTests();
	}

	const gathered = await gatherLocalEditorialSignals({
		document: args.document,
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		userMessage: args.userMessage,
		aspectValue: args.aspectValue,
		speechEvidence: args.speechEvidence,
		preparedChanges: args.preparedChanges,
		ledger: args.ledger,
		signal: args.signal,
		injectedDeadAirCandidates: args.injectedDeadAirCandidates,
		forceDeadAir: args.forceDeadAir,
		bypassDeadAirCache: args.bypassDeadAirCache,
	});

	const tOrch0 = Date.now();
	const orch = orchestrateFromSignals({
		bundle: gathered.bundle,
		bypassCache: true,
	});
	const orchestrateMs = Date.now() - tOrch0;
	let orchestrationSet = orch.set;
	let reasonedSet: ReasonedEditorialRecommendationSetV1 | null = null;
	let reasonMs = 0;

	if (!args.skipReasoning) {
		const tR0 = Date.now();
		try {
			const transcript = args.document.transcripts.find((t) => t.assetId === args.assetId);
			const store = createTemporalContextStore({
				document: args.document,
				assetId: args.assetId,
				mediaFingerprint: gathered.bundle.mediaFingerprint,
				signals: gathered.bundle,
				editorialSet: orchestrationSet,
				speechWords: (transcript?.words ?? [])
					.filter((w) => w.text.trim().length > 0)
					.map((w) => ({
						id: w.id,
						text: w.text,
						sourceStartSec: w.startSec,
						sourceEndSec: w.endSec,
					})),
			});
			const reasoned = await runBoundedEditorialReasoning({
				store,
				orchestrationSet,
				goalText: goalTextForReasoning(gathered.intents),
			});
			reasonedSet = reasoned.finalSet;
			// Prefer reasoned surface when it still has recommendations; else keep orch.
			if (reasoned.finalSet.recommendations.length > 0) {
				const mappedStatus =
					reasoned.finalSet.status === "NO_ACTION_RECOMMENDED"
						? ("NO_ACTION_RECOMMENDED" as const)
						: reasoned.finalSet.status === "NEEDS_HUMAN_JUDGMENT"
							? ("NEEDS_HUMAN_JUDGMENT" as const)
							: ("ACTIONS_AVAILABLE" as const);
				orchestrationSet = {
					...orchestrationSet,
					recommendations: reasoned.finalSet.recommendations,
					unresolvedQuestions: reasoned.finalSet.unresolvedQuestions,
					status: mappedStatus,
					summary: reasoned.finalSet.summary,
				};
			}
		} catch (err) {
			gathered.notes.push(
				`reasoning_failed:${err instanceof Error ? err.message.slice(0, 80) : String(err)}`,
			);
		}
		reasonMs = Date.now() - tR0;
	}

	const tProp0 = Date.now();
	const selected = selectProductRecommendation({
		set: orchestrationSet,
		intents: gathered.intents,
	});

	let editProposalV1 = null as EditorialRecommendationProductSurfaceResult["editProposalV1"];
	let applyPreviewV1 = null as EditorialRecommendationProductSurfaceResult["applyPreviewV1"];
	let editReview = null as EditorialRecommendationProductSurfaceResult["editReview"];

	if (selected) {
		editProposalV1 = recommendationToEditProposal({
			document: args.document,
			assetId: args.assetId,
			aspectValue: gathered.bundle.aspectValue,
			recommendation: selected,
			captionLayout: gathered.captionLayout,
			deadAirCandidates: gathered.deadAirCandidates,
		});
		if (editProposalV1) {
			const docFp = fingerprintDocument(args.document).value;
			applyPreviewV1 = prepareApplyPreviewDiagnostics({
				document: args.document,
				editProposalV1,
				proposalDocumentFingerprint: docFp,
			});
			editReview = buildEditReviewAttachment({
				editProposalV1,
				preflight: applyPreviewV1.preflight,
				documentFingerprint: docFp,
			});
		} else {
			gathered.notes.push("proposal_build_failed");
		}
	}

	const proposalMs = Date.now() - tProp0;
	const supportedFamilies = familiesFromSet(reasonedSet ?? orchestrationSet);
	const doNothing =
		orchestrationSet.status === "NO_ACTION_RECOMMENDED" ||
		(!editReview?.cards.some((c) => c.canApply) && selected == null);

	const userFacingOffer = buildUserFacingOffer({
		recommendation: selected,
		doNothing,
		intents: gathered.intents,
		notes: gathered.notes,
	});

	return {
		providerId: EDITORIAL_RECOMMENDATION_PRODUCT_SURFACE_V1_ID,
		intents: gathered.intents,
		signalBundle: gathered.bundle,
		orchestrationSet,
		reasonedSet,
		selectedRecommendation: selected,
		editProposalV1,
		applyPreviewV1,
		editReview,
		supportedFamilies,
		userFacingOffer,
		doNothing,
		notes: gathered.notes,
		metrics: {
			gatherMs: gathered.metrics.gatherMs,
			orchestrateMs,
			reasonMs,
			proposalMs,
			deadAirRan: gathered.metrics.deadAirRan,
			captionLayoutRan: gathered.metrics.captionLayoutRan,
			additionalModelCalls: 0,
			paidAiCalls: 0,
			autoMutations: 0,
		},
	};
}

/**
 * Professional edit orchestrator pipeline (+ Quality Closure V1).
 */

import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { readCursorSidecar } from "../../media/cursorSidecar";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import type { AudioPcmProvider } from "../audioVerify";
import {
	buildEditingSkillRegistryV1,
	buildMultimodalSourceStory,
	buildTargetEditStory,
	compileEditorialIntents,
	createDeterministicEditorialDirector,
	MAX_AUTONOMOUS_REVISIONS_V1,
	prioritizeOpportunitiesByDirector,
	reviewFinalProgramme,
} from "../autonomousProfessionalEditor";
import { buildTransformationDecisions } from "../autonomousProfessionalEditor/decisionsFromPlan";
import { buildFinalEditorialQualityReview } from "../autonomousProfessionalEditor/finalEditorialQualityReview";
import {
	formatSourceStoryMarkdown,
	formatStoryDiffMarkdown,
	formatTargetStoryMarkdown,
} from "../autonomousProfessionalEditor/storyReadable";
import { buildVideoProblemMap } from "../autonomousProfessionalEditor/videoProblemMap";
import type { CompositedFrameSampler } from "../compositorVerify";
import { analyzeDeadAir, type DeadAirCandidateV1 } from "../deadAir";
import {
	DEFAULT_DEAD_AIR_POLICY,
	EXPLICIT_PAUSE_REMOVAL_DEAD_AIR_POLICY,
	PROFESSIONAL_YOU_DECIDE_DEAD_AIR_POLICY,
} from "../deadAir/config";
import {
	analyzeEditorialFocalEvidence,
	type EditorialFocalAnalysisBundleV1,
	type ProtectedRegionV1,
	toOrchestratorGroundedFocals,
	type VisibleTextRegionV1,
	type VisualChangeIntervalV1,
} from "../editorialFocalEvidence";
import { verifyFinalSequenceCutQuality } from "../finalSequenceCutQualityVerify";
import {
	mediaFingerprint,
	type ProfessionalEditorialPlannerResultV1,
	planProfessionalEditorialOpportunities,
	selectReadyOpportunities,
} from "../professionalEditorialPlanner";
import type { SpeechEvidence } from "../speechEvidence/types";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import { analyzeVisual } from "../visualAnalysis";
import { buildAuthorizationAsk, buildFinalAssessment } from "./assessment";
import { authorizePlanFromUserText } from "./authorization";
import { buildProfessionalDecisionTable } from "./decisionTable";
import { assessDurationObjective } from "./duration";
import { buildEditorialPauseDecisions } from "./editorialPause";
import { discoverGroundedFocalTargets } from "./focal";
import { isExplicitPauseRemovalRequest, parseProfessionalEditIntent } from "./intent";
import { type CursorSample, investigateFocalInRange } from "./investigation";
import { coordinateLoudnessForProfessionalEdit } from "./loudnessCoord";
import { buildPackedEditorialTranscript } from "./packedTranscript";
import { buildProfessionalEditPlan } from "./plan";
import {
	stripFalseProjectEditsDisabledClaim,
	stripRepeatedProceedAsks,
	stripUnsupportedTransitionClaims,
} from "./sanitize";
import {
	createExecutionSession,
	executeAuthorizedPlan,
	type SessionExecutionMode,
} from "./session";
import { buildProfessionalEditStory } from "./story";
import {
	buildSkillConsiderationTable,
	buildTransformationSummary,
	formatEditorFacingReceipt,
} from "./transformationSummary";
import {
	PROFESSIONAL_EDIT_ORCHESTRATOR_V1_ID,
	type ProfessionalEditOrchestratorResultV1,
} from "./types";
import { emptyUtilization, upsertUtilization } from "./utilization";
import { disposeFinalSequenceResult } from "./warningDisposition";

function visualAnalysisToIntervals(
	analysis: Awaited<ReturnType<typeof analyzeVisual>>,
): VisualChangeIntervalV1[] {
	const out: VisualChangeIntervalV1[] = [];
	for (const s of analysis.sceneEvents ?? []) {
		out.push({
			startSec: Math.max(0, s.timeSec - 0.15),
			endSec: s.timeSec + 0.15,
			kind: "scene",
			fullFrame: true,
		});
	}
	for (const c of analysis.changeEvents ?? []) {
		out.push({
			startSec: c.fromSec,
			endSec: c.toSec,
			kind: c.level === "SIGNIFICANT" ? "significant" : "moderate",
			fullFrame: c.level === "SIGNIFICANT",
		});
	}
	for (const a of analysis.activityIntervals ?? []) {
		out.push({
			startSec: a.startSec,
			endSec: a.endSec,
			kind: "activity",
			fullFrame: false,
		});
	}
	for (const s of analysis.stableIntervals ?? []) {
		out.push({
			startSec: s.startSec,
			endSec: s.endSec,
			kind: "stable",
			fullFrame: false,
		});
	}
	return out;
}

export interface RunProfessionalEditOrchestratorArgs {
	document: AxcutDocument;
	assetId: string;
	mediaPath?: string | null;
	userMessage: string;
	sourceDurationSec?: number;
	speechEvidence?: SpeechEvidence | null;
	ledger?: TemporalEventLedger | null;
	cursorSamples?: CursorSample[] | null;
	/** Optional VisualAnalysis-derived intervals for focal corroboration only. */
	visualIntervals?: VisualChangeIntervalV1[] | null;
	textRegions?: VisibleTextRegionV1[] | null;
	protectedRegions?: ProtectedRegionV1[] | null;
	injectedDeadAir?: DeadAirCandidateV1[] | null;
	priorAuthorization?: ProfessionalEditOrchestratorResultV1["authorization"];
	/** Bare "yes"/"ok" may authorize when a pending proposal/auth-ask is active. */
	allowBareAffirmation?: boolean;
	settingsEditsAllowed?: boolean;
	executionMode?: SessionExecutionMode;
	compositorFrameSampler?: CompositedFrameSampler | null;
	allowInjectedCompositorAsAuthoritative?: boolean;
	pcmProvider?: AudioPcmProvider | null;
	skipFinalSequenceQc?: boolean;
	aspectValue?: number;
	appRoot?: string;
	signal?: AbortSignal;
}

function programmeDuration(doc: AxcutDocument, assetId: string, fallback: number): number {
	const asset = doc.assets.find((a) => a.id === assetId);
	const srcDur = asset?.durationSec ?? fallback;
	const removed = doc.timeline.trimRanges
		.filter((t) => t.assetId === assetId)
		.reduce((n, t) => n + Math.max(0, t.endSec - t.startSec), 0);
	return Math.max(0, srcDur - removed);
}

export async function runProfessionalEditOrchestrator(
	args: RunProfessionalEditOrchestratorArgs,
): Promise<ProfessionalEditOrchestratorResultV1> {
	const t0 = Date.now();
	const intent = parseProfessionalEditIntent(args.userMessage);
	const asset = args.document.assets.find((a) => a.id === args.assetId) ?? args.document.assets[0];
	const mediaPath = args.mediaPath ?? asset?.originalPath ?? null;
	const sourceDurationSec = args.sourceDurationSec ?? asset?.durationSec ?? 0;
	const util = emptyUtilization();
	const documentFingerprintBefore = fingerprintDocument(args.document).value;
	const mediaFp = mediaFingerprint(args.assetId, mediaPath, sourceDurationSec);

	let deadAir: DeadAirCandidateV1[] = args.injectedDeadAir ?? [];
	if (!args.injectedDeadAir && mediaPath) {
		try {
			/**
			 * Default policy blocks TRAILING silence (outro risk). When the user
			 * explicitly asks to remove pauses / tighten pacing / you-decide
			 * professional polish, allow long trailing dead-air so the timeline
			 * actually shortens — otherwise Chat only ships captions/audio and
			 * looks like "nothing happened."
			 */
			const deadAirPolicy = isExplicitPauseRemovalRequest(args.userMessage)
				? EXPLICIT_PAUSE_REMOVAL_DEAD_AIR_POLICY
				: intent.requestedOutcome === "MAKE_PROFESSIONAL" && intent.autonomy === "you_decide"
					? PROFESSIONAL_YOU_DECIDE_DEAD_AIR_POLICY
					: intent.pacingPreference === "tighter"
						? {
								...DEFAULT_DEAD_AIR_POLICY,
								allowTrailingPropose: true,
								targetPauseInteriorSec: 0.4,
								minRemovableSec: 0.35,
								explicitUserCut: true,
								visualCursorBlock: false,
							}
						: DEFAULT_DEAD_AIR_POLICY;
			const bundle = await analyzeDeadAir({
				assetId: args.assetId,
				mediaPath,
				document: args.document,
				speechEvidence: args.speechEvidence,
				ledger: args.ledger,
				signal: args.signal,
				policy: deadAirPolicy,
			});
			deadAir = bundle.candidates;
		} catch {
			deadAir = [];
		}
	}

	const safeDead = deadAir.filter((c) => c.safeToPropose);
	upsertUtilization(util, "trim", {
		available: true,
		evidenceFound: deadAir.length > 0,
		editoriallyUseful: safeDead.length > 0,
		parametersGrounded: safeDead.some((c) => Boolean(c.proposedTrimRange)),
		safeToApply: safeDead.length > 0,
		skippedReason: safeDead.length === 0 ? "no_safe_dead_air" : null,
	});

	const packed = buildPackedEditorialTranscript({
		document: args.document,
		assetId: args.assetId,
		sourceDurationSec,
		deadAirCandidates: deadAir,
	});
	const story = buildProfessionalEditStory({ packed, intent });
	const duration = assessDurationObjective({
		originalDurationSec: sourceDurationSec,
		intent,
		story,
		safeDeadAirCandidates: safeDead,
	});

	const investigateRanges: Array<{ startSec: number; endSec: number; reason?: string }> = [
		...story.essentialRanges.slice(0, 3),
		...story.expendablePauses.slice(0, 2).map((p) => ({
			startSec: p.startSec,
			endSec: p.endSec,
			reason: p.reason,
		})),
	];
	if (investigateRanges.length === 0) {
		investigateRanges.push({
			startSec: Math.max(0, sourceDurationSec * 0.2),
			endSec: Math.min(sourceDurationSec, sourceDurationSec * 0.55),
			reason: "default_window",
		});
	}

	// Load cursor sidecar when caller did not inject samples (real product path).
	let cursorSamples = args.cursorSamples ?? null;
	if ((!cursorSamples || cursorSamples.length === 0) && mediaPath) {
		try {
			const sidecar = await readCursorSidecar(mediaPath, {});
			if (sidecar.found && sidecar.data.samples.length > 0) {
				cursorSamples = sidecar.data.samples.map((s) => ({
					atSec: s.timeMs / 1000,
					cx: s.cx,
					cy: s.cy,
					interactionType: s.interactionType,
					visible: s.visible,
				}));
			}
		} catch {
			/* sidecar optional */
		}
	}

	const existingZooms = (args.document.zoomRanges ?? []).map((z, i) => ({
		id: z.id ?? `zoom_${i}`,
		startSec: (z.startMs ?? 0) / 1000,
		endSec: (z.endMs ?? 0) / 1000,
		focus: { cx: z.focus?.cx ?? 0.5, cy: z.focus?.cy ?? 0.5 },
		depth: typeof z.depth === "number" ? z.depth : undefined,
	}));

	// Full local visual analysis for professional intent (corroboration + timeline).
	let visualIntervals = args.visualIntervals ?? null;
	let visualAnalysisRan = false;
	if (!visualIntervals && mediaPath) {
		try {
			const va = await analyzeVisual({
				assetId: args.assetId,
				mediaPath,
				includeCursor: true,
				skipChangeSampling: false,
			});
			visualIntervals = visualAnalysisToIntervals(va);
			visualAnalysisRan = true;
		} catch {
			visualIntervals = [];
		}
	}

	const focalAnalysis: EditorialFocalAnalysisBundleV1 = analyzeEditorialFocalEvidence({
		assetId: args.assetId,
		mediaFingerprint: asset?.originalPath ?? args.assetId,
		cursorSamples,
		visualIntervals,
		textRegions: args.textRegions,
		protectedRegions: args.protectedRegions,
		existingZooms,
	});

	let groundedFocals = toOrchestratorGroundedFocals({
		document: args.document,
		assetId: args.assetId,
		bundle: focalAnalysis,
	});

	// Legacy fallback only when new layer found nothing executable but old stable cluster would —
	// keep discoverGroundedFocalTargets for regression continuity, then re-filter via eligibility.
	if (groundedFocals.length === 0 && (cursorSamples?.length ?? 0) > 0) {
		const legacy = discoverGroundedFocalTargets({
			document: args.document,
			assetId: args.assetId,
			ranges: investigateRanges,
			cursorSamples,
			maxTargets: 2,
		});
		// Only keep if new layer would also consider them grounded via click/dwell —
		// pure legacy stable-crossing without interaction stays skipped (Precision).
		groundedFocals = legacy.filter(
			(f) => f.evidenceType === "cursor_click_dwell" || f.evidenceType === "cursor_convergence",
		);
	}

	const focusRange = investigateRanges[0]!;
	const focalInvestigation = investigateFocalInRange({
		document: args.document,
		assetId: args.assetId,
		startSec: focusRange.startSec,
		endSec: focusRange.endSec,
		cursorSamples,
		question: "stable_focal_for_optional_zoom",
	});

	const zoomSkip =
		focalAnalysis.zoomDecision.decision === "ZOOM_ELIGIBLE"
			? null
			: focalAnalysis.zoomDecision.reasonCode.toLowerCase();

	const aspect = args.aspectValue ?? 16 / 9;
	const captionsEnabledNow = getCaptionSettings(args.document, aspect).enabled;
	let captionCueCount = 0;
	let captionsLayoutOk = false;
	if (!captionsEnabledNow) {
		const { runCaptionLayoutForDocument } = await import("../captionLayout");
		const { layout } = runCaptionLayoutForDocument({
			document: args.document,
			assetId: args.assetId,
			aspectValue: aspect,
			useCache: true,
		});
		captionsLayoutOk = layout.status === "ok";
		captionCueCount = layout.metrics.cueCount;
	}

	let planner: ProfessionalEditorialPlannerResultV1 = planProfessionalEditorialOpportunities({
		document: args.document,
		assetId: args.assetId,
		mediaPath,
		aspectValue: aspect,
		intent,
		packed,
		story,
		deadAir,
		focal: focalAnalysis,
		visualIntervals,
		sourceDurationSec,
		captionsLayoutOk,
		captionCueCount,
		loudnessSafeToPropose: false,
		loudnessOutcome: null,
		aspectFramingRequired: false,
		framingCrop: null,
	});

	// Editorial Director: source/target story → intents → compile against opportunities
	const sourceStory = buildMultimodalSourceStory({
		assetId: args.assetId,
		sourceDurationSec,
		packed,
		visualIntervals,
		focal: focalAnalysis,
		deadAir,
	});
	const targetStory = buildTargetEditStory({ source: sourceStory, intent });
	const wantDissolveTransition = targetStory.beats.some(
		(b) => b.visualTreatment.transition === "DISSOLVE",
	);
	// Rebuild transition opportunities with story-grounded per-join intelligence (CUT default).
	{
		const { generateTransitionOpportunities } = await import(
			"../professionalEditorialPlanner/opportunities"
		);
		const transOps = generateTransitionOpportunities({
			clipCount: args.document.timeline.clips.length,
			secondClipId: args.document.timeline.clips[1]?.id ?? null,
			wantDissolve: wantDissolveTransition,
			document: args.document,
			sourceStory,
			targetStory,
			backend: "metal",
		});
		const withoutTrans = planner.opportunities.filter((o) => o.family !== "TRANSITION");
		planner = {
			...planner,
			opportunities: [...withoutTrans, ...transOps],
			ready: selectReadyOpportunities([...withoutTrans, ...transOps]),
		};
	}
	const videoProblemMap = buildVideoProblemMap({
		source: sourceStory,
		target: targetStory,
		deadAir,
		focal: focalAnalysis,
	});
	const director = createDeterministicEditorialDirector();
	const intentPlan = await director.direct({
		requestId: `dir_${Date.now().toString(36)}`,
		sourceStory,
		targetStory,
		skillRegistry: buildEditingSkillRegistryV1(),
		temporalPacket: planner.temporalPacket ?? null,
		userMessage: args.userMessage,
	});
	const compiled = compileEditorialIntents({
		intentPlan,
		opportunities: planner.opportunities,
	});
	const prioritized = prioritizeOpportunitiesByDirector({
		opportunities: planner.opportunities,
		compiled,
	});
	planner = {
		...planner,
		opportunities: prioritized,
		ready: selectReadyOpportunities(prioritized),
	};

	const speedReady = planner.ready.filter((o) => o.family === "SPEED");
	const cropReady = planner.ready.filter((o) => o.family === "CROP");
	const zoomReady = planner.ready.filter((o) => o.family === "ZOOM");
	const trimReady = planner.ready.filter((o) => o.family === "TRIM");

	upsertUtilization(util, "trim", {
		available: true,
		evidenceFound: deadAir.length > 0,
		editoriallyUseful: trimReady.length > 0,
		parametersGrounded: trimReady.length > 0,
		safeToApply: trimReady.length > 0,
		skippedReason:
			trimReady.length === 0
				? (planner.opportunities.find((o) => o.family === "TRIM")?.editorialReason ??
					"no_safe_dead_air")
				: null,
	});
	upsertUtilization(util, "zoom", {
		available: true,
		evidenceFound:
			focalAnalysis.coverage.cursor !== "NOT_AVAILABLE" || focalAnalysis.evidence.length > 0,
		editoriallyUseful: zoomReady.length > 0,
		parametersGrounded: zoomReady.length > 0,
		safeToApply: zoomReady.length > 0,
		skippedReason:
			zoomReady.length === 0
				? (planner.opportunities.find((o) => o.family === "ZOOM")?.editorialReason ??
					zoomSkip ??
					"no_editorially_useful_zoom")
				: null,
	});
	upsertUtilization(util, "crop", {
		available: true,
		evidenceFound: Boolean(planner.opportunities.some((o) => o.family === "CROP")),
		editoriallyUseful: cropReady.length > 0,
		parametersGrounded: cropReady.length > 0,
		safeToApply: cropReady.length > 0,
		skippedReason:
			cropReady.length === 0
				? String(
						planner.opportunities.find((o) => o.family === "CROP")?.generationStatus ??
							"insufficient_crop_geometry",
					)
				: null,
	});
	upsertUtilization(util, "speed", {
		available: true,
		evidenceFound: Boolean((visualIntervals ?? []).some((v) => v.kind === "stable")),
		editoriallyUseful: speedReady.length > 0,
		parametersGrounded: speedReady.length > 0,
		safeToApply: speedReady.length > 0,
		skippedReason:
			speedReady.length === 0
				? (planner.opportunities.find((o) => o.family === "SPEED")?.editorialReason ??
					"no_grounded_speed_span")
				: null,
	});

	const plan = buildProfessionalEditPlan({
		document: args.document,
		assetId: args.assetId,
		aspectValue: args.aspectValue,
		intent,
		story,
		duration,
		deadAirCandidates: deadAir,
		focalInvestigation:
			groundedFocals.length > 0 ? focalInvestigation : { ...focalInvestigation, focalFound: false },
		groundedFocals,
		planner,
	});

	upsertUtilization(util, "captions", {
		available: true,
		evidenceFound: (args.document.transcripts?.[0]?.words?.length ?? 0) > 0,
		editoriallyUseful: plan.steps.some((s) => s.family === "captions"),
		parametersGrounded: plan.steps.some((s) => s.family === "captions"),
		safeToApply: plan.steps.some((s) => s.family === "captions"),
		skippedReason: plan.steps.some((s) => s.family === "captions")
			? null
			: getCaptionSettings(args.document, args.aspectValue ?? 16 / 9).enabled
				? "CAPTIONS_ALREADY_GOOD"
				: "captions_not_ready_or_already_enabled",
	});

	const authorization = authorizePlanFromUserText({
		plan,
		userMessage: args.userMessage,
		prior: args.priorAuthorization,
		allowBareAffirmation: Boolean(args.allowBareAffirmation),
	});

	const needsUserAuthorization =
		!authorization?.valid && plan.steps.length > 0 && intent.autonomy !== "plan_only";

	let session = createExecutionSession({
		document: args.document,
		plan,
		authorization,
	});

	let document = args.document;
	const execMode: SessionExecutionMode =
		args.executionMode ?? (authorization?.valid ? "verified_apply" : "plan_only");

	if (authorization?.valid && execMode === "verified_apply") {
		const exec = await executeAuthorizedPlan({
			document,
			assetId: args.assetId,
			plan,
			session,
			mode: "verified_apply",
			compositorFrameSampler: args.compositorFrameSampler,
			allowInjectedCompositorAsAuthoritative: args.allowInjectedCompositorAsAuthoritative,
			pcmProvider: args.pcmProvider,
			appRoot: args.appRoot,
		});
		document = exec.document;
		session = exec.session;
	}

	for (const family of ["trim", "zoom", "captions", "speed", "crop"] as const) {
		const committed = session.completed.some(
			(c) =>
				c.status === "committed" &&
				plan.steps.find((s) => s.stepId === c.stepId)?.family === family,
		);
		const attempted =
			committed ||
			session.failed.some(
				(f) => plan.steps.find((s) => s.stepId === f.stepId)?.family === family,
			) ||
			session.skipped.some((s) => plan.steps.find((x) => x.stepId === s.stepId)?.family === family);
		if (plan.steps.some((s) => s.family === family) || attempted) {
			upsertUtilization(util, family, {
				attempted,
				committed,
				skippedReason: committed
					? null
					: (session.failed.find(
							(f) => plan.steps.find((s) => s.stepId === f.stepId)?.family === family,
						)?.reason ??
						session.skipped.find(
							(s) => plan.steps.find((x) => x.stepId === s.stepId)?.family === family,
						)?.reason ??
						util.rows.find((r) => r.family === family)?.skippedReason ??
						null),
			});
		}
	}

	// Loudness coordination (settings path — not ApplyPreview)
	let loudness = null as ProfessionalEditOrchestratorResultV1["loudness"];
	const wantAudio =
		intent.wantAudioImprove === true ||
		intent.wantAudioImprove === "auto" ||
		/\baudio|\bloud|\bvolume/i.test(intent.rawText);
	if (wantAudio && mediaPath) {
		loudness = await coordinateLoudnessForProfessionalEdit({
			document,
			assetId: args.assetId,
			mediaPath,
			execute: Boolean(authorization?.valid && execMode === "verified_apply"),
		});
		document = loudness.document;
		if (loudness.receipt) {
			session.loudnessReceipt = {
				...loudness.receipt,
				appliedGainDb: loudness.appliedGainDb,
			};
			if (loudness.committed) {
				session.operationsUsed += 1;
			}
		}
		upsertUtilization(util, "loudness", {
			available: true,
			evidenceFound: loudness.classification != null,
			editoriallyUseful:
				loudness.outcome === "SAFE_NORMALIZATION_AVAILABLE" ||
				loudness.outcome === "PEAK_LIMITED_SAFE_NORMALIZATION",
			parametersGrounded: Boolean(loudness.candidate?.safeToPropose),
			safeToApply: Boolean(loudness.candidate?.safeToPropose),
			attempted: loudness.receipt != null,
			committed: loudness.committed,
			skippedReason: loudness.committed ? null : loudness.outcome.toLowerCase(),
		});
	} else {
		upsertUtilization(util, "loudness", {
			available: true,
			evidenceFound: false,
			editoriallyUseful: false,
			parametersGrounded: false,
			safeToApply: false,
			skippedReason: wantAudio ? "no_media_path" : "audio_not_requested",
		});
	}

	const finalDuration = programmeDuration(document, args.assetId, sourceDurationSec);
	session.finalProgrammeDurationSec = finalDuration;

	let finalSequenceQc = null as ProfessionalEditOrchestratorResultV1["finalSequenceQc"];
	let warningDispositions: ProfessionalEditOrchestratorResultV1["warningDispositions"] = [];
	if (!args.skipFinalSequenceQc && session.completed.some((c) => c.status === "committed")) {
		try {
			const confirmedSilenceRanges = deadAir
				.filter((c) => c.silenceRange.endSec > c.silenceRange.startSec)
				.map((c) => ({
					startSourceSec: c.silenceRange.startSec,
					endSourceSec: c.silenceRange.endSec,
				}));
			finalSequenceQc = await verifyFinalSequenceCutQuality({
				document,
				assetId: args.assetId,
				useCache: false,
				skipCaption: false,
				pcmProvider: args.pcmProvider,
				confirmedSilenceRanges,
			});
			warningDispositions = disposeFinalSequenceResult({
				joins: finalSequenceQc.joins.map((j) => ({
					joinId: j.join.joinId,
					warnings: j.warnings,
				})),
			});
			if (finalSequenceQc.overall === "FAIL") {
				session.failed.push({
					stepId: "final_sequence_qc",
					status: "failed",
					reason: "final_sequence_qc_fail",
					documentFingerprintBefore: session.currentDocumentFingerprint,
					documentFingerprintAfter: session.currentDocumentFingerprint,
					verificationNotes: finalSequenceQc.joins
						.filter((j) => j.overall === "FAILED")
						.flatMap((j) => [j.join.joinId, ...j.blockingReasons.slice(0, 4)])
						.slice(0, 16),
				});

				// One bounded revision: remove the trim that created the failing join.
				const failedJoins = finalSequenceQc.joins.filter((j) => j.overall === "FAILED");
				const trimIdsToDrop = new Set<string>();
				for (const j of failedJoins) {
					for (const ref of j.join.mutationRefs ?? []) {
						const m = /^trim:(.+)$/.exec(ref);
						if (m?.[1]) trimIdsToDrop.add(m[1]);
					}
				}
				const trims = [...(document.timeline?.trimRanges ?? [])];
				const beforeLen = trims.length;
				const nextTrims =
					trimIdsToDrop.size > 0
						? trims.filter((t) => !trimIdsToDrop.has(String(t.id ?? "")))
						: trims.length > 0
							? trims.slice(0, -1)
							: trims;
				if (nextTrims.length < beforeLen) {
					document = {
						...document,
						timeline: { ...document.timeline, trimRanges: nextTrims },
					};
					try {
						const revisedQc = await verifyFinalSequenceCutQuality({
							document,
							assetId: args.assetId,
							useCache: false,
							skipCaption: false,
							pcmProvider: args.pcmProvider,
							confirmedSilenceRanges,
						});
						finalSequenceQc = revisedQc;
						warningDispositions = disposeFinalSequenceResult({
							joins: revisedQc.joins.map((j) => ({
								joinId: j.join.joinId,
								warnings: j.warnings,
							})),
						});
						session.completed.push({
							stepId: "final_sequence_qc_revision",
							status: "committed",
							reason:
								revisedQc.overall === "PASS" || revisedQc.overall === "PASS_WITH_WARNINGS"
									? "removed_trim_that_failed_join_qc"
									: "attempted_join_qc_revision",
							documentFingerprintBefore: session.currentDocumentFingerprint,
							documentFingerprintAfter: fingerprintDocument(document).value,
							verificationNotes: [
								`dropped_trims:${[...trimIdsToDrop].join(",") || "last"}`,
								`qc:${revisedQc.overall}`,
							],
						});
						session.currentDocumentFingerprint = fingerprintDocument(document).value;
					} catch {
						/* keep prior FAIL */
					}
				}
			}
		} catch {
			finalSequenceQc = null;
		}
	}

	session.finalProgrammeDurationSec = programmeDuration(document, args.assetId, sourceDurationSec);

	const assessment = buildFinalAssessment({
		intent,
		plan,
		session,
		originalDurationSec: sourceDurationSec,
		finalDurationSec: programmeDuration(document, args.assetId, sourceDurationSec),
		finalSequenceQc: finalSequenceQc?.overall ?? "NOT_RUN",
		duration,
		loudness,
		warningDispositions,
		capabilityUtilization: util,
		document,
	});

	const decisionTable = buildProfessionalDecisionTable({
		document,
		aspectValue: args.aspectValue,
		deadAir,
		focal: focalAnalysis,
		plan,
		loudness,
		util,
		planner,
	});

	const resultForReview = {
		providerId: PROFESSIONAL_EDIT_ORCHESTRATOR_V1_ID,
		intent,
		packed,
		story,
		duration,
		plan,
		authorization,
		session,
		document,
		finalSequenceQc,
		assessment: null as unknown as ProfessionalEditOrchestratorResultV1["assessment"],
		userFacingText: "",
		needsUserAuthorization,
		capabilityUtilization: util,
		loudness,
		focalAnalysis,
		decisionTable,
		planner,
		warningDispositions,
		metrics: {
			paidAiCalls: 0 as const,
			autoUnverifiedMutations: 0 as const,
			totalMs: Date.now() - t0,
			stepsCommitted:
				session.completed.filter((c) => c.status === "committed").length +
				(loudness?.committed ? 1 : 0),
			stepsRolledBack: session.failed.filter((c) => c.status === "rolled_back").length,
			visualAnalysisRan,
			temporalContextConsumed: planner.metrics.temporalContextConsumed,
		},
	};

	const selfReview = reviewFinalProgramme({
		result: resultForReview as ProfessionalEditOrchestratorResultV1,
		originalDurationSec: sourceDurationSec,
		revisionUsed: 0,
	});

	let userFacingText = needsUserAuthorization
		? buildAuthorizationAsk(plan)
		: assessment.userFacingSummary;

	userFacingText = stripUnsupportedTransitionClaims(userFacingText);
	userFacingText = stripFalseProjectEditsDisabledClaim(
		userFacingText,
		args.settingsEditsAllowed !== false,
	);
	userFacingText = stripRepeatedProceedAsks(userFacingText, Boolean(authorization?.valid));

	if (selfReview.editorialImprovement === "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT") {
		userFacingText +=
			"\n\n(Editorial review: changes were technically valid but mainly accessibility polish — not a full professional reshape.)";
	}

	const partialResult = {
		providerId: PROFESSIONAL_EDIT_ORCHESTRATOR_V1_ID,
		intent,
		packed,
		story,
		duration,
		plan,
		authorization,
		session,
		document,
		finalSequenceQc,
		assessment,
		userFacingText,
		needsUserAuthorization,
		capabilityUtilization: util,
		loudness,
		focalAnalysis,
		decisionTable,
		planner,
		warningDispositions,
		metrics: {
			paidAiCalls: 0 as const,
			autoUnverifiedMutations: 0 as const,
			totalMs: Date.now() - t0,
			stepsCommitted:
				session.completed.filter((c) => c.status === "committed").length +
				(loudness?.committed ? 1 : 0),
			stepsRolledBack: session.failed.filter((c) => c.status === "rolled_back").length,
			visualAnalysisRan,
			temporalContextConsumed: planner.metrics.temporalContextConsumed,
		},
	} as ProfessionalEditOrchestratorResultV1;

	const transformationDecisions = buildTransformationDecisions({
		opportunities: planner.opportunities,
		compiled,
		targetStory,
	});

	let revisionUsed = 0;
	let finalEditorialQualityReview = buildFinalEditorialQualityReview({
		result: partialResult,
		document,
		targetStory,
		originalDurationSec: sourceDurationSec,
	});

	// Bounded revision first: publish-ready narrated tutorials should get captions without a follow-up.
	if (
		execMode === "verified_apply" &&
		revisionUsed < MAX_AUTONOMOUS_REVISIONS_V1 &&
		intent.requestedOutcome === "MAKE_PROFESSIONAL" &&
		!getCaptionSettings(document, aspect).enabled &&
		captionsLayoutOk &&
		captionCueCount > 0
	) {
		const { patchCaptionSettings } = await import("../../../src/lib/ai-edition/captions/settings");
		document = patchCaptionSettings(document, { enabled: true }, aspect);
		revisionUsed += 1;
		session.completed.push({
			stepId: "bounded_revision_enable_captions",
			status: "committed",
			reason: "publish_ready_autonomous_captions",
			documentFingerprintBefore: session.currentDocumentFingerprint,
			documentFingerprintAfter: fingerprintDocument(document).value,
			verificationNotes: [`cueCount:${captionCueCount}`],
		});
		session.currentDocumentFingerprint = fingerprintDocument(document).value;
		finalEditorialQualityReview = buildFinalEditorialQualityReview({
			result: { ...partialResult, document },
			document,
			targetStory,
			originalDurationSec: sourceDurationSec,
		});
	}

	// One bounded revision: remove conversational / failed title annotations.
	if (
		execMode === "verified_apply" &&
		finalEditorialQualityReview.label === "NEEDS_REVISION" &&
		finalEditorialQualityReview.TITLE_QUALITY === "FAIL" &&
		revisionUsed < MAX_AUTONOMOUS_REVISIONS_V1
	) {
		const before = document.annotations ?? [];
		const nextAnns = before.filter((a) => {
			if (a.annotationSource === "auto-caption") return true;
			const text = String(a.textContent ?? a.content ?? "").trim();
			const conversational =
				/\b(this is a|i am working|i'm working|um+|uh+|i think you|you can see|our cursor|look here)\b/i.test(
					text,
				) ||
				/\b(screen recording|limited(?:\s+labeled)?\s+speech|labeled speech)\b/i.test(text) ||
				text.length < 2;
			return !conversational;
		});
		if (nextAnns.length < before.length) {
			document = { ...document, annotations: nextAnns };
			revisionUsed = 1;
			finalEditorialQualityReview = buildFinalEditorialQualityReview({
				result: { ...partialResult, document },
				document,
				targetStory,
				originalDurationSec: sourceDurationSec,
			});
		}
	}

	const assessmentFinal = buildFinalAssessment({
		intent,
		plan,
		session,
		originalDurationSec: sourceDurationSec,
		finalDurationSec: session.finalProgrammeDurationSec,
		finalSequenceQc: finalSequenceQc?.overall ?? "NOT_RUN",
		duration,
		loudness,
		warningDispositions,
		capabilityUtilization: util,
		document,
	});
	if (!needsUserAuthorization) {
		userFacingText = assessmentFinal.userFacingSummary;
		if (selfReview.editorialImprovement === "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT") {
			userFacingText +=
				"\n\n(Editorial review: changes were technically valid but mainly accessibility polish — not a full professional reshape.)";
		}
	}

	const transformationSummary = buildTransformationSummary({
		...partialResult,
		document,
		userFacingText,
	});
	const skillConsideration = buildSkillConsiderationTable({
		intentPlan,
		compiled,
	});
	const editorialPauseDecisions = buildEditorialPauseDecisions(deadAir);
	userFacingText = formatEditorFacingReceipt({
		summary: transformationSummary,
		baseText: userFacingText,
		unsupportedDesired: targetStory.unsupportedDesiredSkills.map((u) => ({
			skill: u.skill,
			reason: u.reason,
		})),
	});

	if (finalEditorialQualityReview.label === "TECHNICALLY_VALID_NO_CLEAR_IMPROVEMENT") {
		userFacingText +=
			"\n\n(Editorial quality review: technically valid but no clear professional improvement.)";
	}

	const readableStories = {
		sourceStoryMd: formatSourceStoryMarkdown(sourceStory),
		targetStoryMd: formatTargetStoryMarkdown(targetStory),
		storyDiffMd: formatStoryDiffMarkdown(sourceStory, targetStory),
	};

	return {
		...partialResult,
		document,
		assessment: assessmentFinal,
		userFacingText,
		autonomous: {
			sourceStory,
			targetStory,
			intentPlan,
			compiled,
			selfReview,
			finalEditorialQualityReview,
			transformationDecisions,
			revisionUsed,
			transformationSummary,
			skillConsideration,
			editorialPauseDecisions,
			readableStories,
			videoProblemMap,
			grounding: {
				projectId: String(args.document.project.id ?? ""),
				assetId: args.assetId,
				mediaPath,
				documentFingerprintBefore,
				documentFingerprintAfter: fingerprintDocument(document).value,
				mediaFingerprint: mediaFp,
			},
		},
	};
}

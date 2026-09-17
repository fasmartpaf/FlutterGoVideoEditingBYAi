/**
 * Build ReasoningPacketV1 from canonical local evidence — 0 provider calls.
 * Reliability V2: modality sufficiency, cross-modal relations, correction, focal.
 */

import type { ClaimPromotionSet } from "../claimPromotion/types";
import type { EditGapV1 } from "../editGap/types";
import type { EditPlanV1 } from "../editPlan/types";
import type { MediaContextNeeds } from "../mediaContextNeeds/types";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import type { VideoMemoryQueryClass, VideoMemoryV1 } from "../videoMemory";
import type { VisualEvidenceCoverage } from "../videoMemory/coverage";
import type { AttachedFrameMeta } from "../videoMemory/productionPath";
import type { QueryScope } from "../videoMemory/queryScope";
import { buildCorrectionScaffold } from "./correctionScaffold";
import { buildCrossModalRelations } from "./crossModal";
import { resolveDecisionRequirements } from "./decisionRequirements";
import { synthesizeEditorialFindings } from "./editorialFindings";
import { buildFocalTargetCandidates } from "./focalTargets";
import type { CognitionPhase } from "./phase";
import { type RequiredModalities, resolveRequiredModalities } from "./requiredModalities";
import { evaluatePacketSelfContainment } from "./selfContainment";
import { evaluatePacketSufficiency, type SpeechMediaState } from "./sufficiency";
import type { BoundedProjectProjection, PacketEpistemicItem, ReasoningPacketV1 } from "./types";

function pushUnique(list: PacketEpistemicItem[], item: PacketEpistemicItem, max: number) {
	if (list.length >= max) return;
	if (list.some((x) => x.text === item.text)) return;
	list.push(item);
}

export function buildReasoningPacketV1(input: {
	phase: CognitionPhase;
	userMessage: string;
	queryClass: VideoMemoryQueryClass;
	queryScope: QueryScope;
	contextNeeds: MediaContextNeeds;
	requiredModalities?: RequiredModalities;
	memory: VideoMemoryV1 | null;
	claims: ClaimPromotionSet | null;
	sourceStoryV2?: SourceStoryV2 | null;
	targetStoryV1?: TargetStoryV1 | null;
	editGapV1?: EditGapV1 | null;
	editPlanV1?: EditPlanV1 | null;
	investigatorBriefing?: string | null;
	frameMeta: AttachedFrameMeta[];
	visualCoverage: VisualEvidenceCoverage | null;
	projectProjection: BoundedProjectProjection;
	historyConstraints: string[];
	imagesAttached: number;
	speechMediaState?: SpeechMediaState;
	cursorEvidencePresent?: boolean;
	toolPolicyNote?: string | null;
}): ReasoningPacketV1 {
	const required =
		input.requiredModalities ??
		resolveRequiredModalities({
			userMessage: input.userMessage,
			contextNeeds: input.contextNeeds,
			queryClass: input.queryClass,
		});

	const decisionRequirements = resolveDecisionRequirements({
		userMessage: input.userMessage,
		queryClass: input.queryClass,
		queryScope: input.queryScope,
		phase: input.phase,
	});
	const decisionKind = decisionRequirements.decisionKind;

	const known: PacketEpistemicItem[] = [];
	const spoken: PacketEpistemicItem[] = [];
	const supported: PacketEpistemicItem[] = [];
	const contradicted: PacketEpistemicItem[] = [];
	const unknown: PacketEpistemicItem[] = [];
	const provenanceRefs: string[] = [];

	if (input.claims) {
		for (const c of input.claims.claims.slice(0, 40)) {
			const item: PacketEpistemicItem = {
				text: c.text.slice(0, 220),
				claimId: c.id,
				status: "known",
				sourceTimeSec: c.provenance?.[0]?.sourceTimeSec,
				provenanceNote: c.kind,
			};
			provenanceRefs.push(c.id);
			if (c.status === "contradicted") {
				item.status = "contradicted";
				pushUnique(contradicted, item, 8);
			} else if (
				c.status === "spoken" ||
				c.kind === "speech_assertion" ||
				c.kind === "spoken_correction"
			) {
				item.status = "spoken";
				pushUnique(spoken, item, 10);
			} else if (c.status === "supported" || c.status === "verified") {
				item.status = "supported";
				pushUnique(supported, item, 8);
			} else if (c.status === "unknown" || c.status === "inferred") {
				item.status = "unknown";
				pushUnique(unknown, item, 8);
			} else {
				item.status = "known";
				pushUnique(known, item, 12);
			}
		}
	}

	const mem = input.memory;
	if (mem) {
		for (const h of mem.temporaryUiHints.slice(0, 4)) {
			pushUnique(
				known,
				{ text: h.slice(0, 200), status: "known", provenanceNote: "temporary_ui≠action" },
				12,
			);
		}
		for (const h of mem.passiveChromeHints.slice(0, 4)) {
			pushUnique(
				known,
				{ text: h.slice(0, 200), status: "known", provenanceNote: "passive_chrome≠opened" },
				12,
			);
		}
		for (const h of mem.correctionHints.slice(0, 4)) {
			pushUnique(
				spoken,
				{ text: h.slice(0, 200), status: "spoken", provenanceNote: "correction" },
				10,
			);
		}
		for (const h of mem.contradictionHints.slice(0, 4)) {
			pushUnique(contradicted, { text: h.slice(0, 200), status: "contradicted" }, 8);
		}
		for (const h of mem.uncertainties.slice(0, 4)) {
			pushUnique(unknown, { text: h.slice(0, 200), status: "unknown" }, 8);
		}
	}

	const selectedSpeech =
		mem?.speechWindows.slice(0, input.queryClass === "speech" ? 8 : 5).map((w) => ({
			startSec: w.startSec,
			endSec: w.endSec,
			preview: w.preview.slice(0, 220),
		})) ?? [];

	// Seed spoken from speech windows when claims have not yet promoted speech text.
	if (spoken.length === 0 && selectedSpeech.length > 0) {
		for (const w of selectedSpeech) {
			pushUnique(
				spoken,
				{
					text: w.preview.replace(/^Speech:\s*/i, "").slice(0, 220),
					status: "spoken",
					sourceTimeSec: w.startSec,
					provenanceNote: "speech_window",
				},
				10,
			);
		}
	}

	const selectedVisualEvidence = input.frameMeta.slice(0, 8).map((m) => ({
		sourceTimeSec: m.sourceTimeSec,
		reason: m.reason,
		note: m.note.slice(0, 160),
	}));

	const selectedTemporalEvents: string[] = [];
	if (input.investigatorBriefing) {
		for (const line of input.investigatorBriefing.split("\n").slice(0, 8)) {
			const t = line.trim();
			if (t) selectedTemporalEvents.push(t.slice(0, 180));
		}
	}

	const preservationConstraints: string[] = [...input.historyConstraints];
	if (input.targetStoryV1?.preserve?.length) {
		for (const b of input.targetStoryV1.preserve.slice(0, 6)) {
			preservationConstraints.push((b.text || b.id || "").slice(0, 160));
		}
	}

	let relevantSourceStory: string | null = null;
	if (input.sourceStoryV2?.mediaSummary) {
		relevantSourceStory = input.sourceStoryV2.mediaSummary.slice(0, 500);
	} else if (mem?.sourceStorySummary) {
		relevantSourceStory = mem.sourceStorySummary.slice(0, 500);
	}

	let relevantEditorialState: string | null = null;
	if (input.editPlanV1) {
		const lines = [
			input.editPlanV1.summary.slice(0, 240),
			...input.editPlanV1.items.slice(0, 6).map((it) => {
				const pref = it.preferredStrategy ? ` [${it.preferredStrategy}]` : "";
				return `- ${it.editorialIntent.slice(0, 140)}${pref}`;
			}),
		].filter(Boolean);
		relevantEditorialState = lines.join("\n");
	} else if (input.editGapV1) {
		relevantEditorialState = "Edit Gap present — prefer trusted gap constraints over invention";
	}

	const crossModalRequired =
		decisionKind === "CROSS_MODAL_COMPARE" ||
		(decisionKind === "CORRECTION_UNDERSTANDING" &&
			required.speech &&
			required.visual &&
			/\b(?:screen|visib|actually\s+verify|what\s+you\s+can\s+actually)\b/i.test(
				input.userMessage,
			));

	const crossModalRelations = crossModalRequired
		? buildCrossModalRelations({
				spoken,
				supported,
				contradicted,
				known,
				claims: input.claims,
				frameTimes: input.frameMeta.map((f) => f.sourceTimeSec),
			})
		: [];

	const correctionScaffold = buildCorrectionScaffold({
		spoken,
		claims: input.claims,
		userMessage: input.userMessage,
	});

	const focalTargetCandidates = buildFocalTargetCandidates({
		userMessage: input.userMessage,
		queryClass: input.queryClass,
		frameMeta: input.frameMeta,
		known,
		spoken,
	});

	const synthesized = synthesizeEditorialFindings({
		userMessage: input.userMessage,
		editGapV1: input.editGapV1,
		editPlanV1: input.editPlanV1,
		known,
		spoken,
		focalTargets: focalTargetCandidates,
		preservationConstraints: [...new Set(preservationConstraints)].slice(0, 10),
		correctionScaffold,
		memory: mem,
		selectedSpeechCount: selectedSpeech.length,
	});
	const editorialFindings = synthesized.findings;
	const editorialFindingCoverage = synthesized.coverage;

	const speechMediaState: SpeechMediaState = input.speechMediaState ?? "unknown";
	const ocrEvidencePresent = known.some((k) =>
		/visible text|ocr|readable text|crop/i.test(k.text + (k.provenanceNote ?? "")),
	);

	const modalityReport = evaluatePacketSufficiency({
		required,
		speechMediaState,
		speechWindowCount: selectedSpeech.length,
		spokenClaimCount: spoken.length,
		frameCount: input.frameMeta.length,
		imagesAttached: input.imagesAttached,
		visualCoverageSufficient: input.visualCoverage?.coverageSufficient ?? null,
		cursorEvidencePresent: input.cursorEvidencePresent ?? false,
		ocrEvidencePresent,
		crossModalRequired,
		crossModalRelationCount: crossModalRelations.length,
	});

	// Honest media-state note into unknown when speech required but not requested
	if (speechMediaState === "not_requested" && required.speech) {
		pushUnique(
			unknown,
			{
				text: "Speech was required for this ask but was not prepared (status=not_requested). Do NOT claim the recording has no audio.",
				status: "unknown",
				provenanceNote: "speech_media_state",
			},
			8,
		);
	}
	if (speechMediaState === "no_audio" && required.speech) {
		pushUnique(
			unknown,
			{
				text: "Media state no_audio: no audio stream — cannot transcribe. This is not a skipped-prepare state.",
				status: "unknown",
				provenanceNote: "speech_media_state",
			},
			8,
		);
	}

	const unresolvedCritical = unknown
		.filter((u) => /open|click|restart|navigat|settings|upwork/i.test(u.text))
		.map((u) => u.text)
		.slice(0, 5);

	const capabilitySummary =
		input.phase === "PROPOSE" || input.phase === "PLAN"
			? [
					"Trim/zoom/crop/caption/annotation/speed/graphic only when packet evidence supports a concrete target. Apply requires consent.",
					focalTargetCandidates.length
						? "Evaluate each FOCAL_TARGET as HELPFUL | NOT_HELPFUL | INSUFFICIENT_EVIDENCE."
						: null,
					editorialFindings.length
						? "For each EDITORIAL_FINDING choose IMPROVE | PRESERVE | IGNORE | INSUFFICIENT_EVIDENCE in EDITORIAL_DECISIONS sidecar, then write natural prose."
						: null,
				]
					.filter(Boolean)
					.join(" ")
			: null;

	const decisionLabel =
		decisionKind === "EDITORIAL_DIAGNOSIS"
			? "diagnose recording-specific improvements from EDITORIAL_FINDINGS"
			: decisionKind === "FOCAL_EDIT_JUDGMENT"
				? "evaluate FOCAL_TARGET_CANDIDATES; recommend zoom only when HELPFUL"
				: decisionKind === "CROSS_MODAL_COMPARE"
					? "compare speech vs visual using CROSS_MODAL_RELATIONS"
					: decisionKind === "FACTUAL_SPEECH"
						? "answer from SELECTED_SPEECH only"
						: decisionKind === "ACTION_VERIFY"
							? "verify action from packet evidence; UNKNOWN is allowed"
							: decisionKind === "CORRECTION_UNDERSTANDING"
								? "explain correction using CORRECTION_SCAFFOLD"
								: "respond from packet evidence only";

	const packetBase = {
		identity: "CURRENT_OPENSCREEN_BOUNDED_REASONING_V1" as const,
		phase: input.phase,
		userIntent: input.userMessage.slice(0, 800),
		queryClass: input.queryClass,
		queryScope: input.queryScope,
		requiredModalities: required,
		decisionKind,
		decisionRequirements,
		mediaSummary:
			relevantSourceStory?.slice(0, 280) ||
			`durationSec=${mem?.sourceDurationSec ?? "unknown"}; queryScope=${input.queryScope}`,
		known,
		spoken,
		supported,
		contradicted,
		unknown,
		selectedSpeech,
		selectedVisualEvidence,
		selectedTemporalEvents,
		crossModalRelations,
		correctionScaffold,
		focalTargetCandidates,
		editorialFindings,
		editorialFindingCoverage,
		selfContainment: null as ReturnType<typeof evaluatePacketSelfContainment> | null,
		preservationConstraints: [...new Set(preservationConstraints)].slice(0, 10),
		relevantSourceStory,
		relevantEditorialState,
		requestedDecision: `${input.phase}/${decisionKind}: ${decisionLabel}`,
		evidenceCoverage: input.visualCoverage
			? `sufficient=${input.visualCoverage.coverageSufficient}; buckets=${input.visualCoverage.coveredBuckets.length}/${input.visualCoverage.bucketCount}`
			: null,
		provenanceRefs: provenanceRefs.slice(0, 24),
		capabilitySummary,
		projectProjection: input.projectProjection,
		historyConstraints: input.historyConstraints,
		sufficiency: {
			packetEvidenceSufficient: modalityReport.packetEvidenceSufficient,
			missingEvidenceKinds: modalityReport.missingEvidenceKinds,
			visualCoverage: input.visualCoverage
				? `sufficient=${input.visualCoverage.coverageSufficient}`
				: null,
			speechCoverage: selectedSpeech.length
				? `${selectedSpeech.length}_windows`
				: `state=${speechMediaState}`,
			unresolvedCriticalClaims: unresolvedCritical,
			modalityReport,
			speechMediaState,
		},
		frameMeta: input.frameMeta,
		toolPolicyNote: input.toolPolicyNote ?? null,
	};

	packetBase.selfContainment = evaluatePacketSelfContainment(packetBase);
	return packetBase;
}

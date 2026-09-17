/**
 * ReasoningPacketV1 — typed provider-facing packet (0 model calls to build).
 * Identity: CURRENT_OPENSCREEN_BOUNDED_REASONING_V1
 * Reliability V2 extends sufficiency + relations + focal + correction scaffolds.
 */

import type { VideoMemoryQueryClass } from "../videoMemory";
import type { AttachedFrameMeta } from "../videoMemory/productionPath";
import type { QueryScope } from "../videoMemory/queryScope";
import type { CorrectionScaffold } from "./correctionScaffold";
import type { CrossModalEvidenceRelation } from "./crossModal";
import type { DecisionRequirementContract, ReasoningDecisionKind } from "./decisionRequirements";
import type { EditorialFinding, EditorialFindingCoverage } from "./editorialFindings";
import type { FocalTargetCandidate } from "./focalTargets";
import type { CognitionPhase } from "./phase";
import type { RequiredModalities } from "./requiredModalities";
import type { SelfContainmentReport } from "./selfContainment";
import type { ModalitySufficiencyReport, SpeechMediaState } from "./sufficiency";

export type PacketEpistemicItem = {
	text: string;
	claimId?: string;
	status: "known" | "spoken" | "supported" | "contradicted" | "unknown" | "preserve";
	sourceTimeSec?: number;
	provenanceNote?: string;
};

export type PacketSpeechWindow = {
	startSec: number;
	endSec: number;
	preview: string;
};

export type PacketVisualRef = {
	sourceTimeSec: number;
	reason: string;
	note: string;
};

export type PacketSufficiency = {
	packetEvidenceSufficient: boolean;
	missingEvidenceKinds: string[];
	visualCoverage: string | null;
	speechCoverage: string | null;
	unresolvedCriticalClaims: string[];
	/** Reliability V2 */
	modalityReport?: ModalitySufficiencyReport;
	speechMediaState?: SpeechMediaState;
};

export type BoundedProjectProjection = {
	primaryAssetId: string | null;
	durationSec: number | null;
	clipCount: number;
	hasTranscript: boolean;
	visualFramesSupplied: boolean;
	speechStatus: string | null;
	programmeNote: string;
};

export type ReasoningPacketV1 = {
	identity: "CURRENT_OPENSCREEN_BOUNDED_REASONING_V1";
	phase: CognitionPhase;
	userIntent: string;
	queryClass: VideoMemoryQueryClass;
	queryScope: QueryScope;
	requiredModalities: RequiredModalities;
	mediaSummary: string;
	known: PacketEpistemicItem[];
	spoken: PacketEpistemicItem[];
	supported: PacketEpistemicItem[];
	contradicted: PacketEpistemicItem[];
	unknown: PacketEpistemicItem[];
	selectedSpeech: PacketSpeechWindow[];
	selectedVisualEvidence: PacketVisualRef[];
	selectedTemporalEvents: string[];
	crossModalRelations: CrossModalEvidenceRelation[];
	correctionScaffold: CorrectionScaffold;
	focalTargetCandidates: FocalTargetCandidate[];
	editorialFindings: EditorialFinding[];
	editorialFindingCoverage: EditorialFindingCoverage | null;
	decisionKind: ReasoningDecisionKind;
	decisionRequirements: DecisionRequirementContract;
	selfContainment: SelfContainmentReport | null;
	preservationConstraints: string[];
	relevantSourceStory: string | null;
	relevantEditorialState: string | null;
	requestedDecision: string;
	evidenceCoverage: string | null;
	provenanceRefs: string[];
	capabilitySummary: string | null;
	projectProjection: BoundedProjectProjection;
	historyConstraints: string[];
	sufficiency: PacketSufficiency;
	frameMeta: AttachedFrameMeta[];
	toolPolicyNote: string | null;
};

export type ReasoningPacketSerializeResult = {
	text: string;
	chars: number;
	packet: ReasoningPacketV1;
};

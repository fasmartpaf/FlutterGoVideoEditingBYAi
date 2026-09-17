/**
 * Post-structural family verification stage for Apply Preview.
 * Trim → compositor+audio; zoom/crop/speed → editVerify (+ native sampler default).
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { ZoomDepth } from "../../../src/lib/ai-edition/timeline/zoom-scale";
import {
	AUDIO_VERIFY_V1_PROVIDER_ID,
	audioVerifyPassed,
	verifyTrimAudioContinuity,
} from "../audioVerify";
import { runCaptionLayoutForDocument, verifyCaptionLayoutRender } from "../captionLayout";
import {
	COMPOSITOR_VERIFY_V1_PROVIDER_ID,
	compositorVerifyPassed,
	NativeCompositorFrameSampler,
	verifyTrimWithCompositor,
} from "../compositorVerify";
import type { CompositedFrameSampler } from "../compositorVerify/types";
import type { EditProposalItem } from "../editProposal/types";
import {
	type EditVerificationResult,
	LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
	type MustSurviveRequirement,
	type NormalizedRect,
	verifyCrop,
	verifySpeed,
	verifyZoom,
} from "../editVerify";
import { GRAPHIC_VERIFY_PROVIDER_ID, verifyGraphicAnnotation } from "./graphicVerify";
import type { ApplyPreflight, EditApplicationReceipt } from "./types";

export type FamilyVerifyOutcome =
	| {
			ok: true;
			verificationStatus: EditApplicationReceipt["verificationStatus"];
			notes: string[];
			compositorVerification?: EditApplicationReceipt["compositorVerification"];
			audioVerification?: EditApplicationReceipt["audioVerification"];
			editVerification?: EditApplicationReceipt["editVerification"];
			captionVerification?: EditApplicationReceipt["captionVerification"];
			graphicVerification?: EditApplicationReceipt["graphicVerification"];
			renderVerificationMs: number;
			audioVerificationMs: number;
	  }
	| {
			ok: false;
			verificationStatus: EditApplicationReceipt["verificationStatus"];
			notes: string[];
			compositorVerification?: EditApplicationReceipt["compositorVerification"];
			audioVerification?: EditApplicationReceipt["audioVerification"];
			editVerification?: EditApplicationReceipt["editVerification"];
			captionVerification?: EditApplicationReceipt["captionVerification"];
			graphicVerification?: EditApplicationReceipt["graphicVerification"];
			renderVerificationMs: number;
			audioVerificationMs: number;
			blockingReasons: string[];
	  };

function mustSurviveFromProposal(proposal: EditProposalItem): MustSurviveRequirement[] {
	const out: MustSurviveRequirement[] = [];
	for (const req of proposal.mustSurvive) {
		const rangeMatch = /survive:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/i.exec(req.reason);
		if (rangeMatch) {
			out.push({
				id: req.id,
				kind: "source_range",
				startSourceSec: Number(rangeMatch[1]),
				endSourceSec: Number(rangeMatch[2]),
				note: req.text,
			});
		}
		const regionMatch =
			/region:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/i.exec(req.reason);
		if (regionMatch) {
			out.push({
				id: req.id,
				kind: "normalized_region",
				region: {
					x: Number(regionMatch[1]),
					y: Number(regionMatch[2]),
					width: Number(regionMatch[3]),
					height: Number(regionMatch[4]),
				},
				note: req.text,
			});
		}
	}
	return out;
}

function resolveSampler(
	inputSampler: CompositedFrameSampler | undefined,
	appRoot?: string,
): { sampler: CompositedFrameSampler; owned: boolean } {
	if (inputSampler) return { sampler: inputSampler, owned: false };
	return {
		sampler: new NativeCompositorFrameSampler({ appRoot }),
		owned: true,
	};
}

function editAttachment(
	result: EditVerificationResult,
	frameProvider: string | null,
	authoritative: boolean,
): NonNullable<EditApplicationReceipt["editVerification"]> {
	return {
		providerId: LOCAL_EDIT_VERIFY_EXPANSION_V1_PROVIDER_ID,
		operationType: result.operationType,
		status: result.status,
		levelsAchieved: result.levelsAchieved,
		claims: result.claims,
		blockingReasons: result.blockingReasons,
		frameProvider,
		authoritativeSatisfied: authoritative,
		familyVerificationMs: result.latencyMs.totalVerifyMs,
		additionalModelCalls: 0,
	};
}

function parseResultJson(json?: string): Record<string, unknown> {
	if (!json) return {};
	try {
		return JSON.parse(json) as Record<string, unknown>;
	} catch {
		return {};
	}
}

export async function runFamilyVerificationStage(args: {
	toolName: string;
	proposal: EditProposalItem;
	preflight: ApplyPreflight;
	beforeDocument: AxcutDocument;
	afterDocument: AxcutDocument;
	beforeFp: string;
	afterFp: string;
	applyResultJson?: string;
	compositorFrameSampler?: CompositedFrameSampler;
	allowInjectedCompositorAsAuthoritative?: boolean;
	failClosedIfUnavailable?: boolean;
	retainArtifacts?: boolean;
	artifactDir?: string;
	audioPcmProvider?: Parameters<typeof verifyTrimAudioContinuity>[0]["pcmProvider"];
	forceNoAudio?: boolean;
	forceAudioUnavailable?: boolean;
	retainAudioArtifacts?: boolean;
	audioArtifactDir?: string;
	appRoot?: string;
	forceFamilyVerifyFailure?: boolean;
}): Promise<FamilyVerifyOutcome> {
	const tool = args.toolName;
	const landing = args.preflight.landing;
	const mustSurviveRanges = args.proposal.mustSurvive
		.map((req) => {
			const rangeMatch = /survive:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/i.exec(req.reason);
			if (!rangeMatch) return null;
			return {
				id: req.id,
				startSourceSec: Number(rangeMatch[1]),
				endSourceSec: Number(rangeMatch[2]),
				text: req.text,
			};
		})
		.filter((x): x is NonNullable<typeof x> => x != null);

	// --- TRIM (existing path) ---
	if (tool === "addTrim") {
		if (!landing) {
			return {
				ok: false,
				verificationStatus: "compositor_verification_failed",
				notes: ["compositor_verify_missing_landing"],
				renderVerificationMs: 0,
				audioVerificationMs: 0,
				blockingReasons: ["compositor_verify_missing_landing"],
			};
		}
		const assetId =
			args.preflight.assetId ??
			args.afterDocument.project.primaryAssetId ??
			args.afterDocument.assets[0]?.id;
		if (!assetId) {
			return {
				ok: false,
				verificationStatus: "compositor_verification_failed",
				notes: ["compositor_verify_missing_asset"],
				renderVerificationMs: 0,
				audioVerificationMs: 0,
				blockingReasons: ["compositor_verify_missing_asset"],
			};
		}

		const compositorEvidence = await verifyTrimWithCompositor({
			proposalId: args.proposal.id,
			beforeDocumentFingerprint: args.beforeFp,
			afterDocumentFingerprint: args.afterFp,
			trimSourceStartSec: landing.startSourceTimeSec,
			trimSourceEndSec: landing.endSourceTimeSec,
			assetId,
			afterDocument: args.afterDocument,
			beforeDocument: args.beforeDocument,
			mustSurviveRanges,
			sampler: args.compositorFrameSampler,
			allowInjectedAsAuthoritative: args.allowInjectedCompositorAsAuthoritative === true,
			failClosedIfUnavailable: args.failClosedIfUnavailable !== false,
			retainArtifacts: args.retainArtifacts === true,
			artifactDir: args.artifactDir,
		});
		const compositorAttachmentBase: Omit<
			NonNullable<EditApplicationReceipt["compositorVerification"]>,
			"audioContinuity"
		> = {
			providerId: COMPOSITOR_VERIFY_V1_PROVIDER_ID,
			qualityState: compositorEvidence.qualityState,
			evidence: compositorEvidence,
			frameProvider: String(compositorEvidence.frameProvider),
			authoritativeSatisfied: compositorEvidence.authoritativeSatisfied,
			compositorVerificationMs: compositorEvidence.latencyMs.totalCompositorVerificationMs,
			framesCaptured: compositorEvidence.framesCaptured,
			additionalModelCalls: 0,
		};
		if (!compositorVerifyPassed(compositorEvidence)) {
			const status =
				compositorEvidence.qualityState === "compositor_unavailable"
					? "compositor_unavailable"
					: "compositor_verification_failed";
			return {
				ok: false,
				verificationStatus: status,
				notes: [
					`compositor_verify:${compositorEvidence.qualityState}`,
					...compositorEvidence.blockingReasons,
				],
				compositorVerification: {
					...compositorAttachmentBase,
					audioContinuity: "NOT_VERIFIED",
				},
				renderVerificationMs: compositorEvidence.latencyMs.totalCompositorVerificationMs,
				audioVerificationMs: 0,
				blockingReasons: compositorEvidence.blockingReasons,
			};
		}

		const audioEvidence = await verifyTrimAudioContinuity({
			proposalId: args.proposal.id,
			trimSourceStartSec: landing.startSourceTimeSec,
			trimSourceEndSec: landing.endSourceTimeSec,
			assetId,
			afterDocument: args.afterDocument,
			beforeDocument: args.beforeDocument,
			mustSurviveRanges,
			pcmProvider: args.audioPcmProvider,
			forceNoAudio: args.forceNoAudio === true,
			forceUnavailable: args.forceAudioUnavailable === true,
			retainArtifacts: args.retainAudioArtifacts === true,
			artifactDir: args.audioArtifactDir,
			appRoot: args.appRoot,
		});
		const audioAttachment: NonNullable<EditApplicationReceipt["audioVerification"]> = {
			providerId: AUDIO_VERIFY_V1_PROVIDER_ID,
			status: audioEvidence.status,
			evidence: audioEvidence,
			capturePath: audioEvidence.capturePath,
			speechBoundaryRisk: audioEvidence.speechBoundaryRisk,
			audioVerificationMs: audioEvidence.latencyMs.totalAudioVerificationMs,
			pcmSamplesAnalyzed: audioEvidence.pcmSamplesAnalyzed,
			additionalModelCalls: 0,
		};
		const compositorAttachment: NonNullable<EditApplicationReceipt["compositorVerification"]> = {
			...compositorAttachmentBase,
			audioContinuity: audioEvidence.status,
		};
		if (!audioVerifyPassed(audioEvidence)) {
			const allowInjected = args.allowInjectedCompositorAsAuthoritative === true;
			if (
				!(
					allowInjected &&
					audioEvidence.status === "audio_unavailable" &&
					compositorVerifyPassed(compositorEvidence)
				)
			) {
				const status =
					audioEvidence.status === "audio_unavailable"
						? "audio_unavailable"
						: "audio_verification_failed";
				return {
					ok: false,
					verificationStatus: status,
					notes: [`audio_verify:${audioEvidence.status}`, ...audioEvidence.blockingReasons],
					compositorVerification: compositorAttachment,
					audioVerification: audioAttachment,
					renderVerificationMs: compositorEvidence.latencyMs.totalCompositorVerificationMs,
					audioVerificationMs: audioEvidence.latencyMs.totalAudioVerificationMs,
					blockingReasons: audioEvidence.blockingReasons,
				};
			}
		}
		const hasWarnings =
			compositorEvidence.qualityState === "verified_compositor_with_warnings" ||
			audioEvidence.status === "verified_audio_with_warnings";
		return {
			ok: true,
			verificationStatus: hasWarnings
				? "verified_single_trim_with_warnings"
				: "verified_single_trim_basic",
			notes: [
				...compositorEvidence.warnings,
				...audioEvidence.warnings,
				`compositor_quality:${compositorEvidence.qualityState}`,
				`audio_continuity:${audioEvidence.status}`,
			],
			compositorVerification: compositorAttachment,
			audioVerification: audioAttachment,
			renderVerificationMs: compositorEvidence.latencyMs.totalCompositorVerificationMs,
			audioVerificationMs: audioEvidence.latencyMs.totalAudioVerificationMs,
		};
	}

	// --- ZOOM / CROP / SPEED ---
	const { sampler } = resolveSampler(args.compositorFrameSampler, args.appRoot);
	const allowInjected = args.allowInjectedCompositorAsAuthoritative === true;
	const mustSurvive = mustSurviveFromProposal(args.proposal);
	const parsed = parseResultJson(args.applyResultJson);

	if (tool === "addZoom" || tool === "setZoom") {
		const beforeIds = new Set(args.beforeDocument.zoomRanges.map((z) => z.id));
		const newZoom =
			args.afterDocument.zoomRanges.find((z) => !beforeIds.has(z.id)) ??
			args.afterDocument.zoomRanges.find((z) => z.id === parsed.zoomId);
		if (!newZoom || !landing) {
			return {
				ok: false,
				verificationStatus: "family_verification_failed",
				notes: ["zoom_mutation_unresolved"],
				renderVerificationMs: 0,
				audioVerificationMs: 0,
				blockingReasons: ["zoom_mutation_unresolved"],
			};
		}
		const argsFocus = args.proposal.proposedCall?.provisionalArgs.focus as
			| { cx: number; cy: number }
			| undefined;
		const targetRegion = mustSurvive.find((m) => m.kind === "normalized_region")?.region as
			| NormalizedRect
			| undefined;
		const result = await verifyZoom({
			operationId: args.proposal.id,
			document: args.afterDocument,
			documentFingerprint: args.afterFp,
			zoom: {
				id: newZoom.id,
				startSec: newZoom.startMs / 1000,
				endSec: newZoom.endMs / 1000,
				depth: newZoom.depth as ZoomDepth,
				focus: argsFocus ?? newZoom.focus,
				customScale: newZoom.customScale,
			},
			targetRegion: targetRegion ?? null,
			mustSurvive,
			sampler,
			allowInjectedAsAuthoritative: allowInjected,
			forceBlankFailure: args.forceFamilyVerifyFailure,
		});
		const authoritative = result.visual.authoritative && result.status === "verified";
		const liveNativeOk =
			authoritative &&
			(result.evidence.some((e) => e.kind === "compositor_frame") || allowInjected);
		if (result.status !== "verified" || (!allowInjected && !result.visual.authoritative)) {
			// Production: injected never counts as LIVE — if only injected and not allowed, fail.
			const fail =
				result.status !== "verified" ||
				(!allowInjected && result.visual.notes.includes("injected_or_non_native_frames"));
			if (fail || result.status !== "verified") {
				return {
					ok: false,
					verificationStatus: "family_verification_failed",
					notes: result.blockingReasons,
					editVerification: editAttachment(
						result,
						result.visual.authoritative ? "native_or_allowed" : "non_authoritative",
						result.visual.authoritative,
					),
					renderVerificationMs: result.latencyMs.totalVerifyMs,
					audioVerificationMs: 0,
					blockingReasons: result.blockingReasons.length
						? result.blockingReasons
						: ["family_verification_failed"],
				};
			}
		}
		if (!allowInjected && !liveNativeOk && result.visual.authoritative === false) {
			return {
				ok: false,
				verificationStatus: "compositor_unavailable",
				notes: ["native_compositor_required_for_live_verified"],
				editVerification: editAttachment(result, null, false),
				renderVerificationMs: result.latencyMs.totalVerifyMs,
				audioVerificationMs: 0,
				blockingReasons: ["native_compositor_required_for_live_verified"],
			};
		}
		return {
			ok: true,
			verificationStatus: "verified_single_zoom_basic",
			notes: result.claims,
			editVerification: editAttachment(
				result,
				result.visual.authoritative ? "authoritative" : "test_injected",
				result.visual.authoritative,
			),
			renderVerificationMs: result.latencyMs.totalVerifyMs,
			audioVerificationMs: 0,
		};
	}

	if (tool === "setClipCrop") {
		const clipId =
			args.preflight.clipId ??
			(typeof args.proposal.proposedCall?.provisionalArgs.clipId === "string"
				? args.proposal.proposedCall.provisionalArgs.clipId
				: "");
		const crop = args.proposal.proposedCall?.provisionalArgs.crop as NormalizedRect | undefined;
		if (!clipId || !crop) {
			return {
				ok: false,
				verificationStatus: "family_verification_failed",
				notes: ["crop_args_unresolved"],
				renderVerificationMs: 0,
				audioVerificationMs: 0,
				blockingReasons: ["crop_args_unresolved"],
			};
		}
		let result = await verifyCrop({
			operationId: args.proposal.id,
			document: args.afterDocument,
			documentFingerprint: args.afterFp,
			clipId,
			crop,
			mustSurvive,
			sampler,
			allowInjectedAsAuthoritative: allowInjected,
		});
		if (args.forceFamilyVerifyFailure) {
			result = {
				...result,
				status: "failed",
				blockingReasons: [...result.blockingReasons, "forced_family_verify_failure"],
				levelsAchieved: result.levelsAchieved.filter((l) => l !== "VERIFIED"),
			};
		}
		if (result.status !== "verified") {
			return {
				ok: false,
				verificationStatus: "family_verification_failed",
				notes: result.blockingReasons,
				editVerification: editAttachment(result, null, result.visual.authoritative),
				renderVerificationMs: result.latencyMs.totalVerifyMs,
				audioVerificationMs: 0,
				blockingReasons: result.blockingReasons,
			};
		}
		if (!allowInjected && !result.visual.authoritative) {
			return {
				ok: false,
				verificationStatus: "compositor_unavailable",
				notes: ["native_compositor_required_for_live_verified"],
				editVerification: editAttachment(result, null, false),
				renderVerificationMs: result.latencyMs.totalVerifyMs,
				audioVerificationMs: 0,
				blockingReasons: ["native_compositor_required_for_live_verified"],
			};
		}
		return {
			ok: true,
			verificationStatus: "verified_single_crop_basic",
			notes: result.claims,
			editVerification: editAttachment(result, "authoritative", result.visual.authoritative),
			renderVerificationMs: result.latencyMs.totalVerifyMs,
			audioVerificationMs: 0,
		};
	}

	if (tool === "addSpeed" || tool === "setSpeed") {
		const beforeSpeeds =
			((args.beforeDocument.legacyEditor as Record<string, unknown> | null)?.speedRegions as
				| Array<{ id: string; startMs: number; endMs: number; speed: number }>
				| undefined) ?? [];
		const afterSpeeds =
			((args.afterDocument.legacyEditor as Record<string, unknown> | null)?.speedRegions as
				| Array<{ id: string; startMs: number; endMs: number; speed: number }>
				| undefined) ?? [];
		const beforeIds = new Set(beforeSpeeds.map((s) => s.id));
		const newSpeed =
			afterSpeeds.find((s) => !beforeIds.has(s.id)) ??
			afterSpeeds.find((s) => s.id === parsed.speedId);
		if (!newSpeed || !landing) {
			return {
				ok: false,
				verificationStatus: "family_verification_failed",
				notes: ["speed_mutation_unresolved"],
				renderVerificationMs: 0,
				audioVerificationMs: 0,
				blockingReasons: ["speed_mutation_unresolved"],
			};
		}
		const expectedProg = (newSpeed.endMs - newSpeed.startMs) / 1000 / newSpeed.speed;
		const result = await verifySpeed({
			operationId: args.proposal.id,
			document: args.afterDocument,
			documentFingerprint: args.afterFp,
			speed: {
				id: newSpeed.id,
				startSec: newSpeed.startMs / 1000,
				endSec: newSpeed.endMs / 1000,
				multiplier: newSpeed.speed,
			},
			mustSurvive,
			sampler,
			allowInjectedAsAuthoritative: allowInjected,
			measuredAudioDurationSec: expectedProg,
			forceAudioFailure: args.forceFamilyVerifyFailure,
		});
		if (result.status !== "verified") {
			return {
				ok: false,
				verificationStatus: result.blockingReasons.some((b) => b.includes("audio"))
					? "audio_verification_failed"
					: "family_verification_failed",
				notes: result.blockingReasons,
				editVerification: editAttachment(result, null, result.visual.authoritative),
				renderVerificationMs: result.latencyMs.totalVerifyMs,
				audioVerificationMs: result.latencyMs.audioVerifyMs,
				blockingReasons: result.blockingReasons,
			};
		}
		if (!allowInjected && !result.visual.authoritative) {
			return {
				ok: false,
				verificationStatus: "compositor_unavailable",
				notes: ["native_compositor_required_for_live_verified"],
				editVerification: editAttachment(result, null, false),
				renderVerificationMs: result.latencyMs.totalVerifyMs,
				audioVerificationMs: result.latencyMs.audioVerifyMs,
				blockingReasons: ["native_compositor_required_for_live_verified"],
			};
		}
		return {
			ok: true,
			verificationStatus: "verified_single_speed_basic",
			notes: result.claims,
			editVerification: editAttachment(result, "authoritative", result.visual.authoritative),
			renderVerificationMs: result.latencyMs.totalVerifyMs,
			audioVerificationMs: result.latencyMs.audioVerifyMs,
		};
	}

	// --- CAPTIONS (enableCaptions / settings-only) ---
	if (tool === "enableCaptions") {
		const aspect =
			typeof args.proposal.proposedCall?.provisionalArgs?.aspectValue === "number"
				? (args.proposal.proposedCall.provisionalArgs.aspectValue as number)
				: 16 / 9;
		const assetId =
			args.preflight.assetId ??
			args.afterDocument.project.primaryAssetId ??
			args.afterDocument.assets[0]?.id ??
			"";
		const { layout } = runCaptionLayoutForDocument({
			document: args.afterDocument,
			assetId,
			aspectValue: aspect,
			useCache: false,
		});
		if (args.forceFamilyVerifyFailure) {
			return {
				ok: false,
				verificationStatus: "family_verification_failed",
				notes: ["forced_family_verify_failure"],
				captionVerification: {
					providerId: "CURRENT_OPENSCREEN_LOCAL_CAPTION_LAYOUT_V1",
					status: "failed",
					frameProvider: null,
					authoritativeSatisfied: false,
					sceneCaptionCount: 0,
					sampledProgrammeTimes: [],
					blockingReasons: ["forced_family_verify_failure"],
					notes: [],
					familyVerificationMs: 0,
					liveVerifiedCaptionRender: false,
					additionalModelCalls: 0,
				},
				renderVerificationMs: 0,
				audioVerificationMs: 0,
				blockingReasons: ["forced_family_verify_failure"],
			};
		}
		const { sampler, owned } = resolveSampler(args.compositorFrameSampler, args.appRoot);
		try {
			const requireNative = args.allowInjectedCompositorAsAuthoritative !== true;
			const v = await verifyCaptionLayoutRender({
				document: args.afterDocument,
				layout,
				aspectValue: aspect,
				sampler,
				allowInjectedAsAuthoritative: args.allowInjectedCompositorAsAuthoritative === true,
				requireNativeAuthoritative: requireNative,
			});
			const attachment: NonNullable<EditApplicationReceipt["captionVerification"]> = {
				providerId: "CURRENT_OPENSCREEN_LOCAL_CAPTION_LAYOUT_V1",
				status: v.passed
					? v.liveVerifiedCaptionRender
						? "LIVE_VERIFIED_CAPTION_RENDER"
						: "verified_metadata"
					: "failed",
				frameProvider: v.frameProvider,
				authoritativeSatisfied: v.authoritativeSatisfied,
				sceneCaptionCount: v.sceneCaptionCount,
				sampledProgrammeTimes: v.sampledProgrammeTimes,
				blockingReasons: v.blockingReasons,
				notes: v.notes,
				familyVerificationMs: v.verifyMs,
				liveVerifiedCaptionRender: v.liveVerifiedCaptionRender,
				additionalModelCalls: 0,
			};
			if (!v.passed) {
				return {
					ok: false,
					verificationStatus:
						v.blockingReasons.includes("native_compositor_unavailable") ||
						v.blockingReasons.includes("native_compositor_required_for_live_verified")
							? "compositor_unavailable"
							: "family_verification_failed",
					notes: v.blockingReasons,
					captionVerification: attachment,
					renderVerificationMs: v.verifyMs,
					audioVerificationMs: 0,
					blockingReasons: v.blockingReasons,
				};
			}
			return {
				ok: true,
				verificationStatus: "verified_single_caption_basic",
				notes: v.notes,
				captionVerification: attachment,
				renderVerificationMs: v.verifyMs,
				audioVerificationMs: 0,
			};
		} finally {
			if (owned && "dispose" in sampler && typeof sampler.dispose === "function") {
				sampler.dispose();
			}
		}
	}

	// --- GRAPHIC / TITLE / CALLOUT (addGraphic → annotations) ---
	if (tool === "addGraphic") {
		const provisional = args.proposal.proposedCall?.provisionalArgs ?? {};
		if (args.forceFamilyVerifyFailure) {
			return {
				ok: false,
				verificationStatus: "family_verification_failed",
				notes: ["forced_family_verify_failure"],
				graphicVerification: {
					providerId: GRAPHIC_VERIFY_PROVIDER_ID,
					status: "failed",
					annotationId: null,
					kind: null,
					frameProvider: null,
					authoritativeSatisfied: false,
					sampledProgrammeTimes: [],
					blockingReasons: ["forced_family_verify_failure"],
					notes: [],
					familyVerificationMs: 0,
					liveVerifiedGraphicRender: false,
					additionalModelCalls: 0,
				},
				renderVerificationMs: 0,
				audioVerificationMs: 0,
				blockingReasons: ["forced_family_verify_failure"],
			};
		}
		const { sampler, owned } = resolveSampler(args.compositorFrameSampler, args.appRoot);
		try {
			const requireNative = args.allowInjectedCompositorAsAuthoritative !== true;
			const v = await verifyGraphicAnnotation({
				beforeDocument: args.beforeDocument,
				afterDocument: args.afterDocument,
				expected: {
					kind: typeof provisional.kind === "string" ? provisional.kind : undefined,
					text: typeof provisional.text === "string" ? provisional.text : undefined,
					startSec: typeof provisional.startSec === "number" ? provisional.startSec : undefined,
					endSec: typeof provisional.endSec === "number" ? provisional.endSec : undefined,
					x: typeof provisional.x === "number" ? provisional.x : undefined,
					y: typeof provisional.y === "number" ? provisional.y : undefined,
				},
				sampler,
				allowInjectedAsAuthoritative: args.allowInjectedCompositorAsAuthoritative === true,
				requireNativeAuthoritative: requireNative,
			});
			const attachment: NonNullable<EditApplicationReceipt["graphicVerification"]> = {
				providerId: GRAPHIC_VERIFY_PROVIDER_ID,
				status: v.passed
					? v.liveVerifiedGraphicRender
						? "LIVE_VERIFIED_GRAPHIC_RENDER"
						: "verified_metadata"
					: "failed",
				annotationId: v.annotationId,
				kind: v.kind,
				frameProvider: v.frameProvider,
				authoritativeSatisfied: v.authoritativeSatisfied,
				sampledProgrammeTimes: v.sampledProgrammeTimes,
				blockingReasons: v.blockingReasons,
				notes: v.notes,
				familyVerificationMs: v.verifyMs,
				liveVerifiedGraphicRender: v.liveVerifiedGraphicRender,
				additionalModelCalls: 0,
			};
			if (!v.passed) {
				return {
					ok: false,
					verificationStatus:
						v.blockingReasons.includes("native_compositor_unavailable") ||
						v.blockingReasons.includes("native_compositor_required_for_live_verified")
							? "compositor_unavailable"
							: "family_verification_failed",
					notes: v.blockingReasons,
					graphicVerification: attachment,
					renderVerificationMs: v.verifyMs,
					audioVerificationMs: 0,
					blockingReasons: v.blockingReasons,
				};
			}
			return {
				ok: true,
				verificationStatus: "verified_single_graphic_basic",
				notes: v.notes,
				graphicVerification: attachment,
				renderVerificationMs: v.verifyMs,
				audioVerificationMs: 0,
			};
		} finally {
			if (owned && "dispose" in sampler && typeof sampler.dispose === "function") {
				sampler.dispose();
			}
		}
	}

	// --- TRANSITION (setClipIncomingTransition) — document identity verify ---
	if (tool === "setClipIncomingTransition") {
		const provisional = args.proposal.proposedCall?.provisionalArgs ?? {};
		const clipId = String(provisional.clipId ?? args.preflight.clipId ?? "");
		const kind = provisional.kind;
		const afterClip = args.afterDocument.timeline.clips.find((c) => c.id === clipId);
		const got = (afterClip as { incomingTransition?: { kind?: string } } | undefined)
			?.incomingTransition;
		const notes: string[] = [];
		const blocking: string[] = [];
		if (!afterClip) blocking.push("transition_clip_missing");
		if (kind !== "cut" && kind !== "dissolve") blocking.push("transition_kind_invalid");
		if (got?.kind !== kind) blocking.push("transition_kind_not_applied");
		const clipIndex = args.afterDocument.timeline.clips.findIndex((c) => c.id === clipId);
		if (clipIndex <= 0) blocking.push("transition_requires_join");
		if (args.forceFamilyVerifyFailure) blocking.push("forced_family_verify_failure");
		if (blocking.length > 0) {
			return {
				ok: false,
				verificationStatus: "family_verification_failed",
				notes: [...notes, ...blocking],
				renderVerificationMs: 0,
				audioVerificationMs: 0,
				blockingReasons: blocking,
			};
		}
		notes.push(`transition_${String(kind)}_verified`);
		return {
			ok: true,
			verificationStatus: "verified_single_transition_basic",
			notes,
			renderVerificationMs: 0,
			audioVerificationMs: 0,
		};
	}

	return {
		ok: false,
		verificationStatus: "family_verification_failed",
		notes: ["compositor_verify_unsupported_tool"],
		renderVerificationMs: 0,
		audioVerificationMs: 0,
		blockingReasons: ["compositor_verify_unsupported_tool"],
	};
}

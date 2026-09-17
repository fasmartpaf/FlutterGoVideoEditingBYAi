/**
 * Build Temporal Context from orchestrator evidence and prove consumption.
 */

import { createHash } from "node:crypto";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { programmeFingerprintFromDocument } from "../captionLayout";
import type { DeadAirCandidateV1 } from "../deadAir";
import type { EditorialFocalAnalysisBundleV1 } from "../editorialFocalEvidence";
import { focalEvidenceToTemporalRecords } from "../editorialFocalEvidence";
import type { EditorialSignalBundle } from "../editorialOrchestration/types";
import {
	buildTemporalContextRecords,
	TemporalContextStore,
	type TemporalReasoningPacketV1,
} from "../temporalContextStore";

export function mediaFingerprint(
	assetId: string,
	mediaPath: string | null,
	durationSec: number,
): string {
	return createHash("sha256")
		.update(`${assetId}|${mediaPath ?? ""}|${Math.round(durationSec * 1000)}`)
		.digest("hex")
		.slice(0, 24);
}

export function buildPlannerSignalBundle(args: {
	assetId: string;
	mediaFingerprint: string;
	programmeFingerprint: string;
	aspectValue: number;
	deadAir: DeadAirCandidateV1[];
	focal: EditorialFocalAnalysisBundleV1 | null;
	visualIntervals: Array<{
		startSec: number;
		endSec: number;
		kind: string;
		fullFrame?: boolean;
	}>;
	captionsEnabled: boolean;
}): EditorialSignalBundle {
	return {
		assetId: args.assetId,
		mediaFingerprint: args.mediaFingerprint,
		programmeFingerprint: args.programmeFingerprint,
		aspectValue: args.aspectValue,
		deadAir: {
			candidates: args.deadAir.map((c) => ({
				id: c.id,
				startSec: c.silenceRange.startSec,
				endSec: c.silenceRange.endSec,
				durationSec: c.silenceDurationSec,
				safeToPropose: c.safeToPropose,
				blockingReasons: c.blockingReasons,
				classification: c.classification,
			})),
		},
		captions: {
			layoutStatus: "ok",
			cueCount: 0,
			alreadyEnabled: args.captionsEnabled,
			manualConflict: false,
			safeToPropose: !args.captionsEnabled,
		},
		visual: {
			activityRanges: args.visualIntervals
				.filter((v) => v.kind === "activity" || v.kind === "significant")
				.map((v) => ({
					startSec: v.startSec,
					endSec: v.endSec,
					reason: v.kind,
				})),
			stableRanges: args.visualIntervals
				.filter((v) => v.kind === "stable")
				.map((v) => ({ startSec: v.startSec, endSec: v.endSec })),
			focalTargets: (args.focal?.targets ?? [])
				.filter((t) => t.status === "GROUNDED")
				.map((t) => ({
					id: t.targetId,
					startSec: t.sourceRange.startSec,
					endSec: t.sourceRange.endSec,
					cx: t.focalPoint.cx,
					cy: t.focalPoint.cy,
					kind: t.reasonCode,
				})),
			framingEvidence: [],
		},
		timeline: {
			existingTrimCount: 0,
			existingZoomCount: 0,
			existingSpeedCount: 0,
			existingCropCount: 0,
		},
	};
}

export function buildAndQueryTemporalContext(args: {
	document: AxcutDocument;
	assetId: string;
	mediaPath?: string | null;
	aspectValue?: number;
	deadAir: DeadAirCandidateV1[];
	focal: EditorialFocalAnalysisBundleV1 | null;
	visualIntervals: Array<{
		startSec: number;
		endSec: number;
		kind: string;
		fullFrame?: boolean;
	}>;
	captionsEnabled: boolean;
	sourceDurationSec: number;
	speechWords?: Array<{
		id: string;
		text: string;
		sourceStartSec: number;
		sourceEndSec: number;
	}>;
}): {
	store: TemporalContextStore;
	packet: TemporalReasoningPacketV1;
	consumed: true;
} {
	const mediaFp = mediaFingerprint(args.assetId, args.mediaPath ?? null, args.sourceDurationSec);
	const programmeFp = programmeFingerprintFromDocument(args.document);
	const signals = buildPlannerSignalBundle({
		assetId: args.assetId,
		mediaFingerprint: mediaFp,
		programmeFingerprint: programmeFp,
		aspectValue: args.aspectValue ?? 16 / 9,
		deadAir: args.deadAir,
		focal: args.focal,
		visualIntervals: args.visualIntervals,
		captionsEnabled: args.captionsEnabled,
	});

	const t0 = Date.now();
	const baseRecords = buildTemporalContextRecords({
		document: args.document,
		assetId: args.assetId,
		mediaFingerprint: mediaFp,
		signals,
		speechWords: args.speechWords,
	});
	const focalExtra = args.focal
		? focalEvidenceToTemporalRecords({
				bundle: args.focal,
				mediaFingerprint: mediaFp,
				programmeFingerprint: programmeFp,
			})
		: [];
	const store = new TemporalContextStore({
		document: args.document,
		assetId: args.assetId,
		mediaFingerprint: mediaFp,
		records: [...baseRecords, ...focalExtra],
		signals,
		buildMs: Date.now() - t0,
	});

	// Prove consumption: query families + build STANDARD packet (not merely populate)
	store.query({
		kinds: ["DEAD_AIR_CANDIDATE", "VISUAL_ACTIVITY", "VISUAL_STABLE_RANGE"],
	});
	store.query({
		kinds: ["EDITORIAL_FOCAL_TARGET", "FOCAL_TARGET", "EDITORIAL_FOCAL_EVIDENCE"],
	});
	store.query({ kinds: ["SPEECH_WORD", "SPEECH_SEGMENT", "PROTECTED_RANGE"] });
	const packet = store.buildTemporalReasoningPacketV1({ detailLevel: "STANDARD" });

	return { store, packet, consumed: true };
}

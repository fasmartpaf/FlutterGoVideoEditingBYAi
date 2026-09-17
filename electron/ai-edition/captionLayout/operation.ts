/**
 * Caption Verified Apply Bridge V1 — operation contract + helpers.
 * Canonical mutation: enable CaptionSettings (derived cues from transcript SSOT).
 * Does not freeze cue text into annotations.
 */

import { createHash } from "node:crypto";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { documentHasManualOrLegacyCaptions } from "../captionLayout/apply";
import { fingerprintWords } from "../captionLayout/layout";
import { survivingWordsFromDocument } from "../captionLayout/run";
import type { CaptionLayoutResult } from "../captionLayout/types";
import { CAPTION_GROUPING_POLICY_VERSION, CAPTION_LAYOUT_VERSION } from "../captionLayout/types";

export const CAPTION_VERIFIED_APPLY_TOOL = "enableCaptions" as const;

export const CAPTION_LAYOUT_OPERATION_VERSION = "v1" as const;

export interface CaptionLayoutOperationV1 {
	operationId: string;
	proposalId: string;
	operationType: "caption_layout";
	toolName: typeof CAPTION_VERIFIED_APPLY_TOOL;
	transcriptFingerprint: string;
	programmeFingerprint: string;
	enabled: true;
	layoutPolicyVersion: typeof CAPTION_GROUPING_POLICY_VERSION;
	layoutVersion: typeof CAPTION_LAYOUT_VERSION;
	styleRef: {
		fontSizePxAt1080: number;
		fontFamily: string;
		fontWeight: "normal" | "bold";
	};
	styleFingerprint: string;
	cueIds: string[];
	cueCount: number;
	placementPolicy: "continuity_hysteresis_v1";
	safeAreaPolicy: "normalized_caption_safe_v1";
	expectedProgrammeRanges: Array<{ startSec: number; endSec: number }>;
	protectedRegions: Array<{ id: string; kind: string }>;
	preserveManualCaptions: true;
	aspectValue: number;
	layoutStatus: CaptionLayoutResult["status"];
}

export function programmeFingerprintFromDocument(doc: AxcutDocument): string {
	const h = createHash("sha256");
	h.update(
		JSON.stringify({
			clips: doc.timeline.clips.map((c) => ({
				id: c.id,
				s: c.sourceStartSec,
				e: c.sourceEndSec,
				ts: c.timelineStartSec,
				te: c.timelineEndSec,
			})),
			trims: doc.timeline.trimRanges.map((t) => ({
				id: t.id,
				a: t.assetId,
				s: t.startSec,
				e: t.endSec,
			})),
			speeds:
				((doc.legacyEditor as Record<string, unknown> | null)?.speedRegions as unknown[]) ?? [],
		}),
	);
	return h.digest("hex").slice(0, 24);
}

export function styleFingerprintFromDocument(doc: AxcutDocument, aspectValue: number): string {
	const s = getCaptionSettings(doc, aspectValue);
	const h = createHash("sha256");
	h.update(
		JSON.stringify({
			fontSize: s.fontSize,
			fontFamily: s.fontFamily,
			fontWeight: s.fontWeight,
			anchorV: s.anchorV,
			anchorH: s.anchorH,
			insetY: s.insetY,
			insetX: s.insetX,
			minWordsPerLine: s.minWordsPerLine,
			maxWordsPerLine: s.maxWordsPerLine,
			aspectValue,
		}),
	);
	return h.digest("hex").slice(0, 16);
}

export function buildCaptionLayoutOperation(args: {
	proposalId: string;
	document: AxcutDocument;
	assetId: string;
	layout: CaptionLayoutResult;
	aspectValue: number;
}): CaptionLayoutOperationV1 {
	const words = survivingWordsFromDocument(args.document, args.assetId);
	const kept = args.layout.cues.filter((c) => !c.omitted);
	const style = kept[0]?.styleRef ?? {
		fontSizePxAt1080: 48,
		fontFamily: "Inter",
		fontWeight: "bold" as const,
	};
	return {
		operationId: `cap_op_${args.proposalId}`,
		proposalId: args.proposalId,
		operationType: "caption_layout",
		toolName: CAPTION_VERIFIED_APPLY_TOOL,
		transcriptFingerprint: fingerprintWords(words),
		programmeFingerprint: programmeFingerprintFromDocument(args.document),
		enabled: true,
		layoutPolicyVersion: CAPTION_GROUPING_POLICY_VERSION,
		layoutVersion: CAPTION_LAYOUT_VERSION,
		styleRef: style,
		styleFingerprint: styleFingerprintFromDocument(args.document, args.aspectValue),
		cueIds: kept.map((c) => c.id),
		cueCount: kept.length,
		placementPolicy: "continuity_hysteresis_v1",
		safeAreaPolicy: "normalized_caption_safe_v1",
		expectedProgrammeRanges: kept.map((c) => ({
			startSec: c.programmeStartSec,
			endSec: c.programmeEndSec,
		})),
		protectedRegions: (args.layout.collisions ?? [])
			.filter((c) => c.severity === "blocking" || c.severity === "high")
			.map((c) => ({ id: c.objectId, kind: c.reason })),
		preserveManualCaptions: true,
		aspectValue: args.aspectValue,
		layoutStatus: args.layout.status,
	};
}

export function operationToProvisionalArgs(op: CaptionLayoutOperationV1): Record<string, unknown> {
	return {
		enabled: true,
		assetId: undefined, // filled by caller
		transcriptFingerprint: op.transcriptFingerprint,
		programmeFingerprint: op.programmeFingerprint,
		layoutPolicyVersion: op.layoutPolicyVersion,
		layoutVersion: op.layoutVersion,
		styleFingerprint: op.styleFingerprint,
		cueCount: op.cueCount,
		cueIds: op.cueIds,
		aspectValue: op.aspectValue,
		layoutStatus: op.layoutStatus,
		preserveManualCaptions: true,
		placementPolicy: op.placementPolicy,
		safeAreaPolicy: op.safeAreaPolicy,
		expectedProgrammeRanges: op.expectedProgrammeRanges,
	};
}

export type CaptionAnnotationClass =
	| "DERIVED_AUTO_CAPTION"
	| "LEGACY_AUTO_CAPTION"
	| "MANUAL_CAPTION"
	| "USER_EDITED_CAPTION";

export function classifyDocumentCaptions(doc: AxcutDocument): {
	classes: CaptionAnnotationClass[];
	legacyAutoCount: number;
	manualTextCount: number;
	hasManualConflict: boolean;
} {
	const classes = new Set<CaptionAnnotationClass>(["DERIVED_AUTO_CAPTION"]);
	let legacyAutoCount = 0;
	let manualTextCount = 0;
	for (const a of doc.annotations ?? []) {
		const src = (a as { annotationSource?: string }).annotationSource;
		if (src === "auto-caption") {
			legacyAutoCount += 1;
			classes.add("LEGACY_AUTO_CAPTION");
		} else if (a.type === "text") {
			manualTextCount += 1;
			classes.add("MANUAL_CAPTION");
			classes.add("USER_EDITED_CAPTION");
		}
	}
	return {
		classes: [...classes],
		legacyAutoCount,
		manualTextCount,
		hasManualConflict: manualTextCount > 0 && documentHasManualOrLegacyCaptions(doc),
	};
}

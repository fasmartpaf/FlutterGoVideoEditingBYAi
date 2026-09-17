/**
 * Consented caption-enable apply — separate from Apply Preview allowlist.
 * Only toggles caption settings; never overwrites manual annotation text.
 */

import {
	getCaptionSettings,
	patchCaptionSettings,
} from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { CaptionLayoutProposal } from "./proposal";
import { LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID } from "./types";
import { type CaptionRenderVerification, verifyCaptionLayoutRender } from "./verify";

export interface CaptionLayoutConsent {
	proposalIntent: string;
	documentFingerprint: string;
	aspectValue: number;
	consentedAtIso: string;
}

export interface CaptionLayoutApplyResult {
	providerId: typeof LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID;
	mutated: boolean;
	document: AxcutDocument;
	terminalStatus: "verified" | "blocked" | "rolled_back" | "no_op";
	verification: CaptionRenderVerification | null;
	notes: string[];
}

export function fingerprintDocLite(doc: AxcutDocument): string {
	const captions = getCaptionSettings(doc);
	return `${doc.project.id}|${doc.transcripts.length}|${captions.enabled}|${doc.timeline.clips.length}`;
}

/**
 * Apply only `enabled: true` after explicit consent. Does not rewrite transcript
 * or manual annotations. Rolls back settings if verification fails.
 */
export async function runConsentedCaptionLayoutEnable(args: {
	document: AxcutDocument;
	proposal: CaptionLayoutProposal;
	consent: CaptionLayoutConsent | null;
	aspectValue: number;
}): Promise<CaptionLayoutApplyResult> {
	const notes: string[] = [];
	if (!args.consent) {
		return {
			providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
			mutated: false,
			document: args.document,
			terminalStatus: "blocked",
			verification: null,
			notes: ["no_consent"],
		};
	}
	if (!args.proposal.safeToPropose) {
		return {
			providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
			mutated: false,
			document: args.document,
			terminalStatus: "blocked",
			verification: null,
			notes: ["proposal_not_safe", ...args.proposal.blockingReasons],
		};
	}
	const fp = fingerprintDocLite(args.document);
	if (fp !== args.consent.documentFingerprint) {
		return {
			providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
			mutated: false,
			document: args.document,
			terminalStatus: "blocked",
			verification: null,
			notes: ["stale_consent"],
		};
	}

	const before = args.document;
	const next = patchCaptionSettings(before, { enabled: true }, args.aspectValue);
	const verification = await verifyCaptionLayoutRender({
		document: next,
		layout: args.proposal.layout,
		aspectValue: args.aspectValue,
	});
	if (!verification.passed) {
		notes.push(...verification.blockingReasons);
		return {
			providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
			mutated: false,
			document: before,
			terminalStatus: "rolled_back",
			verification,
			notes: ["verification_failed", ...notes],
		};
	}
	return {
		providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
		mutated: true,
		document: next,
		terminalStatus: "verified",
		verification,
		notes: ["captions_enabled"],
	};
}

/** Manual / auto-caption annotation preservation check. */
export function documentHasManualOrLegacyCaptions(doc: AxcutDocument): boolean {
	return (doc.annotations ?? []).some((a) => {
		const src = (a as { annotationSource?: string }).annotationSource;
		return src === "auto-caption" || a.type === "text";
	});
}

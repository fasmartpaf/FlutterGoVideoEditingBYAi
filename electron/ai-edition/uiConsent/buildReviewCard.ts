/**
 * Deterministic human-language review cards from typed proposal + preflight.
 * 0 LLM calls.
 */

import type { ApplyPreflight } from "../applyPreview/types";
import type { EditProposalItem, EditProposalV1 } from "../editProposal/types";
import {
	type EditReviewAttachment,
	type EditReviewCard,
	type HumanReadableRange,
	UI_CONSENT_V1_PROVIDER_ID,
} from "./types";

function formatSec(sec: number): string {
	const s = Math.round(sec * 10) / 10;
	return Number.isInteger(s) ? `${s}` : s.toFixed(1);
}

function capabilityLabel(p: EditProposalItem): string {
	const tool = p.proposedCall?.toolName;
	if (tool === "addTrim" || p.preferredStrategy === "trim") return "Shorten a pause";
	if (p.preferredStrategy === "crop") return "Crop";
	if (p.preferredStrategy === "zoom") return "Zoom";
	if (p.preferredStrategy === "speed") return "Adjust speed";
	if (tool === "enableCaptions" || p.preferredStrategy === "caption") return "Add captions";
	return "Suggested edit";
}

function titleFor(p: EditProposalItem): string {
	if (p.status === "proposal_ready") {
		const tool = p.proposedCall?.toolName;
		if (tool === "addTrim" || p.preferredStrategy === "trim") return "Shorten a quiet pause";
		if (tool === "addZoom" || tool === "setZoom" || p.preferredStrategy === "zoom") {
			return "Emphasize this area";
		}
		if (tool === "setClipCrop" || p.preferredStrategy === "crop") {
			return "Crop the recording to this region";
		}
		if (tool === "addSpeed" || tool === "setSpeed" || p.preferredStrategy === "speed") {
			const speed = p.proposedCall?.provisionalArgs?.speed;
			return typeof speed === "number"
				? `Speed up this section to ${speed}×`
				: "Adjust playback speed";
		}
		if (tool === "enableCaptions" || p.preferredStrategy === "caption") {
			const cueCount = p.proposedCall?.provisionalArgs?.cueCount;
			const dur =
				p.landing != null
					? Math.max(0, p.landing.endSourceTimeSec - p.landing.startSourceTimeSec)
					: null;
			if (typeof cueCount === "number" && dur != null) {
				return `Add captions to ${formatSec(dur)} seconds of narration`;
			}
			return "Add captions for this narration";
		}
	}
	if (p.status === "no_safe_proposal") return "No safe edit found";
	if (p.status === "needs_more_evidence") return "More evidence needed";
	if (p.status === "provisional") return "Possible edit — not ready yet";
	if (p.status === "unsupported") return "This edit isn’t supported yet";
	return capabilityLabel(p);
}

function rangeFromLanding(p: EditProposalItem): HumanReadableRange | undefined {
	const landing = p.landing;
	if (!landing) return undefined;
	const start = landing.startSourceTimeSec;
	const end = landing.endSourceTimeSec;
	const durationSec = Math.max(0, end - start);
	return {
		label: `${formatSec(start)}s–${formatSec(end)}s of the source recording`,
		startSourceSec: start,
		endSourceSec: end,
		durationSec,
	};
}

function explanationFor(p: EditProposalItem, range?: HumanReadableRange): string {
	if (p.status === "no_safe_proposal") {
		return (
			p.rejectionReason?.trim() ||
			"OpenScreen noticed something in the recording, but there isn’t a safe edit that removes it without risking useful content."
		);
	}
	if (p.status === "needs_more_evidence") {
		return "OpenScreen doesn’t have enough evidence to safely make this edit yet.";
	}
	if (p.status === "provisional") {
		return (
			p.intent ||
			"This change might help, but OpenScreen cannot yet guarantee a clean cut while protecting important content."
		);
	}
	if (p.status === "unsupported") {
		return "This kind of edit isn’t available in OpenScreen yet.";
	}

	const dur = range ? formatSec(range.durationSec) : null;
	const tool = p.proposedCall?.toolName;
	if (tool === "addTrim" || p.preferredStrategy === "trim") {
		const pauseBit = dur
			? `OpenScreen found a ${dur}-second pause with no protected speech.`
			: "OpenScreen found a quiet pause with no protected speech.";
		const keepBit =
			p.mustSurvive.length > 0
				? " Removing it should make the explanation more concise while keeping protected content intact."
				: " Removing it should make the explanation more concise.";
		return `${pauseBit}${keepBit}`;
	}
	if (tool === "addZoom" || tool === "setZoom" || p.preferredStrategy === "zoom") {
		const depth = p.proposedCall?.provisionalArgs?.depth;
		const scaleHint = typeof depth === "number" ? ` (depth ${depth})` : "";
		const rangeBit = dur ? ` for about ${dur} seconds` : "";
		return `OpenScreen will zoom into the selected focus${scaleHint}${rangeBit}. Protected content stays visible.`;
	}
	if (tool === "setClipCrop" || p.preferredStrategy === "crop") {
		const crop = p.proposedCall?.provisionalArgs?.crop as
			| { width?: number; height?: number }
			| undefined;
		const size =
			crop && typeof crop.width === "number" && typeof crop.height === "number"
				? ` keeping roughly ${Math.round(crop.width * 100)}%×${Math.round(crop.height * 100)}% of the frame`
				: "";
		return `OpenScreen will crop this clip${size}. Protected on-screen content must remain inside the crop.`;
	}
	if (tool === "addSpeed" || tool === "setSpeed" || p.preferredStrategy === "speed") {
		const speed = p.proposedCall?.provisionalArgs?.speed;
		const m = typeof speed === "number" ? speed : null;
		const durBit =
			dur && m
				? ` The section lasts ${dur}s in the source and about ${formatSec(Number(dur) / m)}s after.`
				: "";
		return `OpenScreen will change playback speed${m ? ` to ${m}×` : ""}.${durBit} Audio stays present; speech naturalness is not judged automatically.`;
	}
	if (tool === "enableCaptions" || p.preferredStrategy === "caption") {
		const cueCount = p.proposedCall?.provisionalArgs?.cueCount;
		const placementMoves = p.proposedCall?.provisionalArgs?.placementChangeCount;
		const cueBit = typeof cueCount === "number" ? `${cueCount} caption lines` : "caption lines";
		const durBit = dur ? ` covering about ${dur} seconds of narration` : "";
		const moveBit =
			typeof placementMoves === "number" && placementMoves > 0
				? " Some lines may sit higher to avoid covering important on-screen content."
				: " Captions stay near the bottom when safe.";
		return `OpenScreen will show ${cueBit}${durBit} from your transcript.${moveBit} Manual titles and stickers are left alone.`;
	}
	return (
		p.intent ||
		p.evidenceJustification ||
		"OpenScreen proposes a careful edit based on available evidence."
	);
}

function humanizePreserveText(raw: string): string | null {
	const text = raw.trim();
	if (!text) return null;
	// Drop internal scaffolding / IDs / provenance dumps.
	if (
		/\b(ic_|obs_|sb\d|tb\d|claim_|survive:|provenance|epistemic|Unresolved \(not verified\))\b/i.test(
			text,
		) ||
		/\bSource-resolution\b/i.test(text) ||
		/\bPixels Unresolved\b/i.test(text) ||
		text.length > 160
	) {
		// Try to salvage a spoken fragment.
		const spoken = text.match(/Spoken:\s*([^|]{3,80})/i);
		if (spoken?.[1]) {
			const s = spoken[1].replace(/\s+/g, " ").trim();
			if (s.length >= 2 && !/Unresolved|Visible text/i.test(s)) {
				return `Your spoken words: “${s}${s.length >= 60 ? "…" : ""}”`;
			}
		}
		if (/correct|effects panel|effects\b/i.test(text)) {
			return "The corrected explanation about Effects";
		}
		if (/explanation|important|main point/i.test(text)) {
			return "Speech that carries the main explanation";
		}
		return null;
	}
	if (/^Spoken:\s*/i.test(text)) {
		const s = text.replace(/^Spoken:\s*/i, "").trim();
		if (s.length <= 2) return null;
		return `Your spoken words: “${s.slice(0, 80)}${s.length > 80 ? "…" : ""}”`;
	}
	if (/after the pause|following the pause|immediately after/i.test(text)) {
		return "Your explanation immediately after the pause";
	}
	return text.slice(0, 120);
}

function preservesFor(p: EditProposalItem): string[] {
	const out: string[] = [];
	for (const m of p.mustSurvive) {
		const human = humanizePreserveText(m.text);
		if (human) out.push(human);
	}
	if (
		p.status === "proposal_ready" &&
		(p.preferredStrategy === "trim" || p.proposedCall?.toolName === "addTrim")
	) {
		if (!out.some((t) => /after|following|next/i.test(t))) {
			out.push("The content immediately after the pause");
		}
	}
	if (out.length === 0 && p.status === "no_safe_proposal") {
		out.push("The important explanation in this recording");
	}
	return [...new Set(out)].slice(0, 4);
}

function risksFor(p: EditProposalItem): string[] {
	const out: string[] = [];
	for (const d of p.damageRisks) {
		if (d.level === "low") continue;
		if (d.description) out.push(d.description);
	}
	if (p.continuityRisk === "high" || p.continuityRisk === "blocking") {
		out.push(
			"This cut is close to spoken audio, so OpenScreen will verify the audio boundary before keeping it.",
		);
	} else if (p.continuityRisk === "medium") {
		out.push("OpenScreen will double-check the cut against nearby speech before keeping it.");
	}
	return [...new Set(out)].slice(0, 3);
}

function blockedCopy(p: EditProposalItem, preflight: ApplyPreflight | null): string | undefined {
	if (p.status === "proposal_ready" && preflight && !preflight.eligible) {
		if (preflight.blockingReasons.includes("stale_proposal")) {
			return "The project changed since this edit was proposed. OpenScreen needs to review it again before applying.";
		}
		if (preflight.blockingReasons.includes("blocking_preservation_risk")) {
			return "This change could remove part of protected content, so it won’t be applied.";
		}
		return "OpenScreen can’t safely apply this suggestion right now.";
	}
	if (p.status === "no_safe_proposal") {
		return "There isn’t a safe edit OpenScreen can offer for this situation.";
	}
	if (p.status === "provisional") {
		return "This suggestion isn’t ready to apply yet.";
	}
	if (p.status === "needs_more_evidence") {
		return "OpenScreen doesn’t have enough evidence to safely make this edit.";
	}
	if (p.status === "unsupported") {
		return "This edit type isn’t supported yet.";
	}
	return undefined;
}

export function buildEditReviewCard(args: {
	proposal: EditProposalItem;
	preflight: ApplyPreflight | null;
	documentFingerprint: string;
}): EditReviewCard {
	const { proposal: p, preflight, documentFingerprint } = args;
	const range = rangeFromLanding(p);
	const stale =
		preflight?.stale === true || preflight?.blockingReasons.includes("stale_proposal") === true;
	const eligible = p.status === "proposal_ready" && preflight?.eligible === true && !stale;

	let readiness: EditReviewCard["readiness"] = "blocked";
	if (eligible) readiness = "ready";
	else if (stale || (p.status === "proposal_ready" && stale)) readiness = "stale";

	return {
		proposalId: p.id,
		title: titleFor(p),
		explanation: explanationFor(p, range),
		changeSummary:
			range && (p.preferredStrategy === "trim" || p.proposedCall?.toolName === "addTrim")
				? `Remove about ${formatSec(range.durationSec)} seconds of quiet pause (${range.label}).`
				: p.intent || "Proposed change based on available evidence.",
		reasonSummary: p.evidenceJustification || p.intent || "",
		affectedRange: range,
		preserves: preservesFor(p),
		risks: readiness === "ready" ? risksFor(p) : [],
		readiness,
		blockedReason: readiness === "ready" ? undefined : blockedCopy(p, preflight),
		capabilityLabel: capabilityLabel(p),
		canApply: readiness === "ready",
		consentScope: "single_proposal_preview",
		documentFingerprint,
	};
}

/**
 * Prefer first eligible ready proposal; otherwise show the primary proposal as informational.
 */
export function buildEditReviewAttachment(args: {
	editProposalV1: EditProposalV1;
	preflight: ApplyPreflight | null;
	documentFingerprint: string;
}): EditReviewAttachment {
	const proposals = args.editProposalV1.proposals;
	const readyWithPreflight =
		args.preflight?.eligible === true
			? proposals.find((p) => p.id === args.preflight?.proposalId && p.status === "proposal_ready")
			: undefined;
	const ready = readyWithPreflight ?? proposals.find((p) => p.status === "proposal_ready");
	const primary = ready ?? proposals[0];
	const cards: EditReviewCard[] = [];

	if (primary) {
		const preflight =
			args.preflight && args.preflight.proposalId === primary.id ? args.preflight : null;
		cards.push(
			buildEditReviewCard({
				proposal: primary,
				preflight,
				documentFingerprint: args.documentFingerprint,
			}),
		);
	}

	return {
		providerId: UI_CONSENT_V1_PROVIDER_ID,
		cards,
		editProposalV1: args.editProposalV1,
		selectedProposalId: cards.find((c) => c.canApply)?.proposalId ?? cards[0]?.proposalId ?? null,
		additionalModelCalls: 0,
	};
}

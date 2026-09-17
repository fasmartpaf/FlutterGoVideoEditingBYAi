/**
 * Professional title derivation — grounded in speech/story, not raw transcript paste
 * and NEVER metadata / evidence-quality descriptions.
 */

const FILLER_START =
	/^(?:so|um+|uh+|okay|ok|alright|well|yeah|yes|no|hi|hello|hey|this\s+is|i\s+am|i'm|i\s+think|we\s+are|we're|just|basically|actually|look\s+here)\b/i;

const CONVERSATIONAL =
	/\b(?:i\s+am\s+working|i'm\s+working|this\s+is\s+a\s+cursor|let\s+me\s+just|gonna|going\s+to\s+show\s+you|our\s+cursor|look\s+here\s+this\s+is|i\s+think\s+you|you\s+can\s+see)\b/i;

/** Internal/system observations that must never become viewer-facing titles. */
const METADATA_OR_EVIDENCE_QUALITY =
	/\b(?:screen\s+recording|limited\s+(?:labeled\s+)?speech|labeled\s+speech|transcript|cursor\s+recording|visual\s+evidence|unknown\s+content|recording\s+with|in\s+this\s+pass|detector|evidence\s+quality|no\s+speech|insufficient\s+(?:local\s+)?label)\b/i;

const TUTORIAL_CUE =
	/\b(?:how\s+to|create|creating|configure|configuring|set\s+up|setting\s+up|build|building|add|adding|install|open|opening|export|exporting|edit|editing|new\s+project|project\s+settings)\b/i;

export function looksLikeMetadataOrEvidenceTitle(text: string): boolean {
	return METADATA_OR_EVIDENCE_QUALITY.test(text.trim());
}

export function looksLikeConversationalFiller(text: string): boolean {
	const t = text.trim();
	if (t.length < 4) return true;
	if (FILLER_START.test(t)) return true;
	if (CONVERSATIONAL.test(t)) return true;
	if (looksLikeMetadataOrEvidenceTitle(t)) return true;
	// Repeated word glue like "Our Cursor Cursor"
	if (/\b(\w+)\s+\1\b/i.test(t)) return true;
	return false;
}

export function looksLikeTutorialIntroduction(text: string): boolean {
	const t = text.trim();
	if (looksLikeMetadataOrEvidenceTitle(t)) return false;
	return TUTORIAL_CUE.test(t);
}

/**
 * Derive a concise title (2–8 words) from grounded text.
 * Returns null when meaning cannot be safely summarized.
 */
export function deriveProfessionalTitleText(args: {
	rawSpeech: string;
	storyCommunicates?: string;
	preferStory?: boolean;
}): string | null {
	const candidates = [
		args.preferStory ? args.storyCommunicates : null,
		args.rawSpeech,
		args.storyCommunicates,
	]
		.map((s) => (s ?? "").replace(/\s+/g, " ").trim())
		.filter((s) => s.length >= 8)
		.filter((s) => !looksLikeMetadataOrEvidenceTitle(s));

	for (const raw of candidates) {
		if (looksLikeConversationalFiller(raw) && !looksLikeTutorialIntroduction(raw)) {
			continue;
		}
		let cleaned = raw
			.replace(/^[^a-zA-Z0-9]+/, "")
			.replace(/\b(um+|uh+|you\s+know|like)\b/gi, " ")
			.replace(/\s+/g, " ")
			.trim();
		for (let i = 0; i < 4; i += 1) {
			const next = cleaned.replace(FILLER_START, "").trim();
			if (next === cleaned) break;
			cleaned = next;
		}
		if (cleaned.length < 6) continue;
		if (looksLikeMetadataOrEvidenceTitle(cleaned)) continue;
		if (looksLikeConversationalFiller(cleaned) && !looksLikeTutorialIntroduction(cleaned)) {
			continue;
		}

		const words = cleaned.split(/\s+/).filter(Boolean);
		if (words.length < 2) continue;
		const sliced = words.slice(0, Math.min(8, Math.max(2, words.length)));
		let title = sliced.join(" ");
		if (title.length > 42) {
			title = words.slice(0, 6).join(" ");
		}
		title = title
			.split(/\s+/)
			.map((w, i) => {
				if (/^[A-Z0-9]{2,}$/.test(w)) return w;
				if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
				if (/^(a|an|the|and|or|of|to|in|on|for|with)$/i.test(w)) return w.toLowerCase();
				return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
			})
			.join(" ");

		if (looksLikeConversationalFiller(title) || looksLikeMetadataOrEvidenceTitle(title)) {
			continue;
		}
		return title;
	}
	return null;
}

export function shouldProposeOpeningTitle(args: {
	wantProfessional: boolean;
	sourceDurationSec: number;
	existingNonCaptionAnnotations: number;
	derivedTitle: string | null;
}): { ok: boolean; reason: string } {
	if (!args.wantProfessional) return { ok: false, reason: "not_professional_request" };
	if (args.sourceDurationSec < 16) return { ok: false, reason: "clip_too_short" };
	if (args.existingNonCaptionAnnotations > 0) return { ok: false, reason: "title_already_present" };
	if (!args.derivedTitle) return { ok: false, reason: "no_safe_title_meaning" };
	if (looksLikeMetadataOrEvidenceTitle(args.derivedTitle)) {
		return { ok: false, reason: "metadata_or_evidence_title" };
	}
	if (args.derivedTitle.split(/\s+/).length < 2) return { ok: false, reason: "title_too_short" };
	return { ok: true, reason: "grounded_professional_title" };
}

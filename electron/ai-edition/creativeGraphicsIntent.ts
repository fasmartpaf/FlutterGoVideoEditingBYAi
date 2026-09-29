/**
 * Detect creative overlay / motion-graphics asks that the local professional
 * orchestrator cannot satisfy (it only does trim/zoom/caption/etc.).
 * When Local CLI is selected, these must reach Claude Code / Cursor / Codex.
 */

const CREATIVE_GRAPHICS_RE =
	/\b(?:motion\s*graphics?|motions?\s*gprahics?|motions?\s*graphics?|graphics?\s*motions?|animated\s+(?:title|overlay|graphic|video)|kinetic\s+type|lower[\s-]?thirds?|end[\s-]?card|thumbnail|overlay\s+graphic|create\s+(?:a\s+)?(?:graphic|title|cta|badge|logo|character|avatar|profile|motion)|add\s+(?:a\s+)?(?:graphic|title|cta|badge|logo|overlay|animation|animations|character|avatar|finger|highlight|callout|profile)|make\s+(?:a\s+)?(?:title|cta|graphic|character|profile|motion)|make\s+\d+\s+images?|create\s+\d+\s+images?|profile\s+images?|design\s+(?:a\s+)?(?:graphic|title)|finger\s*highlight|follow(?:s|ing)?\s+(?:the\s+)?cursor|speaking\s+character|presenter\s+(?:character|avatar)|pointer\s+highlight|\bimages?\s+for\s+(?:this\s+)?video|motion\s+video|graphic\s+motion)\b/i;

/** Typos seen in product chat: "motins gprahics", "graphcis", etc. */
const CREATIVE_GRAPHICS_FUZZY_RE =
	/\b(?:mot(?:ion|ins|ions)?\s*g[a-z]{0,8}ics?|g[a-z]{0,8}ics?\s*(?:motion|motins)?|add\s+.*\b(?:graphic|graphics|overlay|title|cta|character|avatar|highlight)s?\b)/i;

export function wantsCreativeMotionGraphics(userMessage: string): boolean {
	const t = userMessage.trim();
	if (!t) return false;
	return CREATIVE_GRAPHICS_RE.test(t) || CREATIVE_GRAPHICS_FUZZY_RE.test(t);
}

export function isCasualChatTurn(userMessage: string): boolean {
	const t = userMessage.trim().toLowerCase();
	return /^(?:hi|hii+|hello|hey|yo|sup|thanks|thank\s+you|thx|good\s+(?:morning|afternoon|evening)|howdy)(?:[.!?]*)$/i.test(
		t,
	);
}

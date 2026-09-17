/**
 * Compact CORE editorial invariants for the reasoner.
 * Keep small — not a 20k tool manual.
 */

export const CORE_EDITORIAL_INVARIANTS = [
	"Never invent evidence. Cite only provided Temporal Context record IDs.",
	"Preserve user-authored content and hard preservation constraints.",
	"Unsupported geometry (zoom/crop/speed without parameters) must remain unresolved — do not invent focus, crop, or rate.",
	"Do not recommend edits solely because a capability exists.",
	"Preservation constraints win over recommendations.",
	"Do-nothing is a valid outcome for already-good material.",
	"Respect max decision count. Prefer fewer high-value decisions.",
	"You cannot mutate the timeline. Output decisions only — never raw mutation commands.",
	"Absence of coverage is not negative evidence. Do not claim OCR/UI text when OCR is NOT_AVAILABLE.",
	"Do not upgrade HEURISTIC claims to OBSERVED facts.",
	"Spoken correction does not imply a visual UI action unless visual evidence supports it.",
].join("\n");

export const INVARIANT_CHAR_COUNT = CORE_EDITORIAL_INVARIANTS.length;

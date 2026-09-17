/**
 * Reject tool/edit-plan leakage in Edit Gap text.
 */

const TOOL_OR_EDIT_RE =
	/\b(add\s+(a\s+)?zoom|zoom\s+at\s+\d|trim\s+\d|cut\s+\d+(\.\d+)?\s*s|crop\s+(to|at|bottom)|dissolve|wipe\s+transition|lower third|denoise|ffmpeg|call\s+the\s+\w+\s+tool|AxcutDocument)\b/i;

const EDIT_COMMAND_RE =
	/\b(trim|cut|crop|delete|mute|speed\s+up|slow\s+down)\s+(the\s+)?(clip|segment|region|footage|bottom|hud)\b|\bcut\s+at\s+\d/i;

export function leaksToolOrEditPlan(text: string): boolean {
	return TOOL_OR_EDIT_RE.test(text) || EDIT_COMMAND_RE.test(text);
}

export function sanitizeGapProse(text: string): string {
	let out = text;
	out = out.replace(TOOL_OR_EDIT_RE, "shape viewer experience (editorial intention only)");
	out = out.replace(EDIT_COMMAND_RE, "adjust presentation emphasis (not an edit command)");
	out = out.replace(
		/\bcut\s+at\s+\d+(\.\d+)?\s*[-–]\s*\d+/gi,
		"address the gap in this source range",
	);
	out = out.replace(/\btrim\s+\d+(\.\d+)?\s*(s|sec|seconds?)?\b/gi, "reduce pacing friction");
	return out;
}

export function assertsForbiddenRestartActionCleanup(text: string): boolean {
	return /\b(remove|delete|cut)\s+restart\s+action\b|\brestart\s+action\s+cleanup\b/i.test(text);
}

export function assertsForbiddenUpworkWorkflowRemoval(text: string): boolean {
	return /\b(remove|delete)\s+upwork\s+workflow\b|\bupwork\s+workflow\s+removal\b/i.test(text);
}

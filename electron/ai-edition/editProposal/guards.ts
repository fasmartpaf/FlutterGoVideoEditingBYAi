/**
 * Reject execution leakage and unsafe proposal shapes.
 */

const EXECUTION_LEAK_RE =
	/\b(applyEdit|mutateTimeline|invokeTool)\b|\b(addTrim|addZoom|setClipCrop|addSpeed|addAnnotation)\s*\([^)]*\)\s*;/i;

const FORBIDDEN_UPWORK_RE =
	/\b(trim|zoom|crop|emphasize)\b.{0,40}\bupwork\b|\bupwork\b.{0,40}\b(workflow|trim|zoom)\b/i;

const FORBIDDEN_RESTART_ACTION_RE =
	/\b(remove|trim)\s+restart\s+action\b|\brestart\s+recording\s+action\b/i;

const FORBIDDEN_SETTINGS_ZOOM_RE = /\bzoom\b.{0,30}\bsettings\b|\baddZoom\b.{0,40}\bsettings\b/i;

export function leaksExecution(text: string): boolean {
	return EXECUTION_LEAK_RE.test(text);
}

export function assertsForbiddenUpworkProposal(text: string): boolean {
	return FORBIDDEN_UPWORK_RE.test(text);
}

export function assertsForbiddenRestartActionProposal(text: string): boolean {
	return FORBIDDEN_RESTART_ACTION_RE.test(text);
}

export function assertsForbiddenSettingsZoomProposal(text: string): boolean {
	return FORBIDDEN_SETTINGS_ZOOM_RE.test(text);
}

export function sanitizeProposalProse(text: string): string {
	let out = text;
	out = out.replace(FORBIDDEN_UPWORK_RE, "passive context (not a proposal target)");
	out = out.replace(FORBIDDEN_RESTART_ACTION_RE, "temporary recording UI visibility");
	out = out.replace(FORBIDDEN_SETTINGS_ZOOM_RE, "avoid unverified Settings targeting");
	return out;
}

/** Ensure proposed call is marked proposal-only. */
export function isValidProposedCallShape(call: {
	status?: string;
	notExecuted?: boolean;
}): boolean {
	return call.status === "proposal_only" && call.notExecuted === true;
}

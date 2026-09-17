/**
 * Deterministic guards — Target Story must not invent source actions or leak tools.
 */

const TOOL_LEAK_RE =
	/\b(add\s+(a\s+)?zoom|zoom\s+at\s+\d|trim\s+\d|cut\s+\d+(\.\d+)?\s*s|crop\s+(to|at|coords)|dissolve|wipe\s+transition|lower third|caption tool|denoise|EQ\b|saturation|blur tool|add graphic|call\s+the\s+\w+\s+tool|ffmpeg)\b/i;

const EDIT_TIMESTAMP_RE =
	/\b(at|around|near)\s+\d+(\.\d+)?\s*(s|sec|seconds?)\b|\btrim\s+\d|\bcut\s+\d|\b\d+(\.\d+)?s\s+(zoom|trim|cut)\b/i;

const UPWORK_WORKFLOW_RE =
	/\b(emphasize|focus on|show|highlight|feature)\b.{0,40}\bupwork\b|\bupwork\b.{0,40}\b(workflow|work|session|opened|visited)\b/i;

const RESTART_ACTION_GOAL_RE =
	/\b(show|emphasize|feature)\b.{0,40}\brestart(ed|ing)?\s+(the\s+)?recording\b|\buser\s+restarted\b/i;

const SETTINGS_COMPLETED_RE =
	/\b(show|present|feature)\b.{0,40}\bsettings\b.{0,20}\b(workflow|section|as\s+completed|opened)\b|\bsettings\s+workflow\b/i;

const PANEL_OPEN_RE =
	/\b(show|present)\b.{0,30}\b(timeline|effects)\s+panel\b.{0,20}\b(open|opening)\b|\bopen(ed|ing)?\s+(the\s+)?(timeline|effects)\s+panel\b/i;

export function leaksToolInstructions(text: string): boolean {
	return TOOL_LEAK_RE.test(text) || EDIT_TIMESTAMP_RE.test(text);
}

export function assertsForbiddenUpworkWorkflow(text: string): boolean {
	return UPWORK_WORKFLOW_RE.test(text);
}

export function assertsForbiddenRestartActionGoal(text: string): boolean {
	return RESTART_ACTION_GOAL_RE.test(text);
}

export function assertsForbiddenSettingsCompleted(text: string): boolean {
	return SETTINGS_COMPLETED_RE.test(text);
}

export function assertsForbiddenPanelOpenGoal(text: string): boolean {
	return PANEL_OPEN_RE.test(text);
}

export function sanitizeTargetProse(text: string): string {
	let out = text;
	out = out.replace(UPWORK_WORKFLOW_RE, "passive browser chrome (not a workflow focus)");
	out = out.replace(
		RESTART_ACTION_GOAL_RE,
		"recording-control UI visibility (not a restart action)",
	);
	out = out.replace(
		SETTINGS_COMPLETED_RE,
		"Settings mentioned in speech but not visually confirmed",
	);
	out = out.replace(PANEL_OPEN_RE, "spoken panel intent without verified visual open");
	out = out.replace(
		/\b(add|apply|insert)\s+(a\s+)?(zoom|trim|cut|crop|transition|lower third|caption)\b/gi,
		"shape viewer attention/pacing (editorial intention only)",
	);
	out = out.replace(
		/\bzoom\s+at\s+\d+(\.\d+)?\s*s?\b/gi,
		"direct attention at the relevant moment",
	);
	out = out.replace(
		/\btrim\s+\d+(\.\d+)?\s*(s|sec|seconds?)?\b/gi,
		"shorten pacing where appropriate",
	);
	out = out.replace(/\bcut\s+\d+(\.\d+)?\s*(s|sec|seconds?)?\b/gi, "reduce unnecessary duration");
	out = out.replace(/\bat\s+\d+(\.\d+)?\s*(s|sec|seconds?)\b/gi, "at the relevant moment");
	out = out.replace(/\bdissolve\s+transition\b/gi, "intentional transition feel");
	out = out.replace(/\buse\s+dissolve\b/gi, "use a clear transition feel");
	return out;
}

export function isRecordingChromeContext(text: string): boolean {
	return /restart\s+recording|recording\s+tooltip|hud|content.?protection/i.test(text);
}

export function isPassiveAppContext(text: string): boolean {
	return /passive|upwork|tab visible|chrome:/i.test(text);
}

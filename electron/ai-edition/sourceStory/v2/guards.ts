/**
 * Deterministic guards — OCR/speech/passive visibility ≠ action.
 */

const ACTION_ASSERTION_RE =
	/\b(open(ed|ing)?|navigat(ed|ion|e)?|visited?|worked\s+on|restarted?|clicked?|launched?|selected?|submitted?|saved)\b/i;

const UPWORK_ACTION_RE =
	/\b(open(ed|ing)?|navigat\w*|visited?|worked\s+on)\b[\s\S]{0,40}\bupwork\b|\bupwork\b[\s\S]{0,40}\b(open(ed|ing)?|navigat\w*|visited?|worked)\b/i;

const RESTART_ACTION_RE =
	/\b(user\s+)?restarted?\s+(the\s+)?recording\b|\brestarted?\s+recording\b/i;

const SETTINGS_ACTION_RE = /\b((user|speaker)\s+)?(opens?|opened|opening)\s+(the\s+)?settings\b/i;

export function looksLikeActionAssertion(text: string): boolean {
	return ACTION_ASSERTION_RE.test(text);
}

export function assertsForbiddenUpworkAction(text: string): boolean {
	return (
		UPWORK_ACTION_RE.test(text) ||
		/\bopened upwork\b/i.test(text) ||
		/\bworked on upwork\b/i.test(text)
	);
}

export function assertsForbiddenRestartAction(text: string): boolean {
	return RESTART_ACTION_RE.test(text);
}

export function assertsForbiddenSettingsAction(text: string): boolean {
	return SETTINGS_ACTION_RE.test(text);
}

/** Strip or rewrite prose that turns passive/OCR into actions. */
export function sanitizeStoryProse(text: string): string {
	let out = text;
	out = out.replace(/\bworked on Upwork\b/gi, "Upwork tab was visible");
	out = out.replace(/\bopened Upwork\b/gi, "Upwork tab was visible");
	out = out.replace(/\bvisited Upwork\b/gi, "Upwork tab was visible");
	out = out.replace(/\bnavigated to Upwork\b/gi, "Upwork tab was visible");
	out = out.replace(UPWORK_ACTION_RE, "Upwork tab was visible");
	out = out.replace(RESTART_ACTION_RE, "Restart recording tooltip was visible");
	out = out.replace(SETTINGS_ACTION_RE, "speaker mentions opening Settings");
	out = out.replace(
		/\buser\s+(opened?|navigated\s+to|worked\s+on|visited)\s+/gi,
		"evidence does not verify that the user $1 ",
	);
	return out;
}

export function isPassiveVisibilityClaim(kind: string, isAction: boolean): boolean {
	if (isAction) return false;
	return (
		kind === "passive_app_visibility" ||
		kind === "visible_text" ||
		kind === "temporary_ui_visibility" ||
		kind === "ui_state_visibility"
	);
}

/**
 * Reject executable tool args / forbidden epistemic plans in Edit Plan V1.
 */

const EXECUTABLE_TOOL_ARGS_RE =
	/\b(addTrim|addTrims|setTrim|addZoom|addZooms|setZoom|setClipCrop|addSpeed|setSpeed|addAnnotation|addGraphic|generateCaptions|setWordText|exportProject)\s*\(|"tool"\s*:\s*"(addTrim|addZoom|setClipCrop|addSpeed)"|"startSec"\s*:\s*\d|"endSec"\s*:\s*\d/i;

const FORBIDDEN_UPWORK_PLAN_RE =
	/\b(trim|zoom|emphasize|highlight|feature)\b.{0,40}\bupwork\b|\bupwork\b.{0,40}\b(workflow|trim|zoom|emphasize)\b/i;

const FORBIDDEN_RESTART_ACTION_RE =
	/\b(remove|trim|delete)\s+restart\s+action\b|\brestart\s+recording\s+action\b/i;

const FORBIDDEN_PANEL_ZOOM_RE =
	/\bzoom\b.{0,30}\b(timeline|effects)\s+panel\b|\bzoom\b.{0,20}\bsettings\b/i;

export function leaksExecutableToolArgs(text: string): boolean {
	return EXECUTABLE_TOOL_ARGS_RE.test(text);
}

export function assertsForbiddenUpworkPlan(text: string): boolean {
	return FORBIDDEN_UPWORK_PLAN_RE.test(text);
}

export function assertsForbiddenRestartActionPlan(text: string): boolean {
	return FORBIDDEN_RESTART_ACTION_RE.test(text);
}

export function assertsForbiddenUnverifiedPanelZoom(text: string): boolean {
	return FORBIDDEN_PANEL_ZOOM_RE.test(text);
}

export function sanitizePlanProse(text: string): string {
	let out = text;
	out = out.replace(EXECUTABLE_TOOL_ARGS_RE, "editorial strategy family only");
	out = out.replace(FORBIDDEN_UPWORK_PLAN_RE, "passive context (not an editing target)");
	out = out.replace(FORBIDDEN_RESTART_ACTION_RE, "temporary recording UI visibility");
	out = out.replace(FORBIDDEN_PANEL_ZOOM_RE, "avoid unverified panel targeting");
	out = out.replace(/\baddTrim\s*\([^)]*\)/gi, "trim family");
	out = out.replace(/\baddZoom\s*\([^)]*\)/gi, "zoom family");
	return out;
}

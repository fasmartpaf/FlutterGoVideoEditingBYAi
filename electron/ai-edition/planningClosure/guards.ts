/**
 * Guards — Planning Closure must never leak execution / mutation.
 */

const EXECUTION_LEAK_RE =
	/\b(addTrim|addZoom|setClipCrop|addAnnotation|addGraphic|addSpeed|exportProject)\s*\(|mutateTimeline|applyEdit\s*\(/i;

export function leaksExecution(text: string): boolean {
	return EXECUTION_LEAK_RE.test(text);
}

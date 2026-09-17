/**
 * Sanitize user-facing claims: no fake Settings re-enable; no unsupported transition ads.
 * Honest applied CUT/DISSOLVE receipts are kept.
 */

export function stripFalseProjectEditsDisabledClaim(
	text: string,
	settingsEditsAllowed: boolean,
): string {
	if (!settingsEditsAllowed) return text;
	return text
		.replace(
			/\b(?:please\s+)?re-?enable\s+['"]?project\s+edits['"]?\s+in\s+(?:the\s+)?settings[^.]*\.?/gi,
			"",
		)
		.replace(/\bProject\s+edits\s+(?:are\s+)?(?:currently\s+)?disabled[^.]*\.?/gi, "")
		.replace(/\s{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function stripUnsupportedTransitionClaims(text: string): string {
	const lines = text.split(/\n/);
	const kept = lines.filter((line) => {
		if (!/\btransitions?\b|\bdissolve\b/i.test(line)) return true;
		// Keep honest restraint / unsupported / no-useful-join lines
		if (
			/\b(can'?t|cannot|couldn'?t|could\s+not|don'?t|do\s+not|aren'?t|not\s+(?:yet\s+)?(?:supported|verified|available)|left\s+transitions?\s+(?:alone|unchanged)|no\s+useful\s+(?:transition\s+)?join|doesn'?t\s+have\s+a\s+join)\b/i.test(
				line,
			)
		) {
			return true;
		}
		// Keep honest applied dissolve/cut receipts (authorable CUT|DISSOLVE).
		if (
			/\b(set|added|applied|used|softened|put)\b.+\b(dissolve|cut|transition|crossfade)\b/i.test(
				line,
			) ||
			/\b(dissolve|incoming\s+fade)\b.+\b(join|clip|boundary)\b/i.test(line) ||
			/\bbrief\s+dissolve\b/i.test(line)
		) {
			return true;
		}
		return false;
	});
	return kept
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function stripRepeatedProceedAsks(text: string, alreadyAuthorized: boolean): string {
	if (!alreadyAuthorized) return text;
	return text
		.replace(/\bwould you like to proceed\??/gi, "")
		.replace(/\bshall i (?:proceed|continue|apply)\??/gi, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

/**
 * History policy — no LLM summarizer; extract constraint-like user turns only.
 */

export function selectBoundedHistoryConstraints(
	history: Array<{ role: string; content: string }>,
	maxItems = 6,
): string[] {
	const out: string[] = [];
	for (const h of history) {
		if (h.role !== "user") continue;
		const c = h.content.trim();
		if (!c) continue;
		if (
			/\b(don'?t|do not|keep|preserve|without changing|leave|except|but)\b/i.test(c) ||
			/\b(intro|outro|pause|silence|zoom|shorter|professional|settings|upwork)\b/i.test(c)
		) {
			out.push(c.slice(0, 240));
		}
		if (out.length >= maxItems) break;
	}
	// Always keep last user constraint-ish message if none matched but history exists
	if (out.length === 0) {
		const lastUser = [...history].reverse().find((h) => h.role === "user");
		if (lastUser?.content?.trim()) out.push(lastUser.content.trim().slice(0, 240));
	}
	return out;
}

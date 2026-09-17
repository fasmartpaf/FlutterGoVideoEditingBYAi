/**
 * Local receipts — grounded only in committed operations (0 LLM).
 */

export function buildLocalEditorialReceipt(args: {
	intent: string;
	mutated: boolean;
	families: string[];
	durationBeforeSec?: number | null;
	durationAfterSec?: number | null;
	baseText?: string | null;
	extraLines?: string[];
}): string {
	if (args.baseText?.trim() && args.mutated) {
		return args.baseText.trim();
	}
	if (!args.mutated) {
		return (
			args.baseText?.trim() ||
			"I reviewed that request locally and did not change the timeline — nothing safe to apply matched your instruction."
		);
	}
	const parts: string[] = [];
	const fam = args.families;
	if (fam.includes("trim") || fam.includes("dead_air") || fam.includes("pause")) {
		parts.push("adjusted pauses / trims");
	}
	if (fam.includes("speed")) parts.push("updated speed");
	if (fam.includes("zoom")) parts.push("updated zoom");
	if (fam.includes("captions")) parts.push("updated captions");
	if (fam.includes("loudness") || fam.includes("audio")) parts.push("adjusted audio");
	if (fam.includes("title")) parts.push("updated title");
	if (parts.length === 0) parts.push("applied a local edit");
	let text = `I ${parts.join(" and ")}.`;
	if (
		typeof args.durationBeforeSec === "number" &&
		typeof args.durationAfterSec === "number" &&
		Math.abs(args.durationAfterSec - args.durationBeforeSec) >= 0.15
	) {
		text += ` The programme is now about ${args.durationAfterSec.toFixed(1)} seconds (was ${args.durationBeforeSec.toFixed(1)}s).`;
	}
	for (const line of args.extraLines ?? []) {
		if (line.trim()) text += ` ${line.trim()}`;
	}
	return text;
}

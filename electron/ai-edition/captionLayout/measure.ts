/**
 * Local text measurement — compatible estimate (no Canvas required).
 * Prefer real compositor metrics when available later; never invent text.
 */

import type { CaptionGroupingPolicy } from "./types";

export function estimateTextWidthFrac(
	text: string,
	fontSizePxAt1080: number,
	policy: CaptionGroupingPolicy,
	frameWidthPx = 1920,
): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	// Approximate: glyph width ≈ avgGlyphWidthEm * fontSize; frame width from 16:9 @1080.
	const glyphPx = policy.avgGlyphWidthEm * fontSizePxAt1080;
	const widthPx = trimmed.length * glyphPx;
	return Math.min(2, widthPx / frameWidthPx);
}

export function breakLinesDeterministic(
	text: string,
	args: {
		fontSizePxAt1080: number;
		maxWidthFrac: number;
		maxLines: number;
		policy: CaptionGroupingPolicy;
		frameWidthPx?: number;
	},
): { lines: string[]; overflow: boolean; estimatedWidths: number[] } {
	const tokens = text.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { lines: [], overflow: false, estimatedWidths: [] };

	const lines: string[] = [];
	let current = "";
	const push = (s: string) => {
		if (s.trim()) lines.push(s.trim());
	};

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i]!;
		const candidate = current ? `${current} ${tok}` : tok;
		const w = estimateTextWidthFrac(
			candidate,
			args.fontSizePxAt1080,
			args.policy,
			args.frameWidthPx,
		);
		if (w <= args.maxWidthFrac || !current) {
			// Long token alone may still overflow — keep token, flag later.
			current = candidate;
			continue;
		}
		// Avoid orphan single word on last line when possible.
		const remaining = tokens.length - i;
		if (
			args.policy.orphanWordAvoidance &&
			remaining === 1 &&
			lines.length + 1 < args.maxLines &&
			current.split(/\s+/).length > 1
		) {
			const parts = current.split(/\s+/);
			const moved = parts.pop()!;
			push(parts.join(" "));
			current = `${moved} ${tok}`;
			continue;
		}
		push(current);
		current = tok;
		if (lines.length >= args.maxLines) {
			// Remaining tokens join last line → overflow.
			const rest = [current, ...tokens.slice(i + 1)].join(" ");
			if (lines.length === args.maxLines) {
				lines[lines.length - 1] = `${lines[lines.length - 1]} ${rest}`.trim();
			} else {
				push(rest);
			}
			current = "";
			break;
		}
	}
	if (current) push(current);

	while (lines.length > args.maxLines) {
		const last = lines.pop()!;
		lines[lines.length - 1] = `${lines[lines.length - 1]} ${last}`.trim();
	}

	const estimatedWidths = lines.map((l) =>
		estimateTextWidthFrac(l, args.fontSizePxAt1080, args.policy, args.frameWidthPx),
	);
	const overflow =
		estimatedWidths.some((w) => w > args.maxWidthFrac + 1e-6) || lines.length > args.maxLines;
	return { lines, overflow, estimatedWidths };
}

/** Prefer split cue over shrinking below min font. */
export function chooseFontSize(
	text: string,
	policy: CaptionGroupingPolicy,
	maxWidthFrac: number,
	maxLines: number,
): { fontSize: number; lines: string[]; overflow: boolean; estimatedWidths: number[] } {
	let font = policy.preferredFontSizePxAt1080;
	let best = breakLinesDeterministic(text, {
		fontSizePxAt1080: font,
		maxWidthFrac,
		maxLines,
		policy,
	});
	while (best.overflow && font > policy.minFontSizePxAt1080) {
		font = Math.max(policy.minFontSizePxAt1080, font - 4);
		best = breakLinesDeterministic(text, {
			fontSizePxAt1080: font,
			maxWidthFrac,
			maxLines,
			policy,
		});
	}
	return { fontSize: font, ...best };
}

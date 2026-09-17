/**
 * Pre-fix routing diagnosis — write baseline classifications for known failures.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "./classify";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/real-corpus-recovery-2-routing");

const PROMPTS: Array<{ id: string; prompt: string; expectVisual?: boolean; note: string }> = [
	{
		id: "case-015",
		prompt: "Was the screen mostly stable, or were there major visual changes?",
		expectVisual: true,
		note: "baseline starvation",
	},
	{
		id: "case-020",
		prompt: "What safe edits would you propose, if any? If none are safe, say so clearly.",
		expectVisual: true,
		note: "baseline starvation",
	},
	{
		id: "case-022",
		prompt: "What applications or screens are visible? Is there a webcam?",
		expectVisual: true,
		note: "baseline starvation",
	},
	{
		id: "case-025",
		prompt: "Make this suitable for a product demo. What would you change and why?",
		expectVisual: true,
		note: "baseline starvation",
	},
];

describe("routing recovery diagnose (pre/post)", () => {
	it("records classification for known starvation prompts", () => {
		mkdirSync(OUT, { recursive: true });
		const rows = PROMPTS.map((p) => {
			const n = classifyMediaContextNeeds(p.prompt);
			return {
				id: p.id,
				prompt: p.prompt,
				note: p.note,
				expectVisual: p.expectVisual,
				category: n.category,
				visual: n.visual,
				speech: n.speech,
				cursor: n.cursor,
				injectSpeech: n.injectSpeech,
				starved: p.expectVisual === true && n.visual === false,
			};
		});
		writeFileSync(path.join(OUT, "diagnose-classifications.json"), JSON.stringify(rows, null, 2));
		// Soft: document starvation if still present; recovery suite asserts after fix.
		expect(rows.length).toBe(4);
	});
});

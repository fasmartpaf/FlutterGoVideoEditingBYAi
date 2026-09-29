import { describe, expect, it } from "vitest";
import {
	appendEditReceiptIfNeeded,
	formatEditReceipt,
	prepareAssistantContent,
	stripEmbeddedReceipt,
	stripFalseNotChangedClaim,
	summarizeToolActivity,
} from "./editReceipt";

describe("formatEditReceipt", () => {
	it("lists applied tools and how to undo", () => {
		const text = formatEditReceipt([
			{ name: "addGraphic", summary: 'added title "Demo"' },
			{ name: "addZoom", summary: "added zoom 1.80×" },
		]);
		expect(text).toContain("Receipt — applied 2 edits");
		expect(text).toContain("1. addGraphic:");
		expect(text).toContain("2. addZoom:");
		expect(text).toContain("Undo:");
		expect(text).toMatch(/rewind/i);
	});
});

describe("stripFalseNotChangedClaim", () => {
	it("removes honesty paragraphs that deny a mutation", () => {
		const text =
			"Placed 5 overlays.\n\nFrom the current evidence, I don't see a safe edit. Your project was not changed.";
		expect(stripFalseNotChangedClaim(text)).toBe("Placed 5 overlays.");
		expect(stripFalseNotChangedClaim(text)).not.toMatch(/not changed/i);
	});
});

describe("stripEmbeddedReceipt", () => {
	it("removes a trailing receipt block", () => {
		const text =
			"Done — cleaned overlays.\n\nReceipt — applied 2 edits:\n1. removeModifier: id-a\n2. removeModifier: id-b\nUndo: use the chat rewind control on the previous user message to restore the project to before this turn.";
		expect(stripEmbeddedReceipt(text)).toBe("Done — cleaned overlays.");
	});
});

describe("summarizeToolActivity", () => {
	it("batches removeModifier calls into one outcome line", () => {
		const lines = Array.from({ length: 25 }, (_, i) => ({
			name: "removeModifier",
			summary: `removed ${i}`,
		}));
		expect(summarizeToolActivity(lines)).toMatch(/Cleaned 25/i);
		expect(summarizeToolActivity(lines)).not.toMatch(/removeModifier/);
	});
});

describe("prepareAssistantContent", () => {
	it("keeps a short model outcome and strips receipts", () => {
		const body =
			"Done — cleaned overlays.\n\nReceipt — applied 1 edit:\n1. removeModifier: x\nUndo: use the chat rewind control.";
		expect(prepareAssistantContent(body, [{ name: "removeModifier", summary: "x" }])).toBe(
			"Done — cleaned overlays.",
		);
	});

	it("falls back to a compact summary when the model wrote nothing useful", () => {
		expect(
			prepareAssistantContent("", [{ name: "addTrim", summary: "cut silence 1.2s" }]),
		).toMatch(/^Done —/);
		expect(prepareAssistantContent("", [{ name: "addTrim", summary: "cut silence 1.2s" }])).not.toMatch(
			/Receipt/i,
		);
	});

	it("strips false not-changed copy", () => {
		const out = prepareAssistantContent(
			"Beat graphics placed.\n\nYour project was not changed.",
			[{ name: "addBeatGraphics", summary: "beat graphics ×5" }],
		);
		expect(out).toContain("Beat graphics placed");
		expect(out).not.toMatch(/not changed/i);
		expect(out).not.toMatch(/Receipt/i);
	});
});

describe("appendEditReceiptIfNeeded", () => {
	it("does not append a verbose receipt to the primary bubble", () => {
		expect(appendEditReceiptIfNeeded("Done.", [{ name: "addTrim", summary: "cut silence" }])).toBe(
			"Done.",
		);
		expect(appendEditReceiptIfNeeded("Done.", [{ name: "addTrim", summary: "cut silence" }])).not.toMatch(
			/Receipt/i,
		);
	});
});

describe("turnReceiptItems", () => {
	it("lists one phrase per kind of change and skips reads and plan updates", async () => {
		const { turnReceiptItems } = await import("./editReceipt");
		expect(
			turnReceiptItems([
				{ name: "getCurrentDocument", summary: "read" },
				{ name: "updatePlan", summary: "plan" },
				{ name: "addZoom", summary: "zoom 1" },
				{ name: "addZoom", summary: "zoom 2" },
				{ name: "insertStartThumbnail", summary: "cover" },
			]),
		).toEqual(["Added 2 zooms", "Updated the start cover"]);
		expect(turnReceiptItems([{ name: "getTranscript", summary: "" }])).toEqual([]);
	});
});

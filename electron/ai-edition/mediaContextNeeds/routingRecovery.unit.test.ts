/**
 * Recovery 2 — routing regression + natural language coverage.
 */
import { describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "./classify";

describe("mediaContextNeeds Recovery 2 routing", () => {
	it("known starvation: screen stability → visual", () => {
		const n = classifyMediaContextNeeds(
			"Was the screen mostly stable, or were there major visual changes?",
		);
		expect(n.visual).toBe(true);
		expect(["visualInspection", "mediaUnderstanding"]).toContain(n.category);
	});

	it("known starvation: safe edits → multimodal editing/understanding", () => {
		const n = classifyMediaContextNeeds(
			"What safe edits would you propose, if any? If none are safe, say so clearly.",
		);
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
		expect(["editingContext", "mediaUnderstanding"]).toContain(n.category);
	});

	it("known starvation: apps/webcam visible → visual", () => {
		const n = classifyMediaContextNeeds(
			"What applications or screens are visible? Is there a webcam?",
		);
		expect(n.visual).toBe(true);
	});

	it("known starvation: product demo editorial → multimodal", () => {
		const n = classifyMediaContextNeeds(
			"Make this suitable for a product demo. What would you change and why?",
		);
		expect(n.category).toBe("editingContext");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
	});

	it("paraphrases: stability / change", () => {
		for (const p of [
			"Did the screen change much?",
			"Was the screen mostly unchanged?",
			"Anything moving or changing on screen?",
		]) {
			expect(classifyMediaContextNeeds(p).visual, p).toBe(true);
		}
	});

	it("editorial paraphrases / typos", () => {
		for (const p of [
			"make this pro",
			"clean this video",
			"improve pacing",
			"fix the pacing",
			"anything boring here?",
			"make it shorter but don't remove explanation",
			"prepare this for a client",
		]) {
			const n = classifyMediaContextNeeds(p);
			expect(n.visual, p).toBe(true);
			expect(n.speech, p).toBe(true);
		}
	});

	it("speech-only stays selective", () => {
		const n = classifyMediaContextNeeds("What did I say?");
		expect(n.category).toBe("speechInspection");
		expect(n.speech).toBe(true);
		expect(n.visual).toBe(false);
	});

	it("cross-modal needs both", () => {
		const n = classifyMediaContextNeeds("Did what I said actually happen on screen?");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
	});

	it("cross-modal residual phrase (Recovery 4 / val-J) needs speech+visual", () => {
		const n = classifyMediaContextNeeds(
			"Did the things I talk about actually appear on screen, or am I only describing intentions?",
		);
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
		expect(n.category).toBe("mediaUnderstanding");
	});

	it("deterministic edits stay cheap", () => {
		for (const p of ["Trim 5–8s.", "Delete 3–5 seconds.", "Set aspect ratio to 16:9"]) {
			const n = classifyMediaContextNeeds(p);
			expect(n.category, p).toBe("deterministicEdit");
			expect(n.visual, p).toBe(false);
			expect(n.speech, p).toBe(false);
		}
	});

	it("general / capability questions do not force media", () => {
		for (const p of [
			"What does cropping do?",
			"Can OpenScreen stabilize video?",
			"What does trim mean?",
		]) {
			const n = classifyMediaContextNeeds(p);
			expect(n.visual, p).toBe(false);
			expect(n.speech, p).toBe(false);
			expect(n.category, p).toBe("fallback");
		}
	});

	it("popup visual-only", () => {
		const n = classifyMediaContextNeeds("What popup appears at the end?");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(false);
	});

	it("what I said speech path", () => {
		const n = classifyMediaContextNeeds("Summarize what I said near the end.");
		expect(n.speech).toBe(true);
	});
});

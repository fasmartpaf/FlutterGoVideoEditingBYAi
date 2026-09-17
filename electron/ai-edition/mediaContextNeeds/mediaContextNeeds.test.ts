import { describe, expect, it } from "vitest";
import { promptWantsVisualEvidence } from "../visualEvidence/intent";
import { CASE_2_EXACT_PROMPT } from "./case2Prompt";
import { classifyMediaContextNeeds } from "./index";

describe("mediaContextNeeds classifier", () => {
	it("exact Case 2 prompt → visual=true (mediaUnderstanding)", () => {
		const n = classifyMediaContextNeeds(CASE_2_EXACT_PROMPT);
		// Whole-recording watch + beginning-to-end narrative → mediaUnderstanding
		// (not narrow visualInspection), even though UI-event language is also present.
		expect(n.category).toBe("mediaUnderstanding");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
		expect(promptWantsVisualEvidence(CASE_2_EXACT_PROMPT)).toBe(true);
	});

	it('"Watch this recording" → visual=true', () => {
		const n = classifyMediaContextNeeds("Watch this recording");
		expect(n.visual).toBe(true);
		expect(["mediaUnderstanding", "visualInspection"]).toContain(n.category);
	});

	it('"Tell me what visibly happens" → visual=true', () => {
		const n = classifyMediaContextNeeds("Tell me what visibly happens");
		expect(n.visual).toBe(true);
		expect(["mediaUnderstanding", "visualInspection"]).toContain(n.category);
	});

	it('"Did a notification appear?" → visual=true', () => {
		const n = classifyMediaContextNeeds("Did a notification appear?");
		expect(n.category).toBe("visualInspection");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(false);
	});

	it('"Describe UI changes" → visual=true', () => {
		const n = classifyMediaContextNeeds("Describe UI changes");
		expect(n.category).toBe("visualInspection");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(false);
	});

	it("whole-recording request → visual=true", () => {
		const n = classifyMediaContextNeeds(
			"Watch this whole recording and explain what happens from beginning to end.",
		);
		expect(n.category).toBe("mediaUnderstanding");
		expect(n.visual).toBe(true);
	});

	it("6 — narrow visual request does not request speech", () => {
		const n = classifyMediaContextNeeds("What is visible on screen around 6 seconds?");
		expect(n.category).toBe("visualInspection");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(false);
		expect(n.injectSpeech).toBe(false);
	});

	it("7 — transcript request triggers speech, not visual", () => {
		const n = classifyMediaContextNeeds("What did I say around 6 seconds?");
		expect(n.category).toBe("speechInspection");
		expect(n.speech).toBe(true);
		expect(n.visual).toBe(false);
		expect(n.injectSpeech).toBe(true);
	});

	it("8 — whole-media understanding prepares visual + speech", () => {
		const n = classifyMediaContextNeeds(
			"Tell me what is happening in this recording, including what I'm explaining.",
		);
		expect(n.category).toBe("mediaUnderstanding");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
		expect(n.injectSpeech).toBe(true);
	});

	it("9 — editing-brain-style request prepares multimodal context", () => {
		const n = classifyMediaContextNeeds(
			"Make this recording feel like a polished software tutorial.",
		);
		expect(n.category).toBe("editingContext");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
		expect(n.cursor).toBe(true);
		expect(n.injectSpeech).toBe(true);
	});

	it("10 — deterministic timestamp edit avoids visual + speech", () => {
		for (const prompt of [
			"Delete 3–5 seconds.",
			"Trim the first two seconds.",
			"Set speed to 1.2x from 4–8 seconds.",
		]) {
			const n = classifyMediaContextNeeds(prompt);
			expect(n.category, prompt).toBe("deterministicEdit");
			expect(n.visual, prompt).toBe(false);
			expect(n.speech, prompt).toBe(false);
			expect(n.injectSpeech, prompt).toBe(false);
		}
	});

	it("timestamp look is visualInspection, not whole-recording understanding", () => {
		const n = classifyMediaContextNeeds("What happens at 12 seconds?");
		expect(n.category).toBe("visualInspection");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(false);
	});

	it("Q5 compare-say-vs-visible is mediaUnderstanding with both modalities", () => {
		const p =
			"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.";
		const n = classifyMediaContextNeeds(p);
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
		expect(n.category).toBe("mediaUnderstanding");
	});

	it("editorial zoom-help judgment prepares visual+speech", () => {
		const n = classifyMediaContextNeeds("Where would zoom actually help, if anywhere?");
		expect(n.category).toBe("editingContext");
		expect(n.visual).toBe(true);
		expect(n.speech).toBe(true);
		expect(promptWantsVisualEvidence("Where would zoom actually help, if anywhere?")).toBe(true);
		const c1 = classifyMediaContextNeeds(
			"Where would a zoom actually help in this recording, and where would it not help? Only recommend zooms when the visible evidence supports a specific focal target.",
		);
		expect(c1.category).toBe("editingContext");
		expect(c1.visual).toBe(true);
	});

	it("12 — classifier does not invoke an LLM (pure sync function)", () => {
		const before = Date.now();
		classifyMediaContextNeeds("Improve the pacing.");
		expect(Date.now() - before).toBeLessThan(50);
		expect(typeof classifyMediaContextNeeds).toBe("function");
	});

	it("legacy Bug-2 visual-intent stays aligned with classifier", () => {
		const prompts = [
			"Make this look professional",
			"Zoom into the button when I click Publish",
			"What do you see on the screen?",
			"check the recording please",
			"analyze this video",
			"review the footage",
			"read every frame",
			"tell me about this video",
			"Check a video and let's me know what about it? and make ma transacripton read a each frame ok? and guide me how about it's?",
		];
		for (const p of prompts) {
			expect(promptWantsVisualEvidence(p), p).toBe(true);
			expect(classifyMediaContextNeeds(p).visual, p).toBe(true);
		}
		expect(promptWantsVisualEvidence("Delete 10.2 seconds to 13.5 seconds.")).toBe(false);
		expect(promptWantsVisualEvidence("Trim the first two seconds")).toBe(false);
		expect(promptWantsVisualEvidence("Change aspect ratio to 9:16")).toBe(false);
	});
});

/**
 * Compositional intent robustness — duration paraphrases + adversarial suite.
 * Not a list of matcher sentences.
 */

import { describe, expect, it } from "vitest";
import {
	detectSpeechAct,
	normalizeEditorialText,
	parseLocalEditorialRequest,
	shouldHandleLocalEditorialWithoutCloud,
} from "./index";

const DURATION_PARAPHRASES = [
	"Make it under 12 seconds.",
	"Can you make it under a 12 sec?",
	"Get this down to about 12 seconds.",
	"I need this around 12s.",
	"Shorten the video to roughly 12 seconds.",
	"Can we get this below twelve seconds?",
	"Make this shorter, around 12 seconds, but keep the important parts.",
	"Cut it down to 12 sec without removing the explanation.",
	"The video is too long. Bring it closer to 12 seconds.",
	"Try to make this about twelve seconds while keeping the useful content.",
];

const ADVERSARIAL_SUPPORTED: Array<{
	msg: string;
	intent: string;
	mustLocal: boolean;
}> = [
	{ msg: "Trim out the dead air stretches please.", intent: "REMOVE_PAUSES", mustLocal: true },
	{ msg: "Knock the silences down a bit.", intent: "SHORTEN_PAUSES", mustLocal: true },
	{ msg: "Please shorten those awkward pauses.", intent: "SHORTEN_PAUSES", mustLocal: true },
	{ msg: "Speed through the scrolling bits.", intent: "SPEED_UP", mustLocal: true },
	{ msg: "The waiting sections drag — make them snappier.", intent: "SPEED_UP", mustLocal: true },
	{ msg: "That speed ramp feels rushed; ease it back.", intent: "SLOW_DOWN", mustLocal: true },
	{ msg: "Pull off the zoom you just added.", intent: "REMOVE_ZOOM", mustLocal: true },
	{ msg: "Dial the zoom back a notch.", intent: "ADJUST_ZOOM", mustLocal: true },
	{ msg: "Captions are too big for this frame.", intent: "CAPTION_STYLE", mustLocal: true },
	{ msg: "Kill the captions for now.", intent: "CAPTIONS", mustLocal: true },
	{ msg: "Drop the title card.", intent: "REMOVE_TITLE", mustLocal: true },
	{ msg: "Put a simple title on at the start.", intent: "TITLE", mustLocal: true },
	{ msg: "Revert what we just did.", intent: "RESTORE_PREVIOUS", mustLocal: true },
	{
		msg: "Go back to how it was before that last batch.",
		intent: "RESTORE_PREVIOUS",
		mustLocal: true,
	},
	{ msg: "Undo the latest change.", intent: "UNDO_LAST_EDIT", mustLocal: true },
	{ msg: "Polish this like it's going out today.", intent: "PROFESSIONALIZE", mustLocal: true },
	{ msg: "Can you make this better?", intent: "PROFESSIONALIZE", mustLocal: true },
	{
		msg: "Shave this to ~15 seconds and keep the demo click.",
		intent: "TARGET_DURATION",
		mustLocal: true,
	},
	{ msg: "Aim for something nearer 10 seconds.", intent: "TARGET_DURATION", mustLocal: true },
	{
		msg: "Compress runtime toward 20s without losing the talk track.",
		intent: "TARGET_DURATION",
		mustLocal: true,
	},
	{ msg: "Take the last zoom off the timeline.", intent: "REMOVE_ZOOM", mustLocal: true },
	{ msg: "Turn captions down in size.", intent: "CAPTION_STYLE", mustLocal: true },
];

const MUST_NOT_MUTATE = [
	"What do you think about this video?",
	"Why did you remove that zoom?",
	"Don't remove the zoom.",
	"How does OpenScreen export work?",
	"Is there a webcam in the frame?",
	"Summarize what I said near the end.",
];

describe("LOCAL_EDITORIAL_INTENT_ROBUSTNESS_V1", () => {
	it("normalizes units, fillers, and word numbers", () => {
		expect(normalizeEditorialText("under a 12 sec")).toMatch(/under 12 sec/);
		expect(normalizeEditorialText("below twelve seconds")).toMatch(/under 12 sec/);
		expect(normalizeEditorialText("around 12s")).toMatch(/approx 12 sec/);
	});

	it("TARGET_DURATION: 10 natural paraphrases → local ≤12s", () => {
		for (const msg of DURATION_PARAPHRASES) {
			const r = parseLocalEditorialRequest(msg);
			expect(r.intent, msg).toBe("TARGET_DURATION");
			expect(r.durationTargetMaxSec ?? r.durationTargetSec, msg).toBe(12);
			expect(shouldHandleLocalEditorialWithoutCloud(msg), msg).toBe(true);
			expect(r.executionKind, msg).toBe("professional_orchestrator");
			expect(r.confidence, msg).toBeGreaterThanOrEqual(0.8);
		}
		const withPreserve = parseLocalEditorialRequest(
			"Make this shorter, around 12 seconds, but keep the important parts.",
		);
		expect(withPreserve.preserve.length).toBeGreaterThan(0);
	});

	it("adversarial supported paraphrases hit expected families", () => {
		let hits = 0;
		for (const c of ADVERSARIAL_SUPPORTED) {
			const r = parseLocalEditorialRequest(c.msg);
			const ok = r.intent === c.intent;
			if (ok) hits++;
			else {
				// allow close family for shorten vs remove pauses
				if (
					(c.intent === "SHORTEN_PAUSES" || c.intent === "REMOVE_PAUSES") &&
					(r.intent === "SHORTEN_PAUSES" || r.intent === "REMOVE_PAUSES")
				) {
					hits++;
					continue;
				}
				if (c.intent === "RESTORE_PREVIOUS" && r.intent === "UNDO_LAST_EDIT") {
					hits++;
					continue;
				}
			}
			expect(r.intent, `${c.msg} → ${r.intent}`).toBe(c.intent);
			if (c.mustLocal) {
				expect(shouldHandleLocalEditorialWithoutCloud(c.msg), c.msg).toBe(true);
			}
		}
		const recall = hits / ADVERSARIAL_SUPPORTED.length;
		expect(recall).toBeGreaterThanOrEqual(0.95);
	});

	it("protects questions / opinions / don't-remove from mutation routing", () => {
		for (const msg of MUST_NOT_MUTATE) {
			const r = parseLocalEditorialRequest(msg);
			expect(r.intent === "UNKNOWN" || r.intent === "PRESERVE_RANGE", msg).toBe(true);
			expect(
				r.executionKind === "direct_document" || r.executionKind === "professional_orchestrator",
				msg,
			).toBe(false);
			if (msg.toLowerCase().includes("don't remove the zoom")) {
				expect(r.intent).toBe("PRESERVE_RANGE");
				expect(detectSpeechAct(msg, normalizeEditorialText(msg))).toBe("CONSTRAINT");
			}
			if (/what do you think/i.test(msg)) {
				expect(shouldHandleLocalEditorialWithoutCloud(msg)).toBe(false);
			}
			if (/why did you remove/i.test(msg)) {
				expect(r.intent).toBe("UNKNOWN");
				expect(shouldHandleLocalEditorialWithoutCloud(msg)).toBe(false);
			}
		}
	});
});

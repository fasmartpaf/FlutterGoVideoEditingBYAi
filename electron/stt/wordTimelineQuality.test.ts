import { describe, expect, it } from "vitest";
import { isDegenerateWordTimeline } from "./wordTimelineQuality";

describe("isDegenerateWordTimeline", () => {
	it("accepts a normal spread of word starts", () => {
		const words = Array.from({ length: 10 }, (_, i) => ({
			word: `w${i}`,
			startSec: i * 0.4,
			endSec: i * 0.4 + 0.35,
		}));
		expect(isDegenerateWordTimeline(words)).toBe(false);
	});

	it("rejects the Case-recording collapse: all words pinned to one start", () => {
		const words = Array.from({ length: 52 }, (_, i) => ({
			word: `w${i}`,
			startSec: 23.92,
			endSec: i === 51 ? 24.06 : 23.94,
		}));
		const phrases = [{ text: "full narration", startSec: 0.6, endSec: 24.1 }];
		expect(isDegenerateWordTimeline(words, phrases)).toBe(true);
		expect(isDegenerateWordTimeline(words)).toBe(true);
	});

	it("rejects Metal-style pileups with many zero-duration words", () => {
		const words = [
			...Array.from({ length: 12 }, (_, i) => ({
				word: `a${i}`,
				startSec: 18.14,
				endSec: 18.14,
			})),
			...Array.from({ length: 8 }, (_, i) => ({
				word: `b${i}`,
				startSec: 18.14 + i * 0.01,
				endSec: 18.14 + i * 0.01,
			})),
			{ word: "ok", startSec: 20, endSec: 20.4 },
		];
		expect(isDegenerateWordTimeline(words)).toBe(true);
	});

	it("ignores short word lists", () => {
		const words = [
			{ word: "a", startSec: 1, endSec: 1.02 },
			{ word: "b", startSec: 1, endSec: 1.02 },
			{ word: "c", startSec: 1, endSec: 1.02 },
		];
		expect(isDegenerateWordTimeline(words)).toBe(false);
	});
});

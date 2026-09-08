// "Turn the background off" (#84) is four settings, not one. Padding 0 now cover-fills the
// output frame (no letterbox wallpaper), but that crops a mismatched capture. Fit still
// adopts the footage's shape so the whole recording stays visible without a crop.

import { describe, expect, it } from "vitest";
import { fitClipPatch } from "./RightPanes";

describe("fitClipPatch", () => {
	it("zeroes the three frame values and adopts the footage's shape", () => {
		expect(fitClipPatch("16:10")).toEqual({
			padding: 0,
			borderRadius: 0,
			shadowIntensity: 0,
			aspectRatio: "16:10",
		});
	});

	it("adopts the shape it is given, not a preset", () => {
		// An odd capture size is exactly the case a preset list cannot serve.
		expect(fitClipPatch("683:384").aspectRatio).toBe("683:384");
	});

	it("has no inverse, deliberately", () => {
		// It was a toggle, and its OFF branch restored the shipped defaults — a guess dressed
		// as a memory, since nothing stored what the user actually had. Undo does that job,
		// and the three sliders it writes sit right below the button.
		expect(Object.keys(fitClipPatch("16:10")).sort()).toEqual([
			"aspectRatio",
			"borderRadius",
			"padding",
			"shadowIntensity",
		]);
	});
});

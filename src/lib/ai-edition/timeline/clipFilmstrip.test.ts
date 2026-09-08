import { describe, expect, it } from "vitest";
import {
	clipJoinTimes,
	filmstripCellCount,
	filmstripSampleTimes,
	posterTimeForSpan,
} from "./clipFilmstrip";

describe("clipFilmstrip", () => {
	it("samples the middle of a one-cell card", () => {
		expect(filmstripSampleTimes(10, 20, 1)).toEqual([15]);
	});

	it("spaces several pictures across the kept span", () => {
		expect(filmstripSampleTimes(0, 10, 2)).toEqual([2.5, 7.5]);
	});

	it("marks a join only when clips actually touch", () => {
		expect(
			clipJoinTimes([
				{ timelineStartSec: 0, timelineEndSec: 4 },
				{ timelineStartSec: 4, timelineEndSec: 8 },
				{ timelineStartSec: 10, timelineEndSec: 12 },
			]),
		).toEqual([4]);
	});

	it("sizes the strip from the on-screen width", () => {
		expect(filmstripCellCount(20)).toBe(1);
		expect(filmstripCellCount(200)).toBe(3);
	});

	it("takes a poster just inside the pill, not on the raw edge", () => {
		expect(posterTimeForSpan(5, 8)).toBeCloseTo(5.12);
	});
});

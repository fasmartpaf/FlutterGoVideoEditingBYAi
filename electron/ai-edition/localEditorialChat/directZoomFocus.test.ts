/**
 * Direct zoom focus selection — unit coverage for WHERE priority.
 */

import { describe, expect, it } from "vitest";
import { type CursorSampleLite, selectDirectZoomFocus } from "./directZoomFocus";

function samplesInRange(
	start: number,
	end: number,
	points: Array<{ t: number; cx: number; cy: number; type?: string }>,
): CursorSampleLite[] {
	return points
		.filter((p) => p.t >= start && p.t <= end)
		.map((p) => ({
			atSec: p.t,
			cx: p.cx,
			cy: p.cy,
			visible: true,
			interactionType: p.type ?? "move",
		}));
}

describe("DIRECT_ZOOM_FOCUS_V2", () => {
	it("A: strong click in range wins over dwell/center", () => {
		const cursor = samplesInRange(5, 10, [
			{ t: 5.2, cx: 0.2, cy: 0.2 },
			{ t: 5.5, cx: 0.21, cy: 0.22 },
			{ t: 6.0, cx: 0.7, cy: 0.3, type: "click" },
			{ t: 6.05, cx: 0.7, cy: 0.3, type: "mouseup" },
			{ t: 7.0, cx: 0.71, cy: 0.31 },
			{ t: 8.0, cx: 0.72, cy: 0.32 },
			{ t: 9.0, cx: 0.7, cy: 0.3 },
		]);
		const t = selectDirectZoomFocus({ startSec: 5, endSec: 10, cursorSamples: cursor });
		expect(t.focusSource).toBe("click");
		expect(t.selectedFocus.cx).toBeCloseTo(0.7, 1);
		expect(t.fallbackUsed).toBe(false);
		expect(t.focusCandidates.some((c) => c.source === "click")).toBe(true);
	});

	it("B: dwell without click", () => {
		const cursor: CursorSampleLite[] = [];
		for (let i = 0; i < 40; i++) {
			cursor.push({
				atSec: 5 + i * 0.1,
				cx: 0.35 + (i % 3) * 0.005,
				cy: 0.55 + (i % 2) * 0.004,
				visible: true,
				interactionType: "move",
			});
		}
		const t = selectDirectZoomFocus({ startSec: 5, endSec: 10, cursorSamples: cursor });
		expect(["dwell", "focal"]).toContain(t.focusSource);
		expect(t.fallbackUsed).toBe(false);
		expect(Math.abs(t.selectedFocus.cx - 0.5)).toBeGreaterThan(0.05);
	});

	it("C: no useful evidence → center fallback", () => {
		const t = selectDirectZoomFocus({
			startSec: 5,
			endSec: 10,
			cursorSamples: [
				{ atSec: 5.1, cx: 0.1, cy: 0.1, interactionType: "move" },
				{ atSec: 9.9, cx: 0.9, cy: 0.9, interactionType: "move" },
			],
		});
		expect(t.focusSource).toBe("center");
		expect(t.fallbackUsed).toBe(true);
		expect(t.selectedFocus).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("D: explicit user target overrides click", () => {
		const cursor = samplesInRange(5, 10, [
			{ t: 6.0, cx: 0.8, cy: 0.8, type: "click" },
			{ t: 6.1, cx: 0.8, cy: 0.8 },
			{ t: 7.0, cx: 0.81, cy: 0.79 },
		]);
		const t = selectDirectZoomFocus({
			startSec: 5,
			endSec: 10,
			userFocus: { cx: 0.25, cy: 0.4 },
			cursorSamples: cursor,
		});
		expect(t.focusSource).toBe("user");
		expect(t.selectedFocus.cx).toBeCloseTo(0.25, 2);
		expect(t.selectedFocus.cy).toBeCloseTo(0.4, 2);
	});

	it("never rejects — always returns a focus", () => {
		const t = selectDirectZoomFocus({ startSec: 5, endSec: 10, cursorSamples: [] });
		expect(t.selectedFocus).toEqual({ cx: 0.5, cy: 0.5 });
		expect(t.fallbackUsed).toBe(true);
	});
});

import { describe, expect, it } from "vitest";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { classifyVideoMemoryQuery } from "./index";
import { classifyQueryScope, parseFocusWindow } from "./queryScope";

describe("QueryScope V1", () => {
	it("popup near the end is visual + bounded_range", () => {
		const p = "What's this popup near the end?";
		const needs = classifyMediaContextNeeds(p);
		const qc = classifyVideoMemoryQuery(p, needs);
		expect(qc).toBe("visual");
		expect(classifyQueryScope(p, qc)).toBe("bounded_range");
		const w = parseFocusWindow(p, 21.44, "bounded_range");
		expect(w?.kind).toBe("late");
		expect(w!.startSec).toBeGreaterThan(12);
	});

	it("timestamp visual is local", () => {
		expect(classifyQueryScope("What happens at 12 seconds?", "visual")).toBe("local");
		const w = parseFocusWindow("What happens at 12 seconds?", 21, "local");
		expect(w?.kind).toBe("timestamp");
		expect(w!.startSec).toBeLessThan(12);
		expect(w!.endSec).toBeGreaterThan(12);
	});

	it("zoom-help and negative editorial are whole_media", () => {
		const c1 =
			"Where would a zoom actually help in this recording, and where would it not help? Only recommend zooms when the visible evidence supports a specific focal target.";
		expect(classifyQueryScope(c1, "editorial")).toBe("whole_media");
		expect(classifyQueryScope("What would you NOT edit, and why?", "editorial")).toBe(
			"whole_media",
		);
	});

	it("cross-modal compare is whole_media", () => {
		const p =
			"Compare what I say with what is visibly happening. Tell me what matches, what differs, and what cannot be verified.";
		expect(classifyQueryScope(p, "cross_modal")).toBe("whole_media");
	});

	it("speech near the end is bounded_range, not whole_media", () => {
		expect(classifyQueryScope("What did I say near the end?", "speech")).toBe("bounded_range");
	});

	it("Settings action verify is bounded_range", () => {
		expect(classifyQueryScope("Did I open Settings?", "action_verify")).toBe("bounded_range");
	});
});

import { describe, expect, it } from "vitest";
import { createTurnTimer, formatTurnTiming } from "./turnTiming";

describe("turnTiming", () => {
	it("records the first time each kind of event reached the user", () => {
		let t = 1_000;
		const timer = createTurnTimer(() => t);
		const seen: string[] = [];
		const sink = timer.wrap({
			text: (d) => seen.push(`text:${d}`),
			thinking: (d) => seen.push(`thinking:${d}`),
			toolStart: (n) => seen.push(`tool:${n}`),
			toolEnd: () => {},
			error: () => {},
			status: (p) => seen.push(`status:${p}`),
		});
		t = 1_005;
		sink.status("agent_started");
		t = 1_900;
		sink.thinking("hmm");
		t = 2_400;
		sink.toolStart("addTrim", {});
		sink.toolStart("addZoom", {});
		t = 3_000;
		sink.text("Done");
		sink.text(" now");
		t = 3_500;
		const timing = timer.finish();
		expect(timing).toEqual({
			firstStatusMs: 5,
			firstThinkingMs: 900,
			firstTextMs: 2_000,
			firstToolMs: 1_400,
			totalMs: 2_500,
			toolCount: 2,
		});
		// Events still reach the real sink, in order.
		expect(seen).toEqual([
			"status:agent_started",
			"thinking:hmm",
			"tool:addTrim",
			"tool:addZoom",
			"text:Done",
			"text: now",
		]);
		expect(formatTurnTiming(timing)).toContain("text 2000ms");
	});
});

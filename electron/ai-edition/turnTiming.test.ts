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
		expect(timing).toMatchObject({
			firstStatusMs: 5,
			firstThinkingMs: 900,
			firstTextMs: 2_000,
			firstToolMs: 1_400,
			totalMs: 2_500,
			toolCount: 2,
			// Both tools were still running at the end.
			toolMs: 1_100,
			modelMs: 1_400,
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

	it("splits a turn into tool time and model time, and names the slowest tools", () => {
		let t = 0;
		const timer = createTurnTimer(() => t);
		const noop = () => {};
		const sink = timer.wrap({ text: noop, thinking: noop, toolStart: noop, toolEnd: noop, error: noop, status: noop, plan: noop });
		t = 10_000; // model thinks 10 s
		sink.toolStart("createMotionClip", {});
		sink.toolStart("addTrim", {});
		t = 10_050;
		sink.toolEnd("addTrim", true);
		t = 14_000;
		sink.toolEnd("createMotionClip", true); // 4 s of rendering, overlapping the trim
		t = 34_000; // model thinks 20 s
		sink.toolStart("sampleFrames", {});
		t = 35_000;
		sink.toolEnd("sampleFrames", true);
		t = 40_000;
		const timing = timer.finish();
		expect(timing.toolMs).toBe(5_000);
		expect(timing.modelMs).toBe(35_000);
		expect(timing.slowTools.map((x) => x.name)).toEqual(["createMotionClip", "sampleFrames", "addTrim"]);
		expect(formatTurnTiming(timing)).toContain("model time 35000ms");
	});
});

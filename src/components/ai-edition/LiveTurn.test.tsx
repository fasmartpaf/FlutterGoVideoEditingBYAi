// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type LiveTurnLabels, LiveTurnCard, liveHeadline } from "./LiveTurn";

afterEach(cleanup);

const labels: LiveTurnLabels = {
	author: "FlutterGo",
	plan: "Plan",
	reasoning: "Reasoning",
	working: "Working",
	stepActions: (n) => `${n} actions`,
	earlierActions: (n) => `${n} earlier`,
};

describe("LiveTurnCard", () => {
	it("files actions under the step that was running, and counts them on finished steps", () => {
		render(
			<LiveTurnCard
				startedAt={Date.now() - 65_000}
				status="Preparing edits…"
				plan={[
					{ text: "Cut & pacing", status: "done" },
					{ text: "Graphics & motion", status: "in_progress" },
					{ text: "Review & export", status: "pending" },
				]}
				tools={[
					{ name: "addTrims", ok: true, step: 0 },
					{ name: "tightenPacing", ok: true, step: 0 },
					{ name: "createMotionClip", ok: true, step: 1 },
					{ name: "addMotionOverlay", step: 1 },
				]}
				thinking=""
				text=""
				labels={labels}
			/>,
		);
		expect(screen.getByText("1:05")).toBeTruthy();
		expect(screen.getByText("2 actions")).toBeTruthy();
		const rows = screen.getAllByRole("listitem");
		expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["done", "in_progress", "pending"]);
		// No reasoning box without reasoning, and heartbeat noise never shows.
		expect(screen.queryByText("Reasoning")).toBeNull();
	});

	it("shows only the last actions when there is no plan", () => {
		render(
			<LiveTurnCard
				startedAt={Date.now()}
				status={null}
				plan={[]}
				tools={Array.from({ length: 7 }, () => ({ name: "sampleFrames", ok: true }))}
				thinking="Looking at the intro frames"
				text=""
				labels={labels}
			/>,
		);
		expect(screen.getByText("3 earlier")).toBeTruthy();
		expect(screen.getByText("Reasoning")).toBeTruthy();
	});
});

describe("liveHeadline", () => {
	it("prefers the running action, then the status, then 'Working'", () => {
		expect(liveHeadline([{ name: "sampleFrames" }], "Reading files…", "Working")).toMatch(/frames/i);
		expect(liveHeadline([{ name: "sampleFrames", ok: true }], "Reading files…", "Working")).toBe("Reading files");
		expect(liveHeadline([], "thinking", "Working")).toBe("Working");
	});
});

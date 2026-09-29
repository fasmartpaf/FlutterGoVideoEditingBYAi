import { describe, expect, it } from "vitest";
import { toolActivityProgressLine, toolActivityStatus } from "./toolActivityLabels";

describe("toolActivityStatus", () => {
	it("maps OpenScreen tools to short status labels", () => {
		expect(toolActivityStatus("getCurrentDocument")).toBe("Reading project");
		expect(toolActivityStatus("removeModifier")).toBe("Cleaning timeline");
		expect(toolActivityStatus("createMotionGraphicPreview")).toBe("Creating animation");
		expect(toolActivityStatus("Bash")).toBe("Using Bash");
		expect(toolActivityStatus("Read")).toBe("Reading files");
	});

	it("formats a progress line", () => {
		expect(toolActivityProgressLine("addGraphic")).toBe("Editing graphics…");
	});
});

describe("every agent tool has a readable label", () => {
	it("no tool falls back to a raw tool name", async () => {
		const { buildTools } = await import("./deep-agent/service");
		const noop = () => {};
		const tools = buildTools(
			{ current: {} as never },
			{ text: noop, thinking: noop, toolStart: noop, toolEnd: noop, error: noop },
		);
		const unlabeled = tools.map((t) => t.name).filter((name) => toolActivityStatus(name) === `Using ${name}`);
		expect(unlabeled).toEqual([]);
		expect(toolActivityStatus("updatePlan")).toBe("Updating plan");
		expect(toolActivityStatus("removeFillerWords")).toBe("Removing filler words");
	});
});

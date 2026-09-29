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

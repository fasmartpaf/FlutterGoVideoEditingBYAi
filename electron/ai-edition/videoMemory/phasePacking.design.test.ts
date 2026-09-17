import { describe, expect, it } from "vitest";
import { OPENSCREEN_TOOL_NAMES } from "../agent-tools";
import { compareQueryGateVsPhasePacking, estimatePhaseSchemaChars } from "./phasePacking.design";

describe("phase-specific tool packing (design only)", () => {
	it("UNDERSTAND is much smaller than the full 35-tool surface", () => {
		const u = estimatePhaseSchemaChars("understand");
		expect(u.toolCount).toBe(5);
		expect(u.estSchemaChars).toBeLessThan(OPENSCREEN_TOOL_NAMES.length * 200);
		const cmp = compareQueryGateVsPhasePacking();
		expect(cmp.recommendation).toBe("RECOMMENDED");
		expect(cmp.understandVsFullSavedChars).toBeGreaterThan(10_000);
		expect(cmp.phases.find((p) => p.phase === "apply")?.toolCount).toBe(0);
	});
});

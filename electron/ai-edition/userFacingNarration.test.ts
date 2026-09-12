import { describe, expect, it } from "vitest";
import { userFacingMediaNarrationGuidance } from "./userFacingNarration";

describe("userFacingMediaNarrationGuidance", () => {
	it("requires frontmost-app accuracy and plain readable wording", () => {
		const text = userFacingMediaNarrationGuidance();
		expect(text).toMatch(/FRONTMOST/i);
		expect(text).toMatch(/Cursor/);
		expect(text).toMatch(/ChatGPT/);
		expect(text).toMatch(/Do NOT show technical internals/i);
		expect(text).toMatch(/across the sampled frames/i);
		expect(text).toMatch(/localhost preview/i);
	});
});

import { describe, expect, it } from "vitest";
import { OVERAGENT_EDIT_COOKBOOK, overagentCookbookSection } from "./overagentEditCookbook";

describe("overagentEditCookbook", () => {
	it("covers structure, transitions, pacing, and optional graphics helpers", () => {
		const text = overagentCookbookSection();
		expect(text).toBe(OVERAGENT_EDIT_COOKBOOK);
		expect(text).toMatch(/splitClip/);
		expect(text).toMatch(/setClipIncomingTransition/);
		expect(text).toMatch(/tightenPacing/);
		expect(text).toMatch(/importMedia/);
		expect(text).toMatch(/addGraphic/);
		expect(text).toMatch(/insertStartThumbnail/);
		expect(text).toMatch(/listTransitions/);
		expect(text).toMatch(/OPENING CLIP|opening CLIP|own clip/i);
		expect(text).toMatch(/TOOL CATALOG|optional primitives|autonomous/i);
		expect(text).toMatch(/Do NOT auto-map keywords|fixed helper|OPTIONAL shortcuts/i);
		expect(text).toMatch(/addBeatGraphics/);
		expect(text).toMatch(/createMotionGraphicPreview/);
		expect(text).not.toMatch(/MUST call createMotionGraphicPreview/i);
		expect(text).toMatch(/addPrivacyCover/);
		expect(text).toMatch(/setCaptionSettings|setEditorSettings/i);
	});
});

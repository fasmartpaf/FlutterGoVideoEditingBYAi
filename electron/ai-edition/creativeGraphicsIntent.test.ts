import { describe, expect, it } from "vitest";
import { isCasualChatTurn, wantsCreativeMotionGraphics } from "./creativeGraphicsIntent";

describe("wantsCreativeMotionGraphics", () => {
	it("matches motion graphics asks including typos", () => {
		expect(
			wantsCreativeMotionGraphics(
				"kinldy edit thie video and add motins gprahics into it properly to make it more better",
			),
		).toBe(true);
		expect(wantsCreativeMotionGraphics("Add motion graphics and a title CTA")).toBe(true);
		expect(wantsCreativeMotionGraphics("create a lower third for the demo")).toBe(true);
		expect(wantsCreativeMotionGraphics("add a speaking character that follows the cursor")).toBe(
			true,
		);
		expect(wantsCreativeMotionGraphics("finger highlight on clicks")).toBe(true);
	});

	it("does not match plain polish / zoom", () => {
		expect(wantsCreativeMotionGraphics("make this video better")).toBe(false);
		expect(wantsCreativeMotionGraphics("zoom in on the click")).toBe(false);
		expect(wantsCreativeMotionGraphics("remove pauses")).toBe(false);
	});
});

describe("isCasualChatTurn", () => {
	it("matches greetings", () => {
		expect(isCasualChatTurn("hi")).toBe(true);
		expect(isCasualChatTurn("Hello!")).toBe(true);
		expect(isCasualChatTurn("edit this video")).toBe(false);
	});
});

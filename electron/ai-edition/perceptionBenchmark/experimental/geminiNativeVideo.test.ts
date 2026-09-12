import { describe, expect, it } from "vitest";
import { scoreEvent } from "../score";
import { CASE2_LOCKED_GROUND_TRUTH } from "./case02LockedGroundTruth";
import { observationsFromNativeVideoProse } from "./runGeminiNativeVideo";

describe("GEMINI_NATIVE_VIDEO observation parsing", () => {
	it("does not upgrade generic recording-controls text to restart tooltip", () => {
		const text = "Around 18 seconds, recording controls appear at the bottom of the screen.";
		const obs = observationsFromNativeVideoProse(text);
		const score = scoreEvent(
			CASE2_LOCKED_GROUND_TRUTH.events.find((e) => e.id === "restart_tooltip")!,
			obs,
		);
		expect(score.verdict).toBe("MISSED");
	});

	it("detects explicit restart recording tooltip language", () => {
		const text = "Near 00:18 a Restart recording tooltip appears above the recording HUD.";
		const obs = observationsFromNativeVideoProse(text);
		const score = scoreEvent(
			CASE2_LOCKED_GROUND_TRUTH.events.find((e) => e.id === "restart_tooltip")!,
			obs,
		);
		expect(score.verdict).toBe("DETECTED_CORRECTLY");
	});
});

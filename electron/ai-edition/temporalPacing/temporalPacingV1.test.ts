/**
 * Temporal pacing helpers — unit tests.
 */

import { describe, expect, it } from "vitest";
import {
	carveAroundSpeech,
	effectiveSpeechRanges,
	speechOverlapFraction,
	targetPauseForFunction,
	temporalDecisionFromEvidence,
} from "./speechEffective";
import {
	classifyCompositorEvidenceState,
	productionVerificationLabel,
} from "./verificationHonesty";

describe("speechEffective", () => {
	it("punches silencedetect quiet out of inflated STT windows", () => {
		const speech = [{ startSec: 0, endSec: 11 }];
		const silence = [{ startSec: 1.2, endSec: 3.5 }];
		const eff = effectiveSpeechRanges(speech, silence);
		expect(eff).toEqual([
			{ startSec: 0, endSec: 1.2 },
			{ startSec: 3.5, endSec: 11 },
		]);
		expect(speechOverlapFraction({ startSec: 1.2, endSec: 3.5 }, eff)).toBe(0);
	});

	it("carves speed candidates around boundary speech fragments", () => {
		const carved = carveAroundSpeech({
			candidate: { startSec: 10, endSec: 14 },
			speech: [{ startSec: 10, endSec: 10.35 }],
			minSpanSec: 1.8,
			padSec: 0.1,
		});
		expect(carved.length).toBe(1);
		expect(carved[0]!.startSec).toBeCloseTo(10.45, 5);
		expect(carved[0]!.endSec).toBeCloseTo(13.9, 5);
	});

	it("distinguishes SHORTEN vs SPEED vs KEEP", () => {
		expect(
			temporalDecisionFromEvidence({
				contentValues: ["DEAD_AIR"],
				speechValue: "NONE",
				speechOverlapRatio: 0,
				pauseFunction: "DEAD_AIR",
				visualUsefulSlow: false,
				silenceDurationSec: 2.2,
			}),
		).toBe("SHORTEN");
		expect(
			temporalDecisionFromEvidence({
				contentValues: ["LOW_INFORMATION", "NAVIGATION"],
				speechValue: "NONE",
				speechOverlapRatio: 0,
				visualUsefulSlow: true,
			}),
		).toBe("SPEED_UP");
		expect(
			temporalDecisionFromEvidence({
				contentValues: ["USEFUL_EXPLANATION"],
				speechValue: "USEFUL",
				speechOverlapRatio: 0.9,
				visualUsefulSlow: true,
			}),
		).toBe("KEEP");
	});

	it("varies retained pause by function (not fixed 0.55s)", () => {
		const policy = {
			targetPauseInteriorSec: 0.55,
			targetPauseLeadingSec: 0.2,
			targetPauseTrailingSec: 0.4,
		};
		expect(targetPauseForFunction("COMPREHENSION_PAUSE", policy)).toBeGreaterThanOrEqual(0.55);
		expect(targetPauseForFunction("HESITATION", policy)).toBeLessThan(0.55);
		expect(targetPauseForFunction("DEAD_AIR", policy)).toBeLessThan(0.4);
	});
});

describe("verificationHonesty", () => {
	it("never labels injected frames as native production", () => {
		const injected = classifyCompositorEvidenceState({
			frameProvider: "injected_test",
			authoritativeSatisfied: true,
			allowInjectedAsAuthoritative: true,
		});
		expect(injected).toBe("INJECTED_TEST_VERIFIED");
		expect(productionVerificationLabel(injected)).not.toMatch(/PRODUCTION_COMPOSITOR/);
		expect(productionVerificationLabel(injected)).toContain("not production");

		const native = classifyCompositorEvidenceState({
			frameProvider: "native_hardware",
			authoritativeSatisfied: true,
			productionCompositorAttached: true,
			hardwareBackend: true,
		});
		expect(native).toBe("NATIVE_PRODUCTION_VERIFIED");
	});
});

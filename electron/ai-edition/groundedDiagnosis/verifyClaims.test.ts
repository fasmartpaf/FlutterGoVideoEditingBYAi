import { describe, expect, it } from "vitest";
import type { VisualSemanticGrounding } from "../visualEvidence/semantic";
import {
	buildDiagnosisLedger,
	findUngroundedActiveSurfaceClaims,
	sanitizeUngroundedActiveClaims,
	verifyAndSanitizeUserFacingNarration,
} from "./verifyClaims";

const grounding: VisualSemanticGrounding = {
	observations: [
		{
			sourceTimeSec: 0,
			frameSummary: "Cursor frontmost; Upwork tab in Chrome behind",
			frontmostSurface: { name: "Cursor", kind: "app" },
			backgroundSurfaces: [
				{ name: "Upwork", role: "tab" },
				{ name: "Chrome", role: "behind" },
			],
			regions: [],
			observed: ["Cursor is the frontmost window"],
		},
		{
			sourceTimeSec: 9,
			frameSummary: "Strathclyde uploads with timeout dialog",
			frontmostSurface: { name: "Strathclyde", kind: "site" },
			backgroundSurfaces: [{ name: "Upwork", role: "tab" }],
			regions: [],
		},
	],
	transitions: [],
};

describe("groundedDiagnosis claim verifier", () => {
	it("builds frontmost vs background ledger", () => {
		const ledger = buildDiagnosisLedger({ grounding });
		expect(ledger.frontmostNames).toContain("cursor");
		expect(ledger.frontmostNames).toContain("strathclyde");
		expect(ledger.backgroundNames).toContain("upwork");
	});

	it("flags invented Upwork job-listing browsing when only a tab is visible", () => {
		const text = [
			"You're working in Cursor at the start.",
			"The screen transitions to the Upwork website, where job listings are visible. You navigate the site, likely to explore job opportunities.",
			"Chrome then shows the Strathclyde uploads page.",
		].join(" ");
		const ledger = buildDiagnosisLedger({ grounding });
		const violations = findUngroundedActiveSurfaceClaims(text, ledger);
		expect(violations.some((v) => v.app === "upwork")).toBe(true);
		const sanitized = sanitizeUngroundedActiveClaims(text, violations);
		expect(sanitized.toLowerCase()).not.toMatch(/job listings/);
		expect(sanitized.toLowerCase()).toMatch(/upwork tab is visible/);
		expect(sanitized.toLowerCase()).toMatch(/cursor/);
		expect(sanitized.toLowerCase()).toMatch(/strathclyde/);
	});

	it("allows real frontmost App Store Connect activity", () => {
		const g2: VisualSemanticGrounding = {
			observations: [
				{
					sourceTimeSec: 15,
					frameSummary: "App Store Connect TestFlight",
					frontmostSurface: { name: "App Store Connect", kind: "site" },
					regions: [],
				},
			],
			transitions: [],
		};
		const text =
			"Later, Chrome displays App Store Connect, where you're managing TestFlight testers.";
		const result = verifyAndSanitizeUserFacingNarration({
			userFacingText: text,
			grounding: g2,
		});
		expect(result.violations).toEqual([]);
		expect(result.text).toBe(text);
	});
});

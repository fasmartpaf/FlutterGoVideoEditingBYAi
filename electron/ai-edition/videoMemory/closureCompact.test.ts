/**
 * Tool gate + compact system unit tests — Closure V1.
 */

import { describe, expect, it } from "vitest";
import { buildCompactSystemPrompt, SYSTEM_PROMPT_SECTION_AUDIT } from "./compactSystem";
import { isCompactPacking, resolveContextPackingMode } from "./productionPath";
import { auditToolRelevance, filterToolsByGate, toolGateForQuery } from "./toolGate";

describe("VIDEO_MEMORY_RETRIEVAL_COMPACT foundations", () => {
	it("resolves COMPACT packing mode", () => {
		expect(resolveContextPackingMode("VIDEO_MEMORY_RETRIEVAL_COMPACT")).toBe(
			"VIDEO_MEMORY_RETRIEVAL_COMPACT",
		);
		expect(isCompactPacking("VIDEO_MEMORY_RETRIEVAL_COMPACT")).toBe(true);
	});

	it("speech query gates out mutation tools", () => {
		const g = toolGateForQuery("speech");
		expect(g.allowedNames.has("getTranscript")).toBe(true);
		expect(g.allowedNames.has("addZoom")).toBe(false);
		expect(g.irrelevant).toContain("addTrim");
	});

	it("editorial keeps mutate schemas but drops capture tools", () => {
		const g = auditToolRelevance("editorial");
		expect(g.allowedNames.has("addTrim")).toBe(true);
		expect(g.allowedNames.has("recordScreen")).toBe(false);
	});

	it("filterToolsByGate preserves order subset", () => {
		const tools = [{ name: "getCurrentDocument" }, { name: "addZoom" }, { name: "getTranscript" }];
		const filtered = filterToolsByGate(tools, toolGateForQuery("speech"));
		expect(filtered.map((t) => t.name)).toEqual(["getCurrentDocument", "getTranscript"]);
	});

	it("compact system keeps epistemic invariants and drops recipe essay", () => {
		const p = buildCompactSystemPrompt({
			editsAllowed: true,
			queryClass: "speech",
			openProjectSnapshot: "{snapshot}",
		});
		expect(p).toMatch(/Restart recording/);
		expect(p).toMatch(/Upwork/);
		expect(p).toMatch(/Settings/);
		expect(p).not.toMatch(/Opening hook/);
		expect(SYSTEM_PROMPT_SECTION_AUDIT.some((s) => s.kind === "legacy_redundant")).toBe(true);
	});
});

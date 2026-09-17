/**
 * Registry binding: each Chat skill's directEntry must route to its frozen executor intent.
 * No substring fallback to a different family.
 */

import { describe, expect, it } from "vitest";
import { buildEditingSkillRegistryV1 } from "../autonomousProfessionalEditor/skillRegistry";
import { parseLocalEditorialRequest } from "./parse";
import type { SemanticSkillRequestV1 } from "./semanticContract";
import { applySemanticToLocalRequest } from "./semanticContract";
import {
	localIntentFromRegistrySkill,
	resolveExecutableRegistrySkill,
	SEMANTIC_TO_REGISTRY,
	validateAgainstSkillRegistry,
} from "./skillRegistryGate";

const FAMILIES: Array<{
	skillId: keyof typeof SEMANTIC_TO_REGISTRY;
	expectIntent: string;
	okOp: "add" | "adjust" | "remove" | "list";
	badOp: "add" | "adjust" | "remove" | "list";
}> = [
	{ skillId: "zoom", expectIntent: "ADD_ZOOM", okOp: "add", badOp: "list" },
	{ skillId: "trim", expectIntent: "REMOVE_RANGE", okOp: "add", badOp: "list" },
	{ skillId: "speed", expectIntent: "SPEED_UP", okOp: "add", badOp: "list" },
	{ skillId: "captions", expectIntent: "ENABLE_CAPTIONS", okOp: "add", badOp: "list" },
	{ skillId: "title", expectIntent: "TITLE", okOp: "add", badOp: "list" },
	{ skillId: "callout", expectIntent: "CALLOUT", okOp: "add", badOp: "list" },
	{ skillId: "transitions", expectIntent: "TRANSITION", okOp: "add", badOp: "list" },
];

function semanticReq(
	partial: Partial<SemanticSkillRequestV1> &
		Pick<SemanticSkillRequestV1, "skills" | "operation" | "goal">,
): SemanticSkillRequestV1 {
	return {
		version: 1,
		rawText: "x",
		parseStatus: "REASONED",
		authority: "USER_EXPLICIT",
		target: {
			type: "EXPLICIT_RANGE",
			range: { startSec: 1, endSec: 3 },
			semanticEvent: null,
			editRef: null,
		},
		modification: null,
		confidence: "HIGH",
		unresolvedReason: null,
		providerId: "t",
		providerCalls: 1,
		cloudCalls: 0,
		latencyMs: 1,
		...partial,
	};
}

describe("skillRegistry binding per Chat skill", () => {
	it("every advertised Chat skill has chatAvailable:true and directEntry", () => {
		for (const f of FAMILIES) {
			const reg = resolveExecutableRegistrySkill(f.skillId);
			expect(reg, f.skillId).toBeTruthy();
			expect(reg!.chatAvailable).toBe(true);
			expect(reg!.directEntry).toBeTruthy();
			const intent = localIntentFromRegistrySkill(reg!, f.skillId, "add");
			expect(intent).toBe(f.expectIntent);
		}
	});

	it("applySemanticToLocalRequest binds registry intent (no cross-family fallback)", () => {
		const base = parseLocalEditorialRequest("x");
		for (const f of FAMILIES) {
			const mapped = applySemanticToLocalRequest(
				base,
				semanticReq({
					skills: [f.skillId],
					operation: "add",
					goal: "EXPLICIT_EDIT",
				}),
			);
			expect(mapped.intent, f.skillId).toBe(f.expectIntent);
		}
	});

	it("rejects unsupported operation per family; accepts supported op", () => {
		for (const f of FAMILIES) {
			const ok = validateAgainstSkillRegistry(
				semanticReq({
					skills: [f.skillId],
					operation: f.okOp,
					goal: "EXPLICIT_EDIT",
				}),
			);
			expect(ok.ok, `${f.skillId} okOp`).toBe(true);
		}
		const zoomRejectsList = validateAgainstSkillRegistry(
			semanticReq({ skills: ["zoom"], operation: "list", goal: "EXPLICIT_EDIT" }),
		);
		expect(zoomRejectsList.ok).toBe(false);
		const speedRejectsList = validateAgainstSkillRegistry(
			semanticReq({ skills: ["speed"], operation: "list", goal: "EXPLICIT_EDIT" }),
		);
		expect(speedRejectsList.ok).toBe(false);
		const transitionOkList = validateAgainstSkillRegistry(
			semanticReq({ skills: ["transitions"], operation: "list", goal: "EXPLICIT_EDIT" }),
		);
		expect(transitionOkList.ok).toBe(true);
		const zoomBadMod = validateAgainstSkillRegistry(
			semanticReq({
				skills: ["zoom"],
				operation: "adjust",
				goal: "MODIFY_PENDING",
				modification: { rate: "faster" },
				target: {
					type: "PENDING_PROPOSAL",
					range: null,
					semanticEvent: null,
					editRef: "pending",
				},
			}),
		);
		expect(zoomBadMod.ok).toBe(false);
	});

	it("crop/loudness without chatAvailable:true are not executable Chat skills", () => {
		expect(resolveExecutableRegistrySkill("crop")).toBeNull();
		expect(resolveExecutableRegistrySkill("loudness")).toBeNull();
		const reg = buildEditingSkillRegistryV1();
		expect(reg.find((s) => s.skill === "CROP_REFRAME")?.chatAvailable).not.toBe(true);
	});
});

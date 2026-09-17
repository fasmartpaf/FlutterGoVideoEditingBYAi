/**
 * Single Mutation Authority V1 — unit tests.
 */

import { describe, expect, it } from "vitest";
import { createEmptyDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { classifyMediaContextNeeds } from "../mediaContextNeeds/classify";
import { bindFinalResponseToTransactionTruth, resolveMutationAuthority } from "./index";

function docWithClip() {
	const base = createEmptyDocument({
		title: "mut-auth",
		projectId: "proj_mut",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "clip",
				kind: "video",
				originalPath: "/tmp/x.mp4",
				durationSec: 20,
				width: 1920,
				height: 1080,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: 20,
					timelineStartSec: 0,
					timelineEndSec: 20,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
		},
	});
}

describe("resolveMutationAuthority", () => {
	it("editingContext → proposal_only even when editsAllowed", () => {
		const needs = classifyMediaContextNeeds(
			"Make this shorter and more professional, but keep the important explanation.",
		);
		expect(needs.category).toBe("editingContext");
		const a = resolveMutationAuthority({ contextNeeds: needs, editsAllowed: true });
		expect(a.mode).toBe("proposal_only");
		expect(a.agentEditsAllowed).toBe(false);
	});

	it("deterministic trim stays deterministic_edit", () => {
		const needs = classifyMediaContextNeeds("Trim 5.0-7.0 seconds.");
		expect(needs.category).toBe("deterministicEdit");
		const a = resolveMutationAuthority({ contextNeeds: needs, editsAllowed: true });
		expect(a.mode).toBe("deterministic_edit");
		expect(a.agentEditsAllowed).toBe(true);
	});

	it("speech question is read_only", () => {
		const needs = classifyMediaContextNeeds("What did I say near the end?");
		const a = resolveMutationAuthority({ contextNeeds: needs, editsAllowed: true });
		expect(a.mode).toBe("read_only");
		expect(a.agentEditsAllowed).toBe(false);
	});

	it("consented_apply allows mutations", () => {
		const needs = classifyMediaContextNeeds("Make this professional.");
		const a = resolveMutationAuthority({
			contextNeeds: needs,
			editsAllowed: true,
			consentedApply: true,
		});
		expect(a.mode).toBe("consented_apply");
		expect(a.agentEditsAllowed).toBe(true);
	});
});

describe("executeAgentTool mutation authority", () => {
	it("refuses addTrim on proposal_only before document mutation", () => {
		const document = docWithClip();
		const fp0 = fingerprintDocument(document).value;
		const result = executeAgentTool(
			document,
			"addTrim",
			JSON.stringify({ startSec: 1, endSec: 2, reason: "test" }),
			{ editsAllowed: true, mutationMode: "proposal_only" },
		);
		expect(result.ok).toBe(false);
		expect(result.document).toBeUndefined();
		expect(result.resultJson).toMatch(/mutation_authority_proposal_only/);
		expect(fingerprintDocument(document).value).toBe(fp0);
	});

	it("refuses addZoom on read_only", () => {
		const document = docWithClip();
		const result = executeAgentTool(
			document,
			"addZoom",
			JSON.stringify({ startSec: 1, endSec: 2, depth: 3 }),
			{ editsAllowed: true, mutationMode: "read_only" },
		);
		expect(result.ok).toBe(false);
		expect(result.resultJson).toMatch(/mutation_authority_read_only/);
	});

	it("allows addTrim on deterministic_edit when editsAllowed", () => {
		const document = docWithClip();
		const result = executeAgentTool(
			document,
			"addTrim",
			JSON.stringify({ startSec: 5, endSec: 7, reason: "exact" }),
			{ editsAllowed: true, mutationMode: "deterministic_edit" },
		);
		expect(result.ok).toBe(true);
		expect(result.document).toBeTruthy();
	});

	it("allows addTrim on consented_apply", () => {
		const document = docWithClip();
		const result = executeAgentTool(
			document,
			"addTrim",
			JSON.stringify({ startSec: 5, endSec: 7, reason: "approved" }),
			{ editsAllowed: true, mutationMode: "consented_apply" },
		);
		expect(result.ok).toBe(true);
	});
});

describe("bindFinalResponseToTransactionTruth", () => {
	it("rewrites false applied claims on proposal_only", () => {
		const out = bindFinalResponseToTransactionTruth({
			userFacingText:
				"The video has been shortened by trimming some non-essential portions. applied: added 2 trims",
			mode: "proposal_only",
			mutatingToolsExecuted: 0,
			hasConsentableProposal: false,
			hasBlockedOnlyProposal: true,
		});
		expect(out.text).not.toMatch(/has been shortened/i);
		expect(out.text).toMatch(/haven't applied|not changed/i);
		expect(out.claim).toBe("rewritten");
	});

	it("points to review card when consentable", () => {
		const out = bindFinalResponseToTransactionTruth({
			userFacingText: "I found a pause you may want to remove.",
			mode: "proposal_only",
			mutatingToolsExecuted: 0,
			hasConsentableProposal: true,
			hasBlockedOnlyProposal: false,
		});
		expect(out.text).toMatch(/review below|Nothing has been changed yet/i);
		expect(out.claim).toBe("proposal_awaiting_consent");
	});

	it("forceProposalAwaitingConsent rewrites improved/enabling claims when card waits", () => {
		const out = bindFinalResponseToTransactionTruth({
			userFacingText: "I improved the video by balancing the audio, enabling captions.",
			mode: "deterministic_edit",
			mutatingToolsExecuted: 0,
			hasConsentableProposal: true,
			hasBlockedOnlyProposal: false,
			verifiedCommit: true,
			forceProposalAwaitingConsent: true,
		});
		expect(out.claim).toBe("proposal_awaiting_consent");
		expect(out.text).toMatch(/Nothing has been changed yet/i);
		expect(out.text).not.toMatch(/I improved/i);
	});
});

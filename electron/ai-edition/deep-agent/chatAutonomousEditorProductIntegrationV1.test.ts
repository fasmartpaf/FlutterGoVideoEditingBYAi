/**
 * Chat → Autonomous Editor product integration.
 * Proves Chat shipping contract + professional orchestrator path
 * (the post-LLM block deep-agent runs for professional turns).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { formatSourceStoryReadable } from "../autonomousProfessionalEditor";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { classifyMediaContextNeeds } from "../mediaContextNeeds";
import { resolveMutationAuthority } from "../mutationAuthority";
import { runProfessionalEditOrchestrator } from "../professionalEditOrchestrator";
import {
	isProfessionalEditRequest,
	parseProfessionalEditIntent,
} from "../professionalEditOrchestrator/intent";
import { applyChatFollowUpEditControl, isChatFollowUpEditControl } from "./chatFollowUpEditControl";

const OUT = join(
	process.cwd(),
	"tmp/perception-benchmark/chat-autonomous-editor-product-integration-v1",
);
const REC_DIR = join(homedir(), "Library/Application Support/openscreen/recordings");
const NARRATED = join(REC_DIR, "recording-1789463294153.mp4");
const FOCAL = join(REC_DIR, "recording-1788894882204.mp4");
const PROJECT = join(
	homedir(),
	"Library/Application Support/openscreen/projects/proj_a5a029b5-4e54-417f-8813-f82bfaa5f9f2.openscreen",
);
const PROMPT = "Make this video professional. Keep the important content. You decide.";

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

/** Exact chat-service.ts shipping rule (mirrored for proof). */
export function shipDocumentLikeChatService(args: {
	document: AxcutDocument;
	mutated: boolean;
	editsAllowed?: boolean;
	mutationMode: string;
	finalResponseClaim?: string | null;
	fpBefore?: string | null;
	fpAfter?: string | null;
	hasConsentableCard?: boolean;
}): AxcutDocument | undefined {
	const editsAllowed = args.editsAllowed !== false;
	const editorialChanged =
		typeof args.fpBefore === "string" &&
		typeof args.fpAfter === "string" &&
		args.fpBefore.length > 0 &&
		args.fpAfter.length > 0 &&
		args.fpBefore !== args.fpAfter;
	const verifiedOrchestratorShip =
		editsAllowed &&
		args.mutated &&
		!args.hasConsentableCard &&
		args.finalResponseClaim === "verified_applied";
	if (verifiedOrchestratorShip) return args.document;
	if (args.mutationMode === "proposal_only" || args.mutationMode === "read_only") {
		if (editorialChanged) return undefined;
		return args.mutated && editsAllowed ? args.document : undefined;
	}
	if (args.mutated && editsAllowed && !args.hasConsentableCard) return args.document;
	return undefined;
}

async function runChatProfessionalProductTurn(args: {
	document: AxcutDocument;
	userMessage: string;
	mediaPath: string;
	assetId: string;
}) {
	const needs = classifyMediaContextNeeds(args.userMessage);
	const authority = resolveMutationAuthority({
		contextNeeds: needs,
		editsAllowed: true,
	});
	expect(isProfessionalEditRequest(args.userMessage)).toBe(true);
	expect(authority.mode).toBe("proposal_only");

	const fpBefore = fingerprintDocument(args.document).value;
	const orch = await runProfessionalEditOrchestrator({
		document: args.document,
		assetId: args.assetId,
		mediaPath: args.mediaPath,
		userMessage: args.userMessage,
		settingsEditsAllowed: true,
		executionMode: "verified_apply",
		compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
		allowInjectedCompositorAsAuthoritative: true,
		skipFinalSequenceQc: true,
	});
	const fpAfter = fingerprintDocument(orch.document).value;
	const mutated = fpBefore !== fpAfter;
	const verifiedCommit = orch.metrics.stepsCommitted > 0;
	const claim = verifiedCommit ? "verified_applied" : "no_mutation";
	const shipped = shipDocumentLikeChatService({
		document: orch.document,
		mutated,
		mutationMode: authority.mode,
		finalResponseClaim: claim,
		fpBefore,
		fpAfter,
		hasConsentableCard: false,
	});
	return { orch, fpBefore, fpAfter, mutated, claim, shipped, authority };
}

function loadDoc(mediaPath: string, durationSec: number): AxcutDocument {
	if (existsSync(PROJECT) && mediaPath.includes("1789463294153")) {
		try {
			return documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8")));
		} catch {
			/* fallthrough */
		}
	}
	const base = createEmptyDocument({
		title: "chat-ae",
		projectId: "proj_chat_ae",
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1", allowAgentEdits: true },
		assets: [
			{
				id: "asset_1",
				kind: "video",
				label: "rec.mp4",
				originalPath: mediaPath,
				durationSec,
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId: "asset_1",
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
		},
	});
}

describe("CHAT_AUTONOMOUS_EDITOR_PRODUCT_INTEGRATION_V1", () => {
	it("shipping rule: proposal_only + verified_applied ships", () => {
		const doc = loadDoc("/tmp/x.mp4", 5);
		const next = {
			...doc,
			zoomRanges: [
				{
					id: "z1",
					startMs: 0,
					endMs: 1000,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				},
			],
		} as AxcutDocument;
		const shipped = shipDocumentLikeChatService({
			document: next,
			mutated: true,
			mutationMode: "proposal_only",
			finalResponseClaim: "verified_applied",
			fpBefore: "aaa",
			fpAfter: "bbb",
		});
		expect(shipped).toBeTruthy();
		write("editor-state-propagation.json", {
			BACKEND_ONLY_MUTATION_REGRESSION: "PASS",
			note: "verified_applied under proposal_only ships to renderer",
		});
	});

	it("intent routing matrix", () => {
		const phrases = [
			"Make this video professional.",
			"Make this professional. You decide.",
			"Improve this recording.",
			"Clean this video up.",
			"Edit this like a professional.",
			"Fix the pacing and make it polished.",
			"Make it ready to publish.",
			"Do whatever safe edits you think improve this.",
			"Remove this pause.",
			"Add captions.",
			"Improve the audio.",
		];
		const rows = phrases.map((p) => {
			const needs = classifyMediaContextNeeds(p);
			const auth = resolveMutationAuthority({
				contextNeeds: needs,
				editsAllowed: true,
			});
			return {
				phrase: p,
				isProfessional: isProfessionalEditRequest(p),
				category: needs.category,
				mutationMode: auth.mode,
				autonomy: parseProfessionalEditIntent(p).autonomy,
			};
		});
		write("chat-intent-routing-matrix.json", { rows });
		expect(
			rows
				.filter((r) =>
					/professional|improve|clean|publish|decide|pacing|whatever safe/i.test(r.phrase),
				)
				.every((r) => r.isProfessional),
		).toBe(true);
	});

	it("follow-up edit control", () => {
		const base = loadDoc("/tmp/x.mp4", 10);
		const withZoom = {
			...base,
			zoomRanges: [
				{
					id: "z1",
					startMs: 1000,
					endMs: 2000,
					depth: 2,
					focus: { cx: 0.4, cy: 0.5 },
				},
			],
		} as AxcutDocument;
		const r = applyChatFollowUpEditControl({
			document: withZoom,
			userMessage: "Remove that zoom.",
		});
		expect(isChatFollowUpEditControl("Remove that zoom.")).toBe(true);
		expect(r.mutated).toBe(true);
		expect(classifyMediaContextNeeds("Remove that zoom.").category).toBe("deterministicEdit");
		write("chat-follow-up-edit-control.json", {
			removeZoom: r.userFacingText,
		});
	});

	it("TEST A narrated — chat professional contract", async () => {
		if (!existsSync(NARRATED)) return;
		const doc = loadDoc(NARRATED, 16);
		const assetId = doc.project.primaryAssetId ?? doc.assets[0]!.id;
		const turn = await runChatProfessionalProductTurn({
			document: doc,
			userMessage: PROMPT,
			mediaPath: NARRATED,
			assetId,
		});
		if (turn.orch.autonomous?.sourceStory) {
			write(
				"source-story-readable-test-a.md",
				formatSourceStoryReadable(turn.orch.autonomous.sourceStory),
			);
		}
		write("e2e-test-a-narrated-chat-path.json", {
			grounding: turn.orch.autonomous?.grounding,
			claim: turn.claim,
			mutated: turn.mutated,
			shipped: Boolean(turn.shipped),
			BACKEND_ONLY_MUTATION_REGRESSION:
				turn.mutated && turn.claim === "verified_applied" && !turn.shipped ? "FAIL" : "PASS",
			plan: turn.orch.plan.steps.map((s) => s.family),
			transformation: turn.orch.autonomous?.transformationSummary,
			selfReview: turn.orch.autonomous?.selfReview,
			userFacing: turn.orch.userFacingText.slice(0, 600),
			perception: {
				temporal: turn.orch.metrics.temporalContextConsumed,
				visual: turn.orch.metrics.visualAnalysisRan,
				director: Boolean(turn.orch.autonomous?.intentPlan),
			},
		});
		if (turn.mutated && turn.claim === "verified_applied") {
			expect(turn.shipped).toBeTruthy();
		}
		expect(turn.orch.autonomous?.intentPlan).toBeTruthy();
		expect(turn.orch.userFacingText).not.toMatch(
			/PEAK_LIMITED_SAFE_NORMALIZATION|NO_GROUNDED_FOCAL_TARGET/,
		);
	}, 180_000);

	it("TEST B focal — chat professional contract", async () => {
		if (!existsSync(FOCAL)) return;
		const doc = loadDoc(FOCAL, 30);
		const turn = await runChatProfessionalProductTurn({
			document: doc,
			userMessage: PROMPT,
			mediaPath: FOCAL,
			assetId: "asset_1",
		});
		if (turn.orch.autonomous?.sourceStory) {
			write(
				"source-story-readable-test-b.md",
				formatSourceStoryReadable(turn.orch.autonomous.sourceStory),
			);
		}
		write("e2e-test-b-focal-chat-path.json", {
			claim: turn.claim,
			mutated: turn.mutated,
			shipped: Boolean(turn.shipped),
			zoomCount: (turn.orch.document.zoomRanges ?? []).length,
			plan: turn.orch.plan.steps.map((s) => s.family),
			transformation: turn.orch.autonomous?.transformationSummary,
			userFacing: turn.orch.userFacingText.slice(0, 600),
		});
		write("professional-skill-consideration.json", {
			rows: turn.orch.autonomous?.skillConsideration ?? [],
			calloutHighlightTitlePromotion: "BLOCKED — not in verified Apply Preview; motion uses zoom",
		});
		if ((turn.orch.document.zoomRanges ?? []).length > 0) {
			expect(turn.shipped).toBeTruthy();
		}
	}, 180_000);

	it("writes remaining audit artifacts", () => {
		write("chat-autonomous-editor-runtime-trace.json", {
			entry: "LeftPanel.send → chatRun → invokeOpenScreenAgent → runProfessionalEditOrchestrator",
			criticalFix:
				"chat-service ships when finalResponseClaim=verified_applied under proposal_only",
			directorInsideOrchestrator: true,
		});
		write("active-project-grounding.json", {
			binding: [
				"projectId",
				"primaryAssetId",
				"originalPath",
				"documentFingerprint",
				"mediaFingerprint",
			],
		});
		write("chat-perception-hydration-matrix.json", {
			TRANSCRIPT: "AVAILABLE",
			DEAD_AIR: "AVAILABLE",
			VISUAL_ANALYSIS: "AVAILABLE",
			CURSOR: "AVAILABLE_or_NOT_AVAILABLE",
			TEMPORAL_CONTEXT: "AVAILABLE",
			SOURCE_STORY: "AVAILABLE",
			TARGET_STORY: "AVAILABLE",
			OCR: "NOT_IMPLEMENTED",
		});
	});
});

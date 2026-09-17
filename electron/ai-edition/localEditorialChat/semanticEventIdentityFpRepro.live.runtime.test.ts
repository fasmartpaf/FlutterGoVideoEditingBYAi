/**
 * Identity FP gates on recording-1789588079993.
 *
 * Labels (accurate):
 * - unit_injected_brain_chat_path: Vitest + setSemanticBrainForTests + applyLocalEditorialControlWithBrain
 *   NOT desktop UI, NOT real gpt-4o classification.
 * - unit_injected_vision: vision judge injected
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentSchema } from "../../../src/lib/ai-edition/schema";
import { programmeDurationSec, programmePointToSourceSec } from "./directTrim";
import {
	applyLocalEditorialControlWithBrain,
	clearLocalEditorialSessionsForTests,
	getLocalEditorialPendingProposal,
	setSemanticBrainForTests,
} from "./index";
import { identityAnchorsFromCue, verifyRequestedEventIdentity } from "./semanticEventIdentity";
import { resolveSemanticEditEventAsync } from "./semanticEventResolve";

const PROJECT =
	process.env.OPENSCREEN_SB_FP_PROJECT ||
	`${process.env.HOME}/Library/Application Support/openscreen/projects/proj_e50620fc-423c-43b0-aa67-52aa308343a9.openscreen`;

const MEDIA_HINT = "recording-1789588079993.mp4";
const ART = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/fp-repro",
);

const canRun = existsSync(PROJECT);

describe.runIf(canRun)("LIVE_REPRO identity FP on recording-1789588079993", () => {
	it("label=unit_injected_brain_chat_path — negative grounding; not desktop/gpt-4o", async () => {
		mkdirSync(ART, { recursive: true });
		clearLocalEditorialSessionsForTests();
		setSemanticBrainForTests(null);

		const doc = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8")));
		const media =
			doc.assets.find((a) => a.id === doc.project.primaryAssetId)?.originalPath ??
			doc.assets[0]?.originalPath;
		expect(media!).toContain(MEDIA_HINT);

		const cue = "Would it help viewers if the landing page appearance stood out more?";
		const eventCue = "when the landing page appears";
		const anchors = identityAnchorsFromCue(eventCue);
		const progDur = programmeDurationSec(doc);

		const rejectVision = async () => ({
			identified: false as const,
			confidence: "HIGH" as const,
			firstAppearance: false,
			visualUiPresentAfter: false,
			visualUiPresentBefore: false,
			reason: "Not the requested visual UI",
			rawText: "{}",
			providerId: "injected",
			model: "unit",
		});

		const r05 = await verifyRequestedEventIdentity({
			document: doc,
			cue: eventCue,
			programmeAnchorSec: 0.5,
			visualChangeObserved: true,
			ocrRecognize: async (p) =>
				p.includes("before")
					? { text: "whatsapp", available: true }
					: {
							text: "black page look on it",
							available: true,
						},
			extractFrame: async () => true,
			presenceJudge: async () => ({
				present: false,
				confidence: "HIGH",
				reason: "Cursor/WhatsApp — generic “page” OCR is not the landing UI",
				rawText: "{}",
				providerId: "injected",
				model: "unit",
			}),
		});

		const resolved = await resolveSemanticEditEventAsync({
			cue: eventCue,
			document: doc,
			skipVisualAnalysis: false,
			visionJudge: rejectVision,
		});

		setSemanticBrainForTests(async () => ({
			version: 1,
			rawText: cue,
			parseStatus: "REASONED",
			goal: "RECOMMEND",
			authority: "ADVISORY",
			skills: ["zoom"],
			operation: "add",
			target: {
				type: "SEMANTIC_EVENT",
				range: null,
				semanticEvent: eventCue,
				editRef: null,
			},
			modification: null,
			confidence: "MEDIUM",
			unresolvedReason: null,
			providerId: "injected-chat-path",
			providerCalls: 0,
			cloudCalls: 0,
			latencyMs: 0,
		}));

		const chat = await applyLocalEditorialControlWithBrain({
			projectId: doc.project.id,
			document: doc,
			userMessage: cue,
			visionJudge: rejectVision,
		});
		const pending = getLocalEditorialPendingProposal(doc.project.id);

		const payload = {
			label: "unit_injected_brain_chat_path",
			notDesktop: true,
			notSelectedProviderClassify: true,
			media,
			anchors,
			programmeDurationSec: progDur,
			programme0_5_mapsToSource: programmePointToSourceSec(doc, 0.5),
			r05GenericPage: {
				identified: r05.requestedEventIdentified,
				reason: r05.reason,
			},
			resolve: {
				status: resolved.status,
				userFacingReason: resolved.userFacingReason,
				best: resolved.best
					? {
							anchorSec: resolved.best.anchorSec,
							identified: resolved.best.requestedEventIdentified,
						}
					: null,
			},
			chatPath: {
				userFacingText: chat.userFacingText,
				pendingCreated: Boolean(pending),
				mutated: chat.mutated,
			},
		};
		writeFileSync(join(ART, "identity-fp-repro.POST_FIX.json"), JSON.stringify(payload, null, 2));

		expect(anchors).not.toContain("page");
		expect(r05.requestedEventIdentified).toBe(false);
		expect(r05.evidenceRefs).toContain("ocr_evidence:generic_only_onset");
		expect(r05.onsetBoundStatus).toBe("absent_at_candidate");
		expect(resolved.status).not.toBe("FOUND");
		expect(chat.userFacingText).not.toMatch(/onset:\s*page/i);
		expect(pending).toBeNull();
		expect(chat.mutated).toBe(false);

		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	}, 240_000);
});

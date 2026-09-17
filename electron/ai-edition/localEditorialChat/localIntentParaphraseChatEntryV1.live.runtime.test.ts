/**
 * Real Chat entry paraphrase suite — OpenAI disabled.
 * Proves compositional TARGET_DURATION + adversarial intents + non-edit guards.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AxcutDocument, createEmptyDocument } from "../../../src/lib/ai-edition/schema";
import { invokeOpenScreenAgent } from "../deep-agent/service";
import { parseLocalEditorialRequest, shouldHandleLocalEditorialWithoutCloud } from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/autonomous-editor-local-first-chat-v1");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789551162068.mp4",
);

const DURATION_10 = [
	"Make it under 12 seconds.",
	"Can you make it under a 12 sec?",
	"Get this down to about 12 seconds.",
	"I need this around 12s.",
	"Shorten the video to roughly 12 seconds.",
	"Can we get this below twelve seconds?",
	"Make this shorter, around 12 seconds, but keep the important parts.",
	"Cut it down to 12 sec without removing the explanation.",
	"The video is too long. Bring it closer to 12 seconds.",
	"Try to make this about twelve seconds while keeping the useful content.",
];

const ADVERSARIAL = [
	{ msg: "Trim out the dead air stretches please.", intent: "REMOVE_PAUSES" },
	{ msg: "Knock the silences down a bit.", intent: "SHORTEN_PAUSES" },
	{ msg: "Speed through the scrolling bits.", intent: "SPEED_UP" },
	{ msg: "That speed ramp feels rushed; ease it back.", intent: "SLOW_DOWN" },
	{ msg: "Pull off the zoom you just added.", intent: "REMOVE_ZOOM" },
	{ msg: "Dial the zoom back a notch.", intent: "ADJUST_ZOOM" },
	{ msg: "Captions are too big for this frame.", intent: "CAPTION_STYLE" },
	{ msg: "Kill the captions for now.", intent: "CAPTIONS" },
	{ msg: "Drop the title card.", intent: "REMOVE_TITLE" },
	{ msg: "Put a simple title on at the start.", intent: "TITLE" },
	{ msg: "Revert what we just did.", intent: "RESTORE_PREVIOUS" },
	{ msg: "Undo the latest change.", intent: "UNDO_LAST_EDIT" },
	{ msg: "Can you make this better?", intent: "PROFESSIONALIZE" },
	{ msg: "Shave this to ~15 seconds and keep the demo click.", intent: "TARGET_DURATION" },
	{ msg: "Aim for something nearer 10 seconds.", intent: "TARGET_DURATION" },
	{ msg: "Take the last zoom off the timeline.", intent: "REMOVE_ZOOM" },
	{ msg: "Turn captions down in size.", intent: "CAPTION_STYLE" },
	{ msg: "Please shorten those awkward pauses.", intent: "SHORTEN_PAUSES" },
	{ msg: "The waiting sections drag — make them snappier.", intent: "SPEED_UP" },
	{ msg: "Compress runtime toward 20s without losing the talk track.", intent: "TARGET_DURATION" },
	{ msg: "Go back to how it was before that last batch.", intent: "RESTORE_PREVIOUS" },
	{ msg: "Polish this like it's going out today.", intent: "PROFESSIONALIZE" },
];

const NON_EDIT = [
	"What do you think about this video?",
	"Why did you remove that zoom?",
	"Don't remove the zoom.",
	"How does OpenScreen export work?",
	"Is there a webcam in the frame?",
	"Summarize what I said near the end.",
];

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function doc(): AxcutDocument {
	const base = createEmptyDocument({
		projectId: "proj_intent_robust_v1",
		title: "Intent robustness",
	});
	const assetId = "asset_recording-1789551162068";
	const durationSec = 22;
	return {
		...base,
		project: { ...base.project, primaryAssetId: assetId, allowAgentEdits: true },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: "recording-1789551162068",
				originalPath: REC,
				durationSec,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_1",
					assetId,
					sourceStartSec: 0,
					sourceEndSec: durationSec,
					timelineStartSec: 0,
					timelineEndSec: durationSec,
					origin: "system",
					reason: "primary",
					wordRefs: [],
				},
			],
			trimRanges: [],
			speedRanges: [],
		},
		zoomRanges: [
			{
				id: "z_seed",
				startMs: 2000,
				endMs: 4000,
				mode: "cursor",
				depth: 2,
			} as never,
		],
	};
}

async function chatTurn(prompt: string, document: AxcutDocument) {
	return invokeOpenScreenAgent({
		document,
		model: {
			provider: "openai",
			model: "gpt-4o-DISABLED",
			apiKey: undefined,
			baseUrl: "http://127.0.0.1:9",
		},
		history: [],
		userMessage: prompt,
		sink: {
			text: () => {},
			thinking: () => {},
			toolStart: () => {},
			toolEnd: () => {},
			error: () => {},
		},
		editsAllowed: true,
	} as never);
}

describe("LOCAL_INTENT_PARAPHRASE_CHAT_ENTRY_V1", () => {
	it("duration + adversarial + non-edit through Chat entry (OpenAI off)", async () => {
		expect(existsSync(REC)).toBe(true);

		const durationRows = DURATION_10.map((prompt) => {
			const parsed = parseLocalEditorialRequest(prompt);
			return {
				prompt,
				parsedIntent: parsed.intent,
				parsedParameters: {
					durationTargetMaxSec: parsed.durationTargetMaxSec,
					preserve: parsed.preserve,
					executionKind: parsed.executionKind,
				},
				confidence: parsed.confidence,
				localRoute: shouldHandleLocalEditorialWithoutCloud(prompt),
				cloudCallsExpected: 0,
			};
		});
		for (const row of durationRows) {
			expect(row.parsedIntent).toBe("TARGET_DURATION");
			expect(row.parsedParameters.durationTargetMaxSec).toBe(12);
			expect(row.localRoute).toBe(true);
		}

		// Real Chat entry samples (full orch is expensive — prove path on hard paraphrases)
		const chatProofPrompts = [
			"Can you make it under a 12 sec?",
			"Get this down to about 12 seconds.",
			"Try to make this about twelve seconds while keeping the useful content.",
		];
		const chatProof: unknown[] = [];
		let totalCloud = 0;
		let working = doc();
		for (const prompt of chatProofPrompts) {
			const result = await chatTurn(prompt, working);
			const cloudCalls = result.contextTelemetry?.modelCallCount ?? 0;
			totalCloud += cloudCalls;
			chatProof.push({
				prompt,
				status: result.status,
				cloudCalls,
				mutated: result.mutated,
				providerToast: /temporarily unavailable/i.test(result.userMessage ?? ""),
				receipt: (result.text ?? "").slice(0, 220),
			});
			expect(result.status).toBe("completed");
			expect(cloudCalls).toBe(0);
			expect(/temporarily unavailable/i.test(result.userMessage ?? "")).toBe(false);
			working = result.document;
		}

		// Direct follow-ups via Chat entry
		const directProof = [];
		for (const prompt of [
			"Pull off the zoom you just added.",
			"Don't remove the zoom.",
			"Kill the captions for now.",
		]) {
			const beforeZooms = working.zoomRanges?.length ?? 0;
			const parsed = parseLocalEditorialRequest(prompt);
			const result = await chatTurn(prompt, working);
			const cloudCalls = result.contextTelemetry?.modelCallCount ?? 0;
			totalCloud += cloudCalls;
			directProof.push({
				prompt,
				parsedIntent: parsed.intent,
				confidence: parsed.confidence,
				localRoute: shouldHandleLocalEditorialWithoutCloud(prompt),
				cloudCalls,
				status: result.status,
				mutated: result.mutated,
				operation: parsed.intent,
			});
			expect(cloudCalls).toBe(0);
			if (parsed.intent === "PRESERVE_RANGE") {
				expect(result.mutated).toBe(false);
				expect(result.document.zoomRanges?.length ?? 0).toBe(beforeZooms);
			}
			working = result.document;
		}

		let advHits = 0;
		const advRows = ADVERSARIAL.map((c) => {
			const parsed = parseLocalEditorialRequest(c.msg);
			const hit =
				parsed.intent === c.intent ||
				((c.intent === "SHORTEN_PAUSES" || c.intent === "REMOVE_PAUSES") &&
					(parsed.intent === "SHORTEN_PAUSES" || parsed.intent === "REMOVE_PAUSES")) ||
				(c.intent === "RESTORE_PREVIOUS" && parsed.intent === "UNDO_LAST_EDIT");
			if (hit) advHits++;
			return {
				prompt: c.msg,
				expected: c.intent,
				parsedIntent: parsed.intent,
				parsedParameters: {
					durationTargetMaxSec: parsed.durationTargetMaxSec,
					preserve: parsed.preserve,
					relative: parsed.relativeAdjustment,
					reference: parsed.referencedPreviousEdit,
				},
				confidence: parsed.confidence,
				localRoute: shouldHandleLocalEditorialWithoutCloud(c.msg),
				hit,
			};
		});
		const recall = advHits / ADVERSARIAL.length;

		const nonEditRows = NON_EDIT.map((prompt) => {
			const parsed = parseLocalEditorialRequest(prompt);
			const localRoute = shouldHandleLocalEditorialWithoutCloud(prompt);
			const wouldMutate =
				parsed.executionKind === "direct_document" ||
				parsed.executionKind === "professional_orchestrator";
			return {
				prompt,
				parsedIntent: parsed.intent,
				speechSafe: parsed.intent === "UNKNOWN" || parsed.intent === "PRESERVE_RANGE",
				localRoute,
				wouldMutate,
			};
		});
		const falseLocal = nonEditRows.filter((r) => r.wouldMutate).length;

		const metrics = {
			SUPPORTED_LOCAL_INTENT_PARAPHRASE_RECALL: Number(
				(
					(durationRows.filter((r) => r.parsedIntent === "TARGET_DURATION").length + advHits) /
					(DURATION_10.length + ADVERSARIAL.length)
				).toFixed(4),
			),
			DURATION_PARAPHRASE_RECALL:
				durationRows.filter((r) => r.parsedIntent === "TARGET_DURATION").length /
				DURATION_10.length,
			ADVERSARIAL_RECALL: Number(recall.toFixed(4)),
			FALSE_LOCAL_INTENT_RATE: falseLocal / NON_EDIT.length,
			TOTAL_CLOUD_CALLS_FOR_SUPPORTED_LOCAL_TESTS: totalCloud,
			TARGET_DURATION_LOCAL: durationRows.every((r) => r.localRoute) ? "PASS" : "FAIL",
			LOCAL_FIRST_CHAT_ROUTER: totalCloud === 0 && falseLocal === 0 ? "PASS" : "FAIL",
		};

		write("intent-paraphrase-suite.json", {
			durationRows,
			chatProof,
			directProof,
			advRows,
			nonEditRows,
			metrics,
		});
		write("intent-robustness-metrics.json", metrics);

		expect(metrics.DURATION_PARAPHRASE_RECALL).toBe(1);
		expect(metrics.ADVERSARIAL_RECALL).toBeGreaterThanOrEqual(0.95);
		expect(metrics.SUPPORTED_LOCAL_INTENT_PARAPHRASE_RECALL).toBeGreaterThanOrEqual(0.95);
		expect(metrics.FALSE_LOCAL_INTENT_RATE).toBe(0);
		expect(metrics.TOTAL_CLOUD_CALLS_FOR_SUPPORTED_LOCAL_TESTS).toBe(0);
		expect(metrics.TARGET_DURATION_LOCAL).toBe("PASS");
		expect(metrics.LOCAL_FIRST_CHAT_ROUTER).toBe("PASS");
	}, 600_000);
});

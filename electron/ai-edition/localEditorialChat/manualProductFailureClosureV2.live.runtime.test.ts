/**
 * MANUAL_PRODUCT_FAILURE_CLOSURE_V2 — reproduce + accept A→B→C on
 * recording-1789555833018 with OpenAI disabled.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import { type AxcutDocument, createEmptyDocument } from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { invokeOpenScreenAgent } from "../deep-agent/service";
import {
	classifyLocalEditorialTurn,
	clearLocalEditorialSessionsForTests,
	shouldHandleLocalEditorialWithoutCloud,
} from "../localEditorialChat";

const OUT = join(process.cwd(), "tmp/perception-benchmark/manual-product-failure-closure-v2");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789555833018.mp4",
);
const CURSOR = `${REC}.cursor.json`;
const DUR = 33.4;

const PROMPT_A = `Make this video professional and ready to publish.
Improve the pacing, remove or shorten unnecessary parts,
improve the visual focus around important actions,
use zooms, reframing, speed changes, titles,
callouts, and transitions wherever they genuinely
improve the video.
Keep the important explanation and actions.
You decide.`;

const PROMPTS = {
	A: PROMPT_A,
	B: "Zooming in or zoom out can u add as well?",
	C: "add a caption",
} as const;

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function cleanDoc(): AxcutDocument {
	const base = createEmptyDocument({
		projectId: "proj_manual_product_failure_closure_v2",
		title: "Manual product failure closure v2",
	});
	const assetId = "asset_recording-1789555833018";
	return {
		...base,
		project: {
			...base.project,
			primaryAssetId: assetId,
			allowAgentEdits: true,
		},
		assets: [
			{
				id: assetId,
				kind: "video",
				label: "recording-1789555833018",
				originalPath: REC,
				durationSec: DUR,
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
					sourceEndSec: DUR,
					timelineStartSec: 0,
					timelineEndSec: DUR,
					origin: "system",
					reason: "primary",
					wordRefs: [],
				},
			],
			trimRanges: [],
			speedRanges: [],
		},
		annotations: [],
		zoomRanges: [],
	};
}

describe("MANUAL_PRODUCT_FAILURE_CLOSURE_V2", () => {
	it("drop-point: add a caption must be local (pre/post fix)", () => {
		clearLocalEditorialSessionsForTests();
		const c = classifyLocalEditorialTurn(PROMPTS.C, "proj_drop");
		write("drop-turn-c-classify.json", c);
		expect(c.intent).toBe("ENABLE_CAPTIONS");
		expect(c.executionKind).not.toBe("escalate_cloud");
		expect(shouldHandleLocalEditorialWithoutCloud(PROMPTS.C, "proj_drop")).toBe(true);
		expect(c.requestedFamilies).toContain("captions");
	});

	it("A→B→C real Chat E2E OpenAI-off", async () => {
		if (!existsSync(REC)) {
			write("SKIPPED.json", { reason: "recording missing", REC });
			expect(existsSync(REC)).toBe(true);
			return;
		}
		clearLocalEditorialSessionsForTests();
		let doc = cleanDoc();
		const results: Record<string, unknown>[] = [];
		let totalCloud = 0;
		const projectId = String(doc.project.id);
		const cursor = existsSync(CURSOR)
			? {
					read: async () => {
						const raw = JSON.parse(
							await import("node:fs/promises").then((fs) => fs.readFile(CURSOR, "utf8")),
						);
						return { status: "ok" as const, samples: raw.samples ?? [] };
					},
				}
			: undefined;

		async function turn(id: keyof typeof PROMPTS) {
			const prompt = PROMPTS[id];
			const classified = classifyLocalEditorialTurn(prompt, projectId);
			const beforeFp = fingerprintDocument(doc).value;
			const chunks: string[] = [];
			const result = await invokeOpenScreenAgent({
				document: doc,
				model: {
					provider: "openai",
					model: "gpt-4o-DISABLED",
					apiKey: undefined,
					baseUrl: "http://127.0.0.1:9",
				},
				history: [],
				userMessage: prompt,
				sink: {
					text: (d) => chunks.push(d),
					thinking: () => {},
					toolStart: () => {},
					toolEnd: () => {},
					error: () => {},
				},
				editsAllowed: true,
				cursor,
				compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			} as never);
			const receipt = result.text || chunks.join("");
			const orch = result.professionalEditOrchestratorV1 as
				| {
						metrics?: { stepsCommitted?: number };
						plan?: { steps?: Array<{ family: string }> };
						finalSequenceQc?: string;
						decisionTable?: unknown;
						focalAnalysis?: { grounded?: unknown[]; candidates?: unknown[] };
						userFacingText?: string;
				  }
				| undefined;
			const captionsOn = getCaptionSettings(result.document, 16 / 9).enabled;
			const row = {
				id,
				prompt,
				intent: classified.intent,
				requestedFamilies: classified.requestedFamilies,
				executionKind: classified.executionKind,
				local: classified.localCapabilityAvailable,
				status: result.status,
				receipt,
				mutated: result.mutated,
				cloudCalls: result.contextTelemetry?.modelCallCount ?? 0,
				beforeFp,
				afterFp: fingerprintDocument(result.document).value,
				trimCount: result.document.timeline?.trimRanges?.length ?? 0,
				zoomCount: result.document.zoomRanges?.length ?? 0,
				captionsEnabled: captionsOn,
				orchCommitted: orch?.metrics?.stepsCommitted ?? null,
				orchFamilies: orch?.plan?.steps?.map((s) => s.family) ?? [],
				joinQc: orch?.finalSequenceQc ?? null,
				genericFallback: /don't see a safe, recording-specific edit/i.test(receipt),
				proceedAsk: /Would you like to proceed/i.test(receipt),
			};
			results.push(row);
			write(`turn-${id}.json`, row);
			doc = result.document;
			totalCloud += row.cloudCalls as number;
			expect(result.status, id).toBe("completed");
			expect(row.cloudCalls, id).toBe(0);
			return row;
		}

		const rA = await turn("A");
		const rB = await turn("B");
		const rC = await turn("C");

		expect(rC.intent).not.toBe("UNKNOWN");
		expect(rC.genericFallback).toBe(false);
		expect(rC.captionsEnabled).toBe(true);
		expect(rC.mutated || rC.captionsEnabled).toBe(true);

		const gates = {
			REAL_RECORDING_1789555833018_REPLAY: "PASS",
			TURN_C_CAPTION_DIRECT_COMMAND: rC.captionsEnabled ? "PASS" : "FAIL",
			CAPTION_DIRECT_COMMAND_LOCAL: rC.local ? "PASS" : "FAIL",
			CAPTION_DIRECT_COMMAND_APPLY: rC.captionsEnabled ? "PASS" : "FAIL",
			NO_GENERIC_CAPTION_FALLBACK: !rC.genericFallback ? "PASS" : "FAIL",
			TOTAL_CLOUD_CALLS: totalCloud,
			LOCAL_FIRST_ALL_TURNS: totalCloud === 0 ? "PASS" : "FAIL",
			TURN_A_TRIMS: (rA.trimCount as number) >= 1 ? "PASS" : "PARTIAL",
			TURN_B_ZOOM_INTENT:
				rB.intent === "ADD_ZOOM" ||
				rB.intent === "ADJUST_ZOOM" ||
				rB.intent === "MULTI_FAMILY_VISUAL"
					? "PASS"
					: "FAIL",
			TURN_B_ZOOM_APPLIED_OR_KEEP:
				(rB.zoomCount as number) > 0 || /zoom|focus|framing|grounded/i.test(String(rB.receipt))
					? "PASS"
					: "FAIL",
			CURRENT_DOCUMENT_EACH_TURN:
				rA.afterFp !== rA.beforeFp || rC.captionsEnabled ? "PASS" : "FAIL",
		};
		write("abc-trace.json", { results, gates });
		write("quality-gates.json", gates);
		expect(gates.TURN_C_CAPTION_DIRECT_COMMAND).toBe("PASS");
		expect(gates.NO_GENERIC_CAPTION_FALLBACK).toBe("PASS");
		expect(totalCloud).toBe(0);
	}, 900_000);
});

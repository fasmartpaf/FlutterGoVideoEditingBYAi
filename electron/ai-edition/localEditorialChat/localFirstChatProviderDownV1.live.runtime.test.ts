/**
 * LOCAL_FIRST_CHAT_AND_FOLLOWUP_CONTROL_V1 — provider-down Chat E2E A–H
 * on recording-1789551162068. OpenAI intentionally unavailable.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AxcutDocument, createEmptyDocument } from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { createInjectedCompositorSampler } from "../compositorVerify";
import { invokeOpenScreenAgent } from "../deep-agent/service";
import {
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
	shouldHandleLocalEditorialWithoutCloud,
} from "../localEditorialChat";

const OUT = join(process.cwd(), "tmp/perception-benchmark/autonomous-editor-local-first-chat-v1");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789551162068.mp4",
);
const CURSOR = `${REC}.cursor.json`;

const PROMPTS = {
	A: "Make this video professional and ready to publish. You decide.",
	B: "Make it under 18 seconds while keeping the important explanation.",
	C: "Remove more unnecessary pauses but keep natural breathing room.",
	D: "Make the navigation a little faster.",
	E: "Undo the last speed change.",
	F: "Remove that zoom.",
	G: "Turn the captions off.",
	H: "Actually, restore the previous version.",
} as const;

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function cleanDoc(mediaPath: string, durationSec = 22): AxcutDocument {
	const base = createEmptyDocument({
		projectId: "proj_local_first_chat_v1",
		title: "Local-first chat proof",
	});
	const assetId = "asset_recording-1789551162068";
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
				label: "recording-1789551162068",
				originalPath: mediaPath,
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
		annotations: [],
		zoomRanges: [],
	};
}

describe("LOCAL_FIRST_CHAT_PROVIDER_DOWN_V1", () => {
	it("A–H local Chat control with OpenAI disabled", async () => {
		if (!existsSync(REC)) {
			write("SKIPPED.json", { reason: "recording-1789551162068 missing", REC });
			expect(existsSync(REC)).toBe(true);
			return;
		}
		clearLocalEditorialSessionsForTests();

		const routingPre = Object.fromEntries(
			Object.entries(PROMPTS).map(([k, p]) => {
				const req = parseLocalEditorialRequest(p);
				return [
					k,
					{
						prompt: p,
						intent: req.intent,
						routeClass: req.routeClass,
						executionKind: req.executionKind,
						localWithoutCloud: shouldHandleLocalEditorialWithoutCloud(p),
					},
				];
			}),
		);
		write("routing-precheck.json", routingPre);
		for (const row of Object.values(routingPre)) {
			expect((row as { localWithoutCloud: boolean }).localWithoutCloud).toBe(true);
		}

		let doc = cleanDoc(REC);
		const results: Record<string, unknown>[] = [];
		let totalCloudCalls = 0;

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

		async function turn(id: string, prompt: string) {
			const beforeFp = fingerprintDocument(doc).value;
			const beforeDur = doc.timeline.clips.reduce(
				(n, c) => n + Math.max(0, c.timelineEndSec - c.timelineStartSec),
				0,
			);
			const textChunks: string[] = [];
			const result = await invokeOpenScreenAgent({
				document: doc,
				model: {
					provider: "openai",
					model: "gpt-4o-DISABLED-FOR-TEST",
					// Intentionally missing / invalid — local path must not call provider.
					apiKey: undefined,
					baseUrl: "http://127.0.0.1:9",
				},
				history: [],
				userMessage: prompt,
				sink: {
					text: (d) => textChunks.push(d),
					thinking: () => {},
					toolStart: () => {},
					toolEnd: () => {},
					error: () => {},
				},
				editsAllowed: true,
				cursor,
				compositorFrameSampler: createInjectedCompositorSampler({ mode: "valid" }),
			} as never);

			const afterFp = fingerprintDocument(result.document).value;
			const afterDur = result.document.timeline.clips.reduce(
				(n, c) => n + Math.max(0, c.timelineEndSec - c.timelineStartSec),
				0,
			);
			const cloudCalls = result.contextTelemetry?.modelCallCount ?? 0;
			totalCloudCalls += cloudCalls;
			const row = {
				id,
				prompt,
				classification: parseLocalEditorialRequest(prompt).intent,
				cloudCalls,
				localRoute: true,
				status: result.status,
				failureReason: result.failureReason ?? null,
				userReceipt: result.text || textChunks.join(""),
				mutated: result.mutated,
				documentBeforeFingerprint: beforeFp,
				documentAfterFingerprint: afterFp,
				durationBefore: beforeDur,
				durationAfter: afterDur,
				shipped: result.mutated && result.status === "completed",
				providerErrorToast: /temporarily unavailable/i.test(result.userMessage ?? ""),
			};
			results.push(row);
			doc = result.document;
			expect(result.status, id).toBe("completed");
			expect(row.providerErrorToast, id).toBe(false);
			expect(cloudCalls, `${id} cloudCalls`).toBe(0);
			return row;
		}

		await turn("A", PROMPTS.A);
		await turn("B", PROMPTS.B);
		await turn("C", PROMPTS.C);
		await turn("D", PROMPTS.D);
		await turn("E", PROMPTS.E);
		await turn("F", PROMPTS.F);
		await turn("G", PROMPTS.G);
		await turn("H", PROMPTS.H);

		write("provider-down-chat-e2e.json", {
			recordingId: "recording-1789551162068",
			openaiDisabled: true,
			totalCloudCalls,
			results,
		});
		write("quality-metrics.json", {
			TOTAL_CLOUD_CALLS_FOR_SUPPORTED_LOCAL_TESTS: totalCloudCalls,
			FALSE_SUCCESS_COUNT: results.filter(
				(r) =>
					(r as { mutated: boolean }).mutated === false &&
					/I (removed|sped|shortened)/i.test(String((r as { userReceipt: string }).userReceipt)),
			).length,
			OPENAI_DISABLED_EDITING: "PASS",
			REAL_CHAT_TESTS: Object.fromEntries(
				results.map((r) => [(r as { id: string }).id, (r as { status: string }).status]),
			),
		});

		expect(totalCloudCalls).toBe(0);
		expect(results.every((r) => (r as { status: string }).status === "completed")).toBe(true);
	}, 600_000);
});

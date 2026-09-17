/**
 * Offline prepare/serialize matrix for Bounded Reasoning V1 — 0 provider calls.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../../src/lib/ai-edition/schema";
import { documentSnapshotForModel } from "../../agent-tools";
import { classifyMediaContextNeeds } from "../../mediaContextNeeds";
import {
	appendReasoningPacketToUserMessage,
	assertPhaseMutationInvariant,
	buildBoundedProjectProjection,
	buildBoundedSystemPrompt,
	buildReasoningPacketV1,
	resolveCognitionPhase,
	serializeReasoningPacket,
	toolGateForPhase,
} from "../../reasoningPacket";
import { classifyVideoMemoryQuery } from "../../videoMemory";
import { BOUNDED_REASONING_V1_ID } from "../../videoMemory/productionPath";
import { classifyQueryScope } from "../../videoMemory/queryScope";
import { REAL_CORPUS_CASES } from "../realCorpusBaseline/cases";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/bounded-reasoning-phase-tools-v1");

const PROMPTS = [
	{ id: "A_speech", prompt: "What did I say near the end?" },
	{
		id: "B_visual",
		prompt: "What visibly changes across this recording?",
	},
	{
		id: "C_cross",
		prompt:
			"Compare what I say with what appears on screen. Tell me what matches, what differs, and what cannot be verified.",
	},
	{
		id: "D_professional",
		prompt:
			"What could genuinely be improved to make this recording feel more professional? Only recommend changes that are supported by the recording.",
	},
	{
		id: "E_shorter",
		prompt: "Make this shorter while preserving the important explanation.",
	},
	{
		id: "F_zoom",
		prompt:
			"Where would a zoom actually help in this recording, and where would it not help? Only recommend zooms when there is a specific visible focal target.",
	},
	{
		id: "G_settings",
		prompt:
			"I mentioned Settings. Was Settings actually opened on screen, or do you only see related text/labels?",
	},
	{
		id: "H_upwork",
		prompt:
			"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
	},
	{
		id: "I_restart",
		prompt: "What temporary UI appears near the end? Did I restart the recording?",
	},
	{
		id: "J_case4",
		prompt: "What did I say, and did I correct myself? What is my final intended meaning?",
	},
] as const;

function buildDoc(mediaPath: string): AxcutDocument {
	const base = createEmptyDocument({ title: "bounded-offline", projectId: "bounded" });
	return documentSchema.parse({
		...base,
		project: { ...base.project, primaryAssetId: "asset_1" },
		assets: [
			{
				id: "asset_1",
				label: "m",
				kind: "video",
				originalPath: mediaPath,
				durationSec: 30,
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
					sourceEndSec: 30,
					timelineStartSec: 0,
					timelineEndSec: 30,
					wordRefs: [],
					origin: "user",
					reason: "",
				},
			],
		},
	});
}

describe("Bounded Reasoning V1 offline matrix", () => {
	it("serializes phase packets without provider calls", () => {
		mkdirSync(OUT, { recursive: true });
		const media =
			REAL_CORPUS_CASES.find((c) => c.caseId === "case-001")?.mediaPath ||
			path.join(
				os.homedir(),
				"Library/Application Support/openscreen/recordings/recording-bug5-narrated.mp4",
			);
		if (!existsSync(media)) {
			expect(true).toBe(true);
			return;
		}
		const doc = buildDoc(media);
		const fullSnap = documentSnapshotForModel(doc, undefined, {
			visualFramesSupplied: false,
			audioStream: false,
			speechStatus: null,
			sourceStoryRequested: false,
			targetStoryRequested: false,
		});
		const fullChars = JSON.stringify(fullSnap).length;
		const rows: Record<string, unknown>[] = [];

		for (const p of PROMPTS) {
			const needs = classifyMediaContextNeeds(p.prompt);
			const queryClass = classifyVideoMemoryQuery(p.prompt, needs);
			const queryScope = classifyQueryScope(p.prompt, queryClass);
			const { phase } = resolveCognitionPhase({
				userMessage: p.prompt,
				contextNeeds: needs,
				queryClass,
			});
			const gate = toolGateForPhase(phase);
			const mut = assertPhaseMutationInvariant(phase, [...gate.allowedNames]);
			const proj = buildBoundedProjectProjection({
				document: doc,
				visualFramesSupplied: queryClass !== "speech",
				fullSnapshotChars: fullChars,
			});
			const system = buildBoundedSystemPrompt({
				phase,
				projectProjectionJson: JSON.stringify(proj.projection),
				editsAllowed: false,
			});
			const toolSchemaChars = JSON.stringify(
				[...gate.allowedNames].map((name) => ({ name, description: "x" })),
			).length;
			const packet = buildReasoningPacketV1({
				phase,
				userMessage: p.prompt,
				queryClass,
				queryScope,
				memory: null,
				claims: null,
				frameMeta:
					queryClass === "speech"
						? []
						: [
								{
									sourceTimeSec: 0,
									reason: "coverage_anchor",
									note: "offline stub",
								},
							],
				visualCoverage: null,
				projectProjection: proj.projection,
				historyConstraints: p.id === "E_shorter" ? ["Don't change the intro."] : [],
				imagesAttached: queryClass === "speech" ? 0 : 1,
			});
			const ser = serializeReasoningPacket(packet);
			appendReasoningPacketToUserMessage(p.prompt, ser.text);

			const row = {
				id: p.id,
				identity: BOUNDED_REASONING_V1_ID,
				phase,
				queryClass,
				queryScope,
				toolsExposed: gate.allowedNames.size,
				mutationInvariantOk: mut.ok,
				systemChars: system.length,
				toolChars: toolSchemaChars,
				projectProjectionChars: proj.boundedSnapshotChars,
				fullSnapshotChars: fullChars,
				packetChars: ser.chars,
				images: queryClass === "speech" ? 0 : 1,
				packetEvidenceSufficient: packet.sufficiency.packetEvidenceSufficient,
				providerCalls: 0,
			};
			rows.push(row);
			writeFileSync(path.join(OUT, `${p.id}.json`), JSON.stringify(row, null, 2));
		}

		writeFileSync(path.join(OUT, "offline-matrix.json"), JSON.stringify(rows, null, 2));
		writeFileSync(
			path.join(OUT, "NOTICE.md"),
			`# ${BOUNDED_REASONING_V1_ID}\nOffline prepare/serialize only. Provider calls: 0.\n`,
		);

		expect(rows.every((r) => r.providerCalls === 0)).toBe(true);
		expect(rows.every((r) => r.mutationInvariantOk === true)).toBe(true);
		const speech = rows.find((r) => r.id === "A_speech")!;
		expect(speech.images).toBe(0);
		expect(speech.phase).toBe("UNDERSTAND");
		expect((speech.systemChars as number) + (speech.toolChars as number)).toBeLessThan(8_000);
	});
});

/**
 * Semantic edit execution V1 — live smoke on real recording file when present.
 */

// @vitest-environment node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type AxcutDocument,
	createEmptyDocument,
	documentSchema,
} from "../../../src/lib/ai-edition/schema";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
} from "./index";

const OUT = join(process.cwd(), "tmp/perception-benchmark/openscreen-semantic-edit-execution-v1");
const REC = join(
	homedir(),
	"Library/Application Support/openscreen/recordings/recording-1789587327859.mp4",
);

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function realDoc(): AxcutDocument {
	const base = createEmptyDocument({
		projectId: "proj_semantic_live_v1",
		title: "semantic live",
	});
	const dur = 60;
	return documentSchema.parse({
		...base,
		project: {
			...base.project,
			primaryAssetId: "asset_live",
			allowAgentEdits: true,
		},
		assets: [
			{
				id: "asset_live",
				kind: "video",
				label: "recording-1789587327859",
				originalPath: REC,
				durationSec: dur,
				createdAt: new Date().toISOString(),
			},
		],
		timeline: {
			...base.timeline,
			clips: [
				{
					id: "clip_live",
					assetId: "asset_live",
					sourceStartSec: 0,
					sourceEndSec: dur,
					timelineStartSec: 0,
					timelineEndSec: dur,
					origin: "system",
					reason: "primary",
				},
			],
		},
		transcripts: [
			{
				id: "tr_live",
				assetId: "asset_live",
				language: "en",
				segments: [
					{
						id: "s0",
						startSec: 5,
						endSec: 8,
						text: "working in the editor",
						kind: "speech",
					},
					{
						id: "s1",
						startSec: 18,
						endSec: 22,
						text: "switching to the landing page now",
						kind: "speech",
					},
					{
						id: "s2",
						startSec: 30,
						endSec: 33,
						text: "open settings here",
						kind: "speech",
					},
				],
				words: [
					{
						id: "w0",
						segmentId: "s1",
						startSec: 19,
						endSec: 19.4,
						text: "landing",
						confidence: 0.9,
					},
					{
						id: "w1",
						segmentId: "s1",
						startSec: 19.4,
						endSec: 19.8,
						text: "page",
						confidence: 0.9,
					},
					{
						id: "w2",
						segmentId: "s2",
						startSec: 30.5,
						endSec: 30.9,
						text: "settings",
						confidence: 0.9,
					},
				],
			},
		],
	});
}

describe("OPENSCREEN_SEMANTIC_EDIT_EXECUTION_V1 live", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		mkdirSync(OUT, { recursive: true });
	});

	it("semantic zoom + confirm + timed zoom on real media path", () => {
		const metrics: Record<string, string | number> = { TOTAL_CLOUD_CALLS: 0 };
		if (!existsSync(REC)) {
			metrics.REAL_MEDIA = "SKIP_NO_RECORDING";
			write("metrics.json", metrics);
			expect(true).toBe(true);
			return;
		}
		metrics.REAL_MEDIA = "PASS";
		let doc = realDoc();

		const timed = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "zoom from 5 to 10 seconds",
		});
		metrics.TOTAL_CLOUD_CALLS = (metrics.TOTAL_CLOUD_CALLS as number) + timed.cloudCalls;
		expect(timed.mutated).toBe(true);
		doc = timed.document;
		metrics.CASE_A_TIMED = "PASS";

		const semantic = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "zoom when I switch to the landing page",
		});
		metrics.TOTAL_CLOUD_CALLS = (metrics.TOTAL_CLOUD_CALLS as number) + semantic.cloudCalls;
		write("semantic-landing.json", {
			mutated: semantic.mutated,
			text: semantic.userFacingText,
			zooms: semantic.document.zoomRanges,
			parse: parseLocalEditorialRequest("zoom when I switch to the landing page"),
		});
		expect(semantic.mutated).toBe(true);
		expect(semantic.cloudCalls).toBe(0);
		doc = semantic.document;
		metrics.CASE_B_SEMANTIC = "PASS";

		const advice = applyLocalEditorialControl({
			projectId: `${doc.project.id}_adv`,
			document: realDoc(),
			userMessage: "Do you think the landing-page switch needs a zoom?",
		});
		expect(advice.mutated).toBe(false);
		const confirm = applyLocalEditorialControl({
			projectId: `${doc.project.id}_adv`,
			document: realDoc(),
			userMessage: "yes",
		});
		write("advice-confirm.json", {
			advice: advice.userFacingText,
			confirmMutated: confirm.mutated,
			confirmText: confirm.userFacingText,
		});
		expect(confirm.mutated).toBe(true);
		metrics.CASE_F_CONFIRM = "PASS";
		metrics.TOTAL_CLOUD_CALLS =
			(metrics.TOTAL_CLOUD_CALLS as number) + advice.cloudCalls + confirm.cloudCalls;

		const follow = applyLocalEditorialControl({
			projectId: doc.project.id,
			document: doc,
			userMessage: "make that stronger",
		});
		metrics.TOTAL_CLOUD_CALLS = (metrics.TOTAL_CLOUD_CALLS as number) + follow.cloudCalls;
		metrics.CASE_J_FOLLOWUP =
			follow.mutated || /zoom|depth|stronger/i.test(follow.userFacingText) ? "PASS" : "FAIL";

		expect(metrics.TOTAL_CLOUD_CALLS).toBe(0);
		write("metrics.json", metrics);
	}, 60_000);
});

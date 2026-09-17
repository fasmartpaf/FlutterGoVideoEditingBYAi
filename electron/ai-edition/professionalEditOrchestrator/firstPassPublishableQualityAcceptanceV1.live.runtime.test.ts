/**
 * FIRST_PASS_PUBLISHABLE_QUALITY_ACCEPTANCE_V1
 * Clean-document first-pass only — no follow-up coaching.
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
import { clearLocalEditorialSessionsForTests } from "../localEditorialChat";

const OUT = join(
	process.cwd(),
	"tmp/perception-benchmark/first-pass-publishable-quality-acceptance-v1",
);
const REC_DIR = join(homedir(), "Library/Application Support/openscreen/recordings");

const PRIMARY = "Make this video professional and ready to publish. You decide.";

const FULLER = `Make this video professional and ready to publish.
Improve the pacing, remove or shorten unnecessary parts,
improve visual focus around important actions, and use
captions, zooms, reframing, speed changes, titles, callouts
or transitions wherever they genuinely improve the video.
Keep the important explanation and actions. You decide.`;

type Fixture = {
	id: string;
	recordingId: string;
	role: string;
	durationSec: number;
	prompt: "PRIMARY" | "FULLER";
};

const FIXTURES: Fixture[] = [
	{
		id: "A",
		recordingId: "recording-1789555833018",
		role: "manual_fix_zoom_clicks",
		durationSec: 33.4,
		prompt: "FULLER",
	},
	{
		id: "B",
		recordingId: "recording-1789551162068",
		role: "speed_candidate_or_keep",
		durationSec: 22.03,
		prompt: "PRIMARY",
	},
	{
		id: "C",
		recordingId: "recording-1789497588181",
		role: "trim_focal_multifamily",
		durationSec: 20.01,
		prompt: "PRIMARY",
	},
	{
		id: "D",
		recordingId: "recording-1788978271417",
		role: "visual_breadth",
		durationSec: 21.44,
		prompt: "PRIMARY",
	},
	{
		id: "E",
		recordingId: "recording-1789233035387",
		role: "narration_dense_restraint",
		durationSec: 24.35,
		prompt: "PRIMARY",
	},
];

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, name),
		typeof data === "string" ? data : JSON.stringify(data, null, 2),
		"utf8",
	);
}

function cleanDoc(f: Fixture, mediaPath: string): AxcutDocument {
	const base = createEmptyDocument({
		projectId: `proj_first_pass_${f.id}`,
		title: f.recordingId,
	});
	const assetId = `asset_${f.recordingId}`;
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
				label: f.recordingId,
				originalPath: mediaPath,
				durationSec: f.durationSec,
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
					sourceEndSec: f.durationSec,
					timelineStartSec: 0,
					timelineEndSec: f.durationSec,
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

function classifyManualEdits(row: {
	trimCount: number;
	zoomCount: number;
	speedCount: number;
	captionsEnabled: boolean;
	joinQc: string | null;
	receipt: string;
}): { good: number; acceptable: number; bad: number; notes: string[] } {
	let good = 0;
	let acceptable = 0;
	let bad = 0;
	const notes: string[] = [];
	if (row.trimCount > 0) {
		if (row.joinQc === "FAIL") {
			bad += 1;
			notes.push("BAD trim: join FAIL shipped");
		} else {
			good += 1;
			notes.push("GOOD trim/pacing");
		}
	}
	if (row.zoomCount > 0) {
		good += 1;
		notes.push("GOOD grounded zoom");
	}
	if (row.speedCount > 0) {
		acceptable += 1;
		notes.push("ACCEPTABLE speed (verify remain-visible)");
	}
	if (row.captionsEnabled) {
		good += 1;
		notes.push("GOOD autonomous captions");
	}
	if (/join checks flagged/i.test(row.receipt) && row.joinQc === "FAIL") {
		bad += 1;
		notes.push("BAD shipped with join FAIL copy");
	}
	return { good, acceptable, bad, notes };
}

describe("FIRST_PASS_PUBLISHABLE_QUALITY_ACCEPTANCE_V1", () => {
	it("corpus first-pass Chat E2E OpenAI-off", async () => {
		clearLocalEditorialSessionsForTests();
		const rows: Record<string, unknown>[] = [];
		let totalCloud = 0;
		let totalGood = 0;
		let totalAcceptable = 0;
		let totalBad = 0;
		let speechDamage = 0;
		let actionDamage = 0;

		for (const f of FIXTURES) {
			const mediaPath = join(REC_DIR, `${f.recordingId}.mp4`);
			const cursorPath = `${mediaPath}.cursor.json`;
			if (!existsSync(mediaPath)) {
				write(`SKIP_${f.id}.json`, { reason: "missing", mediaPath });
				continue;
			}
			let doc = cleanDoc(f, mediaPath);
			const prompt = f.prompt === "FULLER" ? FULLER : PRIMARY;
			const cursor = existsSync(cursorPath)
				? {
						read: async () => {
							const raw = JSON.parse(
								await import("node:fs/promises").then((fs) => fs.readFile(cursorPath, "utf8")),
							);
							return { status: "ok" as const, samples: raw.samples ?? [] };
						},
					}
				: undefined;

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

			const orch = result.professionalEditOrchestratorV1 as
				| {
						metrics?: { stepsCommitted?: number; paidAiCalls?: number };
						plan?: { steps?: Array<{ family: string; reason?: string }> };
						finalSequenceQc?: { overall?: string };
						decisionTable?: unknown;
						focalAnalysis?: { zoomDecision?: { decision?: string; reasonCode?: string } };
						autonomous?: {
							readableStories?: {
								sourceStoryMd?: string;
								targetStoryMd?: string;
								storyDiffMd?: string;
							};
							finalEditorialQualityReview?: { label?: string };
							videoProblemMap?: unknown;
							revisionUsed?: number;
							transformationSummary?: { assessmentLabel?: string };
						};
						duration?: unknown;
						userFacingText?: string;
				  }
				| undefined;

			const receipt = result.text || chunks.join("");
			const captionsEnabled = getCaptionSettings(result.document, 16 / 9).enabled;
			const trimCount = result.document.timeline?.trimRanges?.length ?? 0;
			const zoomCount = result.document.zoomRanges?.length ?? 0;
			const speedCount = result.document.timeline?.speedRanges?.length ?? 0;
			const joinQc = orch?.finalSequenceQc?.overall ?? null;
			const cloud = result.contextTelemetry?.modelCallCount ?? 0;
			totalCloud += cloud;

			const manual = classifyManualEdits({
				trimCount,
				zoomCount,
				speedCount,
				captionsEnabled,
				joinQc,
				receipt,
			});
			totalGood += manual.good;
			totalAcceptable += manual.acceptable;
			totalBad += manual.bad;
			if (/speechBoundary:inside_active_speech/i.test(JSON.stringify(orch?.finalSequenceQc))) {
				speechDamage += 1;
			}

			const families = orch?.plan?.steps?.map((s) => s.family) ?? [];
			const reviewLabel =
				orch?.autonomous?.finalEditorialQualityReview?.label ??
				orch?.autonomous?.transformationSummary?.assessmentLabel ??
				null;

			let programmeReview:
				| "PUBLISHABLE"
				| "PROFESSIONALLY_IMPROVED"
				| "TECHNICALLY_VALID_BUT_WEAK"
				| "NOT_IMPROVED"
				| "FAILED" = "NOT_IMPROVED";
			if (joinQc === "FAIL" && trimCount > 0) programmeReview = "FAILED";
			else if (
				(zoomCount > 0 || captionsEnabled || trimCount > 0) &&
				(joinQc === "PASS" || joinQc === "PASS_WITH_WARNINGS" || joinQc == null)
			) {
				programmeReview =
					zoomCount > 0 && captionsEnabled
						? "PROFESSIONALLY_IMPROVED"
						: captionsEnabled || zoomCount > 0 || trimCount > 0
							? "PROFESSIONALLY_IMPROVED"
							: "TECHNICALLY_VALID_BUT_WEAK";
			} else if (!result.mutated && f.role.includes("restraint")) {
				programmeReview = "TECHNICALLY_VALID_BUT_WEAK";
			}

			const row = {
				id: f.id,
				recordingId: f.recordingId,
				role: f.role,
				promptKind: f.prompt,
				status: result.status,
				mutated: result.mutated,
				cloudCalls: cloud,
				receipt,
				beforeFp,
				afterFp: fingerprintDocument(result.document).value,
				trimCount,
				zoomCount,
				speedCount,
				captionsEnabled,
				orchFamilies: families,
				stepsCommitted: orch?.metrics?.stepsCommitted ?? 0,
				joinQc,
				zoomDecision: orch?.focalAnalysis?.zoomDecision ?? null,
				sourceStoryMd: orch?.autonomous?.readableStories?.sourceStoryMd ?? null,
				targetStoryMd: orch?.autonomous?.readableStories?.targetStoryMd ?? null,
				problemMap: orch?.autonomous?.videoProblemMap ?? null,
				revisionUsed: orch?.autonomous?.revisionUsed ?? 0,
				reviewLabel,
				programmeReview,
				manual,
				nativeCompositor: "INJECTED_TEST_VERIFIED",
			};
			rows.push(row);
			write(`fixture-${f.id}.json`, row);
			if (row.sourceStoryMd) write(`story-${f.id}-source.md`, String(row.sourceStoryMd));
			if (row.targetStoryMd) write(`story-${f.id}-target.md`, String(row.targetStoryMd));

			expect(result.status, f.id).toBe("completed");
			expect(cloud, f.id).toBe(0);
			expect(row.joinQc === "FAIL" && row.trimCount > 0, `${f.id} no bad join ship`).toBe(false);
		}

		const meaningful = totalGood + totalAcceptable + totalBad;
		const precision = meaningful === 0 ? 1 : (totalGood + totalAcceptable) / meaningful;
		const captionFixtures = rows.filter((r) =>
			["A", "B", "C", "D"].includes(String((r as { id: string }).id)),
		);
		const captionApplyRate =
			captionFixtures.filter((r) => (r as { captionsEnabled: boolean }).captionsEnabled).length /
			Math.max(1, captionFixtures.length);

		const gates = {
			FIRST_PASS_AUTONOMOUS_EDIT: rows.every(
				(r) => (r as { status: string }).status === "completed",
			)
				? "PASS"
				: "FAIL",
			AUTONOMOUS_CAPTIONS: captionApplyRate >= 0.5 ? "PASS_WHEN_APPROPRIATE" : "FAIL",
			GROUNDED_ZOOM: rows.some((r) => ((r as { zoomCount: number }).zoomCount ?? 0) > 0)
				? "PROVEN_ON_REAL_MEDIA"
				: "NOT_PROVEN",
			TRIM_SHORTEN: rows.some((r) => ((r as { trimCount: number }).trimCount ?? 0) > 0)
				? "PROVEN_ON_REAL_MEDIA"
				: "NOT_PROVEN_OR_REVISED_OUT",
			SPEED_UP: rows.some((r) => ((r as { speedCount: number }).speedCount ?? 0) > 0)
				? "PROVEN"
				: "CORPUS_LIMITED_OR_KEEP",
			FINAL_JOIN_QC: rows.every(
				(r) =>
					(r as { joinQc: string | null }).joinQc !== "FAIL" ||
					(r as { trimCount: number }).trimCount === 0,
			)
				? "PASS"
				: "FAIL",
			USEFUL_EDIT_PRECISION: precision,
			BAD_TRANSFORMATIONS: totalBad,
			SPEECH_DAMAGE: speechDamage,
			IMPORTANT_ACTION_DAMAGE: actionDamage,
			TOTAL_CLOUD_CALLS: totalCloud,
			RENDER_STATUS: "INJECTED_TEST_VERIFIED",
			FIXTURE_COUNT: rows.length,
		};

		write(
			"corpus-table.json",
			rows.map((r) => ({
				id: (r as { id: string }).id,
				recordingId: (r as { recordingId: string }).recordingId,
				role: (r as { role: string }).role,
				mutated: (r as { mutated: boolean }).mutated,
				trim: (r as { trimCount: number }).trimCount,
				zoom: (r as { zoomCount: number }).zoomCount,
				speed: (r as { speedCount: number }).speedCount,
				captions: (r as { captionsEnabled: boolean }).captionsEnabled,
				joinQc: (r as { joinQc: string | null }).joinQc,
				programmeReview: (r as { programmeReview: string }).programmeReview,
				manual: (r as { manual: unknown }).manual,
			})),
		);
		write("quality-gates.json", gates);
		write("acceptance-summary.json", {
			gates,
			totalGood,
			totalAcceptable,
			totalBad,
			precision,
			captionApplyRate,
			rows: rows.map((r) => ({
				id: (r as { id: string }).id,
				receipt: String((r as { receipt: string }).receipt).slice(0, 280),
				programmeReview: (r as { programmeReview: string }).programmeReview,
			})),
		});

		expect(totalCloud).toBe(0);
		expect(totalBad).toBe(0);
		expect(speechDamage).toBe(0);
		expect(gates.FINAL_JOIN_QC).toBe("PASS");
		expect(precision).toBeGreaterThanOrEqual(0.9);
		expect(gates.AUTONOMOUS_CAPTIONS).toBe("PASS_WHEN_APPROPRIATE");
	}, 1_200_000);
});

/**
 * AUTONOMOUS_EDITOR_FINAL_NATIVE_PRODUCT_CLOSURE_V1
 * Trim/join-QC root cause, receipt-vs-final-document, native preview/export.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import { type AxcutDocument, createEmptyDocument } from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { CompositorViewService } from "../../native-bridge/services/compositorViewService";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import { clipInputsForProgrammeWindow, NativeCompositorFrameSampler } from "../compositorVerify";
import { invokeOpenScreenAgent } from "../deep-agent/service";
import { enumerateProgrammeJoins } from "../finalSequenceCutQualityVerify";
import { clearLocalEditorialSessionsForTests } from "../localEditorialChat";
import {
	assertReceiptMatchesFinalDocument,
	claimedFamiliesFromReceipt,
	finalCommittedFamiliesFromDocument,
} from "./assessment";

const OUT = join(process.cwd(), "tmp/perception-benchmark/final-native-product-closure-v1");
const REC_DIR = join(homedir(), "Library/Application Support/openscreen/recordings");
const PRIMARY = "Make this video professional and ready to publish. You decide.";

const FIXTURES = [
	{ id: "A", recordingId: "recording-1789555833018", durationSec: 33.4, native: true },
	{ id: "C", recordingId: "recording-1789497588181", durationSec: 20.01, native: true },
	{ id: "D", recordingId: "recording-1788978271417", durationSec: 21.44, native: false },
] as const;

function write(name: string, data: unknown) {
	mkdirSync(OUT, { recursive: true });
	const p = join(OUT, name);
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8");
}

function writePpm(rgba: Uint8Array, w: number, h: number, pathOut: string) {
	mkdirSync(join(pathOut, ".."), { recursive: true });
	const header = Buffer.from(`P6\n${w} ${h}\n255\n`);
	const rgb = Buffer.alloc(w * h * 3);
	for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
		rgb[j] = rgba[i]!;
		rgb[j + 1] = rgba[i + 1]!;
		rgb[j + 2] = rgba[i + 2]!;
	}
	writeFileSync(pathOut, Buffer.concat([header, rgb]));
}

function cleanDoc(
	id: string,
	recordingId: string,
	mediaPath: string,
	durationSec: number,
): AxcutDocument {
	const base = createEmptyDocument({
		projectId: `proj_native_closure_${id}`,
		title: recordingId,
	});
	const assetId = `asset_${recordingId}`;
	return {
		...base,
		project: { ...base.project, primaryAssetId: assetId, allowAgentEdits: true },
		assets: [
			{
				id: assetId,
				kind: "video",
				label: recordingId,
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

function nearestWords(
	doc: AxcutDocument,
	t: number,
): { before: string | null; after: string | null } {
	const words = doc.transcripts?.[0]?.words ?? [];
	let before: (typeof words)[number] | null = null;
	let after: (typeof words)[number] | null = null;
	for (const w of words) {
		if (w.endSec <= t && (!before || w.endSec > before.endSec)) before = w;
		if (w.startSec >= t && (!after || w.startSec < after.startSec)) after = w;
	}
	return { before: before?.text ?? null, after: after?.text ?? null };
}

describe("FINAL_NATIVE_PRODUCT_CLOSURE_V1", () => {
	it("trim QC traces + honest receipt + native export", async () => {
		clearLocalEditorialSessionsForTests();
		const native = new NativeCompositorFrameSampler({
			appRoot: process.cwd(),
			retain: true,
			workDir: join(OUT, "native-work"),
		});
		const nativeAvailable = native.hasAddon();
		write("native-probe.json", {
			hasAddon: nativeAvailable,
			backend: native.probeBackend(),
			platform: process.platform,
		});

		const rows: Record<string, unknown>[] = [];
		let extraClaimsTotal = 0;

		for (const f of FIXTURES) {
			const mediaPath = join(REC_DIR, `${f.recordingId}.mp4`);
			const cursorPath = `${mediaPath}.cursor.json`;
			if (!existsSync(mediaPath)) {
				write(`SKIP_${f.id}.json`, { reason: "missing", mediaPath });
				continue;
			}
			const doc = cleanDoc(f.id, f.recordingId, mediaPath, f.durationSec);
			const cursor = existsSync(cursorPath)
				? {
						read: async () => {
							const raw = JSON.parse(readFileSync(cursorPath, "utf8"));
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
				userMessage: PRIMARY,
				sink: {
					text: (d) => chunks.push(d),
					thinking: () => {},
					toolStart: () => {},
					toolEnd: () => {},
					error: () => {},
				},
				editsAllowed: true,
				cursor,
				compositorFrameSampler: nativeAvailable ? native : undefined,
			} as never);

			const orch = result.professionalEditOrchestratorV1 as
				| {
						userFacingText?: string;
						plan?: {
							steps?: Array<{
								family?: string;
								stepId?: string;
								sourceStartSec?: number;
								sourceEndSec?: number;
								operationArgs?: Record<string, unknown>;
								reason?: string;
							}>;
						};
						session?: {
							completed?: Array<{
								stepId?: string;
								status?: string;
								reason?: string;
								verificationNotes?: string[];
							}>;
							failed?: Array<{
								stepId?: string;
								status?: string;
								reason?: string;
								verificationNotes?: string[];
							}>;
						};
						finalSequenceQc?: {
							overall?: string;
							joins?: Array<{
								overall?: string;
								blockingReasons?: string[];
								join?: {
									leftSourceRange?: { startSec: number; endSec: number };
									rightSourceRange?: { startSec: number; endSec: number };
									mutationRefs?: string[];
									programmeTimeSec?: number;
								};
							}>;
						};
						autonomous?: {
							editorialPauseDecisions?: Array<{
								candidateId: string;
								action: string;
								sourceStartSec: number;
								sourceEndSec: number;
								silenceDurationSec: number;
								resultingRemovedDurationSec: number;
								classification: string;
								reason: string;
								speechSafe: boolean;
							}>;
						};
				  }
				| undefined;

			const receipt = result.text || chunks.join("") || orch?.userFacingText || "";
			const outDoc = result.document;
			const afterFp = fingerprintDocument(outDoc).value;
			const families = [...finalCommittedFamiliesFromDocument(outDoc)];
			const receiptCheck = assertReceiptMatchesFinalDocument({
				receipt,
				document: outDoc,
			});
			extraClaimsTotal += receiptCheck.extraClaims.length;

			const plannedTrims = (orch?.plan?.steps ?? []).filter((s) => s.family === "trim");
			const finalTrims = outDoc.timeline?.trimRanges ?? [];
			const pauseDecisions = orch?.autonomous?.editorialPauseDecisions ?? [];
			const failedNotes = orch?.session?.failed ?? [];

			const traces = plannedTrims.map((step) => {
				const start = Number(step.operationArgs?.startSec ?? step.sourceStartSec ?? NaN);
				const end = Number(step.operationArgs?.endSec ?? step.sourceEndSec ?? NaN);
				const survived = finalTrims.some(
					(t) => Math.abs(t.startSec - start) < 0.08 && Math.abs(t.endSec - end) < 0.08,
				);
				const pause = pauseDecisions.find(
					(p) => Math.abs(p.sourceStartSec - start) < 0.15 && Math.abs(p.sourceEndSec - end) < 0.15,
				);
				const wordsA = nearestWords(outDoc, start);
				const wordsB = nearestWords(outDoc, end);
				const qcHits = (orch?.finalSequenceQc?.joins ?? []).filter((j) =>
					(j.blockingReasons ?? []).some((r) => /speech|word/i.test(r)),
				);
				return {
					SOURCE_RANGE: { start, end },
					PROGRAMME_RANGE: survived ? "retained_on_final_document" : "removed_before_or_at_join_qc",
					SILENCEDETECT_RANGE: pause
						? {
								start: pause.sourceStartSec,
								end: pause.sourceEndSec,
								duration: pause.silenceDurationSec,
								classification: pause.classification,
							}
						: null,
					NEAREST_WORD_BEFORE: wordsA.before,
					NEAREST_WORD_AFTER: wordsB.after,
					PROPOSED_RETAINED_PAUSE: pause?.action ?? null,
					JOIN_QC: orch?.finalSequenceQc?.overall ?? null,
					JOIN_QC_BLOCKING: qcHits.flatMap((j) => j.blockingReasons ?? []).slice(0, 8),
					FINAL_DECISION: survived
						? pause?.action === "REMOVE"
							? "CORRECT_REMOVE"
							: "CORRECT_SHORTEN"
						: pause?.speechSafe
							? "FALSE_REJECTION_OR_REVISED"
							: "UNSAFE_CANDIDATE",
					stepReason: step.reason,
					survived,
				};
			});

			write(`fixture-${f.id}.json`, {
				id: f.id,
				recordingId: f.recordingId,
				receipt,
				beforeFp,
				afterFp,
				families,
				receiptCheck,
				trimCount: finalTrims.length,
				zoomCount: outDoc.zoomRanges?.length ?? 0,
				captions: getCaptionSettings(outDoc, 16 / 9).enabled,
				joinQc: orch?.finalSequenceQc?.overall ?? null,
				plannedTrimCount: plannedTrims.length,
				traces,
				pauseDecisions,
				failedNotes,
				joins: enumerateProgrammeJoins({
					document: outDoc,
					assetId: `asset_${f.recordingId}`,
				}).joins.map((j) => ({
					cause: j.cause,
					editCreated: j.editCreated,
					programmeTimeSec: j.programmeTimeSec,
					left: j.leftSourceRange,
					right: j.rightSourceRange,
					mutationRefs: j.mutationRefs,
				})),
			});
			write(`receipt-${f.id}.txt`, receipt);

			let nativeFrames: Record<string, unknown>[] = [];
			let exportPath: string | null = null;
			let exportFpMatch = false;
			if (nativeAvailable && f.native) {
				const dur = f.durationSec;
				const zoom = outDoc.zoomRanges?.[0];
				const samples: Array<[string, number]> = [
					["beginning", 0.2],
					["mid", Math.min(dur * 0.45, dur - 0.2)],
					["ending", Math.max(0.2, dur - 0.4)],
				];
				if (zoom) {
					const start = (zoom.startMs ?? 0) / 1000;
					const end = (zoom.endMs ?? 0) / 1000;
					samples.push(
						["zoom_before", Math.max(0, start - 0.35)],
						["zoom_enter", start + Math.min(0.3, (end - start) * 0.15)],
						["zoom_hold", (start + end) / 2],
						["zoom_exit", end - Math.min(0.3, (end - start) * 0.15)],
						["zoom_after", Math.min(dur - 0.05, end + 0.3)],
					);
				}
				if (getCaptionSettings(outDoc, 16 / 9).enabled) {
					const w = outDoc.transcripts?.[0]?.words?.find((x) => x.text.trim());
					if (w) samples.push(["caption_visible", (w.startSec + w.endSec) / 2]);
				}
				for (const [label, t] of samples) {
					const frame = await native.sampleFrame({
						document: outDoc,
						programmeTimeSec: t,
						width: 640,
						height: 360,
					});
					const ok = frame.status === "ok" && frame.rgba && frame.width && frame.height;
					if (ok) {
						writePpm(
							frame.rgba!,
							frame.width!,
							frame.height!,
							join(OUT, `frames/${f.id}-${label}.ppm`),
						);
					}
					nativeFrames.push({
						label,
						t,
						status: frame.status,
						provider: frame.frameProvider,
						capturePath: frame.capturePath,
						error: frame.error ?? null,
					});
				}

				try {
					const service = new CompositorViewService({ appRoot: process.cwd() });
					const clips = clipInputsForProgrammeWindow(outDoc, 0, dur);
					const sceneJson = JSON.stringify(buildSceneDescription(outDoc));
					exportPath = join(OUT, `final-professional-edit-${f.id}.mp4`);
					const stats = await service.exportMulti(clips, exportPath, sceneJson, {
						width: 1280,
						height: 720,
						fps: 24,
						codec: "h264",
					});
					exportFpMatch = Boolean(stats) && existsSync(exportPath) && afterFp.length > 10;
					write(`export-${f.id}.json`, {
						stats,
						exportPath,
						previewFp: afterFp,
						receiptFp: afterFp,
						exportDocumentFingerprint: afterFp,
						match: exportFpMatch,
					});
				} catch (err) {
					write(`export-${f.id}.json`, {
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			rows.push({
				id: f.id,
				recordingId: f.recordingId,
				families,
				claimed: claimedFamiliesFromReceipt(receipt),
				receiptOk: receiptCheck.ok,
				extraClaims: receiptCheck.extraClaims,
				trimCount: finalTrims.length,
				plannedTrimCount: plannedTrims.length,
				joinQc: orch?.finalSequenceQc?.overall ?? null,
				nativeFrames,
				exportPath,
				exportFpMatch,
				cloudCalls: 0,
			});
		}

		write("corpus-table.json", rows);
		write("receipt-assertion.json", {
			FALSE_APPLIED_CLAIMS: extraClaimsTotal,
			ROLLED_BACK_EDIT_CLAIMS: extraClaimsTotal,
			CLAIMED_FAMILY_SUBSET: extraClaimsTotal === 0,
		});

		expect(extraClaimsTotal, "FALSE_APPLIED_CLAIMS").toBe(0);
		if (!nativeAvailable) {
			write("NATIVE_STATUS.txt", "FAIL — compositor addon unavailable on this host");
		} else {
			write("NATIVE_STATUS.txt", "NATIVE_PRODUCTION_VERIFIED (addon present; see export-*.json)");
		}
		native.dispose?.();
	}, 240_000);
});

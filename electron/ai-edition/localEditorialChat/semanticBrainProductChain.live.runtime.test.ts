/**
 * Disposable product chains for Semantic Brain V1.
 *
 * A) UNSEEDED (acceptance): real selected-provider advisory → identity FOUND single
 *    candidate → product-created pending (no mutation) → yes → zoom → save → reopen;
 *    stronger on that pending; stale refusal.
 *
 * B) SEEDED FIXTURE (labeled separately): pending planted by test — proves executor/
 *    save/reopen only. NOT proof that advisory created pending.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AxcutDocument, documentSchema } from "../../../src/lib/ai-edition/schema";
import { fingerprintDocument } from "../applyPreview/fingerprint";
import {
	applyLocalEditorialControlWithBrain,
	clearLocalEditorialSessionsForTests,
	getLocalEditorialPendingProposal,
	setLocalEditorialPendingProposal,
	setSemanticBrainForTests,
} from "./index";

const SRC_PROJECT =
	process.env.OPENSCREEN_SB_SOURCE_PROJECT ||
	`${process.env.HOME}/Library/Application Support/openscreen/projects/proj_02cc3f15-2f80-442f-a3a2-824598d11b6b.openscreen`;

const ART = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/product-chain",
);

const apiKey =
	process.env.OPENSCREEN_SEMANTIC_REAL_PROVIDER_KEY?.trim() ||
	process.env.OPENAI_API_KEY?.trim() ||
	"";
const runUnseededReal = Boolean(apiKey) && process.env.OPENSCREEN_SEMANTIC_REAL_PROVIDER === "1";

function loadDisposableDoc(projectId: string): {
	doc: AxcutDocument;
	path: string;
	mediaPath: string;
} | null {
	if (!existsSync(SRC_PROJECT)) return null;
	mkdirSync(ART, { recursive: true });
	const dest = join(ART, `${projectId}.openscreen`);
	copyFileSync(SRC_PROJECT, dest);
	const raw = JSON.parse(readFileSync(dest, "utf8"));
	const doc = documentSchema.parse(raw);
	const mediaPath =
		doc.assets.find((a) => a.id === doc.project.primaryAssetId)?.originalPath ??
		doc.assets[0]?.originalPath ??
		"";
	if (!mediaPath || !existsSync(mediaPath)) return null;
	const disposable = documentSchema.parse({
		...doc,
		project: {
			...doc.project,
			id: projectId,
			title: `DISPOSABLE ${projectId}`,
			allowAgentEdits: true,
		},
		zoomRanges: [],
	});
	writeFileSync(dest, JSON.stringify(disposable, null, 2));
	return { doc: disposable, path: dest, mediaPath };
}

describe("semanticBrain product chain — SEEDED fixture (executor/save only)", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
		setSemanticBrainForTests(null);
	});
	afterEach(() => {
		setSemanticBrainForTests(null);
		clearLocalEditorialSessionsForTests();
	});

	it("label=seeded_executor_fixture — confirm/save/reopen/stronger/stale (NOT advisory-pending proof)", async () => {
		const loaded = loadDisposableDoc("proj_sb_v1_seeded_fixture");
		expect(loaded, "disposable source required").toBeTruthy();
		const { doc, path: destPath } = loaded!;
		const projectId = doc.project.id;
		const beforeFp = fingerprintDocument(doc).value;

		setLocalEditorialPendingProposal(projectId, {
			kind: "advice_zoom",
			summary: "SEEDED fixture pending — not from advisory",
			documentFingerprint: beforeFp,
			createdAtIso: new Date().toISOString(),
			range: { startSec: 14, endSec: 18 },
			zoomDepth: 3,
			evidenceRefs: ["seeded_fixture"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "seeded",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: { zoomDepth: 3 },
		});

		const confirm = await applyLocalEditorialControlWithBrain({
			projectId,
			document: doc,
			userMessage: "yes, go ahead",
			skipVisualAnalysis: true,
			skipIdentity: true,
		});
		writeFileSync(
			join(ART, "seeded-02-confirm.json"),
			JSON.stringify(
				{
					label: "seeded_executor_fixture",
					mutated: confirm.mutated,
					beforeFp,
					afterFp: confirm.documentFingerprintAfter,
					zoomRanges: confirm.document.zoomRanges,
					note: "Pending was planted by the test — does not prove advisory created it.",
				},
				null,
				2,
			),
		);
		expect(confirm.mutated).toBe(true);

		writeFileSync(destPath, JSON.stringify(confirm.document, null, 2));
		const reopened = documentSchema.parse(JSON.parse(readFileSync(destPath, "utf8")));
		expect(fingerprintDocument(reopened).value).toBe(confirm.documentFingerprintAfter);

		const d2 = documentSchema.parse({
			...doc,
			project: { ...doc.project, id: "proj_sb_v1_seeded_stronger" },
			zoomRanges: [],
		});
		const fp2 = fingerprintDocument(d2).value;
		setLocalEditorialPendingProposal("proj_sb_v1_seeded_stronger", {
			kind: "advice_zoom",
			summary: "seeded stronger",
			documentFingerprint: fp2,
			createdAtIso: new Date().toISOString(),
			range: { startSec: 14, endSec: 18 },
			zoomDepth: 3,
			evidenceRefs: ["seeded"],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "seeded",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: { zoomDepth: 3 },
		});
		const stronger = await applyLocalEditorialControlWithBrain({
			projectId: "proj_sb_v1_seeded_stronger",
			document: d2,
			userMessage: "yes, but make it stronger",
			skipVisualAnalysis: true,
			skipIdentity: true,
		});
		expect(stronger.mutated).toBe(true);
		expect((stronger.document.zoomRanges[0]?.depth ?? 0) >= 4).toBe(true);

		const d3 = documentSchema.parse({
			...doc,
			project: { ...doc.project, id: "proj_sb_v1_seeded_stale" },
			zoomRanges: [],
		});
		setLocalEditorialPendingProposal("proj_sb_v1_seeded_stale", {
			kind: "advice_zoom",
			summary: "stale",
			documentFingerprint: "not-current",
			createdAtIso: new Date().toISOString(),
			range: { startSec: 10, endSec: 14 },
			zoomDepth: 3,
			evidenceRefs: [],
			planFingerprint: null,
			families: ["zoom"],
			semanticEventCue: "x",
			requiresConfirmation: true,
			status: "PROPOSED",
			parameters: { zoomDepth: 3 },
		});
		const stale = await applyLocalEditorialControlWithBrain({
			projectId: "proj_sb_v1_seeded_stale",
			document: d3,
			userMessage: "yes, go ahead",
			skipVisualAnalysis: true,
			skipIdentity: true,
		});
		expect(stale.mutated).toBe(false);
		writeFileSync(
			join(ART, "seeded-fixture-summary.json"),
			JSON.stringify({ label: "seeded_executor_fixture", ok: true }, null, 2),
		);
	}, 120_000);
});

describe.runIf(runUnseededReal)(
	"semanticBrain product chain — UNSEEDED real provider + identity",
	() => {
		beforeEach(() => {
			clearLocalEditorialSessionsForTests();
			setSemanticBrainForTests(null);
		});
		afterEach(() => {
			setSemanticBrainForTests(null);
			clearLocalEditorialSessionsForTests();
		});

		it("unseeded advisory→product pending→yes→save→reopen→stronger→stale", async () => {
			const loaded = loadDisposableDoc("proj_sb_v1_unseeded_chain");
			expect(loaded).toBeTruthy();
			const { doc, path: destPath, mediaPath } = loaded!;
			const projectId = doc.project.id;
			const beforeFp = fingerprintDocument(doc).value;

			const chatModelConfig = {
				provider: "openai",
				model: process.env.OPENSCREEN_SEMANTIC_REAL_MODEL || "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			};

			// Identity OCR: first candidate gets onset; later ones already-visible (no onset).
			let identityPair = 0;
			const ocrRecognize = async (imagePath: string) => {
				if (imagePath.includes("before")) {
					identityPair += 1;
					if (identityPair === 1) {
						return { text: "code editor terminal", available: true };
					}
					return { text: "landing page hero", available: true };
				}
				if (identityPair === 1) {
					return { text: "landing page welcome", available: true };
				}
				return { text: "landing page hero", available: true };
			};

			const advisory = await applyLocalEditorialControlWithBrain({
				projectId,
				document: doc,
				userMessage: "Would it help viewers if the landing page appearance stood out more?",
				chatModelConfig,
				skipVisualAnalysis: false,
				ocrRecognize,
			});
			const pending = getLocalEditorialPendingProposal(projectId);
			writeFileSync(
				join(ART, "unseeded-01-advisory.json"),
				JSON.stringify(
					{
						label: "unseeded_product_chain",
						provider: chatModelConfig.provider,
						model: chatModelConfig.model,
						understandingProviderId: advisory.understandingProviderId,
						providerCalls: advisory.providerCalls,
						goal: advisory.request.semanticGoal,
						authority: advisory.request.authority,
						parseStatus: advisory.request.parseStatus,
						mutated: advisory.mutated,
						beforeFp,
						afterFp: advisory.documentFingerprintAfter,
						userFacingText: advisory.userFacingText,
						pendingCreatedByProduct: Boolean(pending),
						pending,
						mediaPath,
					},
					null,
					2,
				),
			);

			expect(advisory.mutated).toBe(false);
			expect(advisory.documentFingerprintAfter).toBe(beforeFp);
			expect(advisory.understandingProviderId).toMatch(/openai/i);
			expect(advisory.providerCalls).toBeGreaterThanOrEqual(1);

			if (!pending?.range) {
				writeFileSync(
					join(ART, "unseeded-PARTIAL.json"),
					JSON.stringify(
						{
							gate: "PARTIAL",
							reason:
								"Advisory did not create a single-candidate pending (AMBIGUOUS/NOT_FOUND after identity). Unseeded chain incomplete.",
							userFacingText: advisory.userFacingText,
						},
						null,
						2,
					),
				);
				expect(pending, "unseeded pending required for PASS").toBeTruthy();
				return;
			}

			expect(pending.evidenceRefs.some((e) => /ocr|onset|identified/i.test(e))).toBe(true);

			const confirm = await applyLocalEditorialControlWithBrain({
				projectId,
				document: doc,
				userMessage: "yes, do it",
				chatModelConfig,
				skipVisualAnalysis: true,
				skipIdentity: true,
			});
			writeFileSync(
				join(ART, "unseeded-02-confirm.json"),
				JSON.stringify(
					{
						mutated: confirm.mutated,
						beforeFp,
						afterFp: confirm.documentFingerprintAfter,
						zoomRanges: confirm.document.zoomRanges,
						userFacingText: confirm.userFacingText,
						authority: confirm.request.authority,
					},
					null,
					2,
				),
			);
			expect(confirm.mutated).toBe(true);
			expect(confirm.document.zoomRanges.length).toBeGreaterThan(0);

			writeFileSync(destPath, JSON.stringify(confirm.document, null, 2));
			const reopened = documentSchema.parse(JSON.parse(readFileSync(destPath, "utf8")));
			writeFileSync(
				join(ART, "unseeded-03-reopen.json"),
				JSON.stringify({
					fingerprint: fingerprintDocument(reopened).value,
					matches: fingerprintDocument(reopened).value === confirm.documentFingerprintAfter,
					zoomCount: reopened.zoomRanges.length,
				}),
			);
			expect(fingerprintDocument(reopened).value).toBe(confirm.documentFingerprintAfter);

			// Stronger while a fresh product-style pending exists on a clean copy
			const clean = loadDisposableDoc("proj_sb_v1_unseeded_stronger")!;
			const fpS = fingerprintDocument(clean.doc).value;
			setLocalEditorialPendingProposal(clean.doc.project.id, {
				...pending,
				documentFingerprint: fpS,
				status: "PROPOSED",
			});
			const stronger = await applyLocalEditorialControlWithBrain({
				projectId: clean.doc.project.id,
				document: clean.doc,
				userMessage: "yes, but make it stronger",
				chatModelConfig,
				skipVisualAnalysis: true,
				skipIdentity: true,
			});
			writeFileSync(
				join(ART, "unseeded-04-stronger.json"),
				JSON.stringify({
					mutated: stronger.mutated,
					depth: stronger.document.zoomRanges[0]?.depth ?? null,
				}),
			);
			expect(stronger.mutated).toBe(true);
			expect((stronger.document.zoomRanges[0]?.depth ?? 0) >= 4).toBe(true);

			const staleDoc = loadDisposableDoc("proj_sb_v1_unseeded_stale")!;
			setLocalEditorialPendingProposal(staleDoc.doc.project.id, {
				...pending,
				documentFingerprint: "stale-fp",
				status: "PROPOSED",
			});
			const stale = await applyLocalEditorialControlWithBrain({
				projectId: staleDoc.doc.project.id,
				document: staleDoc.doc,
				userMessage: "yes, do it",
				chatModelConfig,
				skipVisualAnalysis: true,
				skipIdentity: true,
			});
			writeFileSync(
				join(ART, "unseeded-05-stale.json"),
				JSON.stringify({
					mutated: stale.mutated,
					userFacingText: stale.userFacingText,
				}),
			);
			expect(stale.mutated).toBe(false);
		}, 300_000);
	},
);

describe("unseeded gate (always)", () => {
	it("records whether unseeded real-provider chain can run", () => {
		mkdirSync(ART, { recursive: true });
		writeFileSync(
			join(ART, "unseeded-gate.json"),
			JSON.stringify({
				runUnseededReal,
				hasApiKey: Boolean(apiKey),
				note: runUnseededReal
					? "enabled"
					: "SKIP — not a pass; set OPENSCREEN_SEMANTIC_REAL_PROVIDER=1 + OPENAI_API_KEY",
			}),
		);
		expect(typeof runUnseededReal).toBe("boolean");
	});
});

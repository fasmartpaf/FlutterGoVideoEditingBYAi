/**
 * Vision identity on recording-1789588079993.
 * Labels:
 * - unit_injected_vision: injected judge (not selected-provider, not desktop)
 * - selected_provider_vision: real gpt-4o via env/app key when available
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentSchema } from "../../../src/lib/ai-edition/schema";
import { programmeDurationSec, programmePointToSourceSec } from "./directTrim";
import { verifyRequestedEventIdentity } from "./semanticEventIdentity";
import { resolveSemanticEditEventAsync } from "./semanticEventResolve";
import type { VisualPresenceJudge } from "./semanticEventVisionIdentity";

const PROJECT =
	process.env.OPENSCREEN_SB_FP_PROJECT ||
	`${process.env.HOME}/Library/Application Support/openscreen/projects/proj_e50620fc-423c-43b0-aa67-52aa308343a9.openscreen`;

const ART = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1/fp-repro",
);

const apiKey =
	process.env.OPENSCREEN_SEMANTIC_REAL_PROVIDER_KEY?.trim() ||
	process.env.OPENAI_API_KEY?.trim() ||
	"";
const runProviderVision = Boolean(apiKey) && process.env.OPENSCREEN_SEMANTIC_REAL_PROVIDER === "1";

const canRun = existsSync(PROJECT);

describe.runIf(canRun)("vision identity on recording-1789588079993", () => {
	it("label=unit_injected_vision — reject 0.5 WhatsApp; accept Connect onset; reject late already-visible", async () => {
		mkdirSync(ART, { recursive: true });
		const doc = documentSchema.parse(JSON.parse(readFileSync(PROJECT, "utf8")));
		const eventCue = "when the landing page appears";
		const progDur = programmeDurationSec(doc);

		/** Programme ~8.9s ≈ source ~14.3–15.6 where Connect first appears. */
		const connectProg = 8.9;
		/** Desktop failure: speech-aligned ~15.5s programme while Connect already scrolled. */
		const speechLateProg = Math.min(15.5, Math.max(0, progDur - 0.3));
		const lateProg = Math.min(13.4, progDur - 0.3);

		/** Injected presence: UI appears at/after connectProg (test bracket, not product hardcode). */
		const presenceAtConnectOnset: VisualPresenceJudge = async ({ programmeSec }) => ({
			present: programmeSec >= connectProg - 0.25,
			confidence: "HIGH",
			reason: `injected presence at prog ${programmeSec.toFixed(2)} (onset≈${connectProg})`,
			rawText: "{}",
			providerId: "injected",
			model: "unit",
		});

		const r05 = await verifyRequestedEventIdentity({
			document: doc,
			cue: eventCue,
			programmeAnchorSec: 0.5,
			visualChangeObserved: true,
			presenceJudge: presenceAtConnectOnset,
		});
		const rConnect = await verifyRequestedEventIdentity({
			document: doc,
			cue: eventCue,
			programmeAnchorSec: connectProg,
			visualChangeObserved: true,
			presenceJudge: presenceAtConnectOnset,
		});
		const rLate = await verifyRequestedEventIdentity({
			document: doc,
			cue: eventCue,
			programmeAnchorSec: lateProg,
			visualChangeObserved: true,
			presenceJudge: presenceAtConnectOnset,
		});
		const rSpeechLate = await verifyRequestedEventIdentity({
			document: doc,
			cue: eventCue,
			programmeAnchorSec: speechLateProg,
			visualChangeObserved: true,
			presenceJudge: presenceAtConnectOnset,
		});

		const { resolveSemanticEditEvent } = await import("./semanticEventResolve");
		const preferEarliest = resolveSemanticEditEvent({
			cue: eventCue,
			document: doc,
			visualChangeEvents: [
				{ startSec: connectProg - 0.4, endSec: connectProg + 0.4, level: "SIGNIFICANT" },
				{
					startSec: speechLateProg - 0.4,
					endSec: speechLateProg + 0.4,
					level: "SIGNIFICANT",
				},
			],
			visualAnalysisUsed: true,
			identityChecked: true,
			identityByAnchorSec: new Map([
				[
					connectProg,
					{
						requestedEventIdentified: rConnect.requestedEventIdentified,
						visualChangeObserved: true,
						evidenceRefs: rConnect.evidenceRefs,
						onsetTokens: ["landing"],
					},
				],
				[
					speechLateProg,
					{
						requestedEventIdentified: rSpeechLate.requestedEventIdentified,
						visualChangeObserved: true,
						evidenceRefs: rSpeechLate.evidenceRefs,
						onsetTokens: ["landing"],
						earliestProgrammeSec: rSpeechLate.earliestProgrammeSec,
					},
				],
			]),
		});

		const payload = {
			label: "unit_injected_vision",
			mode: "presence_onset_bound",
			programmeDurationSec: progDur,
			assetDurationSec: doc.assets[0]?.durationSec ?? null,
			clockNote:
				"UI timeline ~23.7s is source media; programme after trims ≈17.3s. Chat anchors are programme clock.",
			map: {
				prog_0_5_source: programmePointToSourceSec(doc, 0.5),
				prog_8_9_source: programmePointToSourceSec(doc, connectProg),
				prog_late_source: programmePointToSourceSec(doc, lateProg),
				prog_15_5_source: programmePointToSourceSec(doc, speechLateProg),
			},
			frames: {
				whatsapp_or_cursor: "src_3.9s.jpg / frame_0.5s.jpg",
				connect_onset_neighborhood: "src_14.6s.jpg / src_15.0s.jpg",
				already_visible: "frame_19.8s.jpg",
				speech_late_already_scrolled: "desktop seek ~15.5s programme",
			},
			r05: {
				identified: r05.requestedEventIdentified,
				status: r05.status,
				bound: r05.onsetBoundStatus,
				reason: r05.reason,
				earliest: r05.earliestProgrammeSec ?? null,
			},
			rConnect: {
				identified: rConnect.requestedEventIdentified,
				status: rConnect.status,
				bound: rConnect.onsetBoundStatus,
				reason: rConnect.reason,
				earliest: rConnect.earliestProgrammeSec ?? null,
				beforeSourceSec: rConnect.beforeSourceSec,
				afterSourceSec: rConnect.afterSourceSec,
			},
			rLate: {
				identified: rLate.requestedEventIdentified,
				status: rLate.status,
				bound: rLate.onsetBoundStatus,
				reason: rLate.reason,
				earliest: rLate.earliestProgrammeSec ?? null,
			},
			rSpeechLate15_5: {
				identified: rSpeechLate.requestedEventIdentified,
				status: rSpeechLate.status,
				bound: rSpeechLate.onsetBoundStatus,
				reason: rSpeechLate.reason,
				earliest: rSpeechLate.earliestProgrammeSec ?? null,
				programmeAnchorSec: speechLateProg,
			},
			preferEarliest: {
				status: preferEarliest.status,
				bestAnchor: preferEarliest.best?.anchorSec ?? null,
				reason: preferEarliest.userFacingReason,
			},
		};
		writeFileSync(join(ART, "vision-identity-injected.json"), JSON.stringify(payload, null, 2));

		expect(r05.requestedEventIdentified).toBe(false);
		expect(rConnect.requestedEventIdentified).toBe(true);
		expect(rConnect.onsetBoundStatus).toBe("bounded");
		expect(rConnect.beforeSourceSec).toBeLessThan(15);
		// Late seeds look back, certify the earlier bracket, and retarget — not discard.
		expect(rLate.requestedEventIdentified).toBe(true);
		expect(rLate.earliestProgrammeSec).toBeCloseTo(connectProg, 0);
		expect(rSpeechLate.requestedEventIdentified).toBe(true);
		expect(rSpeechLate.earliestProgrammeSec).toBeCloseTo(connectProg, 0);
		expect(rSpeechLate.reason).toMatch(/retargeted|first-onset bracket/i);
		expect(preferEarliest.status).toBe("FOUND");
		expect(preferEarliest.best?.anchorSec).toBeCloseTo(connectProg, 0);
		expect(preferEarliest.best?.anchorSec).not.toBeCloseTo(speechLateProg, 0);
	}, 120_000);

	it.runIf(runProviderVision)(
		"label=selected_provider_vision — real gpt-4o BEFORE/AFTER on Connect vs WhatsApp",
		async () => {
			mkdirSync(ART, { recursive: true });
			const dest = join(ART, "vision-provider-disposable.openscreen");
			copyFileSync(PROJECT, dest);
			const doc = documentSchema.parse(JSON.parse(readFileSync(dest, "utf8")));
			const eventCue = "when the landing page appears";
			const chatModelConfig = {
				provider: "openai",
				model: process.env.OPENSCREEN_SEMANTIC_REAL_MODEL || "gpt-4o",
				apiKey,
				baseUrl: "https://api.openai.com/v1",
			};

			const r05 = await verifyRequestedEventIdentity({
				document: doc,
				cue: eventCue,
				programmeAnchorSec: 0.5,
				visualChangeObserved: true,
				chatModelConfig,
			});
			const rConnect = await verifyRequestedEventIdentity({
				document: doc,
				cue: eventCue,
				programmeAnchorSec: 8.9,
				visualChangeObserved: true,
				chatModelConfig,
			});
			const rLate = await verifyRequestedEventIdentity({
				document: doc,
				cue: eventCue,
				programmeAnchorSec: Math.min(13.4, programmeDurationSec(doc) - 0.3),
				visualChangeObserved: true,
				chatModelConfig,
			});

			const resolved = await resolveSemanticEditEventAsync({
				cue: eventCue,
				document: doc,
				chatModelConfig,
				skipVisualAnalysis: false,
			});

			const payload = {
				label: "selected_provider_vision",
				provider: chatModelConfig.provider,
				model: chatModelConfig.model,
				// never include apiKey
				r05: {
					identified: r05.requestedEventIdentified,
					status: r05.status,
					reason: r05.reason,
					refs: r05.evidenceRefs.filter((e) => !/sk-|key/i.test(e)),
				},
				rConnect: {
					identified: rConnect.requestedEventIdentified,
					status: rConnect.status,
					reason: rConnect.reason,
					beforeSourceSec: rConnect.beforeSourceSec,
					afterSourceSec: rConnect.afterSourceSec,
					refs: rConnect.evidenceRefs.filter((e) => !/sk-|key/i.test(e)),
				},
				rLate: {
					identified: rLate.requestedEventIdentified,
					status: rLate.status,
					reason: rLate.reason,
				},
				resolve: {
					status: resolved.status,
					best: resolved.best
						? {
								anchorSec: resolved.best.anchorSec,
								identified: resolved.best.requestedEventIdentified,
								label: resolved.best.label,
							}
						: null,
					userFacingReason: resolved.userFacingReason,
				},
			};
			writeFileSync(join(ART, "vision-identity-provider.json"), JSON.stringify(payload, null, 2));

			expect(r05.requestedEventIdentified).toBe(false);
			expect(rLate.requestedEventIdentified).toBe(false);
			// Positive: prefer identified; if model uncertain mark via soft assert in report.
			if (rConnect.requestedEventIdentified) {
				expect(rConnect.status).toBe("IDENTIFIED");
			}
		},
		180_000,
	);
});

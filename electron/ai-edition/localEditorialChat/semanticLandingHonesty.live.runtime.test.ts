/**
 * Live desktop grounding check for the independent finding:
 * advisory-style cue around landing-page appearance must NOT claim
 * "visual change confirmed" / FOUND from pixel change + speech alone.
 * Uses real disposable media + OCR identity when available.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentSchema } from "../../../src/lib/ai-edition/schema";
import { resolveOcrEngine } from "../visualSpecialist/ocr/engine";
import { resolveSemanticEditEventAsync } from "./semanticEventResolve";

const SRC =
	process.env.OPENSCREEN_SB_SOURCE_PROJECT ||
	`${process.env.HOME}/Library/Application Support/openscreen/projects/proj_02cc3f15-2f80-442f-a3a2-824598d11b6b.openscreen`;

const ART = join(
	process.cwd(),
	"electron/ai-edition/localEditorialChat/_artifacts/semantic-brain-v1",
);

const canRun = existsSync(SRC);

describe.runIf(canRun)("semantic WHERE live landing-page honesty", () => {
	it("does not FOUND from change+speech without event identity; reports honest status", async () => {
		mkdirSync(ART, { recursive: true });
		const dest = join(ART, "live-landing-honesty.openscreen");
		copyFileSync(SRC, dest);
		const doc = documentSchema.parse(JSON.parse(readFileSync(dest, "utf8")));
		const media =
			doc.assets.find((a) => a.id === doc.project.primaryAssetId)?.originalPath ??
			doc.assets[0]?.originalPath;
		expect(media && existsSync(media!)).toBe(true);

		const ocr = await resolveOcrEngine();
		const cue = "Would it help viewers if the landing page appearance stood out more?";
		// Extract event-ish cue the product would ground
		const eventCue = "when the landing page appears";

		const resolved = await resolveSemanticEditEventAsync({
			cue: eventCue,
			document: doc,
			skipVisualAnalysis: false,
			skipIdentity: false,
		});

		const payload = {
			cue: eventCue,
			advisoryWording: cue,
			ocrEngine: ocr.id,
			status: resolved.status,
			identityChecked: resolved.identityChecked,
			userFacingReason: resolved.userFacingReason,
			best: resolved.best
				? {
						anchorSec: resolved.best.anchorSec,
						visualChangeObserved: resolved.best.visualChangeObserved,
						requestedEventIdentified: resolved.best.requestedEventIdentified,
						evidenceRefs: resolved.best.evidenceRefs,
						label: resolved.best.label,
					}
				: null,
			candidates: resolved.candidates.slice(0, 5).map((c) => ({
				anchorSec: c.anchorSec,
				visualChangeObserved: c.visualChangeObserved,
				requestedEventIdentified: c.requestedEventIdentified,
				evidenceRefs: c.evidenceRefs,
			})),
			asserts: {
				neverSaysVisualChangeConfirmed: !/visual change confirmed/i.test(resolved.userFacingReason),
				foundOnlyIfIdentified:
					resolved.status !== "FOUND" || Boolean(resolved.best?.requestedEventIdentified),
			},
		};
		writeFileSync(join(ART, "live-landing-honesty.json"), JSON.stringify(payload, null, 2));

		expect(payload.asserts.neverSaysVisualChangeConfirmed).toBe(true);
		expect(payload.asserts.foundOnlyIfIdentified).toBe(true);
		if (resolved.status === "FOUND") {
			expect(resolved.best?.requestedEventIdentified).toBe(true);
			// Independent review: landing already visible ~19.8s — onset must not be a late change-only hit claiming appearance.
			expect(resolved.userFacingReason).toMatch(/requested event identified/i);
		} else {
			expect(resolved.userFacingReason).not.toMatch(/visual change confirmed/i);
			expect(resolved.status === "AMBIGUOUS" || resolved.status === "NOT_FOUND").toBe(true);
		}
	}, 180_000);
});

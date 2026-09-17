/**
 * Title quality — professional derivation, not transcript paste.
 */

import { describe, expect, it } from "vitest";
import type {
	PackedEditorialTranscriptV1,
	ProfessionalEditStoryV1,
} from "../professionalEditOrchestrator/types";
import { generateTitleOpportunities, resetPlannerOpportunitySeqForTests } from "./opportunities";
import {
	deriveProfessionalTitleText,
	looksLikeConversationalFiller,
	looksLikeMetadataOrEvidenceTitle,
	looksLikeTutorialIntroduction,
	shouldProposeOpeningTitle,
} from "./titleQuality";

describe("titleQuality V1", () => {
	it("rejects conversational openings as titles", () => {
		expect(looksLikeConversationalFiller("This is a cursor I am working with")).toBe(true);
		expect(
			deriveProfessionalTitleText({
				rawSpeech: "This is a cursor I am working with",
			}),
		).toBeNull();
	});

	it("rejects metadata / evidence-quality titles", () => {
		expect(looksLikeMetadataOrEvidenceTitle("Screen Recording with Limited Labeled Speech")).toBe(
			true,
		);
		expect(
			deriveProfessionalTitleText({
				rawSpeech: "um",
				storyCommunicates: "Screen recording with limited labeled speech in this pass.",
				preferStory: true,
			}),
		).toBeNull();
		expect(
			deriveProfessionalTitleText({
				rawSpeech: "Our Cursor Cursor and This Is Our Project",
			}),
		).toBeNull();
		expect(
			deriveProfessionalTitleText({
				rawSpeech: "I think you can see the button here",
			}),
		).toBeNull();
	});

	it("derives a concise title from a tutorial introduction", () => {
		const title = deriveProfessionalTitleText({
			rawSpeech: "So um creating a new project in the settings panel",
			storyCommunicates: "Creating a new project in settings",
			preferStory: true,
		});
		expect(title).toBeTruthy();
		expect(title!.split(/\s+/).length).toBeGreaterThanOrEqual(2);
		expect(title!.split(/\s+/).length).toBeLessThanOrEqual(8);
		expect(looksLikeConversationalFiller(title!)).toBe(false);
		expect(looksLikeTutorialIntroduction("Creating a new project")).toBe(true);
	});

	it("keeps title absent when meaning cannot be summarized", () => {
		expect(
			deriveProfessionalTitleText({
				rawSpeech: "Um okay yeah",
			}),
		).toBeNull();
		const gate = shouldProposeOpeningTitle({
			wantProfessional: true,
			sourceDurationSec: 30,
			existingNonCaptionAnnotations: 0,
			derivedTitle: null,
		});
		expect(gate.ok).toBe(false);
		expect(gate.reason).toBe("no_safe_title_meaning");
	});

	it("skips when a title is already present", () => {
		const gate = shouldProposeOpeningTitle({
			wantProfessional: true,
			sourceDurationSec: 30,
			existingNonCaptionAnnotations: 1,
			derivedTitle: "Create New Project",
		});
		expect(gate.ok).toBe(false);
		expect(gate.reason).toBe("title_already_present");
	});

	it("skips opening title on short clips where it wastes time", () => {
		const gate = shouldProposeOpeningTitle({
			wantProfessional: true,
			sourceDurationSec: 10,
			existingNonCaptionAnnotations: 0,
			derivedTitle: "Create New Project",
		});
		expect(gate.ok).toBe(false);
		expect(gate.reason).toBe("clip_too_short");
	});

	it("generateTitleOpportunities stays KEEP for conversational filler", () => {
		resetPlannerOpportunitySeqForTests();
		const packed: PackedEditorialTranscriptV1 = {
			version: 1,
			assetId: "a1",
			sourceDurationSec: 28,
			buildMs: 1,
			segments: [
				{
					id: "s1",
					startSec: 0.2,
					endSec: 3,
					speechText: "This is a cursor I am working with",
					visualSummary: "desktop",
					activity: "low",
					deadAirSec: 0,
					preservation: "important",
					evidenceRefs: [],
				},
			],
		};
		const story: ProfessionalEditStoryV1 = {
			version: 1,
			communicates: "This is a cursor I am working with",
			mustSurviveSpeech: [],
			expendablePauses: [],
			majorVisualStates: [],
			targetDurationSec: null,
			essentialRanges: [],
			optionalRanges: [],
			uncertainRanges: [],
			structureHint: "tighten",
		};
		const ops = generateTitleOpportunities({
			story,
			packed,
			wantProfessional: true,
			existingAnnotationCount: 0,
		});
		expect(ops[0]?.executionReadiness).toBe("NOT_READY");
		expect(ops[0]?.generationStatus).not.toBe("GROUNDED_READY");
	});
});

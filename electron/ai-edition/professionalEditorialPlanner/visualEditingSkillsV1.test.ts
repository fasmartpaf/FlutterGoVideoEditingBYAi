/**
 * High-impact visual editing V1 — unit coverage for zoom lifecycle, title/callout plan bridge,
 * graphic verify metadata, collision helpers.
 */

import { describe, expect, it } from "vitest";
import { VERIFIED_APPLY_TOOLS } from "../applyPreview/familyPreflight";
import { buildEditingSkillRegistryV1 } from "../autonomousProfessionalEditor/skillRegistry";
import { recordCollision, zoomCalloutCompatible } from "../professionalEditOrchestrator/collision";
import {
	buildProfessionalZoomIntent,
	expandZoomRangeForLifecycle,
} from "../professionalEditOrchestrator/professionalZoom";
import type {
	PackedEditorialTranscriptV1,
	ProfessionalEditStoryV1,
} from "../professionalEditOrchestrator/types";
import {
	generateCalloutOpportunities,
	generateTitleOpportunities,
	generateTransitionOpportunities,
	resetPlannerOpportunitySeqForTests,
} from "./opportunities";
import { opportunitiesToPlanSteps } from "./planBridge";

function packed(): PackedEditorialTranscriptV1 {
	return {
		version: 1,
		assetId: "a1",
		sourceDurationSec: 30,
		buildMs: 1,
		segments: [
			{
				id: "s1",
				startSec: 0.2,
				endSec: 3.5,
				speechText: "Creating a new project in the settings panel",
				visualSummary: "desktop",
				activity: "medium",
				deadAirSec: 0,
				preservation: "important",
				evidenceRefs: ["speech:s1"],
			},
			{
				id: "s2",
				startSec: 8,
				endSec: 10,
				speechText: "Click save",
				visualSummary: "button",
				activity: "high",
				deadAirSec: 0,
				preservation: "important",
				evidenceRefs: ["speech:s2"],
			},
		],
	};
}

function story(): ProfessionalEditStoryV1 {
	return {
		version: 1,
		communicates: "Creating a new project in the settings panel",
		mustSurviveSpeech: ["Creating a new project"],
		expendablePauses: [],
		majorVisualStates: [],
		targetDurationSec: null,
		essentialRanges: [{ startSec: 0.2, endSec: 3.5, reason: "intro" }],
		optionalRanges: [],
		uncertainRanges: [],
		structureHint: "tighten",
	};
}

describe("VISUAL_EDITING_SKILLS_V1 units", () => {
	it("ProfessionalZoomIntent expands enter→hold→exit", () => {
		const life = expandZoomRangeForLifecycle({
			sourceStartSec: 5,
			sourceEndSec: 5.4,
			assetDurationSec: 40,
		});
		expect(life.endSec - life.startSec).toBeGreaterThan(1.5);
		expect(life.holdDurationSec).toBeGreaterThan(0.5);
		const intent = buildProfessionalZoomIntent({
			sourceStartSec: 5,
			sourceEndSec: 5.4,
			assetDurationSec: 40,
			focus: { cx: 0.4, cy: 0.5 },
			depth: 2,
			scale: 1.5,
			evidenceRefs: ["focal:1"],
		});
		expect(intent.version).toBe(1);
		expect(intent.focusRegion.cx).toBe(0.4);
		expect(
			intent.enterDurationSec + intent.holdDurationSec + intent.exitDurationSec,
		).toBeGreaterThan(1);
	});

	it("title opportunity grounds from speech without inventing product claims", () => {
		resetPlannerOpportunitySeqForTests();
		const ops = generateTitleOpportunities({
			story: story(),
			packed: packed(),
			wantProfessional: true,
			existingAnnotationCount: 0,
		});
		expect(ops[0]?.generationStatus).toBe("GROUNDED_READY");
		expect(String(ops[0]?.derivedParameters.text)).toMatch(/Creating|project/i);
	});

	it("callout requires grounded focal click/dwell", () => {
		resetPlannerOpportunitySeqForTests();
		const none = generateCalloutOpportunities({ focal: null, packed: packed() });
		expect(none[0]?.generationStatus).toBe("INSUFFICIENT_EVIDENCE");
	});

	it("planBridge emits title + professional zoom lifecycle args", () => {
		resetPlannerOpportunitySeqForTests();
		const title = generateTitleOpportunities({
			story: story(),
			packed: packed(),
			wantProfessional: true,
			existingAnnotationCount: 0,
		});
		const zoomOpp = {
			id: "peo_zoom_x",
			family: "ZOOM" as const,
			editorialReason: "test",
			evidenceRefs: ["f1"],
			confidence: "HIGH" as const,
			preservationStatus: "SAFE" as const,
			generationStatus: "GROUNDED_READY" as const,
			requiredParameters: [],
			derivedParameters: {
				depth: 2,
				focus: { cx: 0.42, cy: 0.55 },
				sourceStartSec: 8,
				sourceEndSec: 8.5,
				scale: 1.5,
			},
			executionReadiness: "READY" as const,
			rankScore: 9,
		};
		const steps = opportunitiesToPlanSteps(
			[...title.filter((t) => t.executionReadiness === "READY"), zoomOpp],
			0,
			30,
		);
		expect(steps.some((s) => s.family === "title" && s.operationType === "addGraphic")).toBe(true);
		const z = steps.find((s) => s.family === "zoom");
		expect(z).toBeTruthy();
		expect(z!.operationArgs.professionalZoomIntent).toBeTruthy();
		expect(Number(z!.sourceEndSec) - Number(z!.sourceStartSec)).toBeGreaterThan(1.2);
	});

	it("addGraphic and setClipIncomingTransition are on verified apply allowlist", () => {
		expect(VERIFIED_APPLY_TOOLS.has("addGraphic")).toBe(true);
		expect(VERIFIED_APPLY_TOOLS.has("setClipIncomingTransition")).toBe(true);
	});

	it("skill registry marks titles/callouts and transitions full autonomous", () => {
		const reg = buildEditingSkillRegistryV1();
		const titles = reg.find((s) => s.skill === "TITLES_CALLOUTS");
		expect(titles?.classification).toBe("FULL_AUTONOMOUS_PATH");
		const tr = reg.find((s) => s.skill === "TRANSITIONS");
		expect(tr?.classification).toBe("FULL_AUTONOMOUS_PATH");
		expect(tr?.executionReady).toBe(true);
	});

	it("transition opportunities stay NOT_READY without multi-clip dissolve intent", () => {
		resetPlannerOpportunitySeqForTests();
		const single = generateTransitionOpportunities({
			clipCount: 1,
			secondClipId: null,
			wantDissolve: true,
		});
		expect(single[0]?.executionReadiness).toBe("NOT_READY");
		const cutPrefer = generateTransitionOpportunities({
			clipCount: 2,
			secondClipId: "c2",
			wantDissolve: false,
		});
		expect(cutPrefer[0]?.generationStatus).toBe("GROUNDED_NOT_USEFUL");
		const dissolve = generateTransitionOpportunities({
			clipCount: 2,
			secondClipId: "c2",
			wantDissolve: true,
		});
		expect(dissolve[0]?.generationStatus).toBe("GROUNDED_READY");
		expect(dissolve[0]?.derivedParameters.kind).toBe("dissolve");
	});

	it("collision helper allows nearby zoom+callout", () => {
		expect(
			zoomCalloutCompatible({
				zoomFocus: { cx: 0.4, cy: 0.5 },
				calloutXY: { x: 38, y: 48 },
			}).ok,
		).toBe(true);
		expect(
			zoomCalloutCompatible({
				zoomFocus: { cx: 0.1, cy: 0.1 },
				calloutXY: { x: 90, y: 90 },
			}).ok,
		).toBe(false);
		expect(
			recordCollision({ stepId: "s1", family: "speed", disposition: "REMAPPED", reason: "trim" })
				.disposition,
		).toBe("REMAPPED");
	});
});

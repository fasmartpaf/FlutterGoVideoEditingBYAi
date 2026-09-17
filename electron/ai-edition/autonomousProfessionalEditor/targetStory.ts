/**
 * Target edit story — desired finished sequence grounded in source beats.
 */

import type { ProfessionalEditIntentV1 } from "../professionalEditOrchestrator/types";
import { buildEditingSkillRegistryV1 } from "./skillRegistry";
import {
	AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID,
	type EditorialIntentKindV1,
	type MultimodalSourceStoryV1,
	type TargetEditStoryBeatV1,
	type TargetEditStoryV1,
} from "./types";

export function buildTargetEditStory(args: {
	source: MultimodalSourceStoryV1;
	intent: ProfessionalEditIntentV1;
}): TargetEditStoryV1 {
	const t0 = Date.now();
	const registry = buildEditingSkillRegistryV1();
	const unsupportedDesired: TargetEditStoryV1["unsupportedDesiredSkills"] = [];

	const beats: TargetEditStoryBeatV1[] = args.source.beats.map((b, idx) => {
		const skillHints: EditorialIntentKindV1[] = [];
		let pacing: TargetEditStoryBeatV1["pacingIntent"] = "NORMAL";
		let attention: TargetEditStoryBeatV1["attentionIntent"] = "KEEP_FRAME";
		const visualTreatment: TargetEditStoryBeatV1["visualTreatment"] = {
			framing: "normal",
			title: "NO_TITLE",
			callout: "NONE",
			transition: "CUT",
			speedMultiplier: 1,
		};

		if (b.preservationStatus === "SAFE_TO_TIGHTEN" || b.kind === "WAITING_REPETITION") {
			pacing = b.informationDensity === "LOW" ? "ACCELERATE" : "COMPRESS";
			if (pacing === "COMPRESS") skillHints.push("REMOVE_DEAD_TIME", "TIGHTEN_SECTION");
			if (pacing === "ACCELERATE") {
				skillHints.push("ACCELERATE_LOW_INFORMATION_SECTION");
				visualTreatment.speedMultiplier = 1.5;
			}
		}
		if (b.kind === "ACTION_DEMONSTRATION" || b.focalEvidenceRefs.length > 0) {
			attention = "EMPHASIZE_FOCAL";
			skillHints.push("EMPHASIZE_TARGET");
			skillHints.push("ADD_CALLOUT");
			pacing = pacing === "ACCELERATE" ? "NORMAL" : "EMPHASIZE";
			visualTreatment.framing = "zoom_enter_hold_exit";
			visualTreatment.callout = "OPTIONAL";
			visualTreatment.speedMultiplier = 1;
		}
		if (b.kind === "EXPLANATION" || b.preservationStatus === "MUST_SURVIVE") {
			skillHints.push("KEEP_SECTION", "PRESERVE_CONTENT");
			pacing = "NORMAL";
			visualTreatment.speedMultiplier = 1;
		}
		if (b.kind === "RESULT_REVEAL") {
			attention = "KEEP_FRAME";
			pacing = "EMPHASIZE";
			visualTreatment.framing = "restore";
			visualTreatment.transition = "CUT";
		}
		// Section / context change across beats → optional dissolve (CUT remains default).
		// Continuous same-kind action/explanation stays CUT — never dissolve for quota.
		if (idx > 0) {
			const prev = args.source.beats[idx - 1]!;
			const sectionChange =
				prev.kind !== b.kind &&
				!(
					(prev.kind === "EXPLANATION" && b.kind === "EXPLANATION") ||
					(prev.kind === "ACTION_DEMONSTRATION" && b.kind === "ACTION_DEMONSTRATION") ||
					(prev.kind === "WAITING_REPETITION" && b.kind === "WAITING_REPETITION")
				);
			const chapterLike =
				(prev.kind === "OPENING_SETUP" && b.kind !== "OPENING_SETUP") ||
				(prev.kind === "EXPLANATION" && b.kind === "ACTION_DEMONSTRATION") ||
				(prev.kind === "ACTION_DEMONSTRATION" && b.kind === "RESULT_REVEAL") ||
				(prev.kind === "OPENING_SETUP" && b.kind === "ACTION_DEMONSTRATION");
			if (sectionChange && chapterLike) {
				visualTreatment.transition = "DISSOLVE";
				skillHints.push("ADD_TRANSITION");
			}
		}
		if (
			idx === 0 &&
			(b.kind === "OPENING_SETUP" || b.kind === "EXPLANATION" || b.speechSummary.trim().length > 8)
		) {
			visualTreatment.title = "OPENING_TITLE";
			skillHints.push("ADD_TITLE");
		}

		return {
			id: `teb_${b.id}`,
			sourceBeatIds: [b.id],
			purpose: b.kind,
			viewerShouldUnderstand: b.speechSummary,
			pacingIntent: pacing,
			attentionIntent: attention,
			visualTreatment,
			skillHints: [...new Set(skillHints)],
			preserve: b.preservationStatus === "MUST_SURVIVE",
			confidence: b.confidence,
		};
	});

	const globalSkills: EditorialIntentKindV1[] = [];
	if (args.intent.wantCaptions === true || args.intent.wantCaptions === "auto") {
		globalSkills.push("ADD_CAPTIONS");
	}
	if (args.intent.wantAudioImprove === true || args.intent.wantAudioImprove === "auto") {
		globalSkills.push("BALANCE_AUDIO");
	}
	if (args.intent.requestedOutcome === "MAKE_PROFESSIONAL") {
		if (
			!globalSkills.includes("ADD_TITLE") &&
			beats.some((b) => b.visualTreatment.title !== "NO_TITLE")
		) {
			globalSkills.push("ADD_TITLE");
		}
		if (
			!globalSkills.includes("ADD_TRANSITION") &&
			beats.some((b) => b.visualTreatment.transition === "DISSOLVE")
		) {
			globalSkills.push("ADD_TRANSITION");
		}
	}

	// Desired professional skills that may be unsupported — report as product gaps
	for (const desired of ["IMPROVE_COLOR", "AUDIO_CLEANUP"] as const) {
		const skill = registry.find((s) => s.intentKinds.includes(desired));
		if (!skill || !skill.supported || skill.classification === "MISSING") {
			unsupportedDesired.push({
				skill: desired,
				reason: skill?.notes ?? skill?.classification ?? "not_supported",
			});
		} else if (skill.classification === "EXECUTION_ONLY") {
			unsupportedDesired.push({
				skill: desired,
				reason: "execution_exists_but_no_autonomous_generation",
			});
		}
	}

	return {
		version: 1,
		providerId: AUTONOMOUS_PROFESSIONAL_EDITOR_V1_ID,
		assetId: args.source.assetId,
		viewerGoal:
			args.intent.requestedOutcome === "MAKE_TIGHTER"
				? "A tighter, clearer screen tutorial without losing meaning."
				: "A professional, clear screen tutorial that respects important content.",
		desiredArc: beats.map((b) => b.purpose).join(" → "),
		beats,
		globalSkills,
		unsupportedDesiredSkills: unsupportedDesired,
		metrics: { buildMs: Date.now() - t0, paidAiCalls: 0 },
	};
}

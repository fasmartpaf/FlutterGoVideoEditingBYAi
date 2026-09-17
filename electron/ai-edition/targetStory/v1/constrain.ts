/**
 * Sanitize legacy TargetStory JSON against Target Story V1 constraints.
 */

import type { TargetStory, TargetStoryBeat } from "../types";
import {
	assertsForbiddenPanelOpenGoal,
	assertsForbiddenRestartActionGoal,
	assertsForbiddenSettingsCompleted,
	assertsForbiddenUpworkWorkflow,
	leaksToolInstructions,
	sanitizeTargetProse,
} from "./guards";
import type { TargetStoryQualityRubric, TargetStoryV1 } from "./types";

export function constrainTargetStoryWithV1(
	story: TargetStory,
	targetV1: TargetStoryV1,
): { story: TargetStory; warnings: string[]; rubric: TargetStoryQualityRubric } {
	const warnings: string[] = [];
	const notes: string[] = [];

	const allowedSourceIds = new Set(targetV1.provenance.sourceBeatIds);
	// Also allow V1-compatible ids derived from sourceStoryFromV2 (sb*)
	for (const b of targetV1.targetBeats) {
		for (const id of b.sourceBeatIds) allowedSourceIds.add(id);
	}

	const beats: TargetStoryBeat[] = story.targetBeats.map((b) => {
		const raw = `${b.desiredOutcome} ${b.rationale}`;
		let desiredOutcome = b.desiredOutcome;
		let rationale = b.rationale;
		const sourceBeatIds = b.sourceBeatIds.filter((id) => allowedSourceIds.has(id));
		if (sourceBeatIds.length !== b.sourceBeatIds.length) {
			warnings.push("dropped unknown sourceBeatIds");
		}
		if (!sourceBeatIds.length && targetV1.targetBeats[0]) {
			sourceBeatIds.push(...targetV1.targetBeats[0]!.sourceBeatIds);
			warnings.push("repaired orphan target beat with first mapped source beat");
		}

		if (assertsForbiddenUpworkWorkflow(raw)) {
			warnings.push("stripped Upwork workflow goal");
			desiredOutcome = sanitizeTargetProse(desiredOutcome);
			rationale = sanitizeTargetProse(rationale);
		}
		if (assertsForbiddenRestartActionGoal(raw)) {
			warnings.push("stripped restart-action goal");
			desiredOutcome = sanitizeTargetProse(desiredOutcome);
		}
		if (assertsForbiddenSettingsCompleted(raw)) {
			warnings.push("stripped Settings-completed goal");
			desiredOutcome = sanitizeTargetProse(desiredOutcome);
		}
		if (assertsForbiddenPanelOpenGoal(raw)) {
			warnings.push("stripped unverified panel-open goal");
			desiredOutcome = sanitizeTargetProse(desiredOutcome);
		}
		if (leaksToolInstructions(raw)) {
			warnings.push("stripped tool/timestamp leakage");
			desiredOutcome = sanitizeTargetProse(desiredOutcome);
			rationale = sanitizeTargetProse(rationale);
		}

		desiredOutcome = sanitizeTargetProse(desiredOutcome);
		rationale = sanitizeTargetProse(rationale);

		return {
			...b,
			sourceBeatIds,
			desiredOutcome,
			rationale,
		};
	});

	let objective = sanitizeTargetProse(story.objective);
	let audienceExperience = sanitizeTargetProse(story.audienceExperience);
	if (leaksToolInstructions(objective) || leaksToolInstructions(audienceExperience)) {
		warnings.push("sanitized objective/audience tool leakage");
		objective = sanitizeTargetProse(objective);
		audienceExperience = sanitizeTargetProse(audienceExperience);
	}

	const change = story.change.map((c) => ({
		...c,
		description: sanitizeTargetProse(c.description),
		rationale: c.rationale ? sanitizeTargetProse(c.rationale) : c.rationale,
	}));

	const uncertainties = [
		...(story.uncertainties ?? []),
		...targetV1.unresolved.slice(0, 8).map((u) => ({
			note: `[V1 ${u.kind}] ${u.text}`,
			relatedSourceBeatIds: u.sourceBeatIds,
		})),
		...targetV1.unsupportedRequests.map((u) => ({
			note: `[requested_but_not_source_supported] ${u.note}`,
		})),
	];

	const constrained: TargetStory = {
		...story,
		objective,
		audienceExperience,
		targetBeats: beats,
		change,
		uncertainties,
	};

	const blob = JSON.stringify(constrained);
	const rubric: TargetStoryQualityRubric = {
		factualGrounding:
			!assertsForbiddenUpworkWorkflow(blob) && !assertsForbiddenRestartActionGoal(blob),
		faithfulToUserIntent: true,
		communicationClarity: constrained.targetBeats.length > 0,
		pacingCoherence: Boolean(constrained.style?.pacing),
		sourcePreservation: constrained.preserve.length > 0 || targetV1.preserve.length > 0,
		contradictionHandling: targetV1.unresolved.some((u) => u.kind === "contradiction")
			? /avoid|not confirm|contradict|unsupported/i.test(blob)
			: true,
		uncertaintyHandling:
			(constrained.uncertainties?.length ?? 0) > 0 || targetV1.unresolved.length === 0,
		noInventedSourceEvents:
			!assertsForbiddenPanelOpenGoal(blob) && !assertsForbiddenSettingsCompleted(blob),
		noToolLeakage: !leaksToolInstructions(blob),
		notes,
	};
	if (warnings.length) notes.push(...warnings);

	return { story: constrained, warnings, rubric };
}

/** Derive legacy TargetStory from deterministic V1 when model JSON is absent. */
export function targetStoryFromV1(v1: TargetStoryV1): TargetStory {
	return {
		objective: v1.viewerGoal,
		audienceExperience: `${v1.desiredArc} ${v1.emphasisIntent}`.trim(),
		style: {
			pacing: v1.pacingIntent,
			density: v1.objectiveKind === "shorten" ? "minimal" : "balanced",
			tone: v1.objectiveKind === "polish" ? "professional" : undefined,
		},
		editingIntent: v1.editingIntent,
		targetBeats: v1.targetBeats.map((b, i) => ({
			id: `t${i + 1}`,
			sourceBeatIds: b.sourceBeatIds,
			purpose: b.purpose,
			desiredOutcome: b.viewerShouldUnderstand,
			importance:
				b.disposition === "preserve"
					? "essential"
					: b.disposition === "de_emphasize"
						? "supporting"
						: "optional",
			pacing: b.pacingIntent,
			changeNeeded: b.disposition !== "preserve",
			rationale: b.clarityIntent,
		})),
		preserve: v1.preserve.map((p) => ({ id: p.id, description: p.text })),
		change: [
			...v1.deEmphasize.slice(0, 8).map((d) => ({
				id: d.id,
				description: `De-emphasize: ${d.text}`,
				rationale: d.reason,
			})),
			...v1.removeCandidates.slice(0, 8).map((r) => ({
				id: r.id,
				description: `Remove candidate (not a trim command): ${r.text}`,
				rationale: r.reason,
			})),
		],
		uncertainties: [
			...v1.unresolved.map((u) => ({
				note: u.text,
				relatedSourceBeatIds: u.sourceBeatIds,
			})),
			...v1.unsupportedRequests.map((u) => ({
				note: `[requested_but_not_source_supported] ${u.note}`,
			})),
		],
	};
}

export function evaluateTargetStoryRubric(
	story: TargetStory,
	v1: TargetStoryV1,
): TargetStoryQualityRubric {
	return constrainTargetStoryWithV1(story, v1).rubric;
}

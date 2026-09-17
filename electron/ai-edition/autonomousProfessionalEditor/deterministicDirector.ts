/**
 * Deterministic Editorial Director — default V1 (0 paid AI).
 * Emits editorial intents only; never invents geometry or transcript text.
 */

import type { EditorialDirectorRequestV1, EditorialReasoningProvider } from "./provider";
import { executableSkills } from "./skillRegistry";
import {
	EDITORIAL_DIRECTOR_V1_ID,
	type EditorialIntentItemV1,
	type EditorialIntentPlanV1,
} from "./types";

let seq = 0;
export function resetDirectorSeqForTests(): void {
	seq = 0;
}
function iid(kind: string): string {
	seq += 1;
	return `edi_${kind}_${seq}`;
}

export function createDeterministicEditorialDirector(): EditorialReasoningProvider {
	return {
		id: "deterministic-editorial-director-v1",
		kind: "DETERMINISTIC",
		async direct(request: EditorialDirectorRequestV1): Promise<EditorialIntentPlanV1> {
			const t0 = Date.now();
			const exec = new Set(executableSkills(request.skillRegistry).map((s) => s.skill));
			const intents: EditorialIntentItemV1[] = [];
			const rejected: EditorialIntentPlanV1["rejectedSkills"] = [];

			for (const gap of request.targetStory.unsupportedDesiredSkills) {
				rejected.push({ skill: gap.skill, reason: gap.reason });
			}

			for (const beat of request.targetStory.beats) {
				const sourceBeat = request.sourceStory.beats.find((b) => beat.sourceBeatIds.includes(b.id));
				const range = sourceBeat?.sourceRange;

				for (const hint of beat.skillHints) {
					if (hint === "KEEP_SECTION" || hint === "PRESERVE_CONTENT") {
						intents.push({
							id: iid("keep"),
							kind: hint,
							beatId: beat.id,
							sourceRange: range,
							rationale: "Preserve important narration/content in this beat",
							evidenceRefs: sourceBeat?.evidenceRefs ?? [],
							priority: 1,
							requestedSkill: "PRESERVE",
						});
						continue;
					}
					if (hint === "REMOVE_DEAD_TIME" || hint === "TIGHTEN_SECTION") {
						if (!exec.has("TRIM")) {
							rejected.push({ skill: hint, reason: "trim_not_executable" });
							continue;
						}
						intents.push({
							id: iid("trim"),
							kind: hint,
							beatId: beat.id,
							sourceRange: range,
							rationale: "Tighten low-value time in this beat if dead-air allows",
							evidenceRefs: sourceBeat?.evidenceRefs ?? [],
							priority: 8,
							requestedSkill: "TRIM",
						});
					}
					if (hint === "ACCELERATE_LOW_INFORMATION_SECTION") {
						if (!exec.has("SPEED_UP")) {
							rejected.push({ skill: hint, reason: "speed_not_executable" });
							continue;
						}
						intents.push({
							id: iid("speed"),
							kind: hint,
							beatId: beat.id,
							sourceRange: range,
							rationale: "Accelerate low-information span if grounding allows",
							evidenceRefs: sourceBeat?.evidenceRefs ?? [],
							priority: 7,
							requestedSkill: "SPEED_UP",
						});
					}
					if (hint === "EMPHASIZE_TARGET") {
						if (!exec.has("ZOOM")) {
							rejected.push({ skill: hint, reason: "zoom_not_executable" });
							continue;
						}
						intents.push({
							id: iid("zoom"),
							kind: hint,
							beatId: beat.id,
							sourceRange: range,
							rationale: "Emphasize grounded focal target if editorially useful",
							evidenceRefs: [
								...(sourceBeat?.focalEvidenceRefs ?? []),
								...(sourceBeat?.evidenceRefs ?? []),
							],
							priority: 9,
							requestedSkill: "ZOOM",
						});
					}
					if (hint === "SLOW_IMPORTANT_ACTION") {
						rejected.push({
							skill: hint,
							reason: "slow_motion_execution_only_no_autonomous_generation",
						});
					}
					if (hint === "REFRAME_SCENE") {
						intents.push({
							id: iid("crop"),
							kind: hint,
							beatId: beat.id,
							sourceRange: range,
							rationale: "Reframe only if measured framing geometry exists",
							evidenceRefs: sourceBeat?.evidenceRefs ?? [],
							priority: 5,
							requestedSkill: "CROP_REFRAME",
						});
					}
					if (hint === "ADD_TRANSITION") {
						if (!exec.has("TRANSITIONS")) {
							rejected.push({ skill: hint, reason: "transitions_not_executable" });
							continue;
						}
						if (!intents.some((i) => i.kind === "ADD_TRANSITION")) {
							intents.push({
								id: iid("trans"),
								kind: "ADD_TRANSITION",
								beatId: beat.id,
								sourceRange: range,
								rationale: "Story section change — dissolve only if multi-clip join exists",
								evidenceRefs: sourceBeat?.evidenceRefs ?? [],
								priority: 3,
								requestedSkill: "TRANSITIONS",
							});
						}
					}
				}
			}

			for (const g of request.targetStory.globalSkills) {
				if (g === "ADD_CAPTIONS" && exec.has("CAPTIONS")) {
					intents.push({
						id: iid("cap"),
						kind: g,
						rationale: "Enable captions when transcript/layout supports it",
						evidenceRefs: ["captions:global"],
						priority: 4,
						requestedSkill: "CAPTIONS",
					});
				} else if (g === "BALANCE_AUDIO" && exec.has("LOUDNESS")) {
					intents.push({
						id: iid("loud"),
						kind: g,
						rationale: "Balance loudness via settings path when safe",
						evidenceRefs: ["loudness:global"],
						priority: 4,
						requestedSkill: "LOUDNESS",
					});
				} else if (g === "IMPROVE_COLOR" || g === "AUDIO_CLEANUP") {
					rejected.push({ skill: g, reason: "product_capability_gap" });
				} else if (g === "ADD_TRANSITION" && exec.has("TRANSITIONS")) {
					intents.push({
						id: iid("trans"),
						kind: g,
						rationale:
							"Consider authorable dissolve only at a multi-clip story join — CUT remains default",
						evidenceRefs: ["transition:global"],
						priority: 3,
						requestedSkill: "TRANSITIONS",
					});
				} else if (g === "ADD_TRANSITION") {
					rejected.push({ skill: g, reason: "transitions_not_executable" });
				} else if (g === "ADD_TITLE" && exec.has("TITLES_CALLOUTS")) {
					intents.push({
						id: iid("title"),
						kind: g,
						rationale: "Opening/section title from grounded story speech when useful",
						evidenceRefs: ["title:global"],
						priority: 6,
						requestedSkill: "TITLES_CALLOUTS",
					});
				} else if (g === "ADD_CALLOUT" && exec.has("TITLES_CALLOUTS")) {
					intents.push({
						id: iid("callout"),
						kind: g,
						rationale: "Callout only with grounded focal geometry",
						evidenceRefs: ["callout:global"],
						priority: 6,
						requestedSkill: "TITLES_CALLOUTS",
					});
				}
			}

			// Per-beat title/callout from visual treatment
			for (const beat of request.targetStory.beats) {
				if (
					beat.visualTreatment?.title === "OPENING_TITLE" ||
					beat.visualTreatment?.title === "SECTION_TITLE"
				) {
					if (exec.has("TITLES_CALLOUTS") && !intents.some((i) => i.kind === "ADD_TITLE")) {
						intents.push({
							id: iid("title"),
							kind: "ADD_TITLE",
							beatId: beat.id,
							rationale: `Target story visual treatment: ${beat.visualTreatment.title}`,
							evidenceRefs: [`beat:${beat.id}`, "visualTreatment:title"],
							priority: 6,
							requestedSkill: "TITLES_CALLOUTS",
						});
					}
				}
				if (
					beat.visualTreatment?.callout === "OPTIONAL" &&
					beat.attentionIntent === "EMPHASIZE_FOCAL"
				) {
					if (exec.has("TITLES_CALLOUTS") && !intents.some((i) => i.kind === "ADD_CALLOUT")) {
						intents.push({
							id: iid("callout"),
							kind: "ADD_CALLOUT",
							beatId: beat.id,
							rationale: "Optional callout for emphasized focal beat",
							evidenceRefs: [`beat:${beat.id}`, "visualTreatment:callout"],
							priority: 7,
							requestedSkill: "TITLES_CALLOUTS",
						});
					}
				}
				if (beat.visualTreatment?.framing === "zoom_enter_hold_exit") {
					if (
						exec.has("ZOOM") &&
						!intents.some((i) => i.kind === "EMPHASIZE_TARGET" && i.beatId === beat.id)
					) {
						intents.push({
							id: iid("zoom"),
							kind: "EMPHASIZE_TARGET",
							beatId: beat.id,
							rationale: "Target story framing: professional zoom enter→hold→exit",
							evidenceRefs: [`beat:${beat.id}`, "visualTreatment:zoom"],
							priority: 9,
							requestedSkill: "ZOOM",
						});
					}
				}
				if (beat.visualTreatment?.transition === "DISSOLVE") {
					if (exec.has("TRANSITIONS") && !intents.some((i) => i.kind === "ADD_TRANSITION")) {
						intents.push({
							id: iid("trans"),
							kind: "ADD_TRANSITION",
							beatId: beat.id,
							rationale:
								"Target story: section/context change across beats — short dissolve only if a real multi-clip join exists",
							evidenceRefs: [`beat:${beat.id}`, "visualTreatment:transition"],
							priority: 3,
							requestedSkill: "TRANSITIONS",
						});
					}
				}
			}

			// Always consider reframing for professional makeovers — compiler returns NEEDS_EVIDENCE if no geometry
			if (exec.has("CROP_REFRAME")) {
				intents.push({
					id: iid("crop"),
					kind: "REFRAME_SCENE",
					rationale: "Consider reframing only when measured framing geometry exists",
					evidenceRefs: ["crop:global_consider"],
					priority: 3,
					requestedSkill: "CROP_REFRAME",
				});
			}

			// Consume temporal packet coverage honesty (not invent from absence)
			if (request.temporalPacket) {
				const cov = request.temporalPacket.evidenceCoverage;
				if (cov.cursorCoverage === "NOT_AVAILABLE") {
					for (const it of intents) {
						if (it.kind === "EMPHASIZE_TARGET") {
							it.rationale += " (cursor coverage NOT_AVAILABLE — grounding may fail)";
						}
					}
				}
			}

			intents.sort((a, b) => b.priority - a.priority);

			return {
				version: 1,
				providerId: EDITORIAL_DIRECTOR_V1_ID,
				reasoningProvider: "DETERMINISTIC",
				sourceStorySummary: request.sourceStory.summary,
				targetStorySummary: request.targetStory.desiredArc,
				intents,
				preserveNotes: request.sourceStory.beats
					.filter((b) => b.preservationStatus === "MUST_SURVIVE")
					.map((b) => `Preserve ${b.id}: ${b.speechSummary.slice(0, 80)}`),
				rejectedSkills: rejected,
				metrics: { buildMs: Date.now() - t0, paidAiCalls: 0 },
			};
		},
	};
}

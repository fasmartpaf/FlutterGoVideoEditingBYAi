/**
 * Map semantic chat skill ids ↔ EditingSkillV1 registry and validate operations.
 */

import { buildEditingSkillRegistryV1 } from "../autonomousProfessionalEditor/skillRegistry";
import type { EditingSkillV1 } from "../autonomousProfessionalEditor/types";
import type { SemanticSkillId, SemanticSkillRequestV1 } from "./semanticContract";
import type { LocalEditorialPendingProposalV1 } from "./types";

/** Chat-facing lowercase id → registry skill name(s). */
export const SEMANTIC_TO_REGISTRY: Record<SemanticSkillId, string[]> = {
	zoom: ["ZOOM"],
	trim: ["TRIM"],
	speed: ["SPEED_UP", "SLOW_MOTION"],
	captions: ["CAPTIONS"],
	title: ["TITLES_CALLOUTS"],
	callout: ["TITLES_CALLOUTS", "HIGHLIGHTS"],
	transitions: ["TRANSITIONS"],
	loudness: ["LOUDNESS"],
	crop: ["CROP_REFRAME"],
};

export function registrySkillsForSemanticId(
	id: SemanticSkillId,
	registry?: EditingSkillV1[],
): EditingSkillV1[] {
	const names = new Set(SEMANTIC_TO_REGISTRY[id] ?? []);
	const all = registry ?? buildEditingSkillRegistryV1();
	return all.filter((s) => names.has(s.skill));
}

export function resolveExecutableRegistrySkill(
	id: SemanticSkillId,
	registry?: EditingSkillV1[],
): EditingSkillV1 | null {
	// Explicit chatAvailable:true required — missing metadata is not available.
	const matches = registrySkillsForSemanticId(id, registry).filter(
		(s) => s.supported && s.executionReady && s.chatAvailable === true && Boolean(s.directEntry),
	);
	return matches[0] ?? null;
}

/** Map a registry directEntry (+ semantic skill id) onto the frozen local intent. */
export function localIntentFromRegistrySkill(
	reg: EditingSkillV1,
	semanticSkillId: SemanticSkillId,
	operation: SemanticSkillRequestV1["operation"],
): string | null {
	const entry = (reg.directEntry ?? "").trim();
	if (!entry) return null;

	// Exact / pipe-separated entries only — no loose cross-family substring routing.
	const entries = entry.split("|").map((e) => e.trim());
	const has = (suffix: string) =>
		entries.some((e) => e === suffix || e.endsWith(`/${suffix}`) || e.endsWith(suffix));

	if (has("directZoomFocus")) {
		return operation === "remove" ? "REMOVE_ZOOM" : "ADD_ZOOM";
	}
	if (has("directSpeed")) return "SPEED_UP";
	if (has("directTrim")) return "REMOVE_RANGE";
	if (has("directCaptions")) return "ENABLE_CAPTIONS";
	if (has("directTransition")) return "TRANSITION";
	if (has("directCallout") && semanticSkillId === "callout") return "CALLOUT";
	if (has("directTitle") && semanticSkillId === "title") return "TITLE";
	if (has("directTitle") || has("directCallout")) {
		return semanticSkillId === "callout" ? "CALLOUT" : "TITLE";
	}
	return null;
}

export type RegistryGateResult =
	| { ok: true; request: SemanticSkillRequestV1; resolvedSkills: EditingSkillV1[] }
	| { ok: false; errors: string[] };

export function validateAgainstSkillRegistry(
	request: SemanticSkillRequestV1,
	opts?: {
		pending?: LocalEditorialPendingProposalV1 | null;
		documentFingerprint?: string | null;
		registry?: EditingSkillV1[];
	},
): RegistryGateResult {
	const errors: string[] = [];
	const registry = opts?.registry ?? buildEditingSkillRegistryV1();
	const resolved: EditingSkillV1[] = [];

	if (
		request.goal === "CONFIRM_PENDING" ||
		request.goal === "MODIFY_PENDING" ||
		request.goal === "REJECT_PENDING"
	) {
		if (!opts?.pending) {
			errors.push("Pending goal requires an active pending proposal");
		} else if (
			opts.documentFingerprint &&
			opts.pending.documentFingerprint !== opts.documentFingerprint &&
			opts.pending.status !== "EXECUTED"
		) {
			errors.push("Pending proposal document fingerprint is stale");
		}
		if (
			request.target.editRef &&
			request.target.editRef !== "pending" &&
			request.target.editRef !== "last_zoom" &&
			!opts?.pending
		) {
			errors.push(`Unknown edit reference: ${request.target.editRef}`);
		}
	}

	if (request.target.type === "SEMANTIC_EVENT" && request.target.range != null) {
		errors.push("SEMANTIC_EVENT must not include a programme range (model invented timestamps)");
	}

	const mutatingGoal =
		request.goal === "EMPHASIZE" ||
		request.goal === "EXPLICIT_EDIT" ||
		request.goal === "CONFIRM_PENDING" ||
		request.goal === "MODIFY_PENDING" ||
		request.goal === "IMPROVE_PACING" ||
		request.goal === "SHORTEN";

	for (const skillId of request.skills) {
		const reg = resolveExecutableRegistrySkill(skillId, registry);
		if (!reg) {
			errors.push(
				`Skill "${skillId}" is not chat-available (requires chatAvailable:true + directEntry)`,
			);
			continue;
		}
		resolved.push(reg);
		if (mutatingGoal) {
			const bound = localIntentFromRegistrySkill(reg, skillId, request.operation);
			if (!bound) {
				errors.push(
					`Registry skill ${reg.skill} has no bound local executor (directEntry=${reg.directEntry ?? "null"})`,
				);
			}
		}
		if (request.operation) {
			const ops = reg.operations ?? [];
			if (ops.length > 0 && !ops.includes(request.operation)) {
				errors.push(
					`Operation "${request.operation}" is not supported by registry skill ${reg.skill}`,
				);
			}
		}
		if (request.target.type !== "UNKNOWN" && request.target.type !== "PENDING_PROPOSAL") {
			const skipTargetCheck =
				request.goal === "PROFESSIONALIZE" ||
				request.goal === "RECOMMEND" ||
				request.goal === "INSPECT";
			const accepted = reg.acceptedTargetTypes ?? [];
			if (
				!skipTargetCheck &&
				accepted.length > 0 &&
				!accepted.includes(request.target.type as never) &&
				!(request.target.type === "SEMANTIC_EVENT" && reg.acceptsSemanticTarget)
			) {
				errors.push(
					`Target type ${request.target.type} is not accepted by registry skill ${reg.skill}`,
				);
			}
		}
		if (request.modification) {
			const mods = reg.modificationOps ?? [];
			const keys = Object.keys(request.modification).filter(
				(k) => (request.modification as Record<string, unknown>)[k] != null,
			);
			for (const key of keys) {
				const val = (request.modification as Record<string, unknown>)[key];
				if (
					typeof val === "string" &&
					mods.length > 0 &&
					!mods.includes(val) &&
					!mods.includes(key)
				) {
					// intensity stronger/weaker maps to modificationOps entries
					if (key === "intensity" && typeof val === "string" && mods.includes(val)) continue;
					if (key === "rate" && typeof val === "string" && mods.includes(val)) continue;
					if (key === "timing" && typeof val === "string" && mods.includes(val)) continue;
					if (key === "duration" && typeof val === "string" && mods.includes(val)) continue;
					if (key === "text" && mods.includes("text")) continue;
					if (key === "style") continue;
					if (key === "multiplier") continue;
					if (!mods.includes(String(val))) {
						errors.push(`Modification ${key}=${String(val)} is not supported by ${reg.skill}`);
					}
				}
			}
		}
	}

	if (
		request.skills.length === 0 &&
		request.goal !== "UNKNOWN" &&
		request.goal !== "INSPECT" &&
		request.goal !== "REJECT_PENDING" &&
		request.goal !== "PROFESSIONALIZE" &&
		request.goal !== "RECOMMEND"
	) {
		errors.push("Request has no skills for a mutating/edit goal");
	}

	if (errors.length) return { ok: false, errors };
	return { ok: true, request, resolvedSkills: resolved };
}

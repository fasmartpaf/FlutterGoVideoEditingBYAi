/**
 * Semantic skill request contract — validated WHAT/authority before grounding/HOW.
 * Evolves LocalEditorialRequestV1; does not invent timestamps or mutate documents.
 */

import { z } from "zod";
import type { EditingSkillV1 } from "../autonomousProfessionalEditor/types";
import {
	localIntentFromRegistrySkill,
	resolveExecutableRegistrySkill,
	SEMANTIC_TO_REGISTRY,
} from "./skillRegistryGate";
import type {
	EditFamilyRequest,
	LocalEditorialIntent,
	LocalEditorialRequestV1,
	RelativeAdjustment,
} from "./types";

export const SEMANTIC_PARSE_STATUSES = ["HIGH_CONFIDENCE", "UNRESOLVED", "REASONED"] as const;
export type SemanticParseStatus = (typeof SEMANTIC_PARSE_STATUSES)[number];

export const SEMANTIC_AUTHORITIES = [
	"USER_EXPLICIT",
	"USER_CONFIRMED",
	"AUTONOMOUS",
	"ADVISORY",
] as const;
export type SemanticAuthority = (typeof SEMANTIC_AUTHORITIES)[number];

export const SEMANTIC_GOALS = [
	"EXPLICIT_EDIT",
	"PROFESSIONALIZE",
	"IMPROVE_PACING",
	"EMPHASIZE",
	"SHORTEN",
	"RECOMMEND",
	"INSPECT",
	"CONFIRM_PENDING",
	"REJECT_PENDING",
	"MODIFY_PENDING",
	"UNKNOWN",
] as const;
export type SemanticGoal = (typeof SEMANTIC_GOALS)[number];

export const SEMANTIC_SKILL_IDS = [
	"zoom",
	"trim",
	"speed",
	"captions",
	"title",
	"callout",
	"transitions",
	"loudness",
	"crop",
] as const;
export type SemanticSkillId = (typeof SEMANTIC_SKILL_IDS)[number];

export const SEMANTIC_TARGET_TYPES = [
	"EXPLICIT_RANGE",
	"SEMANTIC_EVENT",
	"SELECTION",
	"PREVIOUS_EDIT",
	"PENDING_PROPOSAL",
	"WHOLE_PROGRAMME",
	"UNKNOWN",
] as const;
export type SemanticTargetType = (typeof SEMANTIC_TARGET_TYPES)[number];

export const SEMANTIC_OPERATIONS = ["add", "adjust", "remove", "list"] as const;
export type SemanticOperation = (typeof SEMANTIC_OPERATIONS)[number];

const semanticModificationSchema = z
	.object({
		intensity: z.enum(["stronger", "weaker"]).optional(),
		timing: z.enum(["earlier", "later"]).optional(),
		duration: z.enum(["shorter", "longer"]).optional(),
		rate: z.enum(["faster", "slower"]).optional(),
		text: z.string().min(1).max(500).optional(),
		style: z.string().min(1).max(80).optional(),
		multiplier: z.number().positive().max(8).optional(),
	})
	.strict();

const semanticTargetSchema = z
	.object({
		type: z.enum(SEMANTIC_TARGET_TYPES),
		range: z
			.object({
				startSec: z.number().finite().nonnegative(),
				endSec: z.number().finite().positive(),
			})
			.nullable()
			.optional(),
		semanticEvent: z.string().min(1).max(240).nullable().optional(),
		editRef: z.string().min(1).max(80).nullable().optional(),
	})
	.strict()
	.superRefine((val, ctx) => {
		if (val.type === "EXPLICIT_RANGE") {
			if (!val.range || !(val.range.endSec > val.range.startSec)) {
				ctx.addIssue({
					code: "custom",
					message: "EXPLICIT_RANGE requires a valid programme range",
					path: ["range"],
				});
			}
		}
		if (val.type === "SEMANTIC_EVENT") {
			if (!val.semanticEvent || !val.semanticEvent.trim()) {
				ctx.addIssue({
					code: "custom",
					message: "SEMANTIC_EVENT requires free-language semanticEvent",
					path: ["semanticEvent"],
				});
			}
			if (val.range != null) {
				ctx.addIssue({
					code: "custom",
					message: "Model must not supply timestamps for SEMANTIC_EVENT",
					path: ["range"],
				});
			}
		}
		if (val.type === "PENDING_PROPOSAL" && val.editRef && val.editRef.startsWith("fabricated_")) {
			ctx.addIssue({
				code: "custom",
				message: "Fabricated edit references are rejected",
				path: ["editRef"],
			});
		}
	});

export const semanticSkillRequestSchema = z
	.object({
		version: z.literal(1),
		rawText: z.string().min(1).max(4000),
		parseStatus: z.enum(SEMANTIC_PARSE_STATUSES),
		goal: z.enum(SEMANTIC_GOALS),
		authority: z.enum(SEMANTIC_AUTHORITIES),
		skills: z.array(z.enum(SEMANTIC_SKILL_IDS)).max(8),
		operation: z.enum(SEMANTIC_OPERATIONS).nullable(),
		target: semanticTargetSchema,
		modification: semanticModificationSchema.nullable(),
		confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
		unresolvedReason: z.string().max(400).nullable(),
		providerId: z.string().max(120).nullable(),
		providerCalls: z.number().int().nonnegative(),
		cloudCalls: z.number().int().nonnegative(),
		latencyMs: z.number().nonnegative().nullable(),
	})
	.strict()
	.superRefine((val, ctx) => {
		if (val.parseStatus === "UNRESOLVED" && !val.unresolvedReason) {
			ctx.addIssue({
				code: "custom",
				message: "UNRESOLVED requires unresolvedReason",
				path: ["unresolvedReason"],
			});
		}
		if (val.goal === "CONFIRM_PENDING" || val.goal === "MODIFY_PENDING") {
			if (val.target.type !== "PENDING_PROPOSAL" && val.target.type !== "UNKNOWN") {
				ctx.addIssue({
					code: "custom",
					message: "Pending goals must target PENDING_PROPOSAL",
					path: ["target", "type"],
				});
			}
		}
		if (val.authority === "ADVISORY" && val.goal === "EXPLICIT_EDIT") {
			ctx.addIssue({
				code: "custom",
				message: "ADVISORY cannot be EXPLICIT_EDIT",
				path: ["authority"],
			});
		}
		for (const skill of val.skills) {
			if (!(SEMANTIC_SKILL_IDS as readonly string[]).includes(skill)) {
				ctx.addIssue({
					code: "custom",
					message: `Unknown skill ${skill}`,
					path: ["skills"],
				});
			}
		}
	});

export type SemanticSkillRequestV1 = z.infer<typeof semanticSkillRequestSchema>;

export type SemanticValidationResult =
	| { ok: true; request: SemanticSkillRequestV1 }
	| { ok: false; errors: string[] };

const TARGET_TYPE_ALIASES: Record<string, SemanticTargetType> = {
	explicit_range: "EXPLICIT_RANGE",
	explicitrange: "EXPLICIT_RANGE",
	range: "EXPLICIT_RANGE",
	time_range: "EXPLICIT_RANGE",
	timerange: "EXPLICIT_RANGE",
	semantic_event: "SEMANTIC_EVENT",
	semanticevent: "SEMANTIC_EVENT",
	event: "SEMANTIC_EVENT",
	visual_event: "SEMANTIC_EVENT",
	visualevent: "SEMANTIC_EVENT",
	ui_event: "SEMANTIC_EVENT",
	uievent: "SEMANTIC_EVENT",
	appearance: "SEMANTIC_EVENT",
	moment: "SEMANTIC_EVENT",
	selection: "SELECTION",
	previous_edit: "PREVIOUS_EDIT",
	previousedit: "PREVIOUS_EDIT",
	prior_edit: "PREVIOUS_EDIT",
	pending_proposal: "PENDING_PROPOSAL",
	pendingproposal: "PENDING_PROPOSAL",
	pending: "PENDING_PROPOSAL",
	proposal: "PENDING_PROPOSAL",
	whole_programme: "WHOLE_PROGRAMME",
	wholeprogramme: "WHOLE_PROGRAMME",
	whole_program: "WHOLE_PROGRAMME",
	whole: "WHOLE_PROGRAMME",
	programme: "WHOLE_PROGRAMME",
	program: "WHOLE_PROGRAMME",
	full: "WHOLE_PROGRAMME",
	unknown: "UNKNOWN",
};

function normalizeEnumToken(raw: unknown): string {
	return String(raw ?? "")
		.trim()
		.replace(/[\s-]+/g, "_")
		.toLowerCase();
}

function isFiniteRange(v: unknown): v is { startSec: number; endSec: number } {
	if (!v || typeof v !== "object") return false;
	const r = v as Record<string, unknown>;
	return (
		typeof r.startSec === "number" &&
		Number.isFinite(r.startSec) &&
		typeof r.endSec === "number" &&
		Number.isFinite(r.endSec)
	);
}

/**
 * Bounded repair of provider JSON before strict Zod validation.
 * Maps common aliases / free-language type slips onto the closed enums.
 * Does NOT invent timestamps, edit IDs, or fabricate SEMANTIC_EVENT ranges.
 * Returns { repaired, notes } where notes are safe redacted diagnostics.
 */
export function repairSemanticProviderPayload(input: unknown): {
	repaired: unknown;
	notes: string[];
} {
	const notes: string[] = [];
	if (!input || typeof input !== "object") {
		return { repaired: input, notes: ["payload_not_object"] };
	}
	const obj = { ...(input as Record<string, unknown>) };
	const targetIn = obj.target;
	const target: Record<string, unknown> =
		targetIn && typeof targetIn === "object" ? { ...(targetIn as Record<string, unknown>) } : {};

	const rawType = target.type;
	const rawTypeStr = typeof rawType === "string" ? rawType.trim() : "";
	const allowed = new Set<string>(SEMANTIC_TARGET_TYPES);

	if (rawTypeStr && !allowed.has(rawTypeStr)) {
		const alias = TARGET_TYPE_ALIASES[normalizeEnumToken(rawTypeStr)];
		if (alias) {
			notes.push(`target.type_alias:${normalizeEnumToken(rawTypeStr)}→${alias}`);
			target.type = alias;
		} else if (
			/[\s/_]/.test(rawTypeStr) ||
			rawTypeStr.length > 12 ||
			!/^[A-Z][A-Z0-9_]*$/.test(rawTypeStr)
		) {
			// Free-language / snake / mixed-case type slips → event text.
			// Keep any model-supplied range so strict validation can still reject invented times.
			notes.push("target.type_as_event_text");
			if (typeof target.semanticEvent !== "string" || !String(target.semanticEvent).trim()) {
				target.semanticEvent = rawTypeStr.replace(/_/g, " ").slice(0, 240);
			}
			target.type = "SEMANTIC_EVENT";
		} else {
			notes.push(`target.type_unmapped:${rawTypeStr.slice(0, 40)}`);
		}
	}

	if (!target.type || !allowed.has(String(target.type))) {
		const goal = String(obj.goal ?? "").toUpperCase();
		const hasEvent =
			typeof target.semanticEvent === "string" && String(target.semanticEvent).trim().length > 0;
		if (goal === "CONFIRM_PENDING" || goal === "MODIFY_PENDING" || goal === "REJECT_PENDING") {
			target.type = "PENDING_PROPOSAL";
			notes.push("target.type_inferred:PENDING_PROPOSAL_from_goal");
		} else if (hasEvent) {
			target.type = "SEMANTIC_EVENT";
			notes.push("target.type_inferred:SEMANTIC_EVENT_from_semanticEvent");
		} else if (isFiniteRange(target.range)) {
			target.type = "EXPLICIT_RANGE";
			notes.push("target.type_inferred:EXPLICIT_RANGE_from_range");
		} else if (goal === "PROFESSIONALIZE" || goal === "RECOMMEND" || goal === "INSPECT") {
			target.type = "WHOLE_PROGRAMME";
			notes.push("target.type_inferred:WHOLE_PROGRAMME_from_goal");
		}
	}

	// If SEMANTIC_EVENT with empty semanticEvent, recover from rawText / message-like fields.
	if (
		target.type === "SEMANTIC_EVENT" &&
		(typeof target.semanticEvent !== "string" || !String(target.semanticEvent).trim())
	) {
		const fallback =
			(typeof obj.semanticEvent === "string" && obj.semanticEvent.trim()) ||
			(typeof obj.event === "string" && obj.event.trim()) ||
			null;
		if (fallback) {
			target.semanticEvent = fallback.slice(0, 240);
			notes.push("target.semanticEvent_recovered_from_sibling");
		}
	}

	// Never keep fabricated edit refs by clearing them — strict validation must reject.
	obj.target = target;

	// Soft-normalize other closed enums (aliases only — no invention).
	if (typeof obj.goal === "string" && !(SEMANTIC_GOALS as readonly string[]).includes(obj.goal)) {
		const g = obj.goal
			.trim()
			.toUpperCase()
			.replace(/[\s-]+/g, "_");
		if ((SEMANTIC_GOALS as readonly string[]).includes(g)) {
			notes.push(`goal_alias→${g}`);
			obj.goal = g;
		}
	}
	if (
		typeof obj.authority === "string" &&
		!(SEMANTIC_AUTHORITIES as readonly string[]).includes(obj.authority)
	) {
		const a = obj.authority
			.trim()
			.toUpperCase()
			.replace(/[\s-]+/g, "_");
		if ((SEMANTIC_AUTHORITIES as readonly string[]).includes(a)) {
			notes.push(`authority_alias→${a}`);
			obj.authority = a;
		}
	}
	if (Array.isArray(obj.skills)) {
		obj.skills = obj.skills.map((s) => {
			if (typeof s !== "string") return s;
			const low = s.trim().toLowerCase();
			if ((SEMANTIC_SKILL_IDS as readonly string[]).includes(low)) {
				if (s !== low) notes.push(`skill_alias→${low}`);
				return low;
			}
			return s;
		});
	}

	return { repaired: obj, notes };
}

/**
 * Validate provider output with bounded repair first.
 * Strict Zod still rejects invented timestamps / fabricated edit IDs.
 */
export function validateSemanticSkillRequest(input: unknown): SemanticValidationResult {
	const { repaired, notes } = repairSemanticProviderPayload(input);
	const parsed = semanticSkillRequestSchema.safeParse(repaired);
	if (!parsed.success) {
		const typeDiag =
			repaired && typeof repaired === "object"
				? (() => {
						const t = (repaired as Record<string, unknown>).target;
						const ty =
							t && typeof t === "object" ? String((t as Record<string, unknown>).type ?? "") : "";
						return ty ? ` after_repair_type=${ty.slice(0, 48)}` : "";
					})()
				: "";
		return {
			ok: false,
			errors: [
				...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
				...(notes.length ? [`repair_notes:${notes.slice(0, 4).join(",")}${typeDiag}`] : []),
			],
		};
	}
	return { ok: true, request: parsed.data };
}

export function skillIdsToFamilies(skills: SemanticSkillId[]): EditFamilyRequest[] {
	return [...new Set(skills)] as EditFamilyRequest[];
}

export function relativeFromModification(
	mod: SemanticSkillRequestV1["modification"],
): RelativeAdjustment {
	if (!mod) return null;
	if (mod.intensity === "stronger" || mod.rate === "faster") return "MORE_AGGRESSIVE";
	if (mod.intensity === "weaker" || mod.rate === "slower") return "LESS_AGGRESSIVE";
	if (mod.duration === "shorter") return "MORE_AGGRESSIVE";
	if (mod.duration === "longer") return "LESS_AGGRESSIVE";
	return null;
}

/** Map a validated semantic request onto the existing LocalEditorialRequestV1 router fields.
 * Intent is bound from registry directEntry when resolvedSkills are provided (or looked up).
 */
export function applySemanticToLocalRequest(
	base: LocalEditorialRequestV1,
	semantic: SemanticSkillRequestV1,
	opts?: { resolvedSkills?: EditingSkillV1[] },
): LocalEditorialRequestV1 {
	const families = skillIdsToFamilies(semantic.skills);
	const relative = relativeFromModification(semantic.modification) ?? base.relativeAdjustment;

	let intent = base.intent;
	let executionKind: LocalEditorialRequestV1["executionKind"] = base.executionKind;
	let zoomAuthorization = base.zoomAuthorization;
	let routeClass = base.routeClass;
	let constraints = [...base.constraints];
	let semanticEventCue = base.semanticEventCue;
	let range = base.range;
	let zoomDepth = base.zoomDepth;
	let referencedPreviousEdit = base.referencedPreviousEdit;
	let orchestratorMessage = base.orchestratorMessage;

	const intentFromRegistry = (): LocalEditorialIntent | null => {
		const orderedIds = [...semantic.skills];
		// EMPHASIZE defaults toward zoom when present.
		if (semantic.goal === "EMPHASIZE" && orderedIds.includes("zoom")) {
			orderedIds.sort((a, b) => (a === "zoom" ? -1 : b === "zoom" ? 1 : 0));
		}
		for (const skillId of orderedIds) {
			const reg =
				opts?.resolvedSkills?.find((s) => {
					const names = SEMANTIC_TO_REGISTRY[skillId];
					return names?.includes(s.skill);
				}) ?? resolveExecutableRegistrySkill(skillId);
			if (!reg) continue;
			const mapped = localIntentFromRegistrySkill(reg, skillId, semantic.operation);
			if (mapped) return mapped as LocalEditorialIntent;
		}
		return null;
	};

	if (semantic.goal === "CONFIRM_PENDING" || semantic.goal === "MODIFY_PENDING") {
		intent =
			(intentFromRegistry() as LocalEditorialIntent | null) ??
			(families.includes("callout")
				? "CALLOUT"
				: families.includes("title")
					? "TITLE"
					: families.includes("zoom") || base.intent === "ADD_ZOOM"
						? "ADD_ZOOM"
						: base.intent);
		executionKind = "direct_document";
		zoomAuthorization =
			intent === "ADD_ZOOM" || intent === "REMOVE_ZOOM" || intent === "ADJUST_ZOOM"
				? "execute"
				: null;
		routeClass = "LOCAL_RESOLVED";
		referencedPreviousEdit =
			intent === "ADD_ZOOM" || intent === "REMOVE_ZOOM" || intent === "ADJUST_ZOOM"
				? "last_zoom"
				: intent === "CALLOUT" || intent === "ADJUST_CALLOUT" || intent === "REMOVE_CALLOUT"
					? "last_callout"
					: intent === "TITLE" || intent === "ADJUST_TITLE" || intent === "REMOVE_TITLE"
						? "last_title"
						: base.referencedPreviousEdit;
		if (semantic.modification?.intensity === "stronger") {
			const next = Math.min(6, (base.zoomDepth ?? 3) + 1);
			zoomDepth = next as 1 | 2 | 3 | 4 | 5 | 6;
		} else if (semantic.modification?.intensity === "weaker") {
			const next = Math.max(1, (base.zoomDepth ?? 3) - 1);
			zoomDepth = next as 1 | 2 | 3 | 4 | 5 | 6;
		}
	} else if (semantic.goal === "REJECT_PENDING") {
		intent = "UNKNOWN";
		executionKind = "constraint_only";
		routeClass = "LOCAL_PARTIAL";
		constraints = [...constraints, "REJECT_PENDING"];
	} else if (semantic.goal === "PROFESSIONALIZE") {
		intent = "PROFESSIONALIZE";
		executionKind = "professional_orchestrator";
		routeClass = "LOCAL_RESOLVED";
		orchestratorMessage =
			base.orchestratorMessage ??
			`${semantic.rawText}\n\nYou decide. Apply only evidence-backed improvements from eligible skills.`;
	} else if (semantic.goal === "IMPROVE_PACING" || semantic.goal === "SHORTEN") {
		intent =
			(intentFromRegistry() as LocalEditorialIntent | null) ??
			(families.includes("speed") ? "SPEED_UP" : "CHANGE_PACING");
		executionKind =
			semantic.target.type === "EXPLICIT_RANGE" ? "direct_document" : "professional_orchestrator";
		routeClass = "LOCAL_RESOLVED";
		if (executionKind === "professional_orchestrator") {
			orchestratorMessage =
				base.orchestratorMessage ??
				`${semantic.rawText}\n\nImprove pacing with trim/speed only where evidence supports it. You decide.`;
		}
	} else if (semantic.goal === "EMPHASIZE" || semantic.goal === "EXPLICIT_EDIT") {
		const bound = intentFromRegistry();
		if (bound) {
			intent = bound;
			if (bound === "ADD_ZOOM" || bound === "REMOVE_ZOOM") {
				if (!families.includes("zoom")) families.push("zoom");
			}
		} else if (families.includes("zoom") || semantic.goal === "EMPHASIZE") {
			intent = semantic.operation === "remove" ? "REMOVE_ZOOM" : "ADD_ZOOM";
			if (!families.includes("zoom")) families.push("zoom");
		} else if (families.includes("speed")) {
			intent = "SPEED_UP";
		} else if (families.includes("trim")) {
			intent = "REMOVE_RANGE";
		} else if (families.includes("captions")) {
			intent = "ENABLE_CAPTIONS";
		} else if (families.includes("title")) {
			intent = "TITLE";
		} else if (families.includes("callout")) {
			intent = "CALLOUT";
		} else if (families.includes("transitions")) {
			intent = "TRANSITION";
		}
		if (semantic.authority === "USER_EXPLICIT" || semantic.authority === "USER_CONFIRMED") {
			executionKind =
				intent === "ENABLE_CAPTIONS" || intent === "PROFESSIONALIZE"
					? "professional_orchestrator"
					: "direct_document";
			zoomAuthorization = "execute";
		} else if (semantic.authority === "ADVISORY") {
			executionKind = "constraint_only";
			constraints = [...constraints, "ADVICE_ONLY"];
			zoomAuthorization = "propose";
		} else {
			executionKind = "professional_orchestrator";
			zoomAuthorization = "propose";
		}
		routeClass = "LOCAL_RESOLVED";
	} else if (semantic.goal === "RECOMMEND" || semantic.goal === "INSPECT") {
		executionKind = "constraint_only";
		constraints = [...constraints, "ADVICE_ONLY"];
		routeClass = "LOCAL_PARTIAL";
		zoomAuthorization = "propose";
		const bound = intentFromRegistry();
		if (bound) {
			intent = bound;
		} else if (families.includes("zoom")) {
			intent = "ADD_ZOOM";
		} else if (families.includes("callout")) {
			intent = "CALLOUT";
		} else if (families.includes("title")) {
			intent = "TITLE";
		} else if (families.includes("speed")) {
			intent = "SPEED_UP";
		} else if (families.includes("trim")) {
			intent = "REMOVE_RANGE";
		} else if (families.includes("captions")) {
			intent = "ENABLE_CAPTIONS";
		} else if (families.includes("transitions")) {
			intent = "TRANSITION";
		}
	}

	if (semantic.target.type === "SEMANTIC_EVENT" && semantic.target.semanticEvent) {
		semanticEventCue = semantic.target.semanticEvent;
		range = null;
	} else if (semantic.target.type === "EXPLICIT_RANGE" && semantic.target.range) {
		range = {
			startSec: semantic.target.range.startSec,
			endSec: semantic.target.range.endSec,
		};
	}
	// WHOLE_PROGRAMME keeps existing cue/range from base — no invented timestamps.

	return {
		...base,
		rawText: semantic.rawText || base.rawText,
		intent,
		executionKind,
		zoomAuthorization,
		routeClass,
		constraints: [...new Set(constraints)],
		semanticEventCue,
		range,
		zoomDepth,
		referencedPreviousEdit,
		orchestratorMessage,
		requestedFamilies: families.length > 0 ? families : base.requestedFamilies,
		relativeAdjustment: relative,
		localCapabilityAvailable: true,
		requiresSemanticReasoning: false,
		confidence:
			semantic.confidence === "HIGH" ? 0.92 : semantic.confidence === "MEDIUM" ? 0.75 : 0.55,
		parseStatus: semantic.parseStatus,
		authority: semantic.authority,
		semanticGoal: semantic.goal,
		semanticSkillRequest: semantic,
		resolvedFromConversation:
			base.resolvedFromConversation ||
			semantic.goal === "CONFIRM_PENDING" ||
			semantic.goal === "MODIFY_PENDING",
	};
}

export function unresolvedSemanticRequest(rawText: string, reason: string): SemanticSkillRequestV1 {
	return {
		version: 1,
		rawText,
		parseStatus: "UNRESOLVED",
		goal: "UNKNOWN",
		authority: "ADVISORY",
		skills: [],
		operation: null,
		target: { type: "UNKNOWN", range: null, semanticEvent: null, editRef: null },
		modification: null,
		confidence: "LOW",
		unresolvedReason: reason,
		providerId: null,
		providerCalls: 0,
		cloudCalls: 0,
		latencyMs: null,
	};
}

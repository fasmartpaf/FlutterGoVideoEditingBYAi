/**
 * Semantic understanding brain — WHAT / authority / conversational reference.
 * Does NOT invent timestamps, edit IDs, or mutate the document.
 *
 * Uses OpenScreen's selected Chat provider via createOpenScreenChatModel —
 * never a hardcoded localhost Ollama/LM Studio default.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { skillDescriptorsForBrain } from "../autonomousProfessionalEditor/skillRegistry";
import {
	createOpenScreenChatModel,
	messageContentToText,
	type OpenScreenChatModelConfig,
} from "../deep-agent/chat-model";
import { getProviderDefinition, normalizeProviderId } from "../provider-registry";
import {
	type SemanticSkillRequestV1,
	unresolvedSemanticRequest,
	validateSemanticSkillRequest,
} from "./semanticContract";
import { validateAgainstSkillRegistry } from "./skillRegistryGate";
import type { LocalEditorialPendingProposalV1 } from "./types";

export interface SemanticBrainContext {
	userMessage: string;
	pending: LocalEditorialPendingProposalV1 | null;
	lastAssistantDecision: string | null;
	committedFamilies: string[];
	documentFingerprint: string | null;
	programmeDurationSec: number | null;
	hasTranscript: boolean;
	hasCursor: boolean;
}

export type SemanticBrainFn = (ctx: SemanticBrainContext) => Promise<SemanticSkillRequestV1>;

let injectedBrain: SemanticBrainFn | null = null;

/** Test/product seam — inject a brain (mock or custom). Wiring tests only. */
export function setSemanticBrainForTests(fn: SemanticBrainFn | null): void {
	injectedBrain = fn;
}

export function getSemanticBrainForTests(): SemanticBrainFn | null {
	return injectedBrain;
}

function stripJsonFence(text: string): string {
	const t = text.trim();
	const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) return fenced[1]!.trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start >= 0 && end > start) return t.slice(start, end + 1);
	return t;
}

function isCloudProvider(providerId: string): boolean {
	const id = normalizeProviderId(providerId) ?? providerId;
	if (id === "local-cli" || id === "openai-compatible") return false;
	const def = getProviderDefinition(id);
	return def?.authKind === "api-key";
}

function isSyntheticLocalEditorialModel(config: OpenScreenChatModelConfig): boolean {
	return config.model === "local-editorial-control";
}

function buildSystemPrompt(): string {
	const skills = skillDescriptorsForBrain();
	return [
		"You are OpenScreen's semantic edit understanding layer.",
		"Return JSON only matching the schema. Never invent programme timestamps.",
		"For SEMANTIC_EVENT targets, put free-language description in target.semanticEvent and set range to null.",
		"Never include startSec/endSec/range for SEMANTIC_EVENT — grounding finds WHERE later.",
		"Authority: USER_EXPLICIT when the user requested the edit; USER_CONFIRMED for pending acceptance;",
		"AUTONOMOUS when OpenScreen should decide usefulness; ADVISORY for questions/recommendations without mutation.",
		"Goals: EXPLICIT_EDIT, PROFESSIONALIZE, IMPROVE_PACING, EMPHASIZE, SHORTEN, RECOMMEND, INSPECT,",
		"CONFIRM_PENDING, REJECT_PENDING, MODIFY_PENDING, UNKNOWN.",
		"target.type MUST be exactly one of:",
		"EXPLICIT_RANGE | SEMANTIC_EVENT | SELECTION | PREVIOUS_EDIT | PENDING_PROPOSAL | WHOLE_PROGRAMME | UNKNOWN.",
		"Do not put event descriptions in target.type — use target.semanticEvent for free language.",
		"JSON object mode is required but does NOT validate enums — you must emit exact enum strings.",
		"Skills (lowercase chat ids): zoom, trim, speed, captions, title, callout, transitions, loudness, crop.",
		"Map emphasis / attention / stand-out requests to skill zoom with goal EMPHASIZE when appropriate.",
		"Map slow beginning / drag / waiting to IMPROVE_PACING or SHORTEN with trim and/or speed.",
		"Map polished demo / ready for viewers whole-programme asks to PROFESSIONALIZE with AUTONOMOUS.",
		"If a pending proposal exists and the user affirms it, use CONFIRM_PENDING + USER_CONFIRMED.",
		"If they affirm but ask stronger/weaker, use MODIFY_PENDING with modification.intensity.",
		"If they reject and name a different event, use REJECT_PENDING or a new EMPHASIZE with SEMANTIC_EVENT.",
		"Advisory questions (Would it help…?) → goal RECOMMEND, authority ADVISORY.",
		"Choose skills from meaning (zoom for emphasis/stand-out, callout for labels, title for headings,",
		"trim/speed for pacing) — do not always pick zoom. No mutation under ADVISORY.",
		"Available skill descriptors (registry):",
		JSON.stringify(skills),
		"Output schema keys: version=1, rawText, parseStatus=REASONED, goal, authority, skills[],",
		"operation (add|adjust|remove|list|null), target{type,range|null,semanticEvent|null,editRef|null},",
		"modification|null, confidence (HIGH|MEDIUM|LOW), unresolvedReason|null,",
		"providerId|null, providerCalls=1, cloudCalls (0 or 1), latencyMs|null.",
	].join("\n");
}

function buildUserPayload(ctx: SemanticBrainContext): string {
	return JSON.stringify({
		message: ctx.userMessage,
		pending: ctx.pending
			? {
					kind: ctx.pending.kind,
					summary: ctx.pending.summary,
					families: ctx.pending.families,
					semanticEventCue: ctx.pending.semanticEventCue,
					range: ctx.pending.range,
					zoomDepth: ctx.pending.zoomDepth,
					status: ctx.pending.status ?? "PROPOSED",
					fingerprint: ctx.pending.documentFingerprint,
				}
			: null,
		lastAssistantDecision: ctx.lastAssistantDecision,
		committedFamilies: ctx.committedFamilies,
		documentFingerprint: ctx.documentFingerprint,
		programmeDurationSec: ctx.programmeDurationSec,
		evidenceHints: {
			hasTranscript: ctx.hasTranscript,
			hasCursor: ctx.hasCursor,
		},
	});
}

/**
 * Call OpenScreen's selected Chat model for understanding only.
 * Does not mutate documents and does not invent timestamps.
 */
async function callSelectedChatProviderBrain(
	ctx: SemanticBrainContext,
	chatModelConfig: OpenScreenChatModelConfig,
): Promise<SemanticSkillRequestV1> {
	const providerId = normalizeProviderId(chatModelConfig.provider) ?? chatModelConfig.provider;
	const label = `${providerId}/${chatModelConfig.model}`;
	const t0 = Date.now();

	if (isSyntheticLocalEditorialModel(chatModelConfig)) {
		return unresolvedSemanticRequest(
			ctx.userMessage,
			`Semantic understanding requires your selected Chat AI provider. Configure one in Settings → AI (current Chat model is not available for this turn).`,
		);
	}

	try {
		const model = await createOpenScreenChatModel(chatModelConfig);
		// Prefer JSON-object mode when the bound model supports it (OpenAI-family).
		const jsonModel =
			typeof (model as { bind?: (a: unknown) => typeof model }).bind === "function"
				? (() => {
						try {
							return (model as { bind: (a: unknown) => typeof model }).bind({
								response_format: { type: "json_object" },
							});
						} catch {
							return model;
						}
					})()
				: model;
		const response = await jsonModel.invoke([
			new SystemMessage(buildSystemPrompt()),
			new HumanMessage(buildUserPayload(ctx)),
		]);
		const content = messageContentToText(response.content);
		let parsed: unknown;
		try {
			parsed = JSON.parse(stripJsonFence(content));
		} catch {
			return unresolvedSemanticRequest(
				ctx.userMessage,
				`Semantic understanding from ${label} returned non-JSON; cannot safely classify the request.`,
			);
		}

		if (!parsed || typeof parsed !== "object") {
			return unresolvedSemanticRequest(
				ctx.userMessage,
				`Semantic understanding from ${label} returned an invalid payload.`,
			);
		}

		const obj = parsed as Record<string, unknown>;
		obj.rawText = typeof obj.rawText === "string" ? obj.rawText : ctx.userMessage;
		obj.parseStatus = "REASONED";
		obj.providerId = label;
		obj.providerCalls = 1;
		obj.cloudCalls = isCloudProvider(providerId) ? 1 : 0;
		obj.latencyMs = Date.now() - t0;

		// Safe redacted snapshot of provider target.type before/after repair (no secrets).
		const rawTargetType =
			obj.target && typeof obj.target === "object"
				? String((obj.target as Record<string, unknown>).type ?? "")
				: "";

		// Validate (bounded repair inside) — still rejects invented SEMANTIC_EVENT timestamps.
		const validated = validateSemanticSkillRequest(parsed);
		if (!validated.ok) {
			const typeHint = rawTargetType
				? ` provider_target.type=${JSON.stringify(rawTargetType.slice(0, 60))}`
				: "";
			return unresolvedSemanticRequest(
				ctx.userMessage,
				`Semantic understanding failed validation (${label}): ${validated.errors.slice(0, 4).join("; ")}${typeHint}`,
			);
		}

		const gated = validateAgainstSkillRegistry(validated.request, {
			pending: ctx.pending,
			documentFingerprint: ctx.documentFingerprint,
		});
		if (!gated.ok) {
			return unresolvedSemanticRequest(
				ctx.userMessage,
				`Semantic request rejected by skill registry (${label}): ${gated.errors.slice(0, 4).join("; ")}`,
			);
		}
		return gated.request;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return unresolvedSemanticRequest(
			ctx.userMessage,
			`Semantic understanding provider unavailable (${label}): ${msg}`,
		);
	}
}

/**
 * Structural pending handling (0 provider) — only when pending exists.
 * Does not expand PROCEED_PHRASES.
 */
export function tryPendingStructuralUnderstanding(
	ctx: SemanticBrainContext,
	opts?: {
		relativeIntensity?: "stronger" | "weaker" | null;
		isBareOrProceed?: boolean;
	},
): SemanticSkillRequestV1 | null {
	const pending = ctx.pending;
	if (!pending) return null;
	const t = ctx.userMessage.trim();
	const intensity = opts?.relativeIntensity ?? null;
	const skills = (
		pending.families.length ? pending.families : ["zoom"]
	) as SemanticSkillRequestV1["skills"];

	if (intensity && /\b(yes|yeah|yep|ok|okay)\b/i.test(t)) {
		return {
			version: 1,
			rawText: ctx.userMessage,
			parseStatus: "HIGH_CONFIDENCE",
			goal: "MODIFY_PENDING",
			authority: "USER_CONFIRMED",
			skills,
			operation: "adjust",
			target: {
				type: "PENDING_PROPOSAL",
				range: null,
				semanticEvent: null,
				editRef: "pending",
			},
			modification: { intensity },
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "pending-structural",
			providerCalls: 0,
			cloudCalls: 0,
			latencyMs: 0,
		};
	}

	if (opts?.isBareOrProceed) {
		return {
			version: 1,
			rawText: ctx.userMessage,
			parseStatus: "HIGH_CONFIDENCE",
			goal: "CONFIRM_PENDING",
			authority: "USER_CONFIRMED",
			skills,
			operation: "add",
			target: {
				type: "PENDING_PROPOSAL",
				range: null,
				semanticEvent: null,
				editRef: "pending",
			},
			modification: null,
			confidence: "HIGH",
			unresolvedReason: null,
			providerId: "pending-structural",
			providerCalls: 0,
			cloudCalls: 0,
			latencyMs: 0,
		};
	}

	return null;
}

export interface UnderstandSemanticArgs {
	ctx: SemanticBrainContext;
	/** OpenScreen Chat-selected model — required for real understanding. */
	chatModelConfig?: OpenScreenChatModelConfig | null;
	relativeIntensity?: "stronger" | "weaker" | null;
	isBareOrProceed?: boolean;
}

/**
 * Understand WHAT the user means.
 * Prefer injected brain (tests) → pending structural → selected Chat provider.
 * Never silently defaults to Ollama/LM Studio.
 */
export async function understandSemanticRequest(
	args: UnderstandSemanticArgs,
): Promise<SemanticSkillRequestV1> {
	if (injectedBrain) {
		const out = await injectedBrain(args.ctx);
		const validated = validateSemanticSkillRequest(out);
		if (!validated.ok) {
			return unresolvedSemanticRequest(
				args.ctx.userMessage,
				`Injected brain failed validation: ${validated.errors.slice(0, 3).join("; ")}`,
			);
		}
		const gated = validateAgainstSkillRegistry(validated.request, {
			pending: args.ctx.pending,
			documentFingerprint: args.ctx.documentFingerprint,
		});
		if (!gated.ok) {
			return unresolvedSemanticRequest(
				args.ctx.userMessage,
				`Injected brain failed registry gate: ${gated.errors.slice(0, 3).join("; ")}`,
			);
		}
		return gated.request;
	}

	const structural = tryPendingStructuralUnderstanding(args.ctx, {
		relativeIntensity: args.relativeIntensity ?? null,
		isBareOrProceed: args.isBareOrProceed,
	});
	if (structural) return structural;

	if (!args.chatModelConfig) {
		return unresolvedSemanticRequest(
			args.ctx.userMessage,
			"Semantic understanding required, but no Chat AI provider was passed for this turn. Select a provider in Settings → AI.",
		);
	}

	return callSelectedChatProviderBrain(args.ctx, args.chatModelConfig);
}

/** @deprecated Removed — do not default to localhost Ollama. Kept as stub returning null. */
export function resolveSemanticBrainProvider(): null {
	return null;
}

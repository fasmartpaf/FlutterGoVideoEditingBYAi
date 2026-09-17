/**
 * Benchmark-only cost calculator — Production Cost Architecture V1.
 * Does NOT call providers. Assumptions are explicit inputs.
 *
 * Identity: CURRENT_OPENSCREEN_PRODUCTION_COST_ARCHITECTURE_V1
 */

export type Pricing = {
	inputPerMTok: number;
	cachedInputPerMTok: number;
	outputPerMTok: number;
	/** Optional flat estimate per attached image when image tokens unknown */
	estTokensPerImage?: number;
};

export type TurnProfile = {
	name: string;
	providerCalls: number;
	inputTokens: number;
	cachedInputTokens?: number;
	outputTokens: number;
	images?: number;
};

export type SessionProfile = {
	name: string;
	turns: TurnProfile[];
};

export type ScaleInput = {
	users: number;
	sessionsPerUser: number;
	session: SessionProfile;
	pricing: Pricing;
};

export function estimateTurnUsd(turn: TurnProfile, pricing: Pricing): number {
	const imageTok = (turn.images ?? 0) * (pricing.estTokensPerImage ?? 0);
	// Prefer explicit inputTokens (already includes image accounting when from provider usage).
	const billableIn = turn.inputTokens;
	const cached = turn.cachedInputTokens ?? 0;
	const uncached = Math.max(0, billableIn - cached);
	const inCost =
		(uncached / 1_000_000) * pricing.inputPerMTok +
		(cached / 1_000_000) * pricing.cachedInputPerMTok;
	const outCost = (turn.outputTokens / 1_000_000) * pricing.outputPerMTok;
	// imageTok only for diagnostic decomposition when inputTokens not EXACT
	void imageTok;
	return inCost + outCost;
}

export function estimateSessionUsd(
	session: SessionProfile,
	pricing: Pricing,
): {
	usd: number;
	providerCalls: number;
	inputTokens: number;
	outputTokens: number;
	images: number;
} {
	let usd = 0;
	let providerCalls = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let images = 0;
	for (const t of session.turns) {
		usd += estimateTurnUsd(t, pricing);
		providerCalls += t.providerCalls;
		inputTokens += t.inputTokens;
		outputTokens += t.outputTokens;
		images += t.images ?? 0;
	}
	return { usd, providerCalls, inputTokens, outputTokens, images };
}

export function scaleCost(input: ScaleInput): {
	assumptions: ScaleInput;
	perSession: ReturnType<typeof estimateSessionUsd>;
	totalUsd: number;
	totalProviderCalls: number;
} {
	const perSession = estimateSessionUsd(input.session, input.pricing);
	const sessions = input.users * input.sessionsPerUser;
	return {
		assumptions: input,
		perSession,
		totalUsd: perSession.usd * sessions,
		totalProviderCalls: perSession.providerCalls * sessions,
	};
}

/** gpt-4o list prices used in contextTelemetry audit (verify before finance). */
export const GPT4O_AUDIT_PRICING: Pricing = {
	inputPerMTok: 2.5,
	cachedInputPerMTok: 1.25,
	outputPerMTok: 10,
	estTokensPerImage: 765,
};

/** Measured Gate V2 / Production turn shapes (EXACT input when cited). */
export const MEASURED_TURNS = {
	fullVisual: {
		name: "FULL_visual",
		providerCalls: 1,
		inputTokens: 34281,
		outputTokens: 241,
		images: 13,
	},
	retVisual: {
		name: "RET_visual",
		providerCalls: 1,
		inputTokens: 20063,
		outputTokens: 230,
		images: 5,
	},
	retEditorial: {
		name: "RET_editorial",
		providerCalls: 1,
		inputTokens: 23281,
		outputTokens: 188,
		images: 5,
	},
	retSpeech: {
		name: "RET_speech",
		providerCalls: 1,
		inputTokens: 12089,
		outputTokens: 42,
		images: 0,
	},
	compactSpeech: {
		name: "COMPACT_speech",
		providerCalls: 1,
		inputTokens: 3022,
		outputTokens: 44,
		images: 0,
	},
	followupSpeechMemory: {
		name: "RET_followup_speech_memory",
		providerCalls: 1,
		inputTokens: 12254,
		outputTokens: 50,
		images: 0,
	},
} as const satisfies Record<string, TurnProfile>;

export const SESSION_PROFILES: Record<string, SessionProfile> = {
	LIGHT: {
		name: "LIGHT",
		turns: [MEASURED_TURNS.retSpeech, MEASURED_TURNS.followupSpeechMemory],
	},
	STANDARD: {
		name: "STANDARD",
		turns: [
			MEASURED_TURNS.retEditorial,
			MEASURED_TURNS.followupSpeechMemory,
			MEASURED_TURNS.retSpeech,
			{ name: "apply_no_provider", providerCalls: 0, inputTokens: 0, outputTokens: 0 },
		],
	},
	HEAVY: {
		name: "HEAVY",
		turns: [
			MEASURED_TURNS.fullVisual,
			MEASURED_TURNS.fullVisual,
			MEASURED_TURNS.retEditorial,
			MEASURED_TURNS.retVisual,
			MEASURED_TURNS.followupSpeechMemory,
		],
	},
	BAD_CURRENT_PATTERN: {
		name: "BAD_CURRENT_PATTERN",
		turns: [
			MEASURED_TURNS.fullVisual,
			MEASURED_TURNS.fullVisual,
			MEASURED_TURNS.fullVisual,
			MEASURED_TURNS.fullVisual,
			MEASURED_TURNS.fullVisual,
		],
	},
	TARGET_MEMORY_FIRST: {
		name: "TARGET_MEMORY_FIRST",
		turns: [
			MEASURED_TURNS.retEditorial,
			MEASURED_TURNS.followupSpeechMemory,
			MEASURED_TURNS.followupSpeechMemory,
			MEASURED_TURNS.retSpeech,
			{ name: "apply_no_provider", providerCalls: 0, inputTokens: 0, outputTokens: 0 },
		],
	},
};

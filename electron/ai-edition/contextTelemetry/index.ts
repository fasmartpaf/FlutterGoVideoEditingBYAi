/**
 * Turn-level context / cost telemetry for OpenScreen agent turns.
 * Estimates are explicitly tagged — never presented as provider-billed truth.
 *
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_CONTEXT_AUDIT_V1
 */

export const CONTEXT_TELEMETRY_V1_ID = "CURRENT_OPENSCREEN_VIDEO_MEMORY_CONTEXT_AUDIT_V1" as const;

export type ContextComponentKind =
	| "RAW_EVIDENCE"
	| "DERIVED_EVIDENCE"
	| "EDITORIAL_STATE"
	| "TOOL_CONTRACT"
	| "CONVERSATION"
	| "CONTROL_POLICY"
	| "DUPLICATE_OR_REDUNDANT"
	| "LOCAL_ONLY";

export type TokenAccounting = {
	chars: number;
	estimatedTokens: number;
	/** Provider-reported when available. */
	actualTokens: number | "not_available";
	kind: ContextComponentKind;
	repeated?: boolean;
	notes?: string;
};

export type ProviderUsageActual = {
	inputTokens: number | "not_available";
	outputTokens: number | "not_available";
	reasoningTokens: number | "not_available";
	cachedInputTokens: number | "not_available";
	modelCalls: number;
	source: "langchain_usage_metadata" | "not_available";
};

export type ImageContribution = {
	imageCount: number;
	totalJpegBytes: number;
	maxLongSidePx: number | "not_available";
	/** OpenAI-style tile estimate — always estimated unless provider splits usage. */
	estimatedImageTokens: number;
	accounting: "estimated";
};

export type LatencyBreakdownMs = {
	evidencePreparationMs: number | "not_available";
	sttMs: number | "not_available";
	visualEvidenceMs: number | "not_available";
	investigatorMs: number | "not_available";
	cognitionMs: number | "not_available";
	providerMs: number | "not_available";
	toolExecutionMs: number | "not_available";
	verificationMs: number | "not_available";
	totalMs: number;
};

export type ContextTelemetryV1 = {
	identity: typeof CONTEXT_TELEMETRY_V1_ID;
	provider: string;
	model: string;
	components: Record<string, TokenAccounting>;
	providerUsage: ProviderUsageActual;
	images: ImageContribution;
	latency: LatencyBreakdownMs;
	toolLoopCount: number;
	retryCount: number;
	estimatedCostUsd: number | "NOT_VERIFIED";
	pricingNote: string;
};

/** ~4 chars/token heuristic for English/JSON — always estimated. */
export function estimateTokensFromChars(chars: number): number {
	if (chars <= 0) return 0;
	return Math.ceil(chars / 4);
}

export function measureTextComponent(
	text: string,
	kind: ContextComponentKind,
	extra?: Partial<TokenAccounting>,
): TokenAccounting {
	const chars = text.length;
	return {
		chars,
		estimatedTokens: estimateTokensFromChars(chars),
		actualTokens: "not_available",
		kind,
		...extra,
	};
}

/**
 * Rough OpenAI vision tile estimate for detail=high-ish JPEG ≤1280 long side.
 * Marked estimated — not billed truth.
 */
export function estimateImageTokens(imageCount: number, longSidePx = 1280): number {
	if (imageCount <= 0) return 0;
	// Simplified: ~765 tokens/image at ~1024–1280 (85 + 4*170) — conservative mid.
	const perImage = longSidePx >= 1024 ? 765 : 425;
	return imageCount * perImage;
}

export type ModelPricingConfig = {
	model: string;
	inputPerMillionUsd: number;
	cachedInputPerMillionUsd: number;
	outputPerMillionUsd: number;
	asOf: string;
	source: string;
};

/** Explicit pricing config — separate from cognition. Update when rates change. */
export const GPT4O_PRICING: ModelPricingConfig = {
	model: "gpt-4o",
	inputPerMillionUsd: 2.5,
	cachedInputPerMillionUsd: 1.25,
	outputPerMillionUsd: 10,
	asOf: "2025-09",
	source: "OpenAI API pricing (configured for audit; verify before finance use)",
};

export function estimateCostUsd(input: {
	pricing: ModelPricingConfig;
	inputTokens: number | "not_available";
	cachedInputTokens?: number | "not_available";
	outputTokens: number | "not_available";
}): number | "NOT_VERIFIED" {
	if (input.inputTokens === "not_available" || input.outputTokens === "not_available") {
		return "NOT_VERIFIED";
	}
	const cached = typeof input.cachedInputTokens === "number" ? input.cachedInputTokens : 0;
	const uncached = Math.max(0, input.inputTokens - cached);
	const usd =
		(uncached / 1_000_000) * input.pricing.inputPerMillionUsd +
		(cached / 1_000_000) * input.pricing.cachedInputPerMillionUsd +
		(input.outputTokens / 1_000_000) * input.pricing.outputPerMillionUsd;
	return Math.round(usd * 1_000_000) / 1_000_000;
}

export function extractUsageFromChatModelEnd(data: unknown): {
	inputTokens: number | "not_available";
	outputTokens: number | "not_available";
	reasoningTokens: number | "not_available";
	cachedInputTokens: number | "not_available";
} {
	const empty = {
		inputTokens: "not_available" as const,
		outputTokens: "not_available" as const,
		reasoningTokens: "not_available" as const,
		cachedInputTokens: "not_available" as const,
	};
	if (!data || typeof data !== "object") return empty;
	const d = data as Record<string, unknown>;
	const output = d.output as Record<string, unknown> | undefined;
	const msg = (output?.generations as unknown[] | undefined)?.[0] as
		| { message?: Record<string, unknown> }
		| undefined;
	const usage =
		(d.usage_metadata as Record<string, unknown> | undefined) ||
		(output?.usage_metadata as Record<string, unknown> | undefined) ||
		(msg?.message?.usage_metadata as Record<string, unknown> | undefined) ||
		((d.chunk as Record<string, unknown> | undefined)?.usage_metadata as
			| Record<string, unknown>
			| undefined);

	// Also check llmOutput.tokenUsage (older LangChain)
	const llmOutput = d.llmOutput as Record<string, unknown> | undefined;
	const tokenUsage = llmOutput?.tokenUsage as Record<string, unknown> | undefined;

	const inputTokens =
		num(usage?.input_tokens) ??
		num(usage?.prompt_tokens) ??
		num(tokenUsage?.promptTokens) ??
		"not_available";
	const outputTokens =
		num(usage?.output_tokens) ??
		num(usage?.completion_tokens) ??
		num(tokenUsage?.completionTokens) ??
		"not_available";
	const inputDetails = usage?.input_token_details as Record<string, unknown> | undefined;
	const cachedInputTokens =
		num(inputDetails?.cache_read) ?? num(usage?.cache_read) ?? "not_available";
	const outputDetails = usage?.output_token_details as Record<string, unknown> | undefined;
	const reasoningTokens = num(outputDetails?.reasoning) ?? "not_available";

	return { inputTokens, outputTokens, reasoningTokens, cachedInputTokens };
}

function num(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function measureUserMessageParts(content: unknown): {
	textChars: number;
	imageCount: number;
	estimatedImageDataUrlChars: number;
} {
	if (typeof content === "string") {
		return { textChars: content.length, imageCount: 0, estimatedImageDataUrlChars: 0 };
	}
	if (!Array.isArray(content)) {
		return { textChars: 0, imageCount: 0, estimatedImageDataUrlChars: 0 };
	}
	let textChars = 0;
	let imageCount = 0;
	let estimatedImageDataUrlChars = 0;
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as Record<string, unknown>;
		if (p.type === "text" && typeof p.text === "string") textChars += p.text.length;
		if (p.type === "image_url") {
			imageCount += 1;
			const url = (p.image_url as { url?: string } | undefined)?.url;
			if (typeof url === "string") estimatedImageDataUrlChars += url.length;
		}
	}
	return { textChars, imageCount, estimatedImageDataUrlChars };
}

export function emptyContextTelemetry(partial: {
	provider: string;
	model: string;
}): ContextTelemetryV1 {
	return {
		identity: CONTEXT_TELEMETRY_V1_ID,
		provider: partial.provider,
		model: partial.model,
		components: {},
		providerUsage: {
			inputTokens: "not_available",
			outputTokens: "not_available",
			reasoningTokens: "not_available",
			cachedInputTokens: "not_available",
			modelCalls: 0,
			source: "not_available",
		},
		images: {
			imageCount: 0,
			totalJpegBytes: 0,
			maxLongSidePx: "not_available",
			estimatedImageTokens: 0,
			accounting: "estimated",
		},
		latency: {
			evidencePreparationMs: "not_available",
			sttMs: "not_available",
			visualEvidenceMs: "not_available",
			investigatorMs: "not_available",
			cognitionMs: "not_available",
			providerMs: "not_available",
			toolExecutionMs: "not_available",
			verificationMs: "not_available",
			totalMs: 0,
		},
		toolLoopCount: 0,
		retryCount: 0,
		estimatedCostUsd: "NOT_VERIFIED",
		pricingNote: GPT4O_PRICING.source,
	};
}

/**
 * Context telemetry unit tests — estimates vs provider usage separation.
 * Identity: CURRENT_OPENSCREEN_VIDEO_MEMORY_CONTEXT_AUDIT_V1
 */

import { describe, expect, it } from "vitest";
import {
	CONTEXT_TELEMETRY_V1_ID,
	emptyContextTelemetry,
	estimateCostUsd,
	estimateImageTokens,
	estimateTokensFromChars,
	extractUsageFromChatModelEnd,
	GPT4O_PRICING,
	measureTextComponent,
	measureUserMessageParts,
} from "./index";

describe("contextTelemetry", () => {
	it("tags estimates and keeps provider usage separate", () => {
		const t = emptyContextTelemetry({ provider: "openai", model: "gpt-4o" });
		expect(t.identity).toBe(CONTEXT_TELEMETRY_V1_ID);
		expect(t.providerUsage.source).toBe("not_available");
		expect(t.images.accounting).toBe("estimated");
		expect(t.estimatedCostUsd).toBe("NOT_VERIFIED");
	});

	it("estimates tokens from chars without claiming billed truth", () => {
		const m = measureTextComponent("abcd".repeat(100), "RAW_EVIDENCE");
		expect(m.chars).toBe(400);
		expect(m.estimatedTokens).toBe(estimateTokensFromChars(400));
		expect(m.actualTokens).toBe("not_available");
	});

	it("estimates image tokens separately from text", () => {
		expect(estimateImageTokens(0)).toBe(0);
		expect(estimateImageTokens(10)).toBe(7650);
	});

	it("computes gpt-4o cost only when usage numbers exist", () => {
		expect(
			estimateCostUsd({
				pricing: GPT4O_PRICING,
				inputTokens: "not_available",
				outputTokens: 100,
			}),
		).toBe("NOT_VERIFIED");
		const usd = estimateCostUsd({
			pricing: GPT4O_PRICING,
			inputTokens: 10_000,
			cachedInputTokens: 2_000,
			outputTokens: 500,
		});
		expect(typeof usd).toBe("number");
		expect(usd).toBeGreaterThan(0);
	});

	it("extracts usage_metadata from on_chat_model_end shapes", () => {
		const u = extractUsageFromChatModelEnd({
			output: {
				usage_metadata: {
					input_tokens: 1234,
					output_tokens: 56,
					input_token_details: { cache_read: 100 },
					output_token_details: { reasoning: 0 },
				},
			},
		});
		expect(u.inputTokens).toBe(1234);
		expect(u.outputTokens).toBe(56);
		expect(u.cachedInputTokens).toBe(100);
	});

	it("measures multimodal user parts without mutating them", () => {
		const parts = [
			{ type: "text", text: "hello" },
			{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
		];
		const m = measureUserMessageParts(parts);
		expect(m.textChars).toBe(5);
		expect(m.imageCount).toBe(1);
		expect(m.estimatedImageDataUrlChars).toBeGreaterThan(0);
		// Original unchanged
		expect(parts[0]).toEqual({ type: "text", text: "hello" });
	});
});

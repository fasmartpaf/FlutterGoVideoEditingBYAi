import { describe, expect, it } from "vitest";
import {
	classifyEmptyModelCompletion,
	classifyMissingUserFacingResponse,
	classifyProviderThrownError,
	extractHttpStatus,
	nextRetryDelayMs,
	PROVIDER_RETRY_POLICY,
	userSafeDeliveryMessage,
} from "./deliveryStatus";

describe("deliveryStatus — Recovery 3", () => {
	it("1 — 429 rate-limit produces typed provider_rate_limited (retryable)", () => {
		const err = Object.assign(new Error("Rate limit exceeded (429)"), { status: 429 });
		const d = classifyProviderThrownError(err, { provider: "openai", model: "gpt-4o" });
		expect(d.status).toBe("provider_error");
		expect(d.failureReason).toBe("provider_rate_limited");
		expect(d.retryable).toBe(true);
		expect(d.userMessage).not.toMatch(/Empty response/i);
		expect(d.userMessage).toMatch(/temporarily unavailable/i);
		expect(d.userMessage).not.toMatch(/couldn't understand the video/i);
	});

	it("2 — insufficient_quota is quota exhausted (not retryable)", () => {
		const err = Object.assign(
			new Error("Error: 429 You exceeded your current quota, please check your plan and billing"),
			{ status: 429 },
		);
		const d = classifyProviderThrownError(err, { provider: "openai", model: "gpt-4o" });
		expect(d.failureReason).toBe("provider_quota_exhausted");
		expect(d.retryable).toBe(false);
		expect(nextRetryDelayMs(d, 0)).toBeNull();
	});

	it("3 — 401/auth failure typed", () => {
		const err = Object.assign(new Error("Incorrect API key provided"), { status: 401 });
		const d = classifyProviderThrownError(err, { provider: "openai", model: "gpt-4o" });
		expect(d.failureReason).toBe("provider_auth_failed");
		expect(d.userMessage).toMatch(/credentials/i);
	});

	it("4 — timeout typed", () => {
		const err = Object.assign(new Error("Request timed out"), { status: 408 });
		const d = classifyProviderThrownError(err, { provider: "openai", model: "gpt-4o" });
		expect(d.failureReason).toBe("provider_timeout");
		expect(d.retryable).toBe(true);
	});

	it("5 — provider empty completion typed", () => {
		const d = classifyEmptyModelCompletion({
			provider: "openai",
			model: "gpt-4o",
			chatModelChunks: 3,
			otherEvents: [],
			toolEventSeen: false,
			chunkSample: '{"content":[]}',
			hadThinkingOnly: true,
		});
		expect(d.failureReason).toBe("provider_empty_completion");
		expect(d.status).toBe("provider_error");
	});

	it("6 — tool-loop without final text typed", () => {
		const d = classifyEmptyModelCompletion({
			provider: "openai",
			model: "gpt-4o",
			chatModelChunks: 0,
			otherEvents: ["on_chain_end"],
			toolEventSeen: true,
			chunkSample: "(no on_chat_model_stream events)",
		});
		expect(d.failureReason).toBe("agent_tool_loop_no_final");
		expect(d.status).toBe("analysis_error");
	});

	it("7 — sanitizer removing all prose typed", () => {
		const d = classifyMissingUserFacingResponse({
			provider: "openai",
			model: "gpt-4o",
			rawLen: 400,
			cause: "sanitizer_removed_all_text",
		});
		expect(d.failureReason).toBe("sanitizer_removed_all_text");
		expect(d.status).toBe("analysis_error");
	});

	it("8 — user-safe messages do not expose API keys / stacks", () => {
		const err = Object.assign(new Error("sk-proj-SECRETKEY123 failed with stack at foo.ts:1"), {
			status: 429,
		});
		const d = classifyProviderThrownError(err, { provider: "openai", model: "gpt-4o" });
		expect(d.userMessage).not.toMatch(/sk-proj/i);
		expect(d.userMessage).not.toMatch(/SECRETKEY/);
		expect(d.userMessage).not.toMatch(/foo\.ts/);
		expect(d.diagnostic).toMatch(/SECRETKEY|sk-proj|Rate|429/i); // diagnostic may retain
	});

	it("9 — bounded retry delays", () => {
		const err = Object.assign(new Error("429 rate limit"), { status: 429 });
		const d = classifyProviderThrownError(err, { provider: "openai", model: "gpt-4o" });
		expect(nextRetryDelayMs(d, 0)).toBeTypeOf("number");
		expect(nextRetryDelayMs(d, PROVIDER_RETRY_POLICY.maxAttempts)).toBeNull();
	});

	it("10 — extractHttpStatus from message digits", () => {
		expect(extractHttpStatus(new Error("OpenAI 429 Too Many Requests"))).toBe(429);
	});

	it("12 — context_length and AbortError are typed (not unknown)", () => {
		const ctx = Object.assign(new Error("This model's maximum context length is 128000 tokens"), {
			status: 400,
			error: { type: "invalid_request_error", code: "context_length_exceeded" },
		});
		const d1 = classifyProviderThrownError(ctx, { provider: "openai", model: "gpt-4o" });
		expect(d1.failureReason).toBe("provider_context_length_exceeded");
		expect(d1.providerDiagnostics?.rawProviderCode).toBe("context_length_exceeded");

		const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
		const d2 = classifyProviderThrownError(abort, { provider: "openai", model: "gpt-4o" });
		expect(d2.failureReason).toBe("request_aborted");
	});

	it("13 — unknown retains raw diagnostics when unresolved", () => {
		const err = new Error("WeirdVendorXYZ glitch 999");
		const d = classifyProviderThrownError(err, { provider: "openai", model: "gpt-4o" });
		expect(d.failureReason).toBe("unknown");
		expect(d.providerDiagnostics?.errorMessage).toMatch(/WeirdVendorXYZ/);
		expect(d.diagnostic).toMatch(/WeirdVendorXYZ/);
	});
});

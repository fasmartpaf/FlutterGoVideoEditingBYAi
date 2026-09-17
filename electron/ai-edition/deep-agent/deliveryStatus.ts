/**
 * Final-response delivery status — Recovery 3.
 *
 * Distinguishes provider failures from empty/mute completions and post-sanitize
 * wipeouts so product turns never report success with finalText === "".
 *
 * Internal codes stay off the normal user-facing surface; use
 * {@link userSafeDeliveryMessage} for chat toasts / assistant failure copy.
 */

export const AGENT_RESPONSE_STATUSES = [
	"completed",
	"provider_error",
	"analysis_error",
	"insufficient_evidence",
	"cancelled",
] as const;

export type AgentResponseStatus = (typeof AGENT_RESPONSE_STATUSES)[number];

export const AGENT_FAILURE_REASONS = [
	"provider_rate_limited",
	"provider_auth_failed",
	"provider_quota_exhausted",
	"provider_timeout",
	"provider_network_error",
	"provider_empty_completion",
	"provider_context_length_exceeded",
	"provider_payload_too_large",
	"provider_5xx",
	"provider_overloaded",
	"provider_bad_request",
	"request_aborted",
	"sdk_transport_error",
	"agent_tool_loop_no_final",
	"agent_max_steps",
	"stream_ended_without_text",
	"sanitizer_removed_all_text",
	"missing_user_facing_response",
	"final_assembly_error",
	"ipc_delivery_error",
	"local_cli_error",
	"unknown",
] as const;

export type AgentFailureReason = (typeof AGENT_FAILURE_REASONS)[number];

/** Raw provider/transport fields preserved for benchmarks — never user-facing. */
export interface ProviderErrorDiagnostics {
	rawProviderType?: string;
	rawProviderCode?: string;
	rawProviderMessage?: string;
	httpStatus?: number;
	providerRequestId?: string;
	retryAfterMs?: number;
	causeName?: string;
	causeMessage?: string;
	networkCode?: string;
	errorName?: string;
	errorMessage?: string;
}

export interface DeliveryFailure {
	status: Exclude<AgentResponseStatus, "completed">;
	failureReason: AgentFailureReason;
	/** Developer/benchmark diagnostic — may include provider/model/chunk samples. */
	diagnostic: string;
	/** Safe for toast / product error field. */
	userMessage: string;
	httpStatus?: number;
	retryAfterMs?: number;
	/** True when a bounded retry may help (rate-limit burst, not hard quota). */
	retryable: boolean;
	/** Structured raw cause — diagnostic only. */
	providerDiagnostics?: ProviderErrorDiagnostics;
}

const USER_PROVIDER_UNAVAILABLE =
	"I couldn't complete the AI analysis because the model service is temporarily unavailable. Your video and project were not changed.";

const USER_ANALYSIS_FAILED =
	"OpenScreen couldn't complete this analysis. Your project was not changed.";

const USER_AUTH =
	"I couldn't complete the AI analysis because the model service rejected the credentials. Your video and project were not changed.";

export function userSafeDeliveryMessage(reason: AgentFailureReason): string {
	switch (reason) {
		case "provider_rate_limited":
		case "provider_quota_exhausted":
		case "provider_timeout":
		case "provider_network_error":
		case "provider_empty_completion":
		case "provider_context_length_exceeded":
		case "provider_payload_too_large":
		case "provider_5xx":
		case "provider_overloaded":
		case "provider_bad_request":
		case "request_aborted":
		case "sdk_transport_error":
			return USER_PROVIDER_UNAVAILABLE;
		case "provider_auth_failed":
			return USER_AUTH;
		case "local_cli_error":
			// Local CLI already returns an actionable sentence; callers may override.
			return USER_PROVIDER_UNAVAILABLE;
		default:
			return USER_ANALYSIS_FAILED;
	}
}

/** Extract HTTP status from LangChain / OpenAI-shaped errors when present. */
export function extractHttpStatus(err: unknown): number | undefined {
	if (!err || typeof err !== "object") return undefined;
	const e = err as Record<string, unknown>;
	for (const key of ["status", "statusCode", "httpStatus"] as const) {
		const v = e[key];
		if (typeof v === "number" && v >= 100 && v < 600) return v;
	}
	const response = e.response;
	if (response && typeof response === "object") {
		const st = (response as { status?: unknown }).status;
		if (typeof st === "number") return st;
	}
	const msg = err instanceof Error ? err.message : String(err);
	const m = msg.match(/\b(429|401|403|408|500|502|503|504)\b/);
	if (m) return Number(m[1]);
	return undefined;
}

export function extractRetryAfterMs(err: unknown): number | undefined {
	if (!err || typeof err !== "object") return undefined;
	const e = err as Record<string, unknown>;
	const headers = e.headers ?? (e.response as { headers?: unknown } | undefined)?.headers;
	if (headers && typeof headers === "object") {
		const h = headers as Record<string, unknown>;
		const raw = h["retry-after"] ?? h["Retry-After"];
		if (typeof raw === "string" || typeof raw === "number") {
			const n = Number(raw);
			if (Number.isFinite(n) && n >= 0) return n < 1000 ? n * 1000 : n;
		}
	}
	const msg = err instanceof Error ? err.message : String(err);
	const m = msg.match(/retry[- ]after[:\s]+(\d+)/i);
	if (m) {
		const n = Number(m[1]);
		if (Number.isFinite(n)) return n < 1000 ? n * 1000 : n;
	}
	return undefined;
}

/** Pull structured fields from LangChain / OpenAI / Node error shapes. */
export function extractProviderErrorDiagnostics(err: unknown): ProviderErrorDiagnostics {
	const e = err instanceof Error ? err : new Error(String(err));
	const obj = (err && typeof err === "object" ? err : {}) as Record<string, unknown>;
	const nestedError =
		obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : undefined;
	const cause =
		obj.cause && typeof obj.cause === "object"
			? (obj.cause as Record<string, unknown>)
			: e.cause && typeof e.cause === "object"
				? (e.cause as Record<string, unknown>)
				: undefined;
	const headers =
		obj.headers && typeof obj.headers === "object"
			? (obj.headers as Record<string, unknown>)
			: (obj.response as { headers?: Record<string, unknown> } | undefined)?.headers;
	const requestId =
		(typeof obj.requestID === "string" && obj.requestID) ||
		(typeof obj.request_id === "string" && obj.request_id) ||
		(typeof nestedError?.request_id === "string" && nestedError.request_id) ||
		(headers && typeof headers["x-request-id"] === "string" && headers["x-request-id"]) ||
		(headers &&
			typeof headers["x-openai-request-id"] === "string" &&
			headers["x-openai-request-id"]) ||
		undefined;
	const networkCode =
		(typeof obj.code === "string" && /^(E[A-Z]+|UND_ERR_)/.test(obj.code) && obj.code) ||
		(typeof cause?.code === "string" && cause.code) ||
		undefined;

	return {
		rawProviderType:
			(typeof nestedError?.type === "string" && nestedError.type) ||
			(typeof obj.type === "string" && obj.type) ||
			undefined,
		rawProviderCode:
			(typeof nestedError?.code === "string" && nestedError.code) ||
			(typeof obj.code === "string" && !/^(E[A-Z]+|UND_ERR_)/.test(obj.code) && obj.code) ||
			undefined,
		rawProviderMessage:
			(typeof nestedError?.message === "string" && nestedError.message) || e.message || undefined,
		httpStatus: extractHttpStatus(err),
		providerRequestId: requestId || undefined,
		retryAfterMs: extractRetryAfterMs(err),
		causeName: typeof cause?.name === "string" ? cause.name : undefined,
		causeMessage: typeof cause?.message === "string" ? cause.message : undefined,
		networkCode,
		errorName: e.name,
		errorMessage: e.message,
	};
}

/**
 * Classify a thrown provider / transport error.
 * Does not retry — callers decide bounded retry from {@link DeliveryFailure.retryable}.
 * Preserves raw diagnostics; `unknown` only when no evidence-backed category matches.
 */
export function classifyProviderThrownError(
	err: unknown,
	meta: { provider: string; model: string; chunkSample?: string },
): DeliveryFailure {
	const providerDiagnostics = extractProviderErrorDiagnostics(err);
	const httpStatus = providerDiagnostics.httpStatus;
	const retryAfterMs = providerDiagnostics.retryAfterMs;
	const e = err instanceof Error ? err : new Error(String(err));
	const lower = [
		e.message,
		providerDiagnostics.rawProviderMessage,
		providerDiagnostics.rawProviderCode,
		providerDiagnostics.rawProviderType,
		providerDiagnostics.causeMessage,
		providerDiagnostics.networkCode,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	const stackHead = (e.stack ?? "").split("\n").slice(0, 3).join(" | ");

	let failureReason: AgentFailureReason = "unknown";
	let retryable = false;

	if (
		e.name === "AbortError" ||
		/request.?aborted|the operation was aborted|aborterror/i.test(lower)
	) {
		failureReason = "request_aborted";
		retryable = false;
	} else if (
		httpStatus === 401 ||
		httpStatus === 403 ||
		/invalid.?api.?key|unauthorized|forbidden/i.test(lower)
	) {
		failureReason = "provider_auth_failed";
	} else if (
		/context.?length|maximum context|token.?limit|too many tokens|context_length_exceeded/i.test(
			lower,
		) ||
		providerDiagnostics.rawProviderCode === "context_length_exceeded"
	) {
		failureReason = "provider_context_length_exceeded";
		retryable = false;
	} else if (httpStatus === 413 || /payload.?too.?large|request.?entity.?too.?large/i.test(lower)) {
		failureReason = "provider_payload_too_large";
		retryable = false;
	} else if (
		httpStatus === 429 ||
		/rate.?limit|too many requests|tokens per min|tpm|rpm/i.test(lower)
	) {
		if (/insufficient_quota|quota.?exceeded|billing|exceeded your current quota/i.test(lower)) {
			failureReason = "provider_quota_exhausted";
			retryable = false;
		} else {
			failureReason = "provider_rate_limited";
			retryable = true;
		}
	} else if (
		/insufficient_quota|quota.?exceeded|billing|exceeded your current quota/i.test(lower)
	) {
		failureReason = "provider_quota_exhausted";
		retryable = false;
	} else if (/overloaded|engine.?overloaded|server.?busy/i.test(lower)) {
		failureReason = "provider_overloaded";
		retryable = true;
	} else if (
		httpStatus === 408 ||
		httpStatus === 504 ||
		/timeout|timed out|deadline/i.test(lower)
	) {
		failureReason = "provider_timeout";
		retryable = true;
	} else if (
		httpStatus === 500 ||
		httpStatus === 502 ||
		httpStatus === 503 ||
		/internal.?server.?error/i.test(lower)
	) {
		failureReason = "provider_5xx";
		retryable = true;
	} else if (
		providerDiagnostics.networkCode ||
		/fetch failed|econnreset|enotfound|network|socket|dns|undici|und_err/i.test(lower)
	) {
		failureReason = "sdk_transport_error";
		retryable = true;
	} else if (
		httpStatus === 400 ||
		providerDiagnostics.rawProviderType === "invalid_request_error" ||
		/invalid.?request|bad.?request/i.test(lower)
	) {
		failureReason = "provider_bad_request";
		retryable = false;
	} else {
		failureReason = "unknown";
		retryable = false;
	}

	const diagnostic =
		`provider_error (provider=${meta.provider}, model=${meta.model}, ` +
		`reason=${failureReason}, httpStatus=${httpStatus ?? "n/a"}, ` +
		`rawType=${providerDiagnostics.rawProviderType ?? "n/a"}, ` +
		`rawCode=${providerDiagnostics.rawProviderCode ?? "n/a"}, ` +
		`requestId=${providerDiagnostics.providerRequestId ?? "n/a"}, ` +
		`networkCode=${providerDiagnostics.networkCode ?? "n/a"}, ` +
		`cause=${providerDiagnostics.causeName ?? "n/a"}:${providerDiagnostics.causeMessage ?? "n/a"}, ` +
		`error=${e.name}: ${e.message}` +
		(stackHead ? ` stack=${stackHead}` : "") +
		`). Last chunk: ${(meta.chunkSample ?? "(none)").slice(0, 1024)}`;

	return {
		status: "provider_error",
		failureReason,
		diagnostic,
		userMessage: userSafeDeliveryMessage(failureReason),
		httpStatus,
		retryAfterMs,
		retryable,
		providerDiagnostics,
	};
}

export interface EmptyCompletionMeta {
	provider: string;
	model: string;
	chatModelChunks: number;
	otherEvents: string[];
	toolEventSeen: boolean;
	chunkSample: string;
	hadThinkingOnly?: boolean;
}

/** Classify a completed stream that produced no assistant prose. */
export function classifyEmptyModelCompletion(meta: EmptyCompletionMeta): DeliveryFailure {
	let failureReason: AgentFailureReason;
	if (meta.toolEventSeen) {
		failureReason = "agent_tool_loop_no_final";
	} else if (meta.hadThinkingOnly || meta.chatModelChunks > 0) {
		failureReason = "provider_empty_completion";
	} else if (meta.otherEvents.some((e) => /recursion|max.?iter|max.?step/i.test(e))) {
		failureReason = "agent_max_steps";
	} else {
		failureReason = "stream_ended_without_text";
	}

	const diagnostic =
		`empty_completion (provider=${meta.provider}, model=${meta.model}, ` +
		`reason=${failureReason}, chat_model_chunks=${meta.chatModelChunks}, ` +
		`other_events=${meta.otherEvents.slice(0, 8).join(",") || "none"}). ` +
		`Last chunk: ${meta.chunkSample.slice(0, 1024)}`;

	return {
		status: failureReason === "agent_tool_loop_no_final" ? "analysis_error" : "provider_error",
		failureReason,
		diagnostic,
		userMessage: userSafeDeliveryMessage(failureReason),
		retryable: false,
	};
}

/** Raw model text existed but sanitizers left nothing user-facing. */
export function classifyMissingUserFacingResponse(meta: {
	provider: string;
	model: string;
	rawLen: number;
	cause: "sanitizer_removed_all_text" | "missing_user_facing_response";
}): DeliveryFailure {
	const diagnostic =
		`missing_user_facing (provider=${meta.provider}, model=${meta.model}, ` +
		`reason=${meta.cause}, rawLen=${meta.rawLen})`;
	return {
		status: "analysis_error",
		failureReason: meta.cause,
		diagnostic,
		userMessage: userSafeDeliveryMessage(meta.cause),
		retryable: false,
	};
}

/**
 * Bounded retry policy for rate-limit bursts only.
 * Hard quota exhaustion must not retry.
 */
export const PROVIDER_RETRY_POLICY = {
	maxAttempts: 2,
	/** Cap wait when Retry-After is huge. */
	maxDelayMs: 8_000,
	defaultDelayMs: 1_500,
} as const;

export function nextRetryDelayMs(failure: DeliveryFailure, attemptIndex: number): number | null {
	if (!failure.retryable) return null;
	if (attemptIndex >= PROVIDER_RETRY_POLICY.maxAttempts) return null;
	const base = failure.retryAfterMs ?? PROVIDER_RETRY_POLICY.defaultDelayMs * (attemptIndex + 1);
	return Math.min(base, PROVIDER_RETRY_POLICY.maxDelayMs);
}

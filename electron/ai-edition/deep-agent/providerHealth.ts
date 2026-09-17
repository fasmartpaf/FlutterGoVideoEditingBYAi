/**
 * Benchmark/dev-only provider health probe — Recovery 3.
 * Do NOT call on every product chat turn.
 */

import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { type AgentFailureReason, classifyProviderThrownError } from "./deliveryStatus";

export interface ProviderHealthInput {
	provider: string;
	model: string;
	apiKey?: string;
	baseUrl?: string;
}

export interface ProviderHealthResult {
	configured: boolean;
	credentialsPresent: boolean;
	simpleRequestOk: boolean;
	modelAvailable: boolean;
	rateLimited: boolean;
	quotaBlocked: boolean;
	failureReason?: AgentFailureReason;
	httpStatus?: number;
	latencyMs: number;
	/** Safe summary — never includes apiKey. */
	summary: string;
}

export async function probeConfiguredProviderHealth(
	input: ProviderHealthInput,
): Promise<ProviderHealthResult> {
	const credentialsPresent = Boolean(input.apiKey?.trim());
	const configured = Boolean(input.provider && input.model);
	if (!configured) {
		return {
			configured: false,
			credentialsPresent,
			simpleRequestOk: false,
			modelAvailable: false,
			rateLimited: false,
			quotaBlocked: false,
			latencyMs: 0,
			summary: "provider/model not configured",
		};
	}
	if (!credentialsPresent && input.provider !== "local-cli") {
		return {
			configured: true,
			credentialsPresent: false,
			simpleRequestOk: false,
			modelAvailable: false,
			rateLimited: false,
			quotaBlocked: false,
			latencyMs: 0,
			summary: "credentials missing",
		};
	}

	const t0 = Date.now();
	try {
		const model = new ChatOpenAI({
			...(input.apiKey ? { apiKey: input.apiKey } : {}),
			model: input.model,
			maxRetries: 0,
			timeout: 20_000,
			...(input.baseUrl ? { configuration: { baseURL: input.baseUrl } } : {}),
		});
		const res = await model.invoke([new HumanMessage("Reply with exactly: ok")]);
		const text =
			typeof res.content === "string"
				? res.content
				: Array.isArray(res.content)
					? res.content
							.map((p) => (typeof p === "object" && p && "text" in p ? String(p.text) : ""))
							.join("")
					: "";
		const latencyMs = Date.now() - t0;
		const ok = text.trim().length > 0;
		return {
			configured: true,
			credentialsPresent,
			simpleRequestOk: ok,
			modelAvailable: ok,
			rateLimited: false,
			quotaBlocked: false,
			latencyMs,
			summary: ok ? "simple request ok" : "empty completion on health probe",
		};
	} catch (err) {
		const latencyMs = Date.now() - t0;
		const classified = classifyProviderThrownError(err, {
			provider: input.provider,
			model: input.model,
		});
		return {
			configured: true,
			credentialsPresent,
			simpleRequestOk: false,
			modelAvailable: classified.failureReason !== "provider_auth_failed",
			rateLimited: classified.failureReason === "provider_rate_limited",
			quotaBlocked: classified.failureReason === "provider_quota_exhausted",
			failureReason: classified.failureReason,
			httpStatus: classified.httpStatus,
			latencyMs,
			summary: `probe failed: ${classified.failureReason}`,
		};
	}
}

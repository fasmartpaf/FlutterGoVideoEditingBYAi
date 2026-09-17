/**
 * Generic OpenAI-compatible localhost chat provider adapter.
 * Does not call paid cloud APIs. Used for LOCAL_MODEL / LOCAL_SERVER.
 */

import { CORE_EDITORIAL_INVARIANTS } from "./invariants";
import type {
	EditorialReasoningProviderV1,
	EditorialReasoningRequestV1,
	EditorialReasoningResponseV1,
} from "./types";

export interface LocalChatProviderConfig {
	id?: string;
	kind?: "LOCAL_MODEL" | "LOCAL_SERVER";
	/** e.g. http://127.0.0.1:11434/v1/chat/completions */
	baseUrl: string;
	modelId: string;
	timeoutMs?: number;
	apiKey?: string;
}

function buildUserPayload(request: EditorialReasoningRequestV1): string {
	return JSON.stringify(
		{
			goal: request.goal,
			goalText: request.goalText,
			maxDecisions: request.maxDecisions,
			coverage: request.coverage,
			constraints: request.constraints,
			recommendations: request.currentRecommendations.map((r) => ({
				id: r.id,
				family: r.operationFamily,
				status: r.recommendationStatus,
				readiness: r.executionReadiness,
				missing: r.missingParameters,
				copy: r.reviewCopy,
			})),
			questions: request.unresolvedQuestions.map((q) => ({
				id: q.id,
				text: q.text,
			})),
			packet: request.packet,
			knownEvidenceIds: request.knownEvidenceIds,
			outputSchema: {
				requestId: request.requestId,
				decisions: [
					{
						id: "string",
						recommendationId: "string?",
						operationFamily: "TRIM|…",
						decision: "INCLUDE|EXCLUDE|OPTIONAL|ASK_USER|NO_ACTION",
						rationale: "string",
						evidenceRefs: ["known id"],
						constraintRefs: [],
						confidence: "HIGH|MEDIUM|LOW",
						requestedMissingInformation: [],
						executionReadiness: "READY_TO_APPLY|…|N/A",
					},
				],
				questions: [],
				preserve: [],
				summary: "string",
				confidence: "HIGH|MEDIUM|LOW",
				evidenceRefs: [],
			},
		},
		null,
		0,
	);
}

export function createLocalChatEditorialReasoningProvider(
	config: LocalChatProviderConfig,
): EditorialReasoningProviderV1 {
	const kind = config.kind ?? "LOCAL_MODEL";
	return {
		id: config.id ?? `local-chat-${kind.toLowerCase()}`,
		kind,
		capabilities: {
			structuredText: true,
			optionalImages: false,
			maxContextChars: 48_000,
			streamingOptional: false,
			schemaConstrainedOptional: false,
		},
		async reason(request): Promise<EditorialReasoningResponseV1> {
			const t0 = Date.now();
			const user = buildUserPayload(request);
			const inputChars = CORE_EDITORIAL_INVARIANTS.length + user.length;
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 8_000);
			try {
				const res = await fetch(config.baseUrl, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
					},
					body: JSON.stringify({
						model: config.modelId,
						temperature: 0,
						messages: [
							{
								role: "system",
								content: `${CORE_EDITORIAL_INVARIANTS}\nRespond with JSON only matching the outputSchema.`,
							},
							{ role: "user", content: user },
						],
					}),
					signal: controller.signal,
				});
				if (!res.ok) {
					throw new Error(`local provider HTTP ${res.status}`);
				}
				const body = (await res.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
				};
				const content = body.choices?.[0]?.message?.content ?? "";
				const jsonStart = content.indexOf("{");
				const jsonEnd = content.lastIndexOf("}");
				if (jsonStart < 0 || jsonEnd <= jsonStart) {
					throw new Error("local provider returned non-JSON");
				}
				const parsed = JSON.parse(
					content.slice(jsonStart, jsonEnd + 1),
				) as EditorialReasoningResponseV1;
				parsed.requestId = request.requestId;
				parsed.providerMetadata = {
					providerId: config.id ?? "local-chat",
					kind,
					modelId: config.modelId,
					latencyMs: Date.now() - t0,
					inputChars,
					outputChars: content.length,
				};
				return parsed;
			} finally {
				clearTimeout(timeout);
			}
		},
	};
}

/** Probe whether a localhost OpenAI-compatible endpoint responds. */
export async function probeLocalChatEndpoint(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
	try {
		const controller = new AbortController();
		const t = setTimeout(() => controller.abort(), timeoutMs);
		const root = baseUrl.replace(/\/v1\/chat\/completions\/?$/, "");
		const res = await fetch(`${root}/api/tags`, { signal: controller.signal }).catch(async () =>
			fetch(root, { signal: controller.signal }),
		);
		clearTimeout(t);
		return Boolean(res && (res.ok || res.status === 404));
	} catch {
		return false;
	}
}

/**
 * Deterministic safe serialization for TemporalReasoningPacketV1.
 * No functions, Electron objects, native handles, frames, secrets.
 */

import type { TemporalReasoningPacketV1 } from "./types";
import { TEMPORAL_REASONING_PACKET_VERSION } from "./types";

export function serializeTemporalReasoningPacket(packet: TemporalReasoningPacketV1): string {
	// JSON only — reject non-plain by round-trip
	const json = JSON.stringify(packet);
	const parsed = JSON.parse(json) as TemporalReasoningPacketV1;
	if (parsed.version !== TEMPORAL_REASONING_PACKET_VERSION) {
		throw new Error("packet version mismatch after serialize");
	}
	return json;
}

export function deserializeTemporalReasoningPacket(json: string): TemporalReasoningPacketV1 {
	const parsed = JSON.parse(json) as TemporalReasoningPacketV1;
	if (parsed.version !== TEMPORAL_REASONING_PACKET_VERSION) {
		throw new Error(`unsupported packet version: ${String(parsed.version)}`);
	}
	if (parsed.metrics?.additionalModelCalls !== 0) {
		throw new Error("packet must not claim model calls");
	}
	return parsed;
}

export function assertPacketSafeForExport(packet: TemporalReasoningPacketV1): void {
	const json = serializeTemporalReasoningPacket(packet);
	if (json.includes("Bearer ") || json.includes("sk-") || json.includes("apiKey")) {
		throw new Error("packet appears to contain secrets");
	}
	if (json.includes("data:image") || json.includes(".ppm") || json.includes("ArrayBuffer")) {
		throw new Error("packet must not include binary/image payloads");
	}
}

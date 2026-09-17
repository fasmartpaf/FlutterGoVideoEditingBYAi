/**
 * Direct SPEED document mutations (0 LLM).
 * User times are CURRENT PROGRAMME (trim+speed compressed) time.
 * Speed regions are stored on the RAW ruler; map programme ↔ raw via
 * projectRawTimelineSecToPlayback. ZOOM / TRIM are frozen — do not touch them.
 */

import {
	type PlaybackSpeedRegion,
	projectRawTimelineSecToPlayback,
} from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { programmeDurationSec as trimProgrammeDurationSec } from "./directTrim";
import type { LocalEditorialRequestV1 } from "./types";

/** Product default for unspecified “speed up” (matches addSpeed / timeline UI). */
export const DEFAULT_SPEED_UP = 1.5;
/** Product default for unspecified “slow down”. */
export const DEFAULT_SPEED_DOWN = 0.75;

const SPEED_LADDER = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;

export type LegacySpeedRegion = {
	id: string;
	startMs: number;
	endMs: number;
	speed: number;
};

export function listSpeedRegions(doc: AxcutDocument): LegacySpeedRegion[] {
	const legacy = (doc.legacyEditor as Record<string, unknown> | null) ?? {};
	const regions = Array.isArray(legacy.speedRegions)
		? (legacy.speedRegions as LegacySpeedRegion[])
		: [];
	return regions.filter(
		(r) =>
			typeof r?.id === "string" &&
			typeof r.startMs === "number" &&
			typeof r.endMs === "number" &&
			typeof r.speed === "number" &&
			r.speed > 0,
	);
}

function asPlaybackSpeeds(doc: AxcutDocument): PlaybackSpeedRegion[] {
	return listSpeedRegions(doc).map((r) => ({
		startMs: r.startMs,
		endMs: r.endMs,
		speed: r.speed,
	}));
}

function rawExtentEndSec(doc: AxcutDocument): number {
	const clips = doc.timeline.clips;
	if (clips.length === 0) return 0;
	return Math.max(...clips.map((c) => c.timelineEndSec));
}

/** Effective programme duration including existing speed compression. */
export function programmeDurationWithSpeed(doc: AxcutDocument): number {
	const end = rawExtentEndSec(doc);
	if (!(end > 0)) return trimProgrammeDurationSec(doc);
	return projectRawTimelineSecToPlayback(
		doc.timeline.clips,
		doc.timeline.trimRanges ?? [],
		end,
		asPlaybackSpeeds(doc),
	);
}

/** Invert programme time → raw ruler second (binary search). */
export function programmeToRawSec(doc: AxcutDocument, progSec: number): number | null {
	const end = rawExtentEndSec(doc);
	if (!(end > 0)) return null;
	const clips = doc.timeline.clips;
	const trims = doc.timeline.trimRanges ?? [];
	const speeds = asPlaybackSpeeds(doc);
	const target = Math.max(0, progSec);
	const total = projectRawTimelineSecToPlayback(clips, trims, end, speeds);
	if (target <= 0) {
		// First playable raw instant ≈ programme 0
		let lo = 0;
		let hi = end;
		for (let i = 0; i < 48; i++) {
			const mid = (lo + hi) / 2;
			const p = projectRawTimelineSecToPlayback(clips, trims, mid, speeds);
			if (p > 1e-6) hi = mid;
			else lo = mid;
		}
		return hi;
	}
	if (target >= total - 1e-6) return end;
	let lo = 0;
	let hi = end;
	for (let i = 0; i < 56; i++) {
		const mid = (lo + hi) / 2;
		const p = projectRawTimelineSecToPlayback(clips, trims, mid, speeds);
		if (p < target) lo = mid;
		else hi = mid;
	}
	return hi;
}

export function resolveProgrammeSpeedRange(
	doc: AxcutDocument,
	request: LocalEditorialRequestV1,
): { startSec: number; endSec: number } | { error: string } {
	const dur = programmeDurationWithSpeed(doc);
	if (!(dur > 0.05)) {
		return { error: "There isn't enough timeline media to change speed yet." };
	}
	const slot = request.range;
	if (!slot) {
		return {
			error: "I need a time range to change speed (for example “make 5s to 10s 2x”).",
		};
	}
	let startSec = slot.startSec;
	let endSec = slot.endSec;
	if (slot.relativeEdge === "first") {
		startSec = 0;
		endSec = Math.min(slot.endSec, dur);
	} else if (slot.relativeEdge === "last") {
		const len = slot.endSec;
		endSec = dur;
		startSec = Math.max(0, dur - len);
	}
	startSec = Math.max(0, startSec);
	endSec = Math.min(dur, endSec);
	if (!(endSec > startSec + 0.05)) {
		return {
			error: `That range (${startSec.toFixed(1)}s–${endSec.toFixed(1)}s) is outside the current ${dur.toFixed(1)}s programme.`,
		};
	}
	return { startSec, endSec };
}

export function resolveSpeedMultiplier(
	request: LocalEditorialRequestV1,
): number | { error: string } {
	if (typeof request.speedMultiplier === "number" && request.speedMultiplier > 0) {
		if (request.speedMultiplier > 16) {
			return { error: "That playback speed is higher than OpenScreen supports (max 16×)." };
		}
		return request.speedMultiplier;
	}
	if (request.intent === "SLOW_DOWN") return DEFAULT_SPEED_DOWN;
	return DEFAULT_SPEED_UP;
}

function nextLadderSpeed(current: number, direction: "faster" | "slower"): number {
	if (direction === "faster") {
		const up = SPEED_LADDER.find((s) => s > current + 1e-6);
		return up ?? Math.min(16, current * 1.25);
	}
	const downs = [...SPEED_LADDER].reverse().find((s) => s < current - 1e-6);
	return downs ?? Math.max(0.25, current / 1.25);
}

export function applyDirectSpeedRange(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const resolved = resolveProgrammeSpeedRange(args.document, args.request);
	if ("error" in resolved) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: resolved.error,
			families: [],
		};
	}
	const rate = resolveSpeedMultiplier(args.request);
	if (typeof rate !== "number") {
		return {
			document: args.document,
			mutated: false,
			userFacingText: rate.error,
			families: [],
		};
	}
	if (Math.abs(rate - 1) < 1e-6) {
		return applyDirectReturnSpeedToNormal({
			document: args.document,
			request: args.request,
			programmeStartSec: resolved.startSec,
			programmeEndSec: resolved.endSec,
		});
	}

	const rawStart = programmeToRawSec(args.document, resolved.startSec);
	const rawEnd = programmeToRawSec(args.document, resolved.endSec);
	if (rawStart == null || rawEnd == null || !(rawEnd > rawStart + 0.05)) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: `I couldn't map ${resolved.startSec.toFixed(1)}s–${resolved.endSec.toFixed(1)}s onto the timeline to change speed.`,
			families: [],
		};
	}

	const result = executeAgentTool(
		args.document,
		"addSpeed",
		JSON.stringify({
			startSec: rawStart,
			endSec: rawEnd,
			speed: rate,
		}),
		{ editsAllowed: true },
	);
	if (!result.ok || !result.document) {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				result.summary ??
				`I couldn't apply ${rate}× speed to ${resolved.startSec.toFixed(1)}s–${resolved.endSec.toFixed(1)}s.`,
			families: [],
		};
	}
	const afterDur = programmeDurationWithSpeed(result.document);
	return {
		document: result.document,
		mutated: true,
		userFacingText: `I set ${resolved.startSec.toFixed(1)}s–${resolved.endSec.toFixed(1)}s to ${rate}× on the current timeline (programme is now about ${afterDur.toFixed(1)}s).`,
		families: ["speed"],
	};
}

function applyDirectReturnSpeedToNormal(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
	programmeStartSec?: number;
	programmeEndSec?: number;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const regions = listSpeedRegions(args.document);
	if (regions.length === 0) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "There isn't a speed change on the timeline to reset.",
			families: [],
		};
	}
	let target = regions[regions.length - 1]!;
	if (typeof args.programmeStartSec === "number" && typeof args.programmeEndSec === "number") {
		const rawStart = programmeToRawSec(args.document, args.programmeStartSec);
		const rawEnd = programmeToRawSec(args.document, args.programmeEndSec);
		if (rawStart != null && rawEnd != null) {
			const mid = (rawStart + rawEnd) / 2;
			const hit = regions.find((r) => mid * 1000 >= r.startMs && mid * 1000 < r.endMs);
			if (hit) target = hit;
		}
	}
	const removed = executeAgentTool(
		args.document,
		"removeModifier",
		JSON.stringify({ id: target.id }),
		{ editsAllowed: true },
	);
	if (!removed.ok || !removed.document) {
		// Fallback: pop last
		const legacy = { ...((args.document.legacyEditor as Record<string, unknown>) ?? {}) };
		const next = regions.filter((r) => r.id !== target.id);
		legacy.speedRegions = next;
		return {
			document: { ...args.document, legacyEditor: legacy },
			mutated: true,
			userFacingText: "I returned that section to normal (1×) speed.",
			families: ["speed"],
		};
	}
	return {
		document: removed.document,
		mutated: true,
		userFacingText: "I returned that section to normal (1×) speed.",
		families: ["speed"],
	};
}

export function applyDirectSpeedAdjust(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
} {
	const regions = listSpeedRegions(args.document);
	if (regions.length === 0) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: "There isn't a speed change on the timeline to adjust.",
			families: [],
		};
	}
	const last = regions[regions.length - 1]!;
	const n = args.request.rawText.toLowerCase();

	if (/\bnormal\b|\b1\s*x\b|\b1\.0\s*x\b|\breturn\b.*\bnormal\b|\breset\b.*\bspeed\b/.test(n)) {
		return applyDirectReturnSpeedToNormal({
			document: args.document,
			request: args.request,
		});
	}

	let speed = last.speed;
	let startSec = last.startMs / 1000;
	let endSec = last.endMs / 1000;
	const half = 0.5;
	const bit = 0.35;

	if (typeof args.request.speedMultiplier === "number" && args.request.speedMultiplier > 0) {
		speed = args.request.speedMultiplier;
	} else if (
		/\b(?:much\s+)?faster\b|\bstronger\b|\ba\s+little\s+more\b|\ba\s+little\s+faster\b/.test(n)
	) {
		const much = /\bmuch\b/.test(n);
		speed = much
			? nextLadderSpeed(nextLadderSpeed(speed, "faster"), "faster")
			: nextLadderSpeed(speed, "faster");
	} else if (
		/\b(?:much\s+)?slower\b|\bweaker\b|\breduce\b|\btoo\s+fast\b|\bless\b/.test(n) &&
		!/\bearlier|later|start|end\b/.test(n)
	) {
		speed = nextLadderSpeed(speed, "slower");
	}

	if (/\bearlier\b|\bstart\b.*\bearlier\b|\bhalf\s+(?:a\s+)?sec(?:ond)?\s+earlier\b/.test(n)) {
		startSec = Math.max(0, startSec - (/\bhalf\b/.test(n) ? half : bit));
	}
	if (
		/\blater\b|\bend\b.*\blater\b|\bone\s+sec(?:ond)?\s+later\b|\bhalf\s+(?:a\s+)?sec(?:ond)?\s+later\b/.test(
			n,
		)
	) {
		const delta = /\bone\s+sec/.test(n) ? 1 : /\bhalf\b/.test(n) ? half : bit;
		endSec = endSec + delta;
	}

	if (
		Math.abs(speed - last.speed) < 0.02 &&
		Math.abs(startSec - last.startMs / 1000) < 0.02 &&
		Math.abs(endSec - last.endMs / 1000) < 0.02
	) {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				"I need a clearer speed adjustment (for example “a little faster” or “start half a second earlier”).",
			families: [],
		};
	}

	if (Math.abs(speed - 1) < 1e-6) {
		return applyDirectReturnSpeedToNormal({
			document: args.document,
			request: args.request,
		});
	}

	const result = executeAgentTool(
		args.document,
		"setSpeed",
		JSON.stringify({
			speedId: last.id,
			startSec,
			endSec,
			speed,
		}),
		{ editsAllowed: true },
	);
	if (!result.ok || !result.document) {
		return {
			document: args.document,
			mutated: false,
			userFacingText: result.summary ?? "I couldn't adjust that speed change.",
			families: [],
		};
	}
	const afterDur = programmeDurationWithSpeed(result.document);
	return {
		document: result.document,
		mutated: true,
		userFacingText: `I updated that speed to ${speed}× (${startSec.toFixed(1)}s–${endSec.toFixed(1)}s on the timeline; programme is now about ${afterDur.toFixed(1)}s).`,
		families: ["speed"],
	};
}

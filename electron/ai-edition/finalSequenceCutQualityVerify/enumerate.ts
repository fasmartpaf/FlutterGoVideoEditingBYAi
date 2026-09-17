/**
 * Deterministic programme join enumeration from AxcutDocument playback mapping.
 * Does not invent a second timeline — wraps resolvePlaybackSegments.
 */

import { createHash } from "node:crypto";
import { resolvePlaybackSegments } from "../../../src/lib/ai-edition/document/timeline";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { programmeFingerprintFromDocument } from "../captionLayout/operation";
import type { JoinCause, ProgrammeJoinV1 } from "./types";

const SOURCE_EPS = 1e-3;
const PROG_EPS = 1e-6;

function stableJoinId(parts: Array<string | number>): string {
	const h = createHash("sha256");
	h.update(parts.map(String).join("|"));
	return `join_${h.digest("hex").slice(0, 16)}`;
}

function baseClipId(segId: string): string {
	return segId.replace(/_seg\d+$/, "");
}

function classifyAbutment(args: {
	left: {
		id: string;
		assetId: string;
		sourceStartSec: number;
		sourceEndSec: number;
	};
	right: {
		id: string;
		assetId: string;
		sourceStartSec: number;
		sourceEndSec: number;
	};
	trimIdsCoveringGap: string[];
}): { cause: JoinCause; editCreated: boolean; mutationRefs: string[] } {
	const sameAsset = args.left.assetId === args.right.assetId;
	const sourceContinuous =
		sameAsset && Math.abs(args.right.sourceStartSec - args.left.sourceEndSec) <= SOURCE_EPS;
	const sameBaseClip = baseClipId(args.left.id) === baseClipId(args.right.id);

	if (sourceContinuous && sameBaseClip) {
		return { cause: "NATURAL_CONTINUITY", editCreated: false, mutationRefs: [] };
	}
	if (args.trimIdsCoveringGap.length > 0 || (sameAsset && !sourceContinuous && sameBaseClip)) {
		return {
			cause: "TRIM_CREATED",
			editCreated: true,
			mutationRefs: args.trimIdsCoveringGap.map((id) => `trim:${id}`),
		};
	}
	if (!sameBaseClip) {
		return {
			cause: "CLIP_TO_CLIP",
			editCreated: true,
			mutationRefs: [`clip:${baseClipId(args.left.id)}`, `clip:${baseClipId(args.right.id)}`],
		};
	}
	return {
		cause: "SOURCE_DISCONTINUITY",
		editCreated: true,
		mutationRefs: [],
	};
}

function trimsInSourceGap(
	doc: AxcutDocument,
	assetId: string,
	leftEnd: number,
	rightStart: number,
): string[] {
	if (!(rightStart > leftEnd + SOURCE_EPS)) return [];
	return doc.timeline.trimRanges
		.filter(
			(t) =>
				t.assetId === assetId &&
				t.startSec < rightStart - SOURCE_EPS &&
				t.endSec > leftEnd + SOURCE_EPS,
		)
		.map((t) => t.id);
}

function readSpeedRegions(
	doc: AxcutDocument,
): Array<{ startSec: number; endSec: number; speed: number }> {
	const legacy = doc.legacyEditor as Record<string, unknown> | null | undefined;
	const raw = legacy?.speedRegions;
	if (!Array.isArray(raw)) return [];
	const out: Array<{ startSec: number; endSec: number; speed: number }> = [];
	for (const r of raw) {
		const o = r as Record<string, unknown>;
		const start =
			typeof o.startSec === "number"
				? o.startSec
				: typeof o.startMs === "number"
					? o.startMs / 1000
					: NaN;
		const end =
			typeof o.endSec === "number" ? o.endSec : typeof o.endMs === "number" ? o.endMs / 1000 : NaN;
		const speed = typeof o.speed === "number" ? o.speed : NaN;
		if (Number.isFinite(start) && Number.isFinite(end) && end > start && speed > 0 && speed !== 1) {
			out.push({ startSec: start, endSec: end, speed });
		}
	}
	return out;
}

/** Map a raw/source-ish speed edge onto compressed programme via segment scan. */
function programmeTimeNearSource(
	segs: ReturnType<typeof resolvePlaybackSegments>,
	sourceSec: number,
	assetId: string,
): number | null {
	for (const s of segs) {
		if (s.assetId !== assetId) continue;
		const srcEnd = s.sourceEndSec ?? s.sourceStartSec;
		if (sourceSec >= s.sourceStartSec - SOURCE_EPS && sourceSec <= srcEnd + SOURCE_EPS) {
			const offset = Math.max(0, sourceSec - s.sourceStartSec);
			return s.timelineStartSec + offset;
		}
	}
	return null;
}

export function mediaFingerprintLite(doc: AxcutDocument, assetId: string): string {
	const a = doc.assets.find((x) => x.id === assetId);
	const h = createHash("sha256");
	h.update(assetId);
	h.update("|");
	h.update(a?.originalPath ?? "");
	h.update("|");
	h.update(String(a?.durationSec ?? 0));
	return h.digest("hex").slice(0, 24);
}

export function enumerateProgrammeJoins(args: {
	document: AxcutDocument;
	assetId?: string;
	/** Include NATURAL_CONTINUITY abutments (default false — usually not QC targets). */
	includeNatural?: boolean;
}): {
	joins: ProgrammeJoinV1[];
	programmeFingerprint: string;
	mediaFingerprint: string;
	assetId: string;
	enumerateMs: number;
} {
	const t0 = Date.now();
	const doc = args.document;
	const assetId =
		args.assetId ??
		doc.project.primaryAssetId ??
		doc.assets.find((a) => a.kind !== "audio")?.id ??
		doc.assets[0]?.id ??
		"";
	const segs = resolvePlaybackSegments(doc.timeline.clips, doc.timeline.trimRanges);
	const joins: ProgrammeJoinV1[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < segs.length - 1; i += 1) {
		const left = segs[i]!;
		const right = segs[i + 1]!;
		const programmeTimeSec = left.timelineEndSec;
		if (Math.abs(right.timelineStartSec - programmeTimeSec) > PROG_EPS) {
			// Gap in programme (should not happen with resolvePlaybackSegments) — still record.
		}
		const leftEnd = left.sourceEndSec ?? left.sourceStartSec;
		const rightStart = right.sourceStartSec;
		const trimIds = trimsInSourceGap(doc, left.assetId, leftEnd, rightStart);
		const classified = classifyAbutment({
			left: {
				id: left.id,
				assetId: left.assetId,
				sourceStartSec: left.sourceStartSec,
				sourceEndSec: leftEnd,
			},
			right: {
				id: right.id,
				assetId: right.assetId,
				sourceStartSec: rightStart,
				sourceEndSec: right.sourceEndSec ?? rightStart,
			},
			trimIdsCoveringGap: trimIds,
		});
		if (classified.cause === "NATURAL_CONTINUITY" && !args.includeNatural) continue;

		const joinId = stableJoinId([
			"abut",
			programmeTimeSec.toFixed(4),
			left.id,
			right.id,
			classified.cause,
			leftEnd.toFixed(4),
			rightStart.toFixed(4),
		]);
		if (seen.has(joinId)) continue;
		seen.add(joinId);
		joins.push({
			joinId,
			programmeTimeSec,
			leftSourceRange: { startSec: left.sourceStartSec, endSec: leftEnd },
			rightSourceRange: {
				startSec: rightStart,
				endSec: right.sourceEndSec ?? rightStart,
			},
			leftClipId: left.id,
			rightClipId: right.id,
			leftAssetId: left.assetId,
			rightAssetId: right.assetId,
			cause: classified.cause,
			editCreated: classified.editCreated,
			mutationRefs: classified.mutationRefs,
		});
	}

	// Speed boundaries (not necessarily cuts)
	const speeds = readSpeedRegions(doc);
	for (const sp of speeds) {
		for (const edge of [sp.startSec, sp.endSec]) {
			const prog = programmeTimeNearSource(segs, edge, assetId);
			if (prog == null) continue;
			const joinId = stableJoinId(["speed", edge.toFixed(4), sp.speed, prog.toFixed(4)]);
			if (seen.has(joinId)) continue;
			seen.add(joinId);
			const inst = segs.find(
				(s) =>
					s.assetId === assetId &&
					edge >= s.sourceStartSec - SOURCE_EPS &&
					edge <= (s.sourceEndSec ?? s.sourceStartSec) + SOURCE_EPS,
			);
			joins.push({
				joinId,
				programmeTimeSec: prog,
				leftSourceRange: { startSec: edge - 0.01, endSec: edge },
				rightSourceRange: { startSec: edge, endSec: edge + 0.01 },
				leftClipId: inst?.id ?? "speed",
				rightClipId: inst?.id ?? "speed",
				leftAssetId: assetId,
				rightAssetId: assetId,
				cause: "SPEED_BOUNDARY",
				editCreated: true,
				mutationRefs: [`speed:${sp.speed}@${edge.toFixed(3)}`],
			});
		}
	}

	joins.sort((a, b) => a.programmeTimeSec - b.programmeTimeSec || a.joinId.localeCompare(b.joinId));

	return {
		joins,
		programmeFingerprint: programmeFingerprintFromDocument(doc),
		mediaFingerprint: mediaFingerprintLite(doc, assetId),
		assetId,
		enumerateMs: Date.now() - t0,
	};
}

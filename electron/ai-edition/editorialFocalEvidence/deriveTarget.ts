/**
 * Derive GroundedEditorialFocalTargetV1 from evidence — no invented centers.
 */

import { fingerprintSource } from "./buildEvidence";
import { pointNearRegion, rangesOverlap } from "./cursorMetrics";
import { FOCAL_POLICY_V1 } from "./policy";
import type {
	EditorialFocalEvidenceV1,
	GroundedEditorialFocalTargetV1,
	GroundedFocalTargetStatus,
	NormalizedPointV1,
	NormalizedRegionV1,
} from "./types";

function area(r: NormalizedRegionV1): number {
	return Math.max(0, r.width) * Math.max(0, r.height);
}

function dist(a: NormalizedPointV1, b: NormalizedPointV1): number {
	return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function unionRegion(a: NormalizedRegionV1, b: NormalizedRegionV1): NormalizedRegionV1 {
	const x0 = Math.min(a.x, b.x);
	const y0 = Math.min(a.y, b.y);
	const x1 = Math.max(a.x + a.width, b.x + b.width);
	const y1 = Math.max(a.y + a.height, b.y + b.height);
	return { x: x0, y: y0, width: Math.max(0.01, x1 - x0), height: Math.max(0.01, y1 - y0) };
}

function statusRank(s: GroundedFocalTargetStatus): number {
	return s === "GROUNDED" ? 0 : s === "WEAK" ? 1 : 2;
}

function confRank(c: GroundedEditorialFocalTargetV1["confidence"]): number {
	return c === "HIGH" ? 3 : c === "MEDIUM" ? 2 : 1;
}

/** Instant times used for concurrency — long cluster spans must not invent overlap. */
function interactionInstants(
	seed: EditorialFocalEvidenceV1,
	support: EditorialFocalEvidenceV1[],
): number[] {
	const out: number[] = [];
	for (const e of [seed, ...support]) {
		if (e.kind === "CURSOR_CLICK") {
			out.push(e.sourceRange.startSec);
		}
	}
	if (out.length === 0) {
		out.push(seed.sourceRange.startSec);
		if (seed.sourceRange.endSec - seed.sourceRange.startSec < 1.2) {
			out.push((seed.sourceRange.startSec + seed.sourceRange.endSec) / 2);
		}
	}
	return out;
}

function coresConcurrent(a: number[], b: number[], windowSec = 0.75): boolean {
	return a.some((ta) => b.some((tb) => Math.abs(ta - tb) <= windowSec));
}

type FocalSeedBag = {
	seed: EditorialFocalEvidenceV1;
	support: EditorialFocalEvidenceV1[];
	status: GroundedFocalTargetStatus;
	reasonCode: string;
	confidence: GroundedEditorialFocalTargetV1["confidence"];
};

/**
 * Merge seeds whose foci are within competeDistance into one strengthened target.
 * Does not lower confidence thresholds — only consolidates same-region interactions.
 */
export function mergeNearbyFocalSeeds(seeds: FocalSeedBag[]): FocalSeedBag[] {
	const out: FocalSeedBag[] = [];
	for (const s of seeds) {
		const fp = s.seed.focalPoint;
		const region = s.seed.normalizedRegion;
		if (!fp || !region) {
			out.push(s);
			continue;
		}
		const hit = out.find((o) => {
			const ofp = o.seed.focalPoint;
			if (!ofp || dist(ofp, fp) > FOCAL_POLICY_V1.competeDistance) return false;
			// Spatially near but temporally distant = separate beats (do not create 20s zooms).
			const gap = Math.min(
				Math.abs(o.seed.sourceRange.startSec - s.seed.sourceRange.startSec),
				Math.abs(o.seed.sourceRange.endSec - s.seed.sourceRange.endSec),
				Math.abs(
					(o.seed.sourceRange.startSec + o.seed.sourceRange.endSec) / 2 -
						(s.seed.sourceRange.startSec + s.seed.sourceRange.endSec) / 2,
				),
			);
			return gap <= FOCAL_POLICY_V1.mergeMaxTemporalGapSec;
		});
		if (!hit || !hit.seed.focalPoint || !hit.seed.normalizedRegion) {
			out.push({
				...s,
				support: [...s.support],
			});
			continue;
		}
		const supportIds = new Set(hit.support.map((e) => e.id));
		for (const e of s.support) {
			if (!supportIds.has(e.id)) hit.support.push(e);
		}
		const n = 2;
		hit.seed = {
			...hit.seed,
			focalPoint: {
				cx: (hit.seed.focalPoint.cx + fp.cx) / n,
				cy: (hit.seed.focalPoint.cy + fp.cy) / n,
			},
			normalizedRegion: unionRegion(hit.seed.normalizedRegion, region),
			sourceRange: {
				startSec: Math.min(hit.seed.sourceRange.startSec, s.seed.sourceRange.startSec),
				endSec: Math.max(hit.seed.sourceRange.endSec, s.seed.sourceRange.endSec),
			},
		};
		if (statusRank(s.status) < statusRank(hit.status)) hit.status = s.status;
		if (confRank(s.confidence) > confRank(hit.confidence)) hit.confidence = s.confidence;
		if (
			s.reasonCode === "INTERACTION_CLUSTER" ||
			s.reasonCode === "CLICK_DWELL_PERSISTENCE" ||
			s.seed.kind === "CURSOR_CLUSTER" ||
			s.seed.kind === "INTERACTION_REGION"
		) {
			hit.reasonCode = s.reasonCode;
		}
	}
	return out;
}

function hasKind(
	ids: string[],
	evidence: EditorialFocalEvidenceV1[],
	kind: EditorialFocalEvidenceV1["kind"],
): boolean {
	return ids.some((id) => evidence.find((e) => e.id === id)?.kind === kind);
}

export function deriveGroundedFocalTargets(args: {
	evidence: EditorialFocalEvidenceV1[];
	sourceFingerprint: string;
	maxTargets?: number;
}): GroundedEditorialFocalTargetV1[] {
	const max = args.maxTargets ?? 4;
	const evidence = args.evidence;
	const candidates = evidence.filter(
		(e) =>
			(e.kind === "CURSOR_CLICK" ||
				e.kind === "CURSOR_CLUSTER" ||
				e.kind === "CURSOR_DWELL" ||
				e.kind === "CURSOR_APPROACH" ||
				e.kind === "INTERACTION_REGION") &&
			e.focalPoint &&
			e.normalizedRegion,
	);

	if (candidates.length === 0) {
		return [
			{
				targetId: "tgt_none",
				sourceRange: { startSec: 0, endSec: 0 },
				normalizedRegion: { x: 0, y: 0, width: 1, height: 1 },
				focalPoint: { cx: 0.5, cy: 0.5 },
				confidence: "LOW",
				evidenceIds: [],
				evidenceFamilies: [],
				reasonCode: "NO_GROUNDED_FOCAL_TARGET",
				stability: "UNKNOWN",
				sourceFingerprint: args.sourceFingerprint,
				status: "NO_TARGET",
			},
		];
	}

	type Seed = {
		seed: EditorialFocalEvidenceV1;
		support: EditorialFocalEvidenceV1[];
		status: GroundedFocalTargetStatus;
		reasonCode: string;
		confidence: GroundedEditorialFocalTargetV1["confidence"];
	};

	const seedsRaw: Seed[] = [];

	for (const seed of candidates) {
		const support = evidence.filter((e) => {
			if (e.id === seed.id) return true;
			if (!e.focalPoint && !e.normalizedRegion && e.kind !== "VISUAL_CHANGE_REGION") {
				return rangesOverlap(seed.sourceRange, e.sourceRange, 0.25);
			}
			if (e.kind === "VISUAL_CHANGE_REGION") {
				if (e.metrics?.fullFrame === true) return false;
				return rangesOverlap(
					seed.sourceRange,
					e.sourceRange,
					FOCAL_POLICY_V1.visualCorroborationWindowSec,
				);
			}
			if (e.kind === "VISIBLE_TEXT_REGION" && e.normalizedRegion && seed.focalPoint) {
				return (
					rangesOverlap(seed.sourceRange, e.sourceRange, 0.4) &&
					pointNearRegion(seed.focalPoint, e.normalizedRegion, FOCAL_POLICY_V1.ocrNearDistance)
				);
			}
			if (e.focalPoint && seed.focalPoint) {
				return (
					rangesOverlap(seed.sourceRange, e.sourceRange, 0.35) &&
					dist(e.focalPoint, seed.focalPoint) <= FOCAL_POLICY_V1.competeDistance
				);
			}
			return false;
		});

		const parked = seed.kind === "CURSOR_DWELL" && seed.metrics?.parkedNoInteraction === true;
		const clickWithDwell = seed.kind === "CURSOR_CLICK" && seed.metrics?.hasLocalDwell === true;
		const cluster = seed.kind === "CURSOR_CLUSTER" || seed.kind === "INTERACTION_REGION";
		const ocrAgree = support.some((s) => s.kind === "VISIBLE_TEXT_REGION");
		const visualLocal = support.some(
			(s) => s.kind === "VISUAL_CHANGE_REGION" && s.metrics?.fullFrame !== true,
		);

		let status: GroundedFocalTargetStatus = "WEAK";
		let reasonCode = "INSUFFICIENT_TEMPORAL_SUPPORT";
		let confidence: GroundedEditorialFocalTargetV1["confidence"] = "LOW";

		if (parked && !clickWithDwell && !cluster) {
			status = "WEAK";
			reasonCode = "PARKED_NO_INTERACTION";
			confidence = "LOW";
		} else if (clickWithDwell || cluster) {
			status = "GROUNDED";
			reasonCode = cluster ? "INTERACTION_CLUSTER" : "CLICK_DWELL_PERSISTENCE";
			confidence = ocrAgree || visualLocal ? "HIGH" : "MEDIUM";
		} else if (
			seed.kind === "CURSOR_APPROACH" &&
			support.some((s) => s.kind === "CURSOR_CLICK" || s.kind === "CURSOR_CLUSTER")
		) {
			status = "GROUNDED";
			reasonCode = "APPROACH_WITH_INTERACTION";
			confidence = "MEDIUM";
		} else if (seed.kind === "CURSOR_APPROACH") {
			status = "WEAK";
			reasonCode = "APPROACH_WITHOUT_INTERACTION";
			confidence = "LOW";
		} else if (seed.kind === "CURSOR_DWELL" && (visualLocal || ocrAgree)) {
			// Dwell alone + corroboration still WEAK — need interaction for GROUNDED
			status = "WEAK";
			reasonCode = "DWELL_WITHOUT_INTERACTION";
			confidence = "LOW";
		} else if (seed.kind === "CURSOR_CLICK" && !clickWithDwell) {
			status = "WEAK";
			reasonCode = "CLICK_WITHOUT_LOCAL_DWELL";
			confidence = "LOW";
		}

		// OCR / visual alone never create seeds (filtered above). If only text:
		seedsRaw.push({ seed, support, status, reasonCode, confidence });
	}

	// Same-region seeds strengthen one target — do not invent multi-target conflict.
	const seeds = mergeNearbyFocalSeeds(seedsRaw);

	// Text-only evidence must not produce grounded targets
	const textOnly = evidence.filter((e) => e.kind === "VISIBLE_TEXT_REGION");
	if (candidates.length === 0 && textOnly.length > 0) {
		return [
			{
				targetId: "tgt_ocr_only",
				sourceRange: textOnly[0]!.sourceRange,
				normalizedRegion: textOnly[0]!.normalizedRegion!,
				focalPoint: textOnly[0]!.focalPoint ?? { cx: 0.5, cy: 0.5 },
				confidence: "LOW",
				evidenceIds: textOnly.map((t) => t.id),
				evidenceFamilies: ["VISIBLE_TEXT_REGION"],
				reasonCode: "OCR_WITHOUT_INTERACTION",
				stability: "UNKNOWN",
				sourceFingerprint: args.sourceFingerprint,
				status: "WEAK",
			},
		];
	}

	// Full-frame visual-only → NO_TARGET
	const onlyFullVisual =
		candidates.length === 0 &&
		evidence.some((e) => e.kind === "VISUAL_CHANGE_REGION" && e.metrics?.fullFrame === true);
	if (onlyFullVisual) {
		return [
			{
				targetId: "tgt_fullscreen",
				sourceRange: { startSec: 0, endSec: 0 },
				normalizedRegion: { x: 0, y: 0, width: 1, height: 1 },
				focalPoint: { cx: 0.5, cy: 0.5 },
				confidence: "LOW",
				evidenceIds: evidence.filter((e) => e.kind === "VISUAL_CHANGE_REGION").map((e) => e.id),
				evidenceFamilies: ["VISUAL_CHANGE_REGION"],
				reasonCode: "FULL_FRAME_SCENE_CHANGE",
				stability: "UNKNOWN",
				sourceFingerprint: args.sourceFingerprint,
				status: "NO_TARGET",
			},
		];
	}

	/**
	 * Concurrent competing grounded regions (far + overlapping time) → CONFLICTING.
	 * Sequential actions in different UI regions must NOT void all zoom — demote
	 * secondary far seeds to WEAK and keep the strongest primary GROUNDED.
	 */
	const groundedSeeds = seeds.filter((s) => s.status === "GROUNDED");
	if (groundedSeeds.length >= 2) {
		const supportScore = (s: FocalSeedBag) =>
			s.support.length * 10 +
			(s.confidence === "HIGH" ? 5 : s.confidence === "MEDIUM" ? 3 : 1) +
			(s.seed.sourceRange.endSec - s.seed.sourceRange.startSec);
		const ranked = [...groundedSeeds].sort((a, b) => supportScore(b) - supportScore(a));
		const primary = ranked[0]!;
		const primaryFp = primary.seed.focalPoint!;
		const concurrentFar = ranked.slice(1).filter((s) => {
			if (dist(s.seed.focalPoint!, primaryFp) <= FOCAL_POLICY_V1.competeDistance) {
				return false;
			}
			if (
				!coresConcurrent(
					interactionInstants(primary.seed, primary.support),
					interactionInstants(s.seed, s.support),
				)
			) {
				return false;
			}
			// Only treat as hard conflict when the competitor is comparably strong.
			// A clearly dominant primary keeps GROUNDED; secondary stays deferred.
			return supportScore(s) * 2 >= supportScore(primary);
		});
		if (concurrentFar.length > 0) {
			const far = concurrentFar[0]!;
			return [
				{
					targetId: `tgt_conflict_${fingerprintSource([primaryFp.cx, primaryFp.cy, far.seed.focalPoint!.cx])}`,
					sourceRange: primary.seed.sourceRange,
					normalizedRegion: primary.seed.normalizedRegion!,
					focalPoint: primaryFp,
					confidence: "LOW",
					evidenceIds: [...primary.support.map((s) => s.id), ...far.support.map((s) => s.id)],
					evidenceFamilies: [
						...new Set([...primary.support.map((s) => s.kind), ...far.support.map((s) => s.kind)]),
					],
					reasonCode: "COMPETING_INTERACTION_REGIONS",
					stability: "UNKNOWN",
					sourceFingerprint: args.sourceFingerprint,
					status: "CONFLICTING",
				},
			];
		}
		// Temporally separate far regions: keep primary; demote secondaries.
		for (const s of ranked.slice(1)) {
			if (dist(s.seed.focalPoint!, primaryFp) > FOCAL_POLICY_V1.competeDistance) {
				s.status = "WEAK";
				s.reasonCode = "SECONDARY_REGION_DEFERRED";
				if (confRank(s.confidence) > confRank("LOW")) s.confidence = "LOW";
			}
		}
	}

	const out: GroundedEditorialFocalTargetV1[] = [];
	const ranked = [...seeds].sort((a, b) => {
		const rank = (s: GroundedFocalTargetStatus) => (s === "GROUNDED" ? 0 : s === "WEAK" ? 1 : 2);
		return rank(a.status) - rank(b.status);
	});

	for (const s of ranked) {
		if (out.length >= max) break;
		const seed = s.seed;
		const dur = seed.sourceRange.endSec - seed.sourceRange.startSec;
		const stability = dur >= FOCAL_POLICY_V1.minGroundedPersistSec ? "STABLE" : "TRANSIENT";
		const families = [...new Set(s.support.map((e) => e.kind))];
		out.push({
			targetId: `tgt_${fingerprintSource([seed.id, seed.focalPoint!.cx, seed.focalPoint!.cy])}`,
			sourceRange: { ...seed.sourceRange },
			normalizedRegion: { ...seed.normalizedRegion! },
			focalPoint: { ...seed.focalPoint! },
			confidence: s.confidence,
			evidenceIds: s.support.map((e) => e.id),
			evidenceFamilies: families,
			reasonCode: s.reasonCode,
			stability,
			sourceFingerprint: args.sourceFingerprint,
			status: s.status,
		});
	}

	if (out.length === 0) {
		return [
			{
				targetId: "tgt_none",
				sourceRange: { startSec: 0, endSec: 0 },
				normalizedRegion: { x: 0, y: 0, width: 1, height: 1 },
				focalPoint: { cx: 0.5, cy: 0.5 },
				confidence: "LOW",
				evidenceIds: [],
				evidenceFamilies: [],
				reasonCode: "NO_GROUNDED_FOCAL_TARGET",
				stability: "UNKNOWN",
				sourceFingerprint: args.sourceFingerprint,
				status: "NO_TARGET",
			},
		];
	}

	return out;
}

export function targetAreaFraction(t: GroundedEditorialFocalTargetV1): number {
	return area(t.normalizedRegion);
}

export function evidenceHasFamily(
	t: GroundedEditorialFocalTargetV1,
	kind: EditorialFocalEvidenceV1["kind"],
): boolean {
	return t.evidenceFamilies.includes(kind) || hasKind(t.evidenceIds, [], kind);
}

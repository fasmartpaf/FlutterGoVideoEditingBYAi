/**
 * Placement candidates + continuity (hysteresis).
 */

import { detectCollisions, hasBlockingCollision } from "./collision";
import { placementBox } from "./safeArea";
import type {
	CaptionCollision,
	CaptionPlacementId,
	CaptionProtectedRegion,
	CaptionSafeArea,
	NormalizedRect,
} from "./types";

export const PLACEMENT_CANDIDATES: CaptionPlacementId[] = [
	"BOTTOM_CENTER",
	"TOP_CENTER",
	"BOTTOM_LEFT",
	"BOTTOM_RIGHT",
];

export interface PlacementChoice {
	placement: CaptionPlacementId;
	box: NormalizedRect;
	collisions: CaptionCollision[];
	score: number;
	changedFrom?: CaptionPlacementId;
	changeReason?: string;
}

function scorePlacement(
	placement: CaptionPlacementId,
	collisions: CaptionCollision[],
	previous: CaptionPlacementId | null,
): number {
	let score = 100;
	if (placement === "BOTTOM_CENTER") score += 15;
	if (placement === "TOP_CENTER") score += 5;
	for (const c of collisions) {
		if (c.severity === "blocking") score -= 200;
		else if (c.severity === "high") score -= 40;
		else if (c.severity === "medium") score -= 20;
		else score -= 5;
		score -= c.overlapRatio * 30;
	}
	if (previous && placement === previous) score += 25; // continuity bonus
	if (previous && placement !== previous) score -= 10;
	return score;
}

export function choosePlacement(args: {
	cueId: string;
	safeArea: CaptionSafeArea;
	boxHeightFrac: number;
	protectedRegions: CaptionProtectedRegion[];
	previousPlacement: CaptionPlacementId | null;
	preferContinuity: boolean;
}): PlacementChoice {
	const evaluated: PlacementChoice[] = [];
	for (const placement of PLACEMENT_CANDIDATES) {
		const box = placementBox(placement, args.safeArea, args.boxHeightFrac);
		const collisions = detectCollisions({
			cueId: args.cueId,
			box,
			safeAreaColumn: args.safeArea.column,
			protectedRegions: args.protectedRegions,
		});
		evaluated.push({
			placement,
			box,
			collisions,
			score: scorePlacement(
				placement,
				collisions,
				args.preferContinuity ? args.previousPlacement : null,
			),
		});
	}
	evaluated.sort((a, b) => b.score - a.score);

	// Continuity: keep previous if not blocking.
	if (args.preferContinuity && args.previousPlacement) {
		const prev = evaluated.find((e) => e.placement === args.previousPlacement);
		if (prev && !hasBlockingCollision(prev.collisions)) {
			return {
				...prev,
				changedFrom: undefined,
				changeReason: undefined,
			};
		}
		const best = evaluated[0]!;
		return {
			...best,
			changedFrom: args.previousPlacement,
			changeReason: prev ? "previous_had_blocking_collision" : "previous_unavailable",
		};
	}

	const best = evaluated[0]!;
	return best;
}

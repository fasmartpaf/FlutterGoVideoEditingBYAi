/**
 * Caption collision geometry — deterministic overlap ratios.
 */

import type {
	CaptionCollision,
	CaptionCollisionSeverity,
	CaptionProtectedRegion,
	NormalizedRect,
} from "./types";

export function rectArea(r: NormalizedRect): number {
	return Math.max(0, r.width) * Math.max(0, r.height);
}

export function intersection(a: NormalizedRect, b: NormalizedRect): NormalizedRect | null {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.width, b.x + b.width);
	const y2 = Math.min(a.y + a.height, b.y + b.height);
	if (x2 <= x1 || y2 <= y1) return null;
	return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function overlapRatio(a: NormalizedRect, b: NormalizedRect): number {
	const inter = intersection(a, b);
	if (!inter) return 0;
	const denom = Math.max(1e-9, rectArea(a));
	return rectArea(inter) / denom;
}

function severityFor(ratio: number, blocking: boolean): CaptionCollisionSeverity {
	if (blocking && ratio > 0.02) return "blocking";
	if (ratio >= 0.35) return "high";
	if (ratio >= 0.15) return "medium";
	if (ratio > 0.02) return "low";
	return "low";
}

export function detectCollisions(args: {
	cueId: string;
	box: NormalizedRect;
	safeAreaColumn: NormalizedRect;
	protectedRegions: CaptionProtectedRegion[];
	peerBoxes?: Array<{ id: string; box: NormalizedRect }>;
}): CaptionCollision[] {
	const out: CaptionCollision[] = [];
	const outsideSafe = overlapRatio(args.box, args.safeAreaColumn) < 0.85;
	if (outsideSafe) {
		// Fraction of box outside column approximated via 1 - overlap with column.
		const inside = overlapRatio(args.box, args.safeAreaColumn);
		if (inside < 0.99) {
			out.push({
				cueId: args.cueId,
				objectId: "safe_area",
				overlapRatio: 1 - inside,
				severity: inside < 0.5 ? "blocking" : "medium",
				reason: "extends_outside_safe_column",
			});
		}
	}
	for (const region of args.protectedRegions) {
		const r = overlapRatio(args.box, region.rect);
		if (r <= 0.02) continue;
		out.push({
			cueId: args.cueId,
			objectId: region.id,
			overlapRatio: r,
			severity: severityFor(r, region.blocking),
			reason: `overlaps_${region.kind}`,
		});
	}
	for (const peer of args.peerBoxes ?? []) {
		const r = overlapRatio(args.box, peer.box);
		if (r <= 0.02) continue;
		out.push({
			cueId: args.cueId,
			objectId: peer.id,
			overlapRatio: r,
			severity: severityFor(r, false),
			reason: "overlaps_peer_caption",
		});
	}
	return out;
}

export function hasBlockingCollision(collisions: CaptionCollision[]): boolean {
	return collisions.some((c) => c.severity === "blocking");
}

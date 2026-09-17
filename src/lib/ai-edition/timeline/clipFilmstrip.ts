/**
 * Where to sample pictures for timeline cards, and where the automatic
 * clip-to-clip dissolve sits. Preview/export already composite that dissolve;
 * these helpers only place the pictures on the ruler.
 */

export function filmstripSampleTimes(
	sourceStartSec: number,
	sourceEndSec: number,
	count: number,
): number[] {
	const start = Math.max(0, sourceStartSec);
	const end = Math.max(start, sourceEndSec);
	const n = Math.max(1, Math.floor(count));
	const span = end - start;
	if (span <= 1e-4) return [start];
	if (n === 1) return [start + span * 0.5];
	const times: number[] = [];
	for (let i = 0; i < n; i++) {
		times.push(start + ((i + 0.5) / n) * span);
	}
	return times;
}

export function filmstripCellCount(widthPx: number): number {
	if (!Number.isFinite(widthPx) || widthPx < 36) return 1;
	return Math.min(24, Math.max(1, Math.floor(widthPx / 56)));
}

/** Join marks with the incoming clip id (document authority for transitions). */
export function clipJoins(
	clips: ReadonlyArray<{
		id: string;
		timelineStartSec: number;
		timelineEndSec: number;
	}>,
): Array<{ programmeSec: number; incomingClipId: string }> {
	const joins: Array<{ programmeSec: number; incomingClipId: string }> = [];
	for (let i = 1; i < clips.length; i++) {
		const prev = clips[i - 1]!;
		const next = clips[i]!;
		if (Math.abs(next.timelineStartSec - prev.timelineEndSec) > 0.05) continue;
		joins.push({ programmeSec: next.timelineStartSec, incomingClipId: next.id });
	}
	return joins;
}

/** Virtual-timeline instants of each clip join (incoming clip start). */
export function clipJoinTimes(
	clips: ReadonlyArray<{ timelineStartSec: number; timelineEndSec: number }>,
): number[] {
	const joins: number[] = [];
	for (let i = 1; i < clips.length; i++) {
		const prev = clips[i - 1];
		const next = clips[i];
		if (Math.abs(next.timelineStartSec - prev.timelineEndSec) > 0.05) continue;
		joins.push(next.timelineStartSec);
	}
	return joins;
}

export function posterTimeForSpan(startSec: number, endSec: number): number {
	const span = Math.max(0, endSec - startSec);
	return startSec + Math.min(0.12, span * 0.35);
}

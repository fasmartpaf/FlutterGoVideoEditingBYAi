/**
 * Duration-normalized coverage buckets (shared by coverage + event-region modules).
 */

export type CoverageBucket = {
	index: number;
	startSec: number;
	endSec: number;
	centerSec: number;
	occupied: boolean;
	selectedTimes: number[];
};

export function coverageBucketCount(durationSec: number): number {
	if (!(durationSec > 0)) return 1;
	if (durationSec < 8) return 3;
	if (durationSec < 16) return 4;
	if (durationSec < 40) return 5;
	return 6;
}

export function bucketIndexForTime(t: number, durationSec: number, n: number): number {
	if (!(durationSec > 0) || n <= 0) return 0;
	const frac = Math.min(Math.max(t / durationSec, 0), 0.999999);
	return Math.min(n - 1, Math.floor(frac * n));
}

export function buildCoverageBuckets(durationSec: number): CoverageBucket[] {
	const n = coverageBucketCount(durationSec);
	const width = durationSec / n;
	return Array.from({ length: n }, (_, i) => ({
		index: i,
		startSec: i * width,
		endSec: i === n - 1 ? durationSec : (i + 1) * width,
		centerSec: i * width + width / 2,
		occupied: false,
		selectedTimes: [],
	}));
}

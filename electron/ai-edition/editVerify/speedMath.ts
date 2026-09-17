/**
 * Speed programme math — expected programme duration = sourceDuration / M.
 */

export const MIN_VERIFY_SPEED = 0.1;
export const MAX_VERIFY_SPEED = 100;

export interface SpeedTimingVerification {
	multiplier: number;
	multiplierValid: boolean;
	sourceDurationSec: number;
	expectedProgrammeDurationSec: number;
	toleranceSec: number;
	notes: string[];
	ok: boolean;
}

export function expectedProgrammeDurationForSpeed(
	sourceDurationSec: number,
	multiplier: number,
): number {
	if (!(multiplier > 0) || !(sourceDurationSec >= 0)) return Number.NaN;
	return sourceDurationSec / multiplier;
}

export function verifySpeedTiming(args: {
	multiplier: number;
	sourceStartSec: number;
	sourceEndSec: number;
	/** Optional measured programme duration of the affected span. */
	measuredProgrammeDurationSec?: number | null;
	toleranceSec?: number;
}): SpeedTimingVerification {
	const notes: string[] = [];
	const sourceDurationSec = Math.max(0, args.sourceEndSec - args.sourceStartSec);
	const multiplierValid =
		Number.isFinite(args.multiplier) &&
		args.multiplier >= MIN_VERIFY_SPEED &&
		args.multiplier <= MAX_VERIFY_SPEED;
	if (!multiplierValid) notes.push("invalid_speed_multiplier");
	if (!(args.sourceEndSec > args.sourceStartSec)) notes.push("invalid_source_span");

	const expected = expectedProgrammeDurationForSpeed(sourceDurationSec, args.multiplier);
	const toleranceSec = args.toleranceSec ?? Math.max(0.05, sourceDurationSec * 0.02);
	let ok = multiplierValid && Number.isFinite(expected) && sourceDurationSec > 0;

	if (
		args.measuredProgrammeDurationSec != null &&
		Number.isFinite(args.measuredProgrammeDurationSec)
	) {
		const delta = Math.abs(args.measuredProgrammeDurationSec - expected);
		if (delta > toleranceSec) {
			ok = false;
			notes.push(`programme_duration_mismatch delta=${delta.toFixed(4)}`);
		}
	}

	return {
		multiplier: args.multiplier,
		multiplierValid,
		sourceDurationSec,
		expectedProgrammeDurationSec: expected,
		toleranceSec,
		notes,
		ok,
	};
}

/** Map a source instant under constant speed M covering [src0,src1] starting at programme p0. */
export function sourceToProgrammeUnderSpeed(args: {
	sourceTimeSec: number;
	regionSourceStartSec: number;
	regionSourceEndSec: number;
	programmeStartSec: number;
	multiplier: number;
}): number | null {
	const t = args.sourceTimeSec;
	if (t < args.regionSourceStartSec - 1e-6 || t > args.regionSourceEndSec + 1e-6) return null;
	if (!(args.multiplier > 0)) return null;
	const offset = (t - args.regionSourceStartSec) / args.multiplier;
	return args.programmeStartSec + offset;
}

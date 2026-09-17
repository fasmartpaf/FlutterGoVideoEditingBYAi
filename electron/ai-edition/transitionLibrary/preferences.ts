/**
 * Local-only transition preference signals (no cloud).
 * Architecture hook for later preference learning — counters only.
 */

export type TransitionPreferenceSignalKind =
	| "manual_selected"
	| "ai_accepted"
	| "ai_removed"
	| "ai_replaced"
	| "family_used"
	| "family_rejected";

export interface TransitionPreferenceSignal {
	kind: TransitionPreferenceSignalKind;
	transitionId?: string;
	family?: string;
	atMs: number;
}

const signals: TransitionPreferenceSignal[] = [];

export function recordTransitionPreferenceSignal(
	signal: Omit<TransitionPreferenceSignal, "atMs"> & { atMs?: number },
): void {
	signals.push({ ...signal, atMs: signal.atMs ?? Date.now() });
	if (signals.length > 500) signals.splice(0, signals.length - 500);
}

export function readTransitionPreferenceSignals(): readonly TransitionPreferenceSignal[] {
	return signals;
}

export function clearTransitionPreferenceSignalsForTests(): void {
	signals.length = 0;
}

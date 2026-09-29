/**
 * In-flight chat/agent runs keyed by project+session so the UI can stop them.
 * One AbortController per active run; a second Send on the same session
 * replaces the previous controller (the prior run should already be done).
 */

const active = new Map<string, AbortController>();

export function chatRunKey(projectId: string, sessionId: string): string {
	return `${projectId}\0${sessionId}`;
}

/** Start (or replace) the abort controller for this chat turn. */
export function beginChatRun(projectId: string, sessionId: string): AbortSignal {
	const key = chatRunKey(projectId, sessionId);
	const existing = active.get(key);
	if (existing && !existing.signal.aborted) {
		existing.abort();
	}
	const controller = new AbortController();
	active.set(key, controller);
	return controller.signal;
}

/** User/Stop — abort the in-flight turn. Returns true if something was running. */
export function cancelChatRun(projectId: string, sessionId: string): boolean {
	const key = chatRunKey(projectId, sessionId);
	const controller = active.get(key);
	if (!controller || controller.signal.aborted) return false;
	controller.abort();
	return true;
}

/** Clear the registry entry when the turn settles (success, error, or abort). */
export function endChatRun(projectId: string, sessionId: string, signal?: AbortSignal): void {
	const key = chatRunKey(projectId, sessionId);
	const controller = active.get(key);
	if (!controller) return;
	if (signal && controller.signal !== signal) return;
	active.delete(key);
}

export function isChatRunActive(projectId: string, sessionId: string): boolean {
	const controller = active.get(key(projectId, sessionId));
	return Boolean(controller && !controller.signal.aborted);
}

function key(projectId: string, sessionId: string): string {
	return chatRunKey(projectId, sessionId);
}

/**
 * App quit — abort every in-flight run. Local CLI agents run in their own
 * process group, so without this they (and their ffmpeg children) would
 * outlive the app.
 */
export function abortAllChatRuns(): number {
	let count = 0;
	for (const controller of active.values()) {
		if (!controller.signal.aborted) {
			controller.abort();
			count += 1;
		}
	}
	active.clear();
	return count;
}

/** Test helper — drop every registered run. */
export function resetChatAbortRegistry(): void {
	for (const controller of active.values()) {
		if (!controller.signal.aborted) controller.abort();
	}
	active.clear();
}

export function isAbortError(err: unknown): boolean {
	if (!err) return false;
	if (typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError") {
		return true;
	}
	const message = err instanceof Error ? err.message : String(err);
	return /aborted|AbortError|stopped by user|agent stopped/i.test(message);
}

export const AGENT_STOPPED_MESSAGE = "Agent stopped.";

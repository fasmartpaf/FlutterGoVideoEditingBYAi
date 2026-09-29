/**
 * Persistent Local CLI agent identity per OpenScreen chat conversation.
 * Maps (projectId, chatSessionId) → Claude `--session-id` UUID so tool rounds
 * and follow-up chat messages resume the same CLI memory instead of a fresh spawn.
 */

import { randomUUID } from "node:crypto";

export type CliAgentSessionRecord = {
	/** Claude Code session UUID (`--session-id` / `--resume`). */
	cliSessionId: string;
	/** True after at least one successful spawn for this chat session. */
	started: boolean;
	/** Preferred workspace root for cwd / --add-dir. */
	workspaceRoot: string | null;
	turnCount: number;
	updatedAtIso: string;
};

const sessions = new Map<string, CliAgentSessionRecord>();

function key(projectId: string, chatSessionId: string): string {
	return `${projectId}::${chatSessionId}`;
}

export function getOrCreateCliAgentSession(
	projectId: string,
	chatSessionId: string,
	workspaceRoot?: string | null,
): CliAgentSessionRecord {
	const k = key(projectId, chatSessionId);
	const existing = sessions.get(k);
	if (existing) {
		if (workspaceRoot && !existing.workspaceRoot) {
			existing.workspaceRoot = workspaceRoot;
		}
		existing.updatedAtIso = new Date().toISOString();
		return existing;
	}
	const created: CliAgentSessionRecord = {
		cliSessionId: randomUUID(),
		started: false,
		workspaceRoot: workspaceRoot ?? null,
		turnCount: 0,
		updatedAtIso: new Date().toISOString(),
	};
	sessions.set(k, created);
	return created;
}

export function markCliAgentSessionStarted(
	projectId: string,
	chatSessionId: string,
): CliAgentSessionRecord | null {
	const rec = sessions.get(key(projectId, chatSessionId));
	if (!rec) return null;
	rec.started = true;
	rec.turnCount += 1;
	rec.updatedAtIso = new Date().toISOString();
	return rec;
}

export function clearCliAgentSession(projectId: string, chatSessionId: string): void {
	sessions.delete(key(projectId, chatSessionId));
}

/** Test helper — wipe in-memory registry. */
export function resetCliAgentSessionsForTests(): void {
	sessions.clear();
}

/**
 * Prefer the openscreen userData root that owns recordings/, else the first
 * media directory, else null (caller falls back to tmp).
 */
export function resolveCliWorkspaceRoot(mediaDirs: string[]): string | null {
	for (const dir of mediaDirs) {
		const normalized = dir.replace(/\\/g, "/");
		const recordingsIdx = normalized.lastIndexOf("/recordings");
		if (recordingsIdx > 0) {
			return normalized.slice(0, recordingsIdx);
		}
	}
	return mediaDirs[0] ?? null;
}

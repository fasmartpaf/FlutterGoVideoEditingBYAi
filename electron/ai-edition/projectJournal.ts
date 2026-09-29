/**
 * Project journal: what earlier chat turns did, and what the user asked for
 * in general ("don't cover the sidebar", "keep it under 60 s"). Each new turn
 * gets a few lines of it, so a follow-up goes straight to the edit instead of
 * re-reading the project and re-deciding what was already settled.
 *
 * Kept on disk next to the project's generated media (not in the document, so
 * a read-only turn never has to write the project). A rewind drops the turns
 * it undid.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import { resolveGeneratedGraphicsDir } from "./agentToolMedia";

export interface JournalEntry {
	at: string;
	/** The user message that started the turn (rewinds drop entries by it). */
	userMessageId: string;
	request: string;
	/** What changed, one short line per edit kind (from the receipt). */
	changes: string[];
	outcome: string;
}

export interface ProjectJournal {
	version: 1;
	entries: JournalEntry[];
	/** Standing instructions, in the user's words. */
	preferences: string[];
}

const MAX_ENTRIES = 30;
const MAX_PREFERENCES = 12;
/** Turns shown to the agent. */
const SHOWN_ENTRIES = 8;

function journalPath(document: AxcutDocument): string | null {
	// Only a project with a recording has a folder of its own to keep it in.
	if (!document.assets.some((a) => a.kind === "video" && isAbsolute(a.originalPath ?? ""))) return null;
	try {
		return join(resolveGeneratedGraphicsDir(document), ".journal.json");
	} catch {
		return null; // no recording folder (text-only chat): nothing to remember
	}
}

export function readJournal(document: AxcutDocument): ProjectJournal {
	const file = journalPath(document);
	if (file && existsSync(file)) {
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8")) as ProjectJournal;
			if (parsed.version === 1 && Array.isArray(parsed.entries)) return parsed;
		} catch {
			/* a damaged journal is a fresh one */
		}
	}
	return { version: 1, entries: [], preferences: [] };
}

function writeJournal(document: AxcutDocument, journal: ProjectJournal): void {
	const file = journalPath(document);
	if (!file) return;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(journal, null, 1));
}

const oneLine = (s: string, max: number) => {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Sentences that read as a standing instruction rather than a one-off edit:
 * "don't cover the sidebar", "always use our blue", "keep it under 60 seconds".
 */
export function standingInstructions(message: string): string[] {
	return message
		.split(/(?<=[.!?\n])\s+|\s*[;\n]\s*/)
		.map((s) => oneLine(s, 160))
		.filter((s) =>
			/\b(don'?t|do not|never|always|keep it|keep the|make sure|avoid|no more|i (?:want|prefer|like|don'?t like)|should (?:always|never|be))\b/i.test(s) &&
			s.length >= 8,
		);
}

/** Record a finished turn (and any standing instructions the user gave in it). */
export function recordTurn(
	document: AxcutDocument,
	turn: { userMessageId: string; request: string; changes: string[]; outcome: string },
): void {
	const journal = readJournal(document);
	journal.entries.push({
		at: new Date().toISOString(),
		userMessageId: turn.userMessageId,
		request: oneLine(turn.request, 200),
		changes: turn.changes.slice(0, 8).map((c) => oneLine(c, 100)),
		outcome: oneLine(turn.outcome, 240),
	});
	journal.entries = journal.entries.slice(-MAX_ENTRIES);
	for (const p of standingInstructions(turn.request)) {
		const lower = p.toLowerCase();
		journal.preferences = journal.preferences.filter((q) => q.toLowerCase() !== lower);
		journal.preferences.push(p);
	}
	journal.preferences = journal.preferences.slice(-MAX_PREFERENCES);
	writeJournal(document, journal);
}

/** A rewind undid these turns: forget them. */
export function forgetTurns(document: AxcutDocument, userMessageIds: ReadonlySet<string>): void {
	const journal = readJournal(document);
	const kept = journal.entries.filter((e) => !userMessageIds.has(e.userMessageId));
	if (kept.length === journal.entries.length) return;
	journal.entries = kept;
	writeJournal(document, journal);
}

/** The lines added to a new request. Empty when there is nothing to remember yet. */
export function journalContext(document: AxcutDocument): string {
	const journal = readJournal(document);
	const entries = journal.entries.slice(-SHOWN_ENTRIES);
	if (entries.length === 0 && journal.preferences.length === 0) return "";
	const lines = ["PROJECT MEMORY — earlier turns in this project (already applied; don't redo them, change them only if asked):"];
	for (const e of entries) {
		const changed = e.changes.length ? e.changes.join("; ") : "no edits";
		lines.push(`- "${e.request}" → ${changed}.`);
	}
	if (journal.preferences.length) {
		lines.push("The user's standing instructions (follow them in every edit):");
		for (const p of journal.preferences) lines.push(`- ${p}`);
	}
	return lines.join("\n");
}

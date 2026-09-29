// Project journal: earlier turns + standing instructions, given to each new turn.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AxcutDocument, createEmptyDocument } from "../../src/lib/ai-edition/schema";
import { forgetTurns, journalContext, readJournal, recordTurn, standingInstructions } from "./projectJournal";

const scratch: string[] = [];
afterEach(() => {
	for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

function doc(): AxcutDocument {
	const root = mkdtempSync(join(tmpdir(), "os-journal-"));
	scratch.push(root);
	mkdirSync(join(root, "recordings"));
	const d = createEmptyDocument({ title: "t", projectId: "proj_j", createdAt: "2026-01-01T00:00:00.000Z" });
	return {
		...d,
		assets: [{ id: "a", kind: "video", label: "r", originalPath: join(root, "recordings", "rec.mp4"), cameraTrack: null } as AxcutDocument["assets"][number]],
		project: { ...d.project, primaryAssetId: "a" },
	};
}

describe("standingInstructions", () => {
	it("keeps the sentences that read as rules for every edit", () => {
		expect(
			standingInstructions("Add an intro. Don't cover the sidebar with overlays! Keep it under 60 seconds; make the logo bigger"),
		).toEqual(["Don't cover the sidebar with overlays!", "Keep it under 60 seconds"]);
		expect(standingInstructions("zoom in at 0:12")).toEqual([]);
	});
});

describe("project journal", () => {
	it("is empty for a new project, then tells the next turn what was done and the user's rules", () => {
		const d = doc();
		expect(journalContext(d)).toBe("");
		recordTurn(d, { userMessageId: "u1", request: "add a zoom at the start", changes: ["Added a zoom"], outcome: "Zoomed into the dashboard." });
		recordTurn(d, {
			userMessageId: "u2",
			request: "make the intro amazing. Never cover the sidebar.",
			changes: ["Added a motion graphic"],
			outcome: "Added a SaaS intro.",
		});
		const ctx = journalContext(d);
		expect(ctx).toContain('"add a zoom at the start" → Added a zoom.');
		expect(ctx).toContain("Added a motion graphic");
		expect(ctx).toContain("- Never cover the sidebar.");
	});

	it("a rewind forgets the turns it undid, but keeps the user's rules", () => {
		const d = doc();
		recordTurn(d, { userMessageId: "u1", request: "cut the dead air", changes: ["Trimmed"], outcome: "ok" });
		recordTurn(d, { userMessageId: "u2", request: "add captions. Always use big captions.", changes: ["Captions"], outcome: "ok" });
		forgetTurns(d, new Set(["u2"]));
		const j = readJournal(d);
		expect(j.entries.map((e) => e.userMessageId)).toEqual(["u1"]);
		expect(j.preferences).toEqual(["Always use big captions."]);
	});

	it("a project without a recording folder remembers nothing (and never throws)", () => {
		const d = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
		recordTurn(d, { userMessageId: "u1", request: "hi", changes: [], outcome: "hello" });
		expect(journalContext(d)).toBe("");
	});
});

// Staged whole-video edits: which requests use them, and how the stages run.
import { describe, expect, it } from "vitest";
import { type AxcutDocument, createEmptyDocument } from "../../src/lib/ai-edition/schema";
import { OPENSCREEN_TOOL_NAMES } from "./agent-tools";
import type { InvokeResult } from "./deep-agent/service";
import { EDIT_STAGES, isWholeVideoRequest, stagedFinalMessage, stageToolNames } from "./stagedEdit";
import { runStagedEdit, type StageRun } from "./stagedEditRunner";

describe("which requests run as a staged edit", () => {
	it.each([
		"can you make the SAAS vidoe for fluttergo.ai",
		"turn this into a 60-second product demo for X",
		"Edit this recording into a polished tutorial",
		"make a promo video from this",
	])("whole video: %s", (m) => expect(isWholeVideoRequest(m)).toBe(true));

	it.each([
		"zoom in at 0:12",
		"make that title bigger",
		"what is this video about?",
		"add captions",
		"cut the pause at 14s from the video",
		"hi",
	])("targeted or a question: %s", (m) => expect(isWholeVideoRequest(m)).toBe(false));
});

describe("stage definitions", () => {
	it("only offer tools that exist", () => {
		const known = new Set<string>(OPENSCREEN_TOOL_NAMES);
		for (const stage of EDIT_STAGES) {
			for (const name of stageToolNames(stage)) expect(known.has(name), `${stage.id}: ${name}`).toBe(true);
		}
	});

	it("keep writes out of the understand stage, and export only in review", () => {
		const understand = stageToolNames(EDIT_STAGES[0]!);
		expect(understand).not.toContain("addTrims");
		expect(understand).not.toContain("exportProject");
		for (const stage of EDIT_STAGES.slice(0, -1)) expect(stageToolNames(stage)).not.toContain("exportProject");
		expect(stageToolNames(EDIT_STAGES.at(-1)!)).toContain("exportProject");
	});
});

function doc(title: string): AxcutDocument {
	return createEmptyDocument({ title, projectId: "proj_stage", createdAt: "2026-01-01T00:00:00.000Z" });
}

function reply(document: AxcutDocument, text: string, mutated = false): InvokeResult {
	return { text, document, mutated, status: "completed" } as InvokeResult;
}

function recorder() {
	const events: string[] = [];
	return {
		events,
		emit: {
			plan: (items: Array<{ text: string; status: string }>) =>
				events.push(`plan:${items.map((i) => i.status[0]).join("")}`),
			status: (phase: string, detail?: string) => events.push(`${phase}:${detail}`),
			text: () => {},
		},
	};
}

describe("runStagedEdit", () => {
	it("runs every stage in order on the previous stage's document and reports each one", async () => {
		const runs: StageRun[] = [];
		const cut = doc("after cut");
		const withGraphics = doc("after graphics");
		const rec = recorder();
		const previews: string[] = [];
		const result = await runStagedEdit({
			request: "make the SaaS video",
			document: doc("start"),
			emit: rec.emit,
			onPreview: (path, label) => previews.push(`${label}=${path}`),
			renderPreview: async (_d, stage) => `/p/${stage.id}.jpg`,
			invoke: async (run) => {
				runs.push(run);
				switch (run.stage.id) {
					case "understand":
						return reply(run.document, "Plan: keep the dashboard tour, cut the login.");
					case "pacing":
						return reply(cut, "Cut 6 s of dead air and the login detour.", true);
					case "captions":
						return reply(run.document, "Skipped: no speech in this recording.");
					case "graphics":
						return reply(withGraphics, "Added an intro card and a closing CTA.", true);
					case "review":
						return reply(run.document, "Your demo is 38 s, tight and on-brand.");
					default:
						return reply(run.document, "Nothing needed here.");
				}
			},
		});
		expect(runs.map((r) => r.stage.id)).toEqual(EDIT_STAGES.map((s) => s.id));
		// Each stage edits what the previous one left.
		expect(runs[2]!.document.project.title).toBe("after cut");
		expect(runs[5]!.document.project.title).toBe("after graphics");
		// Later stages know what earlier ones did.
		expect(runs[1]!.prompt).toContain("cut the login");
		expect(runs[5]!.prompt).toContain("Added an intro card");
		expect(runs[1]!.toolNames).toContain("addTrims");
		expect(runs[1]!.toolNames).not.toContain("createMotionClip");
		expect(result.document.project.title).toBe("after graphics");
		expect(result.mutated).toBe(true);
		expect(result.text).toContain("Your demo is 38 s");
		expect(result.text).toMatch(/Captions\*\* — skipped \(no speech/);
		// Previews only for stages that changed the video.
		expect(previews).toEqual(["After cut & pacing=/p/pacing.jpg", "After graphics & motion=/p/graphics.jpg"]);
		// The checklist walks forward one stage at a time.
		const plans = rec.events.filter((e) => e.startsWith("plan:"));
		expect(plans[0]).toBe("plan:ippppp");
		expect(plans[1]).toBe("plan:dipppp");
		expect(plans.at(-1)).toBe("plan:dddsdd");
	});

	it("Stop mid-way keeps the finished stages and says where it stopped", async () => {
		const controller = new AbortController();
		const cut = doc("after cut");
		const result = await runStagedEdit({
			request: "make the SaaS video",
			document: doc("start"),
			emit: recorder().emit,
			abortSignal: controller.signal,
			renderPreview: async () => null,
			invoke: async (run) => {
				if (run.stage.id === "pacing") return reply(cut, "Cut the dead air.", true);
				if (run.stage.id === "camera") {
					controller.abort();
					throw Object.assign(new Error("Agent stopped."), { name: "AbortError" });
				}
				return reply(run.document, "Plan ready.");
			},
		});
		expect(result.document.project.title).toBe("after cut");
		expect(result.mutated).toBe(true);
		expect(result.text).toMatch(/Stopped during \*\*Zoom & camera\*\*/);
	});

	it("a failed stage does not end the edit", async () => {
		const seen: string[] = [];
		const result = await runStagedEdit({
			request: "make the SaaS video",
			document: doc("start"),
			emit: recorder().emit,
			renderPreview: async () => null,
			invoke: async (run) => {
				seen.push(run.stage.id);
				if (run.stage.id === "captions") throw new Error("whisper crashed");
				return reply(run.document, "ok");
			},
		});
		expect(seen).toEqual(EDIT_STAGES.map((s) => s.id));
		expect(result.text).toContain("Captions");
	});
});

describe("stagedFinalMessage", () => {
	it("leads with the review, then one line per editing stage", () => {
		const text = stagedFinalMessage([
			{ stage: EDIT_STAGES[0]!, status: "done", summary: "plan", mutated: false },
			{ stage: EDIT_STAGES[1]!, status: "done", summary: "Cut 5 s.", mutated: true },
			{ stage: EDIT_STAGES[5]!, status: "done", summary: "All set.", mutated: false },
		]);
		expect(text.split("\n\n")[0]).toBe("All set.");
		expect(text).toContain("- **Cut & pacing** — Cut 5 s.");
		expect(text).not.toContain("plan");
	});
});

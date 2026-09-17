/**
 * LocalEditorialChat V1 — unit coverage for intent + offline routing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../src/lib/ai-edition/schema";
import {
	applyLocalEditorialControl,
	clearLocalEditorialSessionsForTests,
	parseLocalEditorialRequest,
	shouldHandleLocalEditorialWithoutCloud,
} from "./index";

describe("LOCAL_EDITORIAL_CHAT_V1", () => {
	beforeEach(() => {
		clearLocalEditorialSessionsForTests();
	});

	it("routes professional + duration + pause + speed without cloud", () => {
		const cases: Array<{ msg: string; intent: string }> = [
			{
				msg: "Make this video professional. You decide.",
				intent: "PROFESSIONALIZE",
			},
			{
				msg: "Make it under 12 seconds but keep the important explanation.",
				intent: "TARGET_DURATION",
			},
			{
				msg: "Can u make a video under a 12 sec and keep important parts?",
				intent: "TARGET_DURATION",
			},
			{ msg: "Remove more pauses.", intent: "REMOVE_PAUSES" },
			{
				msg: "Remove more unnecessary pauses but keep natural breathing room.",
				intent: "REMOVE_PAUSES",
			},
			{ msg: "Make the slow parts faster.", intent: "SPEED_UP" },
			{ msg: "Make the navigation a little faster.", intent: "SPEED_UP" },
		];
		for (const c of cases) {
			const r = parseLocalEditorialRequest(c.msg);
			expect(r.intent, c.msg).toBe(c.intent);
			expect(shouldHandleLocalEditorialWithoutCloud(c.msg), c.msg).toBe(true);
			expect(r.executionKind, c.msg).toBe("professional_orchestrator");
			expect(r.orchestratorMessage, c.msg).toBeTruthy();
		}
	});

	it("routes zoom / captions / title / restore as direct or session", () => {
		expect(parseLocalEditorialRequest("Undo that zoom.").intent).toBe("REMOVE_ZOOM");
		expect(parseLocalEditorialRequest("Remove that zoom.").intent).toBe("REMOVE_ZOOM");
		expect(parseLocalEditorialRequest("Turn the captions off.").intent).toBe("CAPTIONS");
		expect(parseLocalEditorialRequest("Make the captions smaller.").intent).toBe("CAPTION_STYLE");
		expect(parseLocalEditorialRequest("Remove the title.").intent).toBe("REMOVE_TITLE");
		expect(
			parseLocalEditorialRequest("The previous version was better. Undo the last changes.").intent,
		).toBe("RESTORE_PREVIOUS");
		expect(shouldHandleLocalEditorialWithoutCloud("Undo that zoom.")).toBe(true);
	});

	it("applies remove zoom and restore from session locally", () => {
		let doc = createEmptyDocument({ projectId: "proj_local", title: "Local" });
		doc = {
			...doc,
			zoomRanges: [
				{
					id: "z1",
					startMs: 1000,
					endMs: 2000,
					mode: "cursor",
					depth: 2,
				} as never,
			],
		};
		const r1 = applyLocalEditorialControl({
			projectId: "proj_local",
			document: doc,
			userMessage: "Undo that zoom.",
		});
		expect(r1.mutated).toBe(true);
		expect(r1.cloudCalls).toBe(0);
		expect(r1.document.zoomRanges ?? []).toHaveLength(0);

		const r2 = applyLocalEditorialControl({
			projectId: "proj_local",
			document: r1.document,
			userMessage: "Restore the previous version.",
		});
		expect(r2.mutated).toBe(true);
		expect(r2.document.zoomRanges ?? []).toHaveLength(1);
	});

	it("TARGET_DURATION preserves important explanation in orch message", () => {
		const r = parseLocalEditorialRequest(
			"Make it under 18 seconds while keeping the important explanation.",
		);
		expect(r.durationTargetMaxSec).toBe(18);
		expect(r.preserve).toContain("IMPORTANT_EXPLANATION");
		expect(r.orchestratorMessage).toMatch(/under 18 seconds/i);
		expect(r.orchestratorMessage).toMatch(/Preserve important/i);
		expect(r.orchestratorMessage).not.toMatch(/speed everything/i);
	});
});

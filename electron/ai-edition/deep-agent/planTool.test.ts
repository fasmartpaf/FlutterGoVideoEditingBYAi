import { describe, expect, it } from "vitest";
import { buildPlanTool } from "./service";

describe("updatePlan tool", () => {
	it("publishes the checklist to the chat and edits nothing", async () => {
		const published: unknown[] = [];
		const sink = {
			text: () => {},
			thinking: () => {},
			toolStart: () => {},
			toolEnd: () => {},
			error: () => {},
			plan: (items: unknown) => published.push(items),
		};
		const planTool = buildPlanTool(sink);
		expect(planTool.name).toBe("updatePlan");
		const out = await planTool.invoke({
			items: [
				{ text: " Cut dead air ", status: "done" },
				{ text: "Add intro title", status: "in_progress" },
			],
		});
		expect(JSON.parse(String(out))).toEqual({ ok: true, steps: 2 });
		expect(published).toEqual([
			[
				{ text: "Cut dead air", status: "done" },
				{ text: "Add intro title", status: "in_progress" },
			],
		]);
	});
});

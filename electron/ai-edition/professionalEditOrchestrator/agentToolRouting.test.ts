import { describe, expect, it } from "vitest";
import { requestToolScope } from "../stagedEdit";
import { isProfessionalEditRequest } from "./intent";

describe("pictures, layers and audio go to the tool agent, not the cut review", () => {
	it("keeps them out of the professional-edit orchestrator", () => {
		for (const m of [
			"Add this picture as a 4 second clip that pans from left to right, showing the whole picture over a blurred background.",
			"Put this logo small in the top-right corner with a zoom in",
			"Show this video as picture-in-picture bottom-right",
			"Duck the music under my voice",
			"Add a whoosh when each layer comes in",
			"Improve it\n\nAttached files (absolute paths — use these):\n- /x/a.png",
		]) {
			expect([m, isProfessionalEditRequest(m)]).toEqual([m, false]);
		}
		expect(isProfessionalEditRequest("make this video better and more professional")).toBe(true);
	});

	it("gives picture requests the import and layer tools", () => {
		const scope = requestToolScope("Add this picture as a 5 second clip with a slow zoom in")!;
		expect(scope).toEqual(expect.arrayContaining(["importMedia", "addLayer"]));
	});
});

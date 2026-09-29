import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../src/lib/ai-edition/schema";
import {
	bakeBuiltinCharacterImage,
	isBuiltinCharacterId,
	listCharactersCatalog,
	registerCharacterOnDocument,
	resolveCharacterImage,
} from "./characterLibrary";

describe("characterLibrary", () => {
	it("lists builtins and resolves guide by default", () => {
		const doc = createEmptyDocument({
			title: "t",
			projectId: "p",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const catalog = listCharactersCatalog(doc);
		expect(catalog.builtins.map((b) => b.id)).toContain("guide");
		expect(catalog.builtins.map((b) => b.id)).toContain("bot");
		const resolved = resolveCharacterImage(doc, {});
		expect(resolved.characterId).toBe("guide");
		expect(resolved.source).toBe("builtin");
		expect(resolved.image.startsWith("data:image/png")).toBe(true);
		expect(isBuiltinCharacterId("coach")).toBe(true);
		expect(bakeBuiltinCharacterImage("spark").startsWith("data:image/png")).toBe(true);
	});

	it("registers a custom character and resolves it by id", () => {
		const doc = createEmptyDocument({
			title: "t",
			projectId: "p2",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const tiny =
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
		const registered = registerCharacterOnDocument(doc, {
			id: "my_mascot",
			label: "Mascot",
			image: tiny,
		});
		expect(registered.character.id).toBe("my_mascot");
		const catalog = listCharactersCatalog(registered.document);
		expect(catalog.registered.some((c) => c.id === "my_mascot")).toBe(true);
		const resolved = resolveCharacterImage(registered.document, { characterId: "my_mascot" });
		expect(resolved.source).toBe("registered");
		expect(resolved.image).toBe(tiny);
	});

	it("refuses to overwrite a builtin id", () => {
		const doc = createEmptyDocument({
			title: "t",
			projectId: "p3",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(() =>
			registerCharacterOnDocument(doc, {
				id: "guide",
				image:
					"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			}),
		).toThrow(/built-in/i);
	});
});

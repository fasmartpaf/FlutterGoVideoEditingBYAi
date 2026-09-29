/**
 * Presenter / guide characters the agent can place on the video.
 * Sources: built-in presets, user-uploaded paths, or agent-made PNGs registered on the project.
 */

import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import {
	assertImageDataUri,
	loadImageFileAsDataUri,
	renderAvatarBubblePng,
} from "../../src/lib/ai-edition/document/graphicPlate";

export type BuiltinCharacterId = "guide" | "pointer" | "coach" | "spark" | "bot";

export interface BuiltinCharacter {
	id: BuiltinCharacterId;
	label: string;
	tagline: string;
	/** Head fill color. */
	fill: string;
	/** Eyes / smile accent. */
	accent: string;
}

export const BUILTIN_CHARACTERS: readonly BuiltinCharacter[] = [
	{
		id: "guide",
		label: "Guide",
		tagline: "round indigo avatar",
		fill: "#4F46E5",
		accent: "#ffffff",
	},
	{
		id: "pointer",
		label: "Pointer",
		tagline: "green avatar",
		fill: "#22C55E",
		accent: "#ffffff",
	},
	{
		id: "coach",
		label: "Coach",
		tagline: "amber avatar",
		fill: "#F59E0B",
		accent: "#ffffff",
	},
	{
		id: "spark",
		label: "Spark",
		tagline: "pink avatar",
		fill: "#EC4899",
		accent: "#ffffff",
	},
	{
		id: "bot",
		label: "Bot",
		tagline: "cyan robot avatar",
		fill: "#0891B2",
		accent: "#ECFEFF",
	},
] as const;

export type RegisteredCharacter = {
	id: string;
	label: string;
	/** Absolute path on disk (preferred) or a data URI stored on the project. */
	imagePath?: string;
	image?: string;
};

type LegacyAgentChars = Record<string, { label?: string; imagePath?: string; image?: string }>;

function legacyAgentCharacters(doc: AxcutDocument): LegacyAgentChars {
	const legacy =
		doc.legacyEditor && typeof doc.legacyEditor === "object"
			? (doc.legacyEditor as Record<string, unknown>)
			: {};
	const raw = legacy.agentCharacters;
	if (!raw || typeof raw !== "object") return {};
	return raw as LegacyAgentChars;
}

export function listRegisteredCharacters(doc: AxcutDocument): RegisteredCharacter[] {
	return Object.entries(legacyAgentCharacters(doc)).map(([id, value]) => ({
		id,
		label: value.label?.trim() || id,
		imagePath: value.imagePath,
		image: value.image,
	}));
}

export function listCharactersCatalog(doc: AxcutDocument): {
	builtins: Array<{ id: string; label: string; tagline: string; source: "builtin" }>;
	registered: Array<{ id: string; label: string; source: "registered"; hasImage: boolean }>;
	note: string;
} {
	return {
		builtins: BUILTIN_CHARACTERS.map((c) => ({
			id: c.id,
			label: c.label,
			tagline: c.tagline,
			source: "builtin" as const,
		})),
		registered: listRegisteredCharacters(doc).map((c) => ({
			id: c.id,
			label: c.label,
			source: "registered" as const,
			hasImage: Boolean(c.imagePath || c.image),
		})),
		note:
			"Pick characterId from builtins or registered, pass characterPath/image for a custom file the user uploaded or you rendered, " +
			"or registerCharacter first then reuse characterId. Place with addCursorHighlight(style:\"character\") or addGraphic(kind:\"image\").",
	};
}

export function bakeBuiltinCharacterImage(
	id: BuiltinCharacterId,
	_labelOverride?: string,
): string {
	const def = BUILTIN_CHARACTERS.find((c) => c.id === id);
	if (!def) throw new Error(`Unknown builtin character: ${id}`);
	return renderAvatarBubblePng({
		fill: def.fill,
		accent: def.accent,
		face: def.id,
		size: 192,
	});
}

export function isBuiltinCharacterId(id: string): id is BuiltinCharacterId {
	return BUILTIN_CHARACTERS.some((c) => c.id === id);
}

/**
 * Resolve pixels for a character placement.
 * Priority: image data URI → characterPath → registered id → builtin id → bake "guide".
 */
export function resolveCharacterImage(
	document: AxcutDocument,
	args: {
		characterId?: string;
		characterPath?: string;
		image?: string;
		label?: string;
	},
	opts?: { ffmpegPath?: string | null },
): { image: string; characterId: string; source: "image" | "path" | "registered" | "builtin" } {
	if (args.image?.trim()) {
		return {
			image: assertImageDataUri(args.image.trim()),
			characterId: args.characterId?.trim() || "custom",
			source: "image",
		};
	}
	if (args.characterPath?.trim()) {
		return {
			image: loadImageFileAsDataUri(args.characterPath.trim(), {
				ffmpegPath: opts?.ffmpegPath,
			}),
			characterId: args.characterId?.trim() || "custom",
			source: "path",
		};
	}
	const id = args.characterId?.trim();
	if (id) {
		const registered = legacyAgentCharacters(document)[id];
		if (registered) {
			if (registered.image?.trim()) {
				return {
					image: assertImageDataUri(registered.image.trim()),
					characterId: id,
					source: "registered",
				};
			}
			if (registered.imagePath?.trim()) {
				return {
					image: loadImageFileAsDataUri(registered.imagePath.trim(), {
						ffmpegPath: opts?.ffmpegPath,
					}),
					characterId: id,
					source: "registered",
				};
			}
		}
		if (isBuiltinCharacterId(id)) {
			return {
				image: bakeBuiltinCharacterImage(id, args.label),
				characterId: id,
				source: "builtin",
			};
		}
		throw new Error(
			`Unknown characterId "${id}". Call listCharacters for builtins/registered, or pass characterPath.`,
		);
	}
	return {
		image: bakeBuiltinCharacterImage("guide", args.label),
		characterId: "guide",
		source: "builtin",
	};
}

export function registerCharacterOnDocument(
	document: AxcutDocument,
	args: { id: string; label?: string; imagePath?: string; image?: string },
	opts?: { ffmpegPath?: string | null },
): { document: AxcutDocument; character: RegisteredCharacter } {
	const id = args.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
	if (!id) throw new Error("registerCharacter needs a non-empty id");
	if (isBuiltinCharacterId(id)) {
		throw new Error(`"${id}" is a built-in character id — pick a different id for a custom character`);
	}
	let imagePath = args.imagePath?.trim();
	let image = args.image?.trim();
	if (!imagePath && !image) {
		throw new Error("registerCharacter needs imagePath or image (data URI)");
	}
	if (image) {
		image = assertImageDataUri(image);
	} else if (imagePath) {
		// Validate loadable now; store the path for later reuse.
		loadImageFileAsDataUri(imagePath, { ffmpegPath: opts?.ffmpegPath });
	}
	const label = args.label?.trim() || id;
	const current = legacyAgentCharacters(document);
	const nextChars: LegacyAgentChars = {
		...current,
		[id]: {
			label,
			...(imagePath ? { imagePath } : {}),
			...(image ? { image } : {}),
		},
	};
	const legacy =
		document.legacyEditor && typeof document.legacyEditor === "object"
			? { ...(document.legacyEditor as Record<string, unknown>) }
			: {};
	return {
		document: {
			...document,
			legacyEditor: { ...legacy, agentCharacters: nextChars },
		},
		character: { id, label, imagePath, image },
	};
}

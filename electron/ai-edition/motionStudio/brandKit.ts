/**
 * Project brand kit: the colours, font and logo every generated graphic uses,
 * so intros, section cards and outros look like one product. Stored on the
 * project document (`legacyEditor.brandKit`) — it travels with the project.
 */

import { z } from "zod";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";

const hex = z
	.string()
	.trim()
	.regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "use a hex colour like #1d4ed8");

export const brandKitSchema = z.object({
	name: z.string().trim().max(60).optional(),
	/** Main brand colour (buttons, accents, underlines). */
	primary: hex.default("#6366f1"),
	/** Second colour for gradients and highlights. */
	secondary: hex.default("#22d3ee"),
	/** Card background. */
	background: hex.default("#0b1020"),
	/** Main text colour on the background. */
	text: hex.default("#ffffff"),
	/** Heading font family — a locally installed font (no web fonts are fetched). */
	fontFamily: z.string().trim().max(80).default("Inter"),
	/** Absolute path to a PNG/SVG/JPEG logo. */
	logoPath: z.string().trim().max(1024).optional(),
	/** Overall motion feel. */
	style: z.enum(["clean", "bold", "playful", "tech"]).default("clean"),
});

export type BrandKit = z.infer<typeof brandKitSchema>;

export const DEFAULT_BRAND_KIT: BrandKit = brandKitSchema.parse({});

/** The project's brand kit, or the default when none was set (or it is invalid). */
export function readBrandKit(document: AxcutDocument): BrandKit {
	const raw = (document.legacyEditor as Record<string, unknown> | null | undefined)?.brandKit;
	const parsed = brandKitSchema.safeParse(raw ?? {});
	return parsed.success ? parsed.data : DEFAULT_BRAND_KIT;
}

/** Return a copy of the document with the brand kit merged in (partial updates allowed). */
export function writeBrandKit(document: AxcutDocument, patch: Partial<BrandKit>): { document: AxcutDocument; kit: BrandKit } {
	const current = readBrandKit(document);
	const kit = brandKitSchema.parse({ ...current, ...patch });
	const legacy =
		document.legacyEditor && typeof document.legacyEditor === "object"
			? { ...(document.legacyEditor as Record<string, unknown>) }
			: {};
	return {
		document: {
			...document,
			legacyEditor: { ...legacy, brandKit: kit },
			project: { ...document.project, updatedAt: new Date().toISOString() },
		},
		kit,
	};
}

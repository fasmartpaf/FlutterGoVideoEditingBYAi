/**
 * The user's brand, remembered across projects.
 *
 * A brand kit set in one project (name, logo, colours) is saved once in the
 * app's data folder, with a copy of the logo, so every new project starts with
 * it instead of asking again. A project's own brand kit always wins; this is
 * only the starting point for projects that have none.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { type BrandKit, brandKitSchema } from "./brandKit";

let home: string | null = null;

/** Where the remembered brand lives (the app's data folder). Unset = nothing is remembered (tests, CLI). */
export function setBrandHome(dir: string | null): void {
	home = dir;
}

function brandDir(): string | null {
	return home ? join(home, "brand") : null;
}

/** The remembered brand, or null when none was saved (or it is unreadable). */
export function readGlobalBrandKit(): BrandKit | null {
	const dir = brandDir();
	if (!dir) return null;
	try {
		const parsed = brandKitSchema.safeParse(JSON.parse(readFileSync(join(dir, "brand-kit.json"), "utf8")));
		if (!parsed.success) return null;
		const kit = parsed.data;
		// A logo that has gone missing is dropped rather than breaking every render.
		if (kit.logoPath && !existsSync(kit.logoPath)) return { ...kit, logoPath: undefined };
		return kit;
	} catch {
		return null;
	}
}

/**
 * Remember a brand the user set. Only a named or logo'd brand is worth
 * remembering (colours read from one video are that video's, not the user's).
 * The logo is copied next to the saved kit so moving the original is harmless.
 */
export function saveGlobalBrandKit(kit: BrandKit): BrandKit | null {
	const dir = brandDir();
	if (!dir || (!kit.name && !kit.logoPath)) return null;
	try {
		mkdirSync(dir, { recursive: true });
		let logoPath = kit.logoPath;
		if (logoPath && existsSync(logoPath) && !logoPath.startsWith(dir)) {
			const copy = join(dir, `logo${extname(logoPath).toLowerCase() || ".png"}`);
			copyFileSync(logoPath, copy);
			logoPath = copy;
		}
		const saved = brandKitSchema.parse({ ...kit, logoPath });
		writeFileSync(join(dir, "brand-kit.json"), JSON.stringify(saved, null, 2));
		return saved;
	} catch {
		return null;
	}
}

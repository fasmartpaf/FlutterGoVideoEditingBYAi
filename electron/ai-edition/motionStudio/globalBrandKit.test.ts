import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { brandKitSchema } from "./brandKit";
import { readGlobalBrandKit, saveGlobalBrandKit, setBrandHome } from "./globalBrandKit";

describe("the remembered brand", () => {
	afterEach(() => setBrandHome(null));

	it("remembers a named brand with a copy of its logo", () => {
		const home = mkdtempSync(join(tmpdir(), "brand-home-"));
		const logo = join(home, "my-logo.png");
		writeFileSync(logo, "png");
		setBrandHome(home);
		expect(readGlobalBrandKit()).toBeNull();
		const saved = saveGlobalBrandKit(brandKitSchema.parse({ name: "FlutterGo.ai", primary: "#1E9BE8", logoPath: logo }));
		expect(saved?.logoPath).toBe(join(home, "brand", "logo.png"));
		expect(readGlobalBrandKit()).toMatchObject({ name: "FlutterGo.ai", primary: "#1E9BE8", logoPath: join(home, "brand", "logo.png") });
	});

	it("does not remember colours alone, and remembers nothing without a home", () => {
		const home = mkdtempSync(join(tmpdir(), "brand-home-"));
		setBrandHome(home);
		expect(saveGlobalBrandKit(brandKitSchema.parse({ primary: "#111111" }))).toBeNull();
		setBrandHome(null);
		expect(saveGlobalBrandKit(brandKitSchema.parse({ name: "X" }))).toBeNull();
		expect(readGlobalBrandKit()).toBeNull();
	});
});

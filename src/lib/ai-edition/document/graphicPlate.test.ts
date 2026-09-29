import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	assertImageDataUri,
	graphicCaption,
	graphicLayout,
	isImageDataUri,
	loadImageFileAsDataUri,
	normalizeTopLeftLayout,
	renderPlatePng,
	resolveGraphic,
} from "./graphicPlate";

/** ffmpeg from OPENSCREEN_FFMPEG or PATH; tests that need it are SKIPPED without it. */
const TEST_FFMPEG: string | null = (() => {
	const fromEnv = process.env.OPENSCREEN_FFMPEG;
	if (fromEnv && existsSync(fromEnv)) return fromEnv;
	const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
	for (const dir of [...(process.env.PATH ?? "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin"]) {
		if (dir && existsSync(join(dir, name))) return join(dir, name);
	}
	return null;
})();

describe("graphicPlate", () => {
	it("gives each kind a frame layout the compositor can composite", () => {
		expect(graphicLayout("title")).toMatchObject({
			y: 16,
			type: "text",
			textAnimation: "fade",
		});
		expect(graphicLayout("lowerThird")).toMatchObject({
			x: 8,
			y: 78,
			textAlign: "left",
			textAnimation: "slide-left",
		});
		expect(graphicLayout("cta")).toMatchObject({
			y: 82,
			backgroundColor: "#34B27B",
			textAnimation: "pop",
		});
		expect(graphicLayout("image").type).toBe("image");
		expect(graphicLayout("image")).toMatchObject({
			x: 4,
			y: 6,
			width: 92,
			height: 88,
		});
		expect(graphicLayout("intro")).toMatchObject({
			x: 4,
			y: 6,
			width: 92,
			height: 88,
			type: "text",
			textAnimation: "none",
		});
		expect(graphicLayout("outro").type).toBe("text");
		expect(graphicLayout("title")).toMatchObject({ x: 8, y: 16, width: 84 });
		expect(graphicLayout("cta")).toMatchObject({ x: 32, y: 82, width: 36 });
		expect(graphicLayout("figure").type).toBe("figure");
	});

	it("keeps full-bleed plates inside the frame (top-left + size ≤ 100)", () => {
		for (const kind of ["intro", "outro", "image"] as const) {
			const layout = graphicLayout(kind);
			expect(layout.x + layout.width).toBeLessThanOrEqual(100);
			expect(layout.y + layout.height).toBeLessThanOrEqual(100);
		}
	});

	it("converts center-style full-bleed coords to top-left so the plate stays on screen", () => {
		const { position, size } = normalizeTopLeftLayout(
			{ x: 50, y: 50 },
			{ width: 92, height: 88 },
		);
		expect(position.x).toBeCloseTo(4, 5);
		expect(position.y).toBeCloseTo(6, 5);
		expect(size.width).toBe(92);
		expect(size.height).toBe(88);
		expect(position.x + size.width).toBeLessThanOrEqual(100);
		expect(position.y + size.height).toBeLessThanOrEqual(100);

		const graphic = resolveGraphic({
			kind: "intro",
			text: "Browsing Mobile App Work",
			x: 50,
			y: 50,
			width: 92,
			height: 88,
		});
		expect(graphic.position.x).toBeCloseTo(4, 5);
		expect(graphic.position.y).toBeCloseTo(6, 5);
		expect(graphic.style.textAnimation).toBe("none");
	});

	it("joins text and subtext for titles / CTAs", () => {
		expect(graphicCaption("Coach Pulse", "Try the demo")).toBe("Coach Pulse\nTry the demo");
		expect(graphicCaption("  Try Now  ")).toBe("Try Now");
	});

	it("resolves a title into an official text annotation payload", () => {
		const graphic = resolveGraphic({ kind: "title", text: "Coach Pulse" });
		expect(graphic.type).toBe("text");
		expect(graphic.content).toBe("Coach Pulse");
		expect(graphic.position.y).toBe(16);
		expect(graphic.style.textAnimation).toBe("fade");
		expect(graphic.summaryLabel).toContain("title");
	});

	it("bakes a local PNG plate when kind is image and no data URI is given", () => {
		const graphic = resolveGraphic({ kind: "image", text: "CP" });
		expect(graphic.type).toBe("image");
		expect(graphic.content.startsWith("data:image/png;base64,")).toBe(true);
		expect(graphic.imageContent).toBe(graphic.content);
		expect(graphic.textContent).toBe("CP");
		expect(graphic.content.length).toBeGreaterThan(100);
	});

	it("accepts an image data URI as-is", () => {
		const png = renderPlatePng({
			kind: "badge",
			text: "OK",
			color: "#fff",
			backgroundColor: "#111",
		});
		const graphic = resolveGraphic({ kind: "image", image: png, text: "logo" });
		expect(graphic.content).toBe(png);
		expect(graphic.textContent).toBe("logo");
		expect(graphic.summaryLabel).toContain("logo");
	});

	it("loads a PNG from disk for Local CLI imagePath", () => {
		const dir = mkdtempSync(join(tmpdir(), "os-graphic-"));
		const png = renderPlatePng({
			kind: "badge",
			text: "OK",
			color: "#fff",
			backgroundColor: "#111",
		});
		const match = /^data:image\/png;base64,(.+)$/i.exec(png);
		expect(match).toBeTruthy();
		const file = join(dir, "plate.png");
		writeFileSync(file, Buffer.from(match![1]!, "base64"));
		try {
			const uri = loadImageFileAsDataUri(file);
			expect(uri.startsWith("data:image/png;base64,")).toBe(true);
			const graphic = resolveGraphic({ kind: "image", image: uri, text: "from-disk" });
			expect(graphic.type).toBe("image");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects oversized imagePath without ffmpeg", () => {
		const dir = mkdtempSync(join(tmpdir(), "os-graphic-big-"));
		const file = join(dir, "huge.png");
		// Minimal valid-ish PNG header + padding past the size cap.
		const pad = Buffer.alloc(1_200_000, 0);
		writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), pad]));
		try {
			expect(() => loadImageFileAsDataUri(file)).toThrow(/too large/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.skipIf(!TEST_FFMPEG)("downscales oversized imagePath when ffmpeg is available", () => {
		const dir = mkdtempSync(join(tmpdir(), "os-plate-big-"));
		try {
			// Random noise does not compress, so this PNG is well over the 1.1MB cap.
			const big = join(dir, "big.png");
			const made = spawnSync(TEST_FFMPEG!, [
				"-y",
				"-f",
				"lavfi",
				"-i",
				"nullsrc=s=2400x1600,geq=random(1)*255:128:128",
				"-frames:v",
				"1",
				big,
			]);
			expect(made.status).toBe(0);
			expect(statSync(big).size).toBeGreaterThan(1_100_000);
			const uri = loadImageFileAsDataUri(big, { ffmpegPath: TEST_FFMPEG });
			expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
			expect(uri.length).toBeLessThan(2_000_000);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);

	it("refuses relative and URL image paths", () => {
		expect(() => loadImageFileAsDataUri("plate.png")).toThrow(/absolute/);
		expect(() => loadImageFileAsDataUri("http://example.com/x.png")).toThrow(/absolute/);
	});

	it("rejects non-image data URIs", () => {
		expect(() => assertImageDataUri("https://example.com/x.png")).toThrow(/data URI/);
		expect(isImageDataUri("data:image/png;base64,AAA")).toBe(true);
	});

	it("refuses an empty image graphic", () => {
		expect(() => resolveGraphic({ kind: "image" })).toThrow(/needs text/);
		expect(() => resolveGraphic({ kind: "title", text: "  " })).toThrow(/needs text/);
	});
});

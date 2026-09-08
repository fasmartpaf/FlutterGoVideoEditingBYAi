import { describe, expect, it } from "vitest";
import {
	assertImageDataUri,
	graphicCaption,
	graphicLayout,
	isImageDataUri,
	renderPlatePng,
	resolveGraphic,
} from "./graphicPlate";

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
		expect(graphicLayout("figure").type).toBe("figure");
	});

	it("joins headline and subtext the way a lower third is read", () => {
		expect(graphicCaption("Coach Pulse", "Try the demo")).toBe("Coach Pulse\nTry the demo");
		expect(graphicCaption("  Try Now  ")).toBe("Try Now");
	});

	it("resolves a title as official text — preview and export already paint it", () => {
		const graphic = resolveGraphic({ kind: "title", text: "Coach Pulse" });
		expect(graphic.type).toBe("text");
		expect(graphic.content).toBe("Coach Pulse");
		expect(graphic.position.y).toBe(16);
		expect(graphic.style.textAnimation).toBe("fade");
		expect(graphic.summaryLabel).toContain("title");
	});

	it("bakes an image plate when no data URI is supplied", () => {
		const graphic = resolveGraphic({ kind: "image", text: "CP" });
		expect(graphic.type).toBe("image");
		expect(graphic.content.startsWith("data:image/png;base64,")).toBe(true);
		expect(graphic.imageContent).toBe(graphic.content);
		expect(graphic.textContent).toBe("CP");
		expect(graphic.content.length).toBeGreaterThan(100);
	});

	it("keeps a supplied PNG and never dumps it into the label", () => {
		const png = renderPlatePng({
			kind: "badge",
			text: "NEW",
			color: "#ffffff",
			backgroundColor: "#34B27B",
		});
		const graphic = resolveGraphic({ kind: "image", image: png, text: "logo" });
		expect(graphic.content).toBe(png);
		expect(graphic.textContent).toBe("logo");
		expect(graphic.summaryLabel).toContain("logo");
	});

	it("refuses a non-image payload", () => {
		expect(() => assertImageDataUri("https://example.com/x.png")).toThrow(/data URI/);
		expect(isImageDataUri("data:image/png;base64,AAA")).toBe(true);
	});

	it("refuses an empty image graphic", () => {
		expect(() => resolveGraphic({ kind: "image" })).toThrow(/needs text/);
		expect(() => resolveGraphic({ kind: "title", text: "  " })).toThrow(/needs text/);
	});
});

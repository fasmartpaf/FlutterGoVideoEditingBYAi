import { deflateSync } from "node:zlib";

/**
 * Official-schema graphics the agent can create and drop on the timeline.
 * Preview and export already composite `annotations[]` (text / image / figure).
 * This module only resolves layout + optional local PNG — it does not invent
 * clip-transition or template fields.
 */

export const GRAPHIC_KINDS = [
	"title",
	"lowerThird",
	"badge",
	"cta",
	"bar",
	"figure",
	"image",
] as const;

export type GraphicKind = (typeof GRAPHIC_KINDS)[number];

export type GraphicTextAnimation =
	| "none"
	| "fade"
	| "rise"
	| "pop"
	| "slide-left"
	| "typewriter"
	| "pulse";

export type GraphicLayout = {
	x: number;
	y: number;
	width: number;
	height: number;
	fontSize: number;
	fontWeight: "normal" | "bold";
	textAlign: "left" | "center" | "right";
	color: string;
	backgroundColor: string;
	textAnimation: GraphicTextAnimation;
	type: "text" | "figure" | "image";
	pixelWidth: number;
	pixelHeight: number;
};

const LAYOUTS: Record<GraphicKind, GraphicLayout> = {
	title: {
		x: 50,
		y: 16,
		width: 84,
		height: 16,
		fontSize: 44,
		fontWeight: "bold",
		textAlign: "center",
		color: "#ffffff",
		backgroundColor: "rgba(0,0,0,0.55)",
		textAnimation: "fade",
		type: "text",
		pixelWidth: 1280,
		pixelHeight: 280,
	},
	lowerThird: {
		x: 8,
		y: 78,
		width: 48,
		height: 16,
		fontSize: 28,
		fontWeight: "bold",
		textAlign: "left",
		color: "#ffffff",
		backgroundColor: "#111827",
		textAnimation: "slide-left",
		type: "text",
		pixelWidth: 960,
		pixelHeight: 200,
	},
	badge: {
		x: 8,
		y: 8,
		width: 22,
		height: 8,
		fontSize: 18,
		fontWeight: "bold",
		textAlign: "center",
		color: "#ffffff",
		backgroundColor: "#34B27B",
		textAnimation: "pop",
		type: "text",
		pixelWidth: 420,
		pixelHeight: 96,
	},
	cta: {
		x: 50,
		y: 82,
		width: 36,
		height: 12,
		fontSize: 28,
		fontWeight: "bold",
		textAlign: "center",
		color: "#ffffff",
		backgroundColor: "#34B27B",
		textAnimation: "pop",
		type: "text",
		pixelWidth: 640,
		pixelHeight: 160,
	},
	bar: {
		x: 50,
		y: 88,
		width: 92,
		height: 10,
		fontSize: 22,
		fontWeight: "bold",
		textAlign: "center",
		color: "#ffffff",
		backgroundColor: "rgba(0,0,0,0.72)",
		textAnimation: "rise",
		type: "text",
		pixelWidth: 1280,
		pixelHeight: 120,
	},
	figure: {
		x: 50,
		y: 50,
		width: 16,
		height: 16,
		fontSize: 24,
		fontWeight: "bold",
		textAlign: "center",
		color: "#34B27B",
		backgroundColor: "transparent",
		textAnimation: "none",
		type: "figure",
		pixelWidth: 256,
		pixelHeight: 256,
	},
	image: {
		x: 82,
		y: 10,
		width: 16,
		height: 16,
		fontSize: 22,
		fontWeight: "bold",
		textAlign: "center",
		color: "#ffffff",
		backgroundColor: "#111827",
		textAnimation: "none",
		type: "image",
		pixelWidth: 640,
		pixelHeight: 640,
	},
};

export function graphicLayout(kind: GraphicKind): GraphicLayout {
	return { ...LAYOUTS[kind] };
}

const IMAGE_DATA_URI = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i;
const MAX_IMAGE_CHARS = 1_500_000;

export function isImageDataUri(value: string): boolean {
	return IMAGE_DATA_URI.test(value.trim());
}

export function assertImageDataUri(value: string): string {
	const trimmed = value.trim();
	if (!isImageDataUri(trimmed)) {
		throw new Error("image must be a PNG, JPEG, GIF or WebP data URI (data:image/…;base64,…)");
	}
	if (trimmed.length > MAX_IMAGE_CHARS) {
		throw new Error("image data URI is too large to store on the document");
	}
	return trimmed;
}

export function graphicCaption(text: string, subtext?: string): string {
	const head = text.trim();
	const sub = subtext?.trim() ?? "";
	if (head && sub) return `${head}\n${sub}`;
	return head || sub;
}

export type GraphicRequest = {
	kind: GraphicKind;
	text?: string;
	subtext?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	color?: string;
	backgroundColor?: string;
	fontSize?: number;
	fontWeight?: "normal" | "bold";
	textAlign?: "left" | "center" | "right";
	textAnimation?: GraphicTextAnimation;
	arrowDirection?:
		| "up"
		| "down"
		| "left"
		| "right"
		| "up-right"
		| "up-left"
		| "down-right"
		| "down-left";
	image?: string;
};

export type ResolvedGraphic = {
	type: "text" | "figure" | "image";
	content: string;
	textContent: string;
	imageContent?: string;
	position: { x: number; y: number };
	size: { width: number; height: number };
	style: {
		color: string;
		backgroundColor: string;
		fontSize: number;
		fontFamily: "Inter";
		fontWeight: "normal" | "bold";
		fontStyle: "normal";
		textDecoration: "none";
		textAlign: "left" | "center" | "right";
		textAnimation: GraphicTextAnimation;
	};
	figureData?: {
		arrowDirection: NonNullable<GraphicRequest["arrowDirection"]>;
		color: string;
		strokeWidth: number;
	};
	summaryLabel: string;
};

export function resolveGraphic(request: GraphicRequest): ResolvedGraphic {
	const layout = graphicLayout(request.kind);
	const caption = graphicCaption(request.text ?? "", request.subtext);
	const color = request.color ?? layout.color;
	const backgroundColor = request.backgroundColor ?? layout.backgroundColor;
	const textAlign = request.textAlign ?? layout.textAlign;
	const fontWeight = request.fontWeight ?? layout.fontWeight;
	const fontSize = request.fontSize ?? layout.fontSize;
	const textAnimation = request.textAnimation ?? layout.textAnimation;
	const style = {
		color,
		backgroundColor,
		fontSize,
		fontFamily: "Inter" as const,
		fontWeight,
		fontStyle: "normal" as const,
		textDecoration: "none" as const,
		textAlign,
		textAnimation,
	};
	const position = {
		x: request.x ?? layout.x,
		y: request.y ?? layout.y,
	};
	const size = {
		width: request.width ?? layout.width,
		height: request.height ?? layout.height,
	};

	if (request.kind === "figure") {
		return {
			type: "figure",
			content: caption,
			textContent: caption,
			position,
			size,
			style,
			figureData: {
				arrowDirection: request.arrowDirection ?? "right",
				color,
				strokeWidth: 4,
			},
			summaryLabel: caption ? `figure "${caption.slice(0, 24)}"` : "figure",
		};
	}

	if (request.kind === "image") {
		if (!caption && !request.image) {
			throw new Error("addGraphic image needs text to draw, or an image data URI to place");
		}
		const image = request.image
			? assertImageDataUri(request.image)
			: renderPlatePng({
					kind: "image",
					text: caption,
					color,
					backgroundColor,
				});
		return {
			type: "image",
			content: image,
			textContent: caption,
			imageContent: image,
			position,
			size,
			style: { ...style, backgroundColor: "transparent", textAnimation: "none" },
			summaryLabel: caption ? `image "${caption.slice(0, 24)}"` : "image graphic",
		};
	}

	if (!caption) {
		throw new Error(`addGraphic ${request.kind} needs text`);
	}
	return {
		type: "text",
		content: caption,
		textContent: caption,
		position,
		size,
		style,
		summaryLabel: `${request.kind} "${caption.slice(0, 24)}"`,
	};
}

export function renderPlatePng(options: {
	kind: GraphicKind;
	text: string;
	color: string;
	backgroundColor: string;
}): string {
	const layout = graphicLayout(options.kind === "figure" ? "image" : options.kind);
	const width = layout.pixelWidth;
	const height = layout.pixelHeight;
	const pixels = new Uint8Array(width * height * 4);
	const bg = parseRgba(options.backgroundColor, [17, 24, 39, 230]);
	const fg = parseRgba(options.color, [255, 255, 255, 255]);
	fillRoundedRect(pixels, width, height, 0, 0, width, height, Math.round(height * 0.18), bg);
	if (options.kind === "lowerThird" || options.kind === "title" || options.kind === "bar") {
		const accent = parseRgba("#34B27B", [52, 178, 123, 255]);
		fillRect(pixels, width, height, 0, 0, Math.max(10, Math.round(width * 0.018)), height, accent);
	}
	const lines = options.text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 3);
	const scale = Math.max(3, Math.floor(height / (lines.length * 14 + 16)));
	const lineH = 7 * scale + Math.round(scale * 0.8);
	const blockH = lines.length * lineH;
	let y = Math.round((height - blockH) / 2);
	for (const line of lines) {
		const lineW = textWidth(line, scale);
		const x =
			layout.textAlign === "left"
				? Math.round(width * 0.08)
				: layout.textAlign === "right"
					? width - lineW - Math.round(width * 0.08)
					: Math.round((width - lineW) / 2);
		drawText(pixels, width, height, line, x, y, scale, fg);
		y += lineH;
	}
	return `data:image/png;base64,${encodePng(width, height, pixels).toString("base64")}`;
}

function parseRgba(input: string, fallback: [number, number, number, number]) {
	const value = input.trim();
	const hex = value.match(/^#([0-9a-f]{3,8})$/i);
	if (hex) {
		const h = hex[1];
		if (h.length === 3 || h.length === 4) {
			const r = Number.parseInt(h[0] + h[0], 16);
			const g = Number.parseInt(h[1] + h[1], 16);
			const b = Number.parseInt(h[2] + h[2], 16);
			const a = h.length === 4 ? Number.parseInt(h[3] + h[3], 16) : 255;
			return [r, g, b, a] as const;
		}
		if (h.length === 6 || h.length === 8) {
			const r = Number.parseInt(h.slice(0, 2), 16);
			const g = Number.parseInt(h.slice(2, 4), 16);
			const b = Number.parseInt(h.slice(4, 6), 16);
			const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) : 255;
			return [r, g, b, a] as const;
		}
	}
	const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
	if (rgba) {
		const a = rgba[4] == null ? 255 : Math.round(Math.min(1, Math.max(0, Number(rgba[4]))) * 255);
		return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), a] as const;
	}
	if (value === "transparent") return [0, 0, 0, 0] as const;
	return fallback;
}

function fillRect(
	pixels: Uint8Array,
	width: number,
	height: number,
	x: number,
	y: number,
	w: number,
	h: number,
	color: readonly [number, number, number, number],
) {
	const x0 = Math.max(0, Math.floor(x));
	const y0 = Math.max(0, Math.floor(y));
	const x1 = Math.min(width, Math.ceil(x + w));
	const y1 = Math.min(height, Math.ceil(y + h));
	for (let py = y0; py < y1; py++) {
		let i = (py * width + x0) * 4;
		for (let px = x0; px < x1; px++) {
			pixels[i] = color[0];
			pixels[i + 1] = color[1];
			pixels[i + 2] = color[2];
			pixels[i + 3] = color[3];
			i += 4;
		}
	}
}

function fillRoundedRect(
	pixels: Uint8Array,
	width: number,
	height: number,
	x: number,
	y: number,
	w: number,
	h: number,
	radius: number,
	color: readonly [number, number, number, number],
) {
	const r = Math.max(0, Math.min(radius, Math.floor(Math.min(w, h) / 2)));
	const x0 = Math.max(0, Math.floor(x));
	const y0 = Math.max(0, Math.floor(y));
	const x1 = Math.min(width, Math.ceil(x + w));
	const y1 = Math.min(height, Math.ceil(y + h));
	for (let py = y0; py < y1; py++) {
		for (let px = x0; px < x1; px++) {
			if (!inRoundedRect(px + 0.5, py + 0.5, x, y, w, h, r)) continue;
			const i = (py * width + px) * 4;
			pixels[i] = color[0];
			pixels[i + 1] = color[1];
			pixels[i + 2] = color[2];
			pixels[i + 3] = color[3];
		}
	}
}

function inRoundedRect(
	px: number,
	py: number,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): boolean {
	if (px < x || py < y || px > x + w || py > y + h) return false;
	if (px >= x + r && px <= x + w - r) return true;
	if (py >= y + r && py <= y + h - r) return true;
	const cx = px < x + r ? x + r : x + w - r;
	const cy = py < y + r ? y + r : y + h - r;
	const dx = px - cx;
	const dy = py - cy;
	return dx * dx + dy * dy <= r * r;
}

/** 5×7 glyphs, low 5 bits of each row. Space and unknown glyphs are empty. */
const GLYPHS: Record<string, number[]> = {
	A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
	B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
	C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
	D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
	E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
	F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
	G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
	H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
	I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
	J: [0x01, 0x01, 0x01, 0x01, 0x11, 0x11, 0x0e],
	K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
	L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
	M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
	N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
	O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
	P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
	Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
	R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
	S: [0x0e, 0x11, 0x10, 0x0e, 0x01, 0x11, 0x0e],
	T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
	U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
	V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
	W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
	X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
	Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
	Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
	"0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
	"1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
	"2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
	"3": [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
	"4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
	"5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
	"6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
	"7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
	"8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
	"9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
	" ": [0, 0, 0, 0, 0, 0, 0],
	".": [0, 0, 0, 0, 0, 0x04, 0x04],
	",": [0, 0, 0, 0, 0x04, 0x04, 0x08],
	"!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
	"?": [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
	"-": [0, 0, 0, 0x1f, 0, 0, 0],
	_: [0, 0, 0, 0, 0, 0, 0x1f],
	":": [0, 0x04, 0x04, 0, 0x04, 0x04, 0],
	"'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
	"+": [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
	"/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
	"&": [0x0c, 0x12, 0x0c, 0x15, 0x12, 0x11, 0x0d],
};

function glyphFor(ch: string): number[] {
	if (GLYPHS[ch]) return GLYPHS[ch];
	const upper = ch.toUpperCase();
	return GLYPHS[upper] ?? GLYPHS[" "];
}

function textWidth(text: string, scale: number): number {
	return text.length * (5 * scale + Math.max(1, Math.round(scale * 0.4)));
}

function drawText(
	pixels: Uint8Array,
	width: number,
	height: number,
	text: string,
	x: number,
	y: number,
	scale: number,
	color: readonly [number, number, number, number],
) {
	let cx = x;
	const gap = Math.max(1, Math.round(scale * 0.4));
	for (const ch of text) {
		const glyph = glyphFor(ch);
		for (let row = 0; row < 7; row++) {
			const bits = glyph[row] ?? 0;
			for (let col = 0; col < 5; col++) {
				if (((bits >> (4 - col)) & 1) === 0) continue;
				fillRect(pixels, width, height, cx + col * scale, y + row * scale, scale, scale, color);
			}
		}
		cx += 5 * scale + gap;
	}
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buffer: Buffer): number {
	let c = -1;
	for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function pngChunk(type: string, body: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(body.length, 0);
	const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typed), 0);
	return Buffer.concat([length, typed, crc]);
}

function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
	const stride = width * 4;
	const raw = Buffer.alloc(height * (stride + 1));
	for (let y = 0; y < height; y++) {
		const dst = y * (stride + 1);
		raw[dst] = 0;
		raw.set(pixels.subarray(y * stride, y * stride + stride), dst + 1);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw, { level: 9 })),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

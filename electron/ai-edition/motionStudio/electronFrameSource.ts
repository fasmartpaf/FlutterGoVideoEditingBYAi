/**
 * FrameSource backed by an off-screen Electron window. Used in the app (main
 * process). The composition runs sandboxed, in its own throw-away session,
 * with every network request refused — agent-written HTML can draw, not call
 * out.
 */

import { randomUUID } from "node:crypto";
import { BrowserWindow, type NativeImage, session } from "electron";
import type { FrameSource } from "./render";

const PAINT_TIMEOUT_MS = 3_000;

export function createElectronFrameSource(): FrameSource {
	let win: BrowserWindow | null = null;
	let rawSize: { width: number; height: number } | null = null;

	const nextPaint = (w: BrowserWindow): Promise<NativeImage | null> =>
		new Promise((resolve) => {
			const timer = setTimeout(() => {
				w.webContents.removeListener("paint", onPaint);
				resolve(null);
			}, PAINT_TIMEOUT_MS);
			const onPaint = (_event: unknown, _dirty: unknown, image: NativeImage) => {
				clearTimeout(timer);
				resolve(image);
			};
			w.webContents.once("paint", onPaint);
			w.webContents.invalidate();
		});

	return {
		async open(filePath, size, options) {
			const transparent = Boolean(options?.transparent);
			const scale = options?.scale && options.scale > 0 && options.scale < 1 ? options.scale : 1;
			// In-memory partition (no "persist:" prefix): nothing survives the render.
			const ses = session.fromPartition(`motion-render-${randomUUID()}`, { cache: false });
			ses.webRequest.onBeforeRequest((details, callback) => {
				const allowed = /^(file|data|blob|about|devtools):/i.test(details.url);
				callback({ cancel: !allowed });
			});
			ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
			win = new BrowserWindow({
				show: false,
				width: Math.round(size.width * scale),
				height: Math.round(size.height * scale),
				useContentSize: true,
				frame: false,
				enableLargerThanScreen: true,
				// Overlays: keep alpha so the compositor can draw them over the recording.
				transparent,
				backgroundColor: transparent ? "#00000000" : "#000000",
				webPreferences: {
					offscreen: true,
					session: ses,
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false,
					webSecurity: true,
					backgroundThrottling: false,
					devTools: false,
					spellcheck: false,
				},
			});
			win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
			win.webContents.on("will-navigate", (event) => event.preventDefault());
			win.webContents.setFrameRate(60);
			await win.loadFile(filePath);
			// Same layout at a smaller drawing size (see MAX_RENDER_SIDE).
			if (scale !== 1) win.webContents.setZoomFactor(scale);
		},
		async frame(ms) {
			const w = win;
			if (!w) throw new Error("Motion renderer is not open.");
			// Seek, then wait for two real frames so style, layout and every raster
			// tile of THIS moment are drawn — capturing right after the seek returned
			// the previous frame or a half-drawn one (the "shaking" / missing words).
			await w.webContents.executeJavaScript(
				`window.__osSeek(${Number(ms)}).then(() => window.__osSettle ? window.__osSettle() : 0)`,
				true,
			);
			const painted = await nextPaint(w);
			const image = painted && !painted.isEmpty() ? painted : await w.webContents.capturePage();
			return image.toPNG();
		},
		async frameRaw(ms) {
			const w = win;
			if (!w) throw new Error("Motion renderer is not open.");
			await w.webContents.executeJavaScript(
				`window.__osSeek(${Number(ms)}).then(() => window.__osSettle ? window.__osSettle() : 0)`,
				true,
			);
			const painted = await nextPaint(w);
			const image = painted && !painted.isEmpty() ? painted : await w.webContents.capturePage();
			// Every frame must match the first one's size (a fallback capture can differ).
			let img = image;
			const got = img.getSize();
			rawSize ??= got;
			if (got.width !== rawSize.width || got.height !== rawSize.height) img = img.resize(rawSize);
			// Native byte order: BGRA on macOS and Windows (little-endian ARGB32).
			return { data: img.toBitmap(), width: rawSize.width, height: rawSize.height, format: "bgra" as const };
		},
				async errors() {
			if (!win) return [];
			const list = await win.webContents.executeJavaScript("window.__osErrors || []", true);
			return Array.isArray(list) ? list.map(String).slice(0, 20) : [];
		},
		async close() {
			win?.destroy();
			win = null;
		},
	};
}

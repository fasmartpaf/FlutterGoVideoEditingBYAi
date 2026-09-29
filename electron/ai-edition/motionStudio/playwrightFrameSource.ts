/**
 * FrameSource on headless Chromium via Playwright — the same page contract
 * as the Electron window, used by tests and CLI tooling. Returns null when
 * Playwright or its browser is not installed, so callers can skip.
 */

import { pathToFileURL } from "node:url";
import type { FrameSource } from "./render";

type PwBrowser = { newPage(o: unknown): Promise<PwPage>; close(): Promise<void> };
type PwPage = {
	goto(url: string): Promise<unknown>;
	evaluate<T>(expr: string): Promise<T>;
	screenshot(o: unknown): Promise<Buffer>;
	route(pattern: string, handler: (route: { abort(): Promise<void>; continue(): Promise<void>; request(): { url(): string } }) => unknown): Promise<void>;
};

export async function createPlaywrightFrameSource(): Promise<FrameSource | null> {
	let chromium: { launch(o?: unknown): Promise<PwBrowser> } | undefined;
	for (const mod of ["playwright", "playwright-core", "@playwright/test"]) {
		try {
			const loaded = (await import(mod)) as {
				chromium?: typeof chromium;
				default?: { chromium?: typeof chromium };
			};
			chromium = loaded.chromium ?? loaded.default?.chromium;
			if (chromium) break;
		} catch {
			// try next
		}
	}
	if (!chromium) return null;
	let browser: PwBrowser;
	try {
		browser = await chromium.launch({ headless: true });
	} catch {
		// Bundled Playwright Chromium may be missing (TLS / offline install). Prefer
		// the machine's Google Chrome so Mac tests still exercise the real pipeline.
		try {
			browser = await chromium.launch({ headless: true, channel: "chrome" });
		} catch {
			return null;
		}
	}
	let page: PwPage | null = null;
	let transparent = false;
	return {
		async open(filePath, size, options) {
			transparent = Boolean(options?.transparent);
			const scale = options?.scale && options.scale > 0 && options.scale < 1 ? options.scale : 1;
			page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: scale });
			await page.route("**/*", (route) =>
				/^(file|data|blob|about):/i.test(route.request().url()) ? route.continue() : route.abort(),
			);
			await page.goto(pathToFileURL(filePath).href);
		},
		async frame(ms) {
			if (!page) throw new Error("not open");
			await page.evaluate(`window.__osSeek(${Number(ms)})`);
			return page.screenshot({ type: "png", animations: "allow", caret: "initial", omitBackground: transparent });
		},
		async errors() {
			return page ? page.evaluate<string[]>("window.__osErrors || []") : [];
		},
		async close() {
			await browser.close();
		},
	};
}

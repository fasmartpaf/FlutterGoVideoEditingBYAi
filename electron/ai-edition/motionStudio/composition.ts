/** Writing a composition to disk for the renderer, next to its own assets. */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { assertSafeLocalMediaPath } from "../mediaStudio";
import { type CompositionFrame, wrapComposition } from "./driver";

/** Largest composition file the agent may hand us (inline images included). */
export const MAX_COMPOSITION_BYTES = 8 * 1024 * 1024;

export interface WrittenComposition {
	path: string;
	/** Remove the temporary wrapped file (the original is never touched). */
	dispose: () => void;
}

/**
 * Wrap `html` (or the file at `htmlPath`) with the virtual-clock driver and
 * write it where relative asset URLs still resolve: beside the original file
 * when one was given, else in a temp folder.
 */
export function writeComposition(
	source: { html: string } | { htmlPath: string },
	frame: CompositionFrame,
): WrittenComposition {
	if ("htmlPath" in source) {
		const abs = assertSafeLocalMediaPath(source.htmlPath, "htmlPath");
		if (!existsSync(abs)) throw new Error(`htmlPath not found: ${abs}`);
		if (![".html", ".htm"].includes(extname(abs).toLowerCase())) {
			throw new Error("htmlPath must be an .html file");
		}
		if (statSync(abs).size > MAX_COMPOSITION_BYTES) throw new Error("composition file is too large (max 8 MB)");
		const wrapped = wrapComposition(readFileSync(abs, "utf8"), frame);
		const out = join(dirname(abs), `.os-render-${Date.now().toString(36)}-${basename(abs)}`);
		writeFileSync(out, wrapped, "utf8");
		return { path: out, dispose: () => rmSync(out, { force: true }) };
	}
	if (Buffer.byteLength(source.html, "utf8") > MAX_COMPOSITION_BYTES) {
		throw new Error("composition html is too large (max 8 MB)");
	}
	const dir = mkdtempSync(join(tmpdir(), "os-motion-"));
	const out = join(dir, "composition.html");
	writeFileSync(out, wrapComposition(source.html, frame), "utf8");
	return { path: out, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

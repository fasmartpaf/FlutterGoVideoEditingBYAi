#!/usr/bin/env node
/**
 * Brand the npm Electron.app so macOS Privacy & Security lists show "OpenScreen"
 * instead of "Electron" during `npm run dev`.
 *
 * Packaged installers already ship as Openscreen.app — this only patches the
 * local `node_modules/electron/dist/Electron.app` host used in development.
 * End users never need this; developers (and agents) do, because the old
 * permission dialog said "Allow OpenScreen" while Settings listed Electron.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DISPLAY_NAME = "OpenScreen";

if (process.platform !== "darwin") {
	process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appPath = path.join(root, "node_modules", "electron", "dist", "Electron.app");
const plistPath = path.join(appPath, "Contents", "Info.plist");

if (!fs.existsSync(plistPath)) {
	console.warn(`[brand-electron] skip — missing ${plistPath}`);
	process.exit(0);
}

function readPlistString(key) {
	const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", plistPath], {
		encoding: "utf8",
	});
	if (result.status !== 0) return "";
	return result.stdout.trim();
}

const current = readPlistString("CFBundleDisplayName");
if (current === DISPLAY_NAME) {
	console.info(`[brand-electron] already branded as ${DISPLAY_NAME}`);
	process.exit(0);
}

for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
	const set = spawnSync("plutil", ["-replace", key, "-string", DISPLAY_NAME, plistPath], {
		encoding: "utf8",
	});
	if (set.status !== 0) {
		console.error(`[brand-electron] failed to set ${key}: ${set.stderr || set.stdout}`);
		process.exit(1);
	}
}

// Editing Info.plist invalidates the ad-hoc signature; re-sign so macOS still launches it.
const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
	encoding: "utf8",
});
if (sign.status !== 0) {
	console.error(`[brand-electron] codesign failed: ${sign.stderr || sign.stdout}`);
	process.exit(1);
}

console.info(
	`[brand-electron] ${appPath} now displays as ${DISPLAY_NAME} in System Settings (was “${current || "unknown"}”).`,
);

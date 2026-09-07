// In-app bridge from the Studio chat agent to the local OpenScreen CLI.
// The user talks to the software; this module runs sources / record / captions /
// export through the same Electron CLI the packaged `openscreen` binary uses.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { fillProbedMedia, loadProjectForEdit, persistForCli } from "../../src/cli/agentWrapper";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import type { CliEngine, CliEngineResult } from "../ai-edition/deep-agent/service";

interface CliDoneEvent {
	event?: string;
	success?: boolean;
	error?: string;
	sources?: unknown;
	outputPath?: string;
	projectPath?: string;
	captionCount?: number;
	screenVideoPath?: string;
}

function ffprobePath(): string {
	return path.join(
		app.getAppPath(),
		"crates/thirdparty/ffmpeg-n8.1.2-macos64-lgpl-shared/bin/ffprobe",
	);
}

function agentDir(): string {
	return path.join(app.getPath("userData"), "agent-cli");
}

function cliArgv(args: string[]): string[] {
	const withJson = args.includes("--json") ? args : [...args, "--json"];
	return app.isPackaged ? withJson : [app.getAppPath(), ...withJson];
}

async function runOpenscreenCli(args: string[]): Promise<CliDoneEvent> {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	return await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, cliArgv(args), {
			cwd: app.getAppPath(),
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", reject);
		child.on("close", (code) => {
			let done: CliDoneEvent | null = null;
			for (const line of stdout.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const parsed = JSON.parse(trimmed) as CliDoneEvent;
					if (parsed.event === "done") done = parsed;
				} catch {
					// Chromium may leak a non-JSON line onto stdout.
				}
			}
			if (done) {
				if (done.success === false) {
					reject(new Error(String(done.error ?? `OpenScreen CLI failed: ${args[0]}`)));
					return;
				}
				resolve(done);
				return;
			}
			if (code === 0) {
				resolve({ event: "done", success: true });
				return;
			}
			reject(new Error(`OpenScreen CLI exited ${code} (${args.join(" ")}). ${stderr.slice(-600)}`));
		});
	});
}

async function writeCliProject(document: AxcutDocument, projectPath: string): Promise<void> {
	await fs.mkdir(path.dirname(projectPath), { recursive: true });
	await fs.writeFile(projectPath, `${JSON.stringify(persistForCli(document), null, 2)}\n`, "utf8");
}

async function readCliProject(projectPath: string): Promise<AxcutDocument> {
	const raw = JSON.parse(await fs.readFile(projectPath, "utf8"));
	const loaded = loadProjectForEdit(raw);
	try {
		return await fillProbedMedia(loaded.document, ffprobePath());
	} catch {
		return loaded.document;
	}
}

export function createInAppCliEngine(): CliEngine {
	return {
		async run(name, args, document): Promise<CliEngineResult> {
			try {
				return await runNamed(name, args, document);
			} catch (error) {
				return {
					ok: false,
					resultJson: JSON.stringify({
						error: error instanceof Error ? error.message : String(error),
					}),
				};
			}
		},
	};
}

async function runNamed(
	name: "listSources" | "recordScreen" | "generateCaptions" | "exportProject",
	args: unknown,
	document: AxcutDocument,
): Promise<CliEngineResult> {
	const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
	await fs.mkdir(agentDir(), { recursive: true });

	if (name === "listSources") {
		const outPath = path.join(agentDir(), `sources-${Date.now()}.json`);
		await runOpenscreenCli(["sources", "-o", outPath]);
		const sources = JSON.parse(await fs.readFile(outPath, "utf8"));
		return {
			ok: true,
			resultJson: JSON.stringify({ sources }),
			summary: "listed capture sources",
		};
	}

	if (name === "recordScreen") {
		const projectPath = path.join(agentDir(), `record-${Date.now()}.openscreen`);
		const cliArgs = ["record", "--project", projectPath];
		const windowTitle = typeof input.window === "string" ? input.window : undefined;
		const display = typeof input.display === "number" ? input.display : undefined;
		const durationSec = typeof input.durationSec === "number" ? input.durationSec : 15;
		if (windowTitle) cliArgs.push("--window", windowTitle);
		else if (display !== undefined) cliArgs.push("--display", String(display));
		cliArgs.push("--duration", String(durationSec));
		if (input.mic === true) cliArgs.push("--mic");
		if (input.systemAudio === true) cliArgs.push("--system-audio");
		const done = await runOpenscreenCli(cliArgs);
		const next = await readCliProject(done.projectPath ?? projectPath);
		return {
			ok: true,
			document: next,
			resultJson: JSON.stringify({
				projectPath: done.projectPath ?? projectPath,
				screenVideoPath: done.screenVideoPath,
				durationSec,
			}),
			summary: `recorded ${windowTitle ?? `display ${display ?? 0}`} (${durationSec}s)`,
		};
	}

	if (name === "generateCaptions") {
		const projectPath = path.join(agentDir(), `${document.project.id}.openscreen`);
		await writeCliProject(document, projectPath);
		const cliArgs = ["captions", projectPath];
		if (typeof input.minWords === "number") cliArgs.push("--min-words", String(input.minWords));
		if (typeof input.maxWords === "number") cliArgs.push("--max-words", String(input.maxWords));
		const done = await runOpenscreenCli(cliArgs);
		const next = await readCliProject(projectPath);
		return {
			ok: true,
			document: next,
			resultJson: JSON.stringify({ captionCount: done.captionCount ?? null }),
			summary: `captions (${done.captionCount ?? "done"})`,
		};
	}

	const projectPath = path.join(agentDir(), `${document.project.id}.openscreen`);
	await writeCliProject(document, projectPath);
	const outPath =
		typeof input.out === "string" && input.out.trim()
			? path.isAbsolute(input.out)
				? input.out
				: path.join(agentDir(), "exports", input.out)
			: path.join(agentDir(), "exports", `${document.project.id}-${Date.now()}.mp4`);
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	const cliArgs = ["export", projectPath, "-o", outPath];
	if (typeof input.quality === "string") cliArgs.push("--quality", input.quality);
	if (typeof input.format === "string") cliArgs.push("--format", input.format);
	if (input.autoZoom === true) cliArgs.push("--auto-zoom");
	const done = await runOpenscreenCli(cliArgs);
	return {
		ok: true,
		resultJson: JSON.stringify({
			outputPath: done.outputPath ?? outPath,
			format: input.format ?? "mp4",
		}),
		summary: `exported ${done.outputPath ?? outPath}`,
	};
}

#!/usr/bin/env npx tsx
// Way-1 local agent CLI. Cursor / Codex call this; humans do not need the HUD.
// Process commands (sources / record / captions / export) spawn the OpenScreen
// Electron CLI. Document edits go through agentWrapper.ts only.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentCommand,
	applyDocumentCommand,
	fillProbedMedia,
	inspectProject,
	loadProjectForEdit,
	parseAgentCommands,
	persistForCli,
} from "./agentWrapper";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ELECTRON = path.join(ROOT, "node_modules/.bin/electron");
const FFPROBE = path.join(ROOT, "crates/thirdparty/ffmpeg-n8.1.2-macos64-lgpl-shared/bin/ffprobe");

const USAGE = `OpenScreen Way-1 agent

Usage:
  openscreen-agent sources [--json]
  openscreen-agent record [--window <title>] [--display <n>] [--duration <sec>]
                          [--project <out.openscreen>] [--mic] [--system-audio] [--json]
  openscreen-agent inspect <project.openscreen>
  openscreen-agent captions <project.openscreen> [--min-words n] [--max-words n]
  openscreen-agent edit <project.openscreen> --commands <file.json>
  openscreen-agent export <project.openscreen> -o <out.mp4> [--quality medium|good|source]
  openscreen-agent run --file <pipeline.json>

Edit / pipeline command objects (Zod-validated):
  { "op": "trim", "startSec": 0, "endSec": 0.4 }
  { "op": "zoom", "startSec": 1, "endSec": 3, "depth": 3, "focus": { "cx": 0.5, "cy": 0.4 } }
  { "op": "speed", "startSec": 4, "endSec": 6, "speed": 1.5 }
  { "op": "annotation", "startSec": 1, "endSec": 3, "text": "Title", "x": 50, "y": 12 }
  { "op": "aspectRatio", "value": "9:16" }
  { "op": "background", "wallpaper": "2" }
  { "op": "captions" }
  { "op": "export", "out": "demo.mp4", "quality": "good" }
`;

function die(message: string, code = 2): never {
	process.stderr.write(`${message}\n`);
	process.exit(code);
}

function takeFlag(argv: string[], name: string): boolean {
	return argv.includes(name);
}

function takeOption(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	if (i < 0) return undefined;
	const value = argv[i + 1];
	if (value === undefined || value.startsWith("-")) {
		die(`${name} requires a value`);
	}
	return value;
}

async function readJson(filePath: string): Promise<unknown> {
	return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

interface CliDoneEvent {
	event?: string;
	success?: boolean;
	error?: string;
	[key: string]: unknown;
}

async function runOpenscreenCli(args: string[], json = true): Promise<CliDoneEvent> {
	const electronArgs = [ROOT, ...args, ...(json && !args.includes("--json") ? ["--json"] : [])];
	return await new Promise((resolve, reject) => {
		const child = spawn(ELECTRON, electronArgs, {
			cwd: ROOT,
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			stdout += text;
			process.stderr.write(text);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			stderr += text;
			process.stderr.write(text);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			const lines = stdout
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			let done: CliDoneEvent | null = null;
			for (const line of lines) {
				try {
					const parsed = JSON.parse(line) as CliDoneEvent;
					if (parsed.event === "done") done = parsed;
				} catch {
					// Chromium may leak a non-JSON line onto stdout under some wrappers.
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
			reject(
				new Error(
					`OpenScreen CLI exited ${code} (${args.join(" ")}). ${stderr.trim().slice(-800)}`,
				),
			);
		});
	});
}

async function loadFromDisk(projectPath: string) {
	const raw = await readJson(projectPath);
	const loaded = loadProjectForEdit(raw);
	const document = await fillProbedMedia(loaded.document, FFPROBE);
	return { ...loaded, document };
}

async function saveToDisk(
	projectPath: string,
	document: Awaited<ReturnType<typeof loadFromDisk>>["document"],
) {
	await writeJson(projectPath, persistForCli(document));
}

async function applyEdits(projectPath: string, commands: AgentCommand[]) {
	const loaded = await loadFromDisk(projectPath);
	let document = loaded.document;
	const applied: { op: string; summary: string }[] = [];
	for (const command of commands) {
		if (command.op === "captions") {
			await saveToDisk(projectPath, document);
			await runOpenscreenCli([
				"captions",
				projectPath,
				...(command.minWords ? ["--min-words", String(command.minWords)] : []),
				...(command.maxWords ? ["--max-words", String(command.maxWords)] : []),
			]);
			document = (await loadFromDisk(projectPath)).document;
			applied.push({ op: "captions", summary: "openscreen captions" });
			continue;
		}
		if (command.op === "export") {
			await saveToDisk(projectPath, document);
			const outPath = path.isAbsolute(command.out) ? command.out : path.resolve(command.out);
			await runOpenscreenCli([
				"export",
				projectPath,
				"-o",
				outPath,
				...(command.quality ? ["--quality", command.quality] : []),
				...(command.format ? ["--format", command.format] : []),
				...(command.autoZoom ? ["--auto-zoom"] : []),
			]);
			applied.push({ op: "export", summary: `export ${outPath}` });
			continue;
		}
		const result = applyDocumentCommand(document, command);
		document = result.document;
		applied.push({ op: result.op, summary: result.summary });
	}
	await saveToDisk(projectPath, document);
	return { applied, inspect: inspectProject(document, "v2") };
}

async function cmdSources(argv: string[]) {
	const done = await runOpenscreenCli(["sources", ...(takeFlag(argv, "--json") ? ["--json"] : [])]);
	process.stdout.write(`${JSON.stringify(done, null, 2)}\n`);
}

async function cmdRecord(argv: string[]) {
	const args = ["record"];
	const windowTitle = takeOption(argv, "--window");
	const display = takeOption(argv, "--display");
	const duration = takeOption(argv, "--duration");
	const project = takeOption(argv, "--project");
	if (windowTitle) args.push("--window", windowTitle);
	if (display) args.push("--display", display);
	if (duration) args.push("--duration", duration);
	if (project) args.push("--project", path.resolve(project));
	if (takeFlag(argv, "--mic")) args.push("--mic");
	if (takeFlag(argv, "--system-audio")) args.push("--system-audio");
	const done = await runOpenscreenCli(args);
	process.stdout.write(`${JSON.stringify(done, null, 2)}\n`);
}

async function cmdInspect(projectPath: string) {
	const loaded = await loadFromDisk(path.resolve(projectPath));
	process.stdout.write(
		`${JSON.stringify(inspectProject(loaded.document, loaded.source), null, 2)}\n`,
	);
}

async function cmdCaptions(argv: string[]) {
	const projectPath = argv.find((arg) => arg.endsWith(".openscreen"));
	if (!projectPath) die("captions requires a <project.openscreen> path");
	const minWords = takeOption(argv, "--min-words");
	const maxWords = takeOption(argv, "--max-words");
	const done = await runOpenscreenCli([
		"captions",
		path.resolve(projectPath),
		...(minWords ? ["--min-words", minWords] : []),
		...(maxWords ? ["--max-words", maxWords] : []),
	]);
	process.stdout.write(`${JSON.stringify(done, null, 2)}\n`);
}

async function cmdEdit(argv: string[]) {
	const projectPath = argv.find((arg) => arg.endsWith(".openscreen"));
	const commandsPath = takeOption(argv, "--commands");
	if (!projectPath || !commandsPath)
		die("edit requires <project.openscreen> --commands <file.json>");
	const commands = parseAgentCommands(await readJson(path.resolve(commandsPath)));
	const result = await applyEdits(path.resolve(projectPath), commands);
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function cmdExport(argv: string[]) {
	const projectPath = argv.find((arg) => arg.endsWith(".openscreen"));
	const out = takeOption(argv, "-o") ?? takeOption(argv, "--out");
	if (!projectPath || !out) die("export requires <project.openscreen> -o <file>");
	const quality = takeOption(argv, "--quality");
	const done = await runOpenscreenCli([
		"export",
		path.resolve(projectPath),
		"-o",
		path.resolve(out),
		...(quality ? ["--quality", quality] : []),
	]);
	process.stdout.write(`${JSON.stringify(done, null, 2)}\n`);
}

async function cmdRun(argv: string[]) {
	const file = takeOption(argv, "--file");
	if (!file) die("run requires --file <pipeline.json>");
	const pipeline = (await readJson(path.resolve(file))) as {
		record?: {
			window?: string;
			display?: number;
			duration?: number;
			project: string;
			mic?: boolean;
			systemAudio?: boolean;
		};
		project?: string;
		commands?: unknown;
	};
	let projectPath = pipeline.project ? path.resolve(pipeline.project) : undefined;
	if (pipeline.record) {
		projectPath = path.resolve(pipeline.record.project);
		const args = ["record", "--project", projectPath];
		if (pipeline.record.window) args.push("--window", pipeline.record.window);
		if (pipeline.record.display !== undefined)
			args.push("--display", String(pipeline.record.display));
		if (pipeline.record.duration !== undefined) {
			args.push("--duration", String(pipeline.record.duration));
		}
		if (pipeline.record.mic) args.push("--mic");
		if (pipeline.record.systemAudio) args.push("--system-audio");
		await runOpenscreenCli(args);
	}
	if (!projectPath) die("pipeline needs record.project or project");
	const commands = pipeline.commands ? parseAgentCommands(pipeline.commands) : [];
	const result = await applyEdits(projectPath, commands);
	process.stdout.write(`${JSON.stringify({ projectPath, ...result }, null, 2)}\n`);
}

async function main() {
	const argv = process.argv.slice(2);
	const command = argv[0];
	if (!command || command === "help" || command === "--help" || command === "-h") {
		process.stdout.write(USAGE);
		return;
	}
	switch (command) {
		case "sources":
			await cmdSources(argv.slice(1));
			return;
		case "record":
			await cmdRecord(argv.slice(1));
			return;
		case "inspect":
			if (!argv[1]) die("inspect requires a <project.openscreen> path");
			await cmdInspect(argv[1]);
			return;
		case "captions":
			await cmdCaptions(argv.slice(1));
			return;
		case "edit":
			await cmdEdit(argv.slice(1));
			return;
		case "export":
			await cmdExport(argv.slice(1));
			return;
		case "run":
			await cmdRun(argv.slice(1));
			return;
		default:
			die(`Unknown command: ${command}\n\n${USAGE}`);
	}
}

main().catch((error) => {
	die(error instanceof Error ? (error.stack ?? error.message) : String(error), 1);
});

#!/usr/bin/env node
// Launches the Way-1 TypeScript agent with the repo tsconfig path aliases.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsx = path.join(root, "node_modules/.bin/tsx");
const entry = path.join(root, "src/cli/agentCli.ts");
const child = spawn(tsx, [entry, ...process.argv.slice(2)], {
	cwd: root,
	stdio: "inherit",
	env: process.env,
});
child.on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 1);
});

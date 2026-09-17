/**
 * Generate THIRD_PARTY_TRANSITIONS_NOTICES from the actual bundled registry set.
 * MAIN / scripts / tests only — never import from renderer via the transitionLibrary barrel.
 */

import { GL_TRANSITIONS_PINNED_REVISION, TRANSITION_REGISTRY } from "./registry";

export function buildThirdPartyTransitionsNotices(): string {
	const lines: string[] = [
		"# THIRD_PARTY_TRANSITIONS_NOTICES",
		"",
		`Generated from OpenScreen Transition Registry (gl-transitions pin ${GL_TRANSITIONS_PINNED_REVISION}).`,
		"Only transitions listed below are bundled / attributed for this build.",
		"",
		"| Transition ID | Source name | Author | License | Source | Revision |",
		"|---|---|---|---|---|---|",
	];
	for (const e of TRANSITION_REGISTRY) {
		if (e.provider !== "gl-transitions") continue;
		lines.push(
			`| ${e.id} | ${e.sourceName ?? e.displayName} | ${e.author} | ${e.license} | https://github.com/gl-transitions/gl-transitions | ${e.sourceRevision} |`,
		);
	}
	lines.push("");
	lines.push("## OpenScreen builtins");
	lines.push("");
	for (const e of TRANSITION_REGISTRY.filter((x) => x.provider === "openscreen")) {
		lines.push(`- ${e.id}: ${e.attribution} (${e.license})`);
	}
	lines.push("");
	lines.push(
		"GL Transitions are community contributions under their stated per-transition licenses (MIT / BSD).",
	);
	lines.push(
		"OpenScreen vendors definitions offline; runtime rendering uses OpenScreen native Metal ports — no HTTP at playback/export.",
	);
	lines.push("");
	return lines.join("\n");
}

export async function writeThirdPartyTransitionsNotices(repoRoot: string): Promise<string> {
	const { writeFileSync, mkdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	const text = buildThirdPartyTransitionsNotices();
	const out = join(repoRoot, "THIRD_PARTY_TRANSITIONS_NOTICES.md");
	writeFileSync(out, text, "utf8");
	mkdirSync(join(repoRoot, "electron/ai-edition/transitionLibrary"), { recursive: true });
	writeFileSync(
		join(repoRoot, "electron/ai-edition/transitionLibrary/THIRD_PARTY_TRANSITIONS_NOTICES.md"),
		text,
		"utf8",
	);
	return out;
}

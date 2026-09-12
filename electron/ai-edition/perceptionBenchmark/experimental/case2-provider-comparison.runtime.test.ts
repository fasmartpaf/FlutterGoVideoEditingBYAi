/**
 * Experimental Case 2 provider comparison: GEMINI_NATIVE_VIDEO vs locked CURRENT_OPENSCREEN.
 * Skips when Gemini API key is absent. Does not alter production routing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CASE2_LOCKED_MEDIA } from "./case02LockedGroundTruth";
import { loadGeminiApiKey } from "./geminiNativeClient";
import {
	GEMINI_NATIVE_VIDEO_PROVIDER,
	runGeminiNativeVideoCase,
	scoreCurrentOpenscreenCase2Text,
} from "./runGeminiNativeVideo";

const OUT = path.join(process.cwd(), "tmp/perception-benchmark/case2-provider-comparison");

function loadInAppCurrentOpenscreenText(): string {
	const locked = path.join(
		process.cwd(),
		"tmp/perception-benchmark/case2-current-openscreen-baseline/product-turn-user-facing.txt",
	);
	if (existsSync(locked)) return readFileSync(locked, "utf8");
	const chat = path.join(
		process.env.HOME || "",
		"Library/Application Support/openscreen/chat-sessions/proj_7252048e-d297-49bc-a67e-e581e12fe2c5.json",
	);
	if (existsSync(chat)) {
		const d = JSON.parse(readFileSync(chat, "utf8")) as {
			sessions?: Array<{ messages?: Array<{ role?: string; content?: string }> }>;
		};
		for (const s of d.sessions ?? []) {
			for (const m of [...(s.messages ?? [])].reverse()) {
				if (m.role === "assistant" && m.content) return m.content;
			}
		}
	}
	return "";
}

function verdictMap(scores: Array<{ eventId: string; verdict: string }>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const s of scores) out[s.eventId] = s.verdict;
	return out;
}

const apiKey = loadGeminiApiKey();
const canRun = Boolean(apiKey) && existsSync(CASE2_LOCKED_MEDIA);

describe.runIf(canRun)("Case 2 GEMINI_NATIVE_VIDEO experiment", () => {
	it("runs native video perception and compares to CURRENT_OPENSCREEN", async () => {
		mkdirSync(OUT, { recursive: true });
		const currentText = loadInAppCurrentOpenscreenText();
		expect(currentText.length).toBeGreaterThan(40);
		const current = scoreCurrentOpenscreenCase2Text(currentText);

		const gemini = await runGeminiNativeVideoCase({ apiKey });
		expect(gemini.provider).toBe(GEMINI_NATIVE_VIDEO_PROVIDER);
		expect(gemini.evidence.finalUserText?.length ?? 0).toBeGreaterThan(40);
		expect(gemini.evidence.attachedFrameCount).toBe(0);

		const cur = verdictMap(current.eventScores);
		const gem = verdictMap(gemini.eventScores);
		const restart = gem.restart_tooltip ?? "MISSED";

		const comparison = {
			recording: CASE2_LOCKED_MEDIA,
			currentProvider: "CURRENT_OPENSCREEN",
			geminiProvider: GEMINI_NATIVE_VIDEO_PROVIDER,
			geminiModel: gemini.latency.model,
			events: {
				file_menu_open: {
					CURRENT_OPENSCREEN: cur.file_menu_open,
					GEMINI_NATIVE_VIDEO: gem.file_menu_open,
				},
				menu_highlight: {
					CURRENT_OPENSCREEN: cur.menu_highlight,
					GEMINI_NATIVE_VIDEO: gem.menu_highlight,
				},
				menu_closure: {
					CURRENT_OPENSCREEN: cur.menu_closure,
					GEMINI_NATIVE_VIDEO: gem.menu_closure,
				},
				app_transition: {
					CURRENT_OPENSCREEN: cur.app_transition,
					GEMINI_NATIVE_VIDEO: gem.app_transition,
				},
				restart_tooltip: {
					CURRENT_OPENSCREEN: cur.restart_tooltip,
					GEMINI_NATIVE_VIDEO: gem.restart_tooltip,
				},
			},
			recall: {
				CURRENT_OPENSCREEN: current.importantEventRecall,
				GEMINI_NATIVE_VIDEO: gemini.importantEventRecall,
			},
			hallucinations: {
				CURRENT_OPENSCREEN: current.hallucinations,
				GEMINI_NATIVE_VIDEO: gemini.hallucinations,
			},
			latency: {
				CURRENT_OPENSCREEN: current.latency,
				GEMINI_NATIVE_VIDEO: gemini.latency,
				geminiProviderRaw: gemini.providerRaw,
			},
			restartTooltipClassification: restart,
		};

		writeFileSync(path.join(OUT, "comparison.json"), JSON.stringify(comparison, null, 2));
		writeFileSync(
			path.join(OUT, "CURRENT_OPENSCREEN_scored.json"),
			JSON.stringify(current, null, 2),
		);
		writeFileSync(path.join(OUT, "COMPARISON.md"), renderComparisonMd(comparison, gemini));

		process.stderr.write(
			"CASE2_PROVIDER_COMPARISON " +
				JSON.stringify({
					restart,
					geminiRecall: gemini.importantEventRecall.recall,
					currentRecall: current.importantEventRecall.recall,
					model: gemini.latency.model,
					totalMs: gemini.latency.totalTurnMs,
				}) +
				"\n",
		);
	}, 600_000);
});

describe("Case 2 GEMINI_NATIVE_VIDEO experiment (key gate)", () => {
	it("documents skip when Gemini key absent", () => {
		if (!canRun) {
			expect(apiKey).toBe("");
			expect(existsSync(CASE2_LOCKED_MEDIA)).toBe(true);
		} else {
			expect(apiKey.length).toBeGreaterThan(0);
		}
	});
});

function renderComparisonMd(
	comparison: Record<string, unknown>,
	gemini: { evidence: { finalUserText?: string }; latency: { totalTurnMs: number } },
): string {
	const ev = comparison.events as Record<
		string,
		{ CURRENT_OPENSCREEN: string; GEMINI_NATIVE_VIDEO: string }
	>;
	const lines = [
		"# Case 2 provider comparison",
		"",
		"| Dimension | CURRENT_OPENSCREEN | GEMINI_NATIVE_VIDEO |",
		"| --- | --- | --- |",
		`| File menu | ${ev.file_menu_open.CURRENT_OPENSCREEN} | ${ev.file_menu_open.GEMINI_NATIVE_VIDEO} |`,
		`| Menu highlight | ${ev.menu_highlight.CURRENT_OPENSCREEN} | ${ev.menu_highlight.GEMINI_NATIVE_VIDEO} |`,
		`| Menu closure | ${ev.menu_closure.CURRENT_OPENSCREEN} | ${ev.menu_closure.GEMINI_NATIVE_VIDEO} |`,
		`| App transition | ${ev.app_transition.CURRENT_OPENSCREEN} | ${ev.app_transition.GEMINI_NATIVE_VIDEO} |`,
		`| Restart tooltip | ${ev.restart_tooltip.CURRENT_OPENSCREEN} | ${ev.restart_tooltip.GEMINI_NATIVE_VIDEO} |`,
		"",
		`Restart classification (Gemini): **${comparison.restartTooltipClassification}**`,
		"",
		`Gemini totalTurnMs: ${gemini.latency.totalTurnMs}`,
		"",
		"## Gemini user-facing (truncated)",
		"",
		(gemini.evidence.finalUserText ?? "").slice(0, 2500),
		"",
	];
	return lines.join("\n");
}

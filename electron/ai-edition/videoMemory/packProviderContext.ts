/**
 * Bounded provider-facing context from Video Memory + local editorial state.
 * Distinguishes KNOWN / SPOKEN / SUPPORTED / CONTRADICTED / UNKNOWN / PRESERVE / REQUESTED.
 * Does not dump full Ledger or Claim Promotion objects.
 */

import type { EditGapV1 } from "../editGap/types";
import type { EditPlanV1 } from "../editPlan/types";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TargetStoryV1 } from "../targetStory/v1/types";
import type { VideoMemoryQueryClass, VideoMemoryRetrieval, VideoMemoryV1 } from "./index";
import type { AttachedFrameMeta } from "./productionPath";

export type PackedProviderContext = {
	text: string;
	chars: number;
	queryClass: VideoMemoryQueryClass;
	includedSections: string[];
};

export function packProviderContextFromMemory(input: {
	userMessage: string;
	memory: VideoMemoryV1;
	retrieval: VideoMemoryRetrieval;
	sourceStoryV2?: SourceStoryV2 | null;
	targetStoryV1?: TargetStoryV1 | null;
	editGapV1?: EditGapV1 | null;
	editPlanV1?: EditPlanV1 | null;
	investigatorBriefing?: string | null;
	frameMeta?: AttachedFrameMeta[];
	coverageBriefing?: string | null;
	/** Soft cap on packed text chars (not including images). */
	maxChars?: number;
}): PackedProviderContext {
	const maxChars = input.maxChars ?? 12_000;
	const included: string[] = [];
	const lines: string[] = [
		"VIDEO_MEMORY_PROVIDER_CONTEXT (canonical evidence index — not a second ledger)",
		`queryClass=${input.retrieval.queryClass}`,
		`queryScope=${input.retrieval.queryScope}`,
		`sourceFingerprint=${input.memory.sourceFingerprint.slice(0, 12)}…`,
		`programmeFingerprint=${input.memory.programmeFingerprint.slice(0, 12)}…`,
		`durationSec=${input.memory.sourceDurationSec}`,
		`coverage speech=${input.memory.analysisCoverage.speech} visual=${input.memory.analysisCoverage.visual} investigator=${input.memory.analysisCoverage.investigator}`,
		"",
		"Epistemic legend: KNOWN=observed evidence; SPOKEN=speech only; SUPPORTED=multi-modal support;",
		"CONTRADICTED=conflicting channels; UNKNOWN=unresolved; PRESERVE=must keep; REQUESTED=user ask.",
		"",
		`REQUESTED: ${input.userMessage.slice(0, 500)}`,
		"",
	];
	included.push("header", "requested");

	if (input.retrieval.includeSourceStorySummary || input.retrieval.queryClass === "editorial") {
		const summary =
			input.memory.sourceStorySummary || input.sourceStoryV2?.mediaSummary?.slice(0, 400) || "";
		if (summary) {
			lines.push("KNOWN chronology (compact Source Story):");
			lines.push(summary.slice(0, 500));
			included.push("sourceStorySummary");
		}
		const beats = input.sourceStoryV2?.beats?.slice(0, 8) ?? [];
		if (beats.length) {
			lines.push("KNOWN beats:");
			for (const b of beats) {
				const range = `${b.startSourceTimeSec.toFixed(1)}-${b.endSourceTimeSec.toFixed(1)}s`;
				lines.push(`  - ${range}: ${(b.summary || b.purposeHint || "").slice(0, 140)}`);
			}
			included.push("sourceStoryBeats");
		}
		lines.push("");
	}

	const speech = input.memory.speechWindows.slice(0, input.retrieval.maxSpeechWindows);
	if (speech.length) {
		lines.push("SPOKEN windows:");
		for (const w of speech) {
			lines.push(`  ${w.startSec.toFixed(1)}–${w.endSec.toFixed(1)}s: ${w.preview}`);
		}
		lines.push("");
		included.push("speechWindows");
	}

	if (input.retrieval.includeCorrections && input.memory.correctionHints.length) {
		lines.push("SPOKEN corrections (supersession — final intended meaning wins):");
		for (const c of input.memory.correctionHints.slice(0, 6)) lines.push(`  - ${c}`);
		lines.push("");
		included.push("corrections");
	}

	if (input.retrieval.includeContradictions && input.memory.contradictionHints.length) {
		lines.push("CONTRADICTED / unresolved cross-modal:");
		for (const c of input.memory.contradictionHints.slice(0, 6)) lines.push(`  - ${c}`);
		lines.push("");
		included.push("contradictions");
	}

	if (input.retrieval.includeTemporaryUi && input.memory.temporaryUiHints.length) {
		lines.push("KNOWN temporary UI (visibility ≠ user action unless verified):");
		for (const c of input.memory.temporaryUiHints.slice(0, 6)) lines.push(`  - ${c}`);
		lines.push("UNKNOWN: whether the user activated those controls.");
		lines.push("");
		included.push("temporaryUi");
	}

	if (input.retrieval.includePassiveChrome && input.memory.passiveChromeHints.length) {
		lines.push("KNOWN passive chrome (context only — NOT workflow):");
		for (const c of input.memory.passiveChromeHints.slice(0, 6)) lines.push(`  - ${c}`);
		lines.push(
			"Do NOT claim the user opened/worked in background apps/tabs without verified action evidence.",
		);
		lines.push("");
		included.push("passiveChrome");
	}

	if (input.memory.uncertainties.length) {
		lines.push("UNKNOWN:");
		for (const u of input.memory.uncertainties.slice(0, 6)) lines.push(`  - ${u}`);
		lines.push("");
		included.push("uncertainties");
	}

	if (input.targetStoryV1) {
		lines.push("PRESERVE / desired viewer goal (Target Story compact):");
		lines.push(`  viewerGoal: ${input.targetStoryV1.viewerGoal.slice(0, 220)}`);
		lines.push(`  objectiveKind: ${input.targetStoryV1.objectiveKind}`);
		const preserve = input.targetStoryV1.targetBeats
			.filter((b) => b.disposition === "preserve")
			.slice(0, 6);
		for (const b of preserve) {
			lines.push(`  PRESERVE beat ${b.id} ← ${b.sourceBeatIds.join(",")}`);
		}
		lines.push("");
		included.push("targetCompact");
	}

	if (input.editPlanV1?.items?.length) {
		lines.push("SUPPORTED editorial plan items (do not invent tool recipes beyond these):");
		for (const item of input.editPlanV1.items.slice(0, 6)) {
			const strat = item.preferredStrategy ?? item.candidateStrategies?.[0]?.family ?? "none";
			lines.push(`  - ${item.id}: ${strat} — ${(item.editorialIntent || "").slice(0, 120)}`);
		}
		lines.push("");
		included.push("editPlanCompact");
	} else if (input.editGapV1) {
		lines.push("KNOWN edit gaps (compact): gapCount present — prefer honesty over invented zooms.");
		lines.push("");
		included.push("editGapNote");
	}

	if (input.investigatorBriefing) {
		lines.push("SUPPORTED investigator notes (bounded):");
		lines.push(input.investigatorBriefing.slice(0, 1800));
		lines.push("");
		included.push("investigator");
	}

	if (input.coverageBriefing) {
		lines.push(input.coverageBriefing);
		lines.push("");
		included.push("visualCoverage");
	}

	if (input.frameMeta?.length) {
		lines.push("ATTACHED frames (reasons):");
		for (const m of input.frameMeta) {
			lines.push(`  t=${m.sourceTimeSec.toFixed(2)}s ${m.reason}: ${m.note}`);
		}
		lines.push("");
		included.push("frameReasons");
	}

	lines.push(
		"Instructions: Reason only from sections above + any attached frames. Prefer UNKNOWN over invented UI actions. Restart UI ≠ restarted. Passive speech ≠ Settings opened. Passive chrome ≠ workflow.",
	);

	let text = lines.join("\n");
	if (text.length > maxChars) {
		text = `${text.slice(0, maxChars)}\n…[packed context truncated]`;
	}
	return {
		text,
		chars: text.length,
		queryClass: input.retrieval.queryClass,
		includedSections: included,
	};
}

/** Merge packed context into a user message (string or multimodal parts). */
export function appendPackedContextToUserMessage(
	userMessage: { role: "user"; content: unknown },
	packedText: string,
): { role: "user"; content: unknown } {
	const block = `\n${packedText}\n`;
	const content = userMessage.content;
	if (typeof content === "string") {
		return { role: "user", content: `${block}\nUSER REQUEST\n${content}` };
	}
	if (Array.isArray(content)) {
		const parts = [...content];
		const idx = parts.findIndex(
			(p) =>
				p &&
				typeof p === "object" &&
				(p as { type?: string }).type === "text" &&
				typeof (p as { text?: string }).text === "string" &&
				((p as { text: string }).text.includes("USER REQUEST") ||
					(p as { text: string }).text.startsWith("USER REQUEST")),
		);
		const insert = { type: "text" as const, text: block };
		if (idx >= 0) {
			parts.splice(idx, 0, insert);
			return { role: "user", content: parts };
		}
		return {
			role: "user",
			content: [...parts, insert, { type: "text", text: "USER REQUEST\n(see prior)" }],
		};
	}
	return userMessage;
}

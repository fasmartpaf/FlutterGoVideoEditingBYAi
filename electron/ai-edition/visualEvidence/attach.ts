import { promises as fs } from "node:fs";
import { buildVisualSemanticGroundingPromptSection } from "./semantic";
import type { VisualChange, VisualEvidenceFrame } from "./types";

export type MultimodalContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } };

function formatClock(sec: number): string {
	const s = Math.max(0, sec);
	const m = Math.floor(s / 60);
	const rem = s - m * 60;
	const whole = Math.floor(rem);
	const frac = Math.round((rem - whole) * 100);
	return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

function reasonLabel(reason: VisualEvidenceFrame["reason"]): string {
	switch (reason) {
		case "cursor_interaction_pre":
			return "cursor interaction −0.30s (before)";
		case "cursor_interaction":
			return "cursor interaction";
		case "cursor_interaction_post":
			return "cursor interaction +0.50s (after)";
		case "clip_boundary":
			return "clip boundary";
		case "change_refinement":
			return "change midpoint refinement";
		default:
			return "periodic sample";
	}
}

function classificationLabel(c: VisualChange["classification"]): string {
	return c.toUpperCase();
}

/**
 * Build OpenAI-compatible multimodal user content (also accepted by ChatAnthropic).
 * Reads JPEG files into data URLs — never logs the base64.
 * When `changes` is provided, inserts measured transition markers between frames.
 */
export async function buildVisualEvidenceUserContent(
	userMessage: string,
	frames: VisualEvidenceFrame[],
	options?: {
		changes?: VisualChange[];
		interactionCorrelations?: Array<{
			interactionSourceSec: number;
			fromSourceTimeSec: number;
			toSourceTimeSec: number;
			score: number;
		}>;
		/** When false, skip semantic grounding scaffold (tests). Default true. */
		includeSemanticGrounding?: boolean;
		/** Optional out-params for timings (same turn; not a second model call). */
		semanticTimingOut?: { preparationMs: number; promptChars: number };
	},
): Promise<MultimodalContentPart[]> {
	const parts: MultimodalContentPart[] = [
		{
			type: "text",
			text: [
				"VISUAL EVIDENCE — sampled JPEG frames from the open recording (NOT every video frame).",
				"Frames are chronological samples. Transition markers (when present) are deterministic pixel-difference scores between adjacent samples — not semantic scene labels.",
				"SIGNIFICANT means pixels changed a lot between those two timestamps; it does NOT by itself prove an important user action.",
				"Compare before/after frames to describe visible state change. Do not invent what happened between samples. Do not claim exact event timing beyond provided/refined timestamps.",
				"Cursor coordinates remain telemetry; named UI labels still require semanticUi (false).",
				"When visualSemanticEvidence is true: emit turn-local VISUAL_SEMANTIC_GROUNDING JSON from these frames (observed vs inferred, confidence, coarse regions). That does not set semanticUi.",
				"",
			].join("\n"),
		},
	];

	const changes = options?.changes ?? [];

	for (let i = 0; i < frames.length; i++) {
		const f = frames[i]!;
		const timeline =
			f.virtualTimeSec == null ? "n/a (outside kept timeline)" : formatClock(f.virtualTimeSec);
		parts.push({
			type: "text",
			text: [
				`Frame ${i + 1}/${frames.length}`,
				`source ${formatClock(f.sourceTimeSec)}`,
				`timeline ${timeline}`,
				`reason: ${reasonLabel(f.reason)}`,
				`size ${f.width}×${f.height}`,
			].join(" | "),
		});
		const bytes = await fs.readFile(f.imagePath);
		const b64 = bytes.toString("base64");
		parts.push({
			type: "image_url",
			image_url: { url: `data:${f.mimeType};base64,${b64}` },
		});

		const next = frames[i + 1];
		if (!next) continue;
		const transition =
			changes.find(
				(c) =>
					Math.abs(c.fromSourceTimeSec - f.sourceTimeSec) < 0.001 &&
					Math.abs(c.toSourceTimeSec - next.sourceTimeSec) < 0.001,
			) ?? null;
		if (!transition) continue;
		const fromVirt =
			transition.fromVirtualTimeSec == null
				? formatClock(transition.fromSourceTimeSec)
				: formatClock(transition.fromVirtualTimeSec);
		const toVirt =
			transition.toVirtualTimeSec == null
				? formatClock(transition.toSourceTimeSec)
				: formatClock(transition.toVirtualTimeSec);
		parts.push({
			type: "text",
			text: [
				`Transition ${formatClock(transition.fromSourceTimeSec)} → ${formatClock(transition.toSourceTimeSec)}`,
				`(timeline ${fromVirt} → ${toVirt})`,
				`visual change: ${classificationLabel(transition.classification)}`,
				`score: ${transition.score.toFixed(2)}`,
				transition.interactionSequence ? "local interaction sequence pair" : null,
				transition.classification === "significant"
					? "Compare these two frames and state what visibly differs (panel/region/overlay), or say the difference looks local/subtle if content is mostly unchanged."
					: null,
			]
				.filter(Boolean)
				.join(" | "),
		});
	}

	if (options?.interactionCorrelations && options.interactionCorrelations.length > 0) {
		parts.push({
			type: "text",
			text: [
				"",
				"INTERACTION ↔ VISUAL CHANGE CORRELATION (timing proximity only — not button identity):",
				...options.interactionCorrelations.map(
					(row) =>
						`cursor interaction: ${formatClock(row.interactionSourceSec)} · significant visual transition: ${formatClock(row.fromSourceTimeSec)}–${formatClock(row.toSourceTimeSec)} (score ${row.score.toFixed(2)})`,
				),
				"You may note that a visual state change occurs around a recorded interaction. Do NOT name UI controls (semanticUi is false).",
			].join("\n"),
		});
	}

	if (options?.includeSemanticGrounding !== false) {
		const t0 = Date.now();
		const semanticText = buildVisualSemanticGroundingPromptSection({ frames, changes });
		if (options?.semanticTimingOut) {
			options.semanticTimingOut.preparationMs = Date.now() - t0;
			options.semanticTimingOut.promptChars = semanticText.length;
		}
		parts.push({
			type: "text",
			text: semanticText,
		});
	}

	parts.push({
		type: "text",
		text: `\nUSER REQUEST\n${userMessage}`,
	});
	return parts;
}

/** Agent message shape used by createAgent / streamEvents. */
export function toAgentUserMessage(content: string | MultimodalContentPart[]): {
	role: "user";
	content: string | MultimodalContentPart[];
} {
	return { role: "user", content };
}

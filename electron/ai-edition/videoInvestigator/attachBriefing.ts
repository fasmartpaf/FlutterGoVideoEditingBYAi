/**
 * Merge investigator briefing + optional extra stills into the agent user message.
 * Internal only — stripInternalEvidenceJsonBlocks / grounded diagnosis still apply later.
 */

import { promises as fs } from "node:fs";
import type { MultimodalContentPart } from "../visualEvidence/attach";
import type { InvestigationEvidenceSet } from "./types";

function isParts(content: unknown): content is MultimodalContentPart[] {
	return Array.isArray(content);
}

export async function appendInvestigatorToUserMessage(
	userMessage: { role: "user"; content: unknown },
	investigation: InvestigationEvidenceSet | null | undefined,
): Promise<{ role: "user"; content: unknown }> {
	if (!investigation?.internalBriefing) return userMessage;

	const briefingPart: MultimodalContentPart = {
		type: "text",
		text: `\n${investigation.internalBriefing}\n`,
	};

	const imageParts: MultimodalContentPart[] = [];
	for (const f of investigation.additionalFrames.slice(0, 6)) {
		try {
			const bytes = await fs.readFile(f.imagePath);
			imageParts.push({
				type: "text",
				text: `Investigator still @ ${f.sourceTimeSec.toFixed(2)}s — ${f.note}`,
			});
			imageParts.push({
				type: "image_url",
				image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` },
			});
		} catch {
			/* skip missing */
		}
	}

	const content = userMessage.content;
	if (typeof content === "string") {
		return {
			role: "user",
			content: [briefingPart, ...imageParts, { type: "text", text: content }],
		};
	}
	if (isParts(content)) {
		// Insert briefing before USER REQUEST if present; else append.
		const idx = content.findIndex(
			(p) => p.type === "text" && typeof p.text === "string" && p.text.includes("USER REQUEST"),
		);
		if (idx >= 0) {
			const next = [...content];
			next.splice(idx, 0, briefingPart, ...imageParts);
			return { role: "user", content: next };
		}
		return { role: "user", content: [...content, briefingPart, ...imageParts] };
	}
	return userMessage;
}

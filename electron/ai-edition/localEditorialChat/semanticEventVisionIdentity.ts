/**
 * Provider-vision visual presence — does this single frame show the requested UI?
 *
 * Presence only. First-appearance / onset bounding is done by sampling programme
 * frames in semanticEventIdentity (trims/speed via programme↔source map).
 * A single BEFORE/AFTER pair must never self-certify first appearance.
 */

import { promises as fs } from "node:fs";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
	createOpenScreenChatModel,
	messageContentToText,
	type OpenScreenChatModelConfig,
} from "../deep-agent/chat-model";
import { normalizeProviderId } from "../provider-registry";
import { providerSupportsAttachedVisualFrames } from "../visualEvidence/providers";

export type VisualPresenceVerdict = {
	present: boolean;
	confidence: "HIGH" | "MEDIUM" | "LOW";
	reason: string;
	rawText: string;
	providerId: string;
	model: string;
};

/** Presence at one frame (programme-mapped source still). */
export type VisualPresenceJudge = (args: {
	cue: string;
	imagePath: string;
	sourceSec: number;
	programmeSec: number;
}) => Promise<VisualPresenceVerdict | null>;

/**
 * @deprecated Pair-wise first-appearance judge. Prefer VisualPresenceJudge +
 * programme-frame onset bounding. Kept for test seams that adapt to presence.
 */
export type VisionIdentityVerdict = {
	identified: boolean;
	confidence: "HIGH" | "MEDIUM" | "LOW";
	firstAppearance: boolean;
	visualUiPresentAfter: boolean;
	visualUiPresentBefore: boolean;
	visualUiPresentEarlier?: boolean;
	reason: string;
	rawText: string;
	providerId: string;
	model: string;
};

/** @deprecated See VisualPresenceJudge. */
export type VisionIdentityJudge = (args: {
	cue: string;
	beforeImagePath: string;
	afterImagePath: string;
	beforeSourceSec: number;
	afterSourceSec: number;
	earlierImagePath?: string | null;
	earlierSourceSec?: number | null;
}) => Promise<VisionIdentityVerdict | null>;

function stripJson(text: string): string {
	const t = text.trim();
	const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) return fenced[1]!.trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start >= 0 && end > start) return t.slice(start, end + 1);
	return t;
}

async function imageDataUrl(imagePath: string): Promise<string> {
	const bytes = await fs.readFile(imagePath);
	return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

/**
 * Ask the selected OpenScreen Chat provider whether the requested visual UI
 * is present as a primary object in this single frame.
 */
export async function judgeVisualUiPresenceWithProviderVision(args: {
	cue: string;
	imagePath: string;
	sourceSec: number;
	programmeSec: number;
	chatModelConfig: OpenScreenChatModelConfig;
}): Promise<VisualPresenceVerdict | null> {
	const providerId =
		normalizeProviderId(args.chatModelConfig.provider) ?? args.chatModelConfig.provider;
	if (!providerSupportsAttachedVisualFrames(providerId)) {
		return null;
	}

	const url = await imageDataUrl(args.imagePath);
	const model = await createOpenScreenChatModel(args.chatModelConfig);

	const system = [
		"You verify whether a requested on-screen UI is present in ONE frame.",
		"Return JSON only.",
		"present=true ONLY when the frame shows the described UI as a primary visual object",
		"(the website/app/screen itself), not merely the cue words inside chat, IDE, docs, or messaging.",
		"If the frame is chat/IDE/messaging that only mentions the cue, present=false.",
		"Do NOT decide first appearance, onset, or timing — presence only.",
		"If uncertain, present=false with confidence LOW.",
		'Schema: {"present":boolean,"confidence":"HIGH"|"MEDIUM"|"LOW","reason":string}',
	].join("\n");

	const response = await model.invoke([
		new SystemMessage(system),
		new HumanMessage({
			content: [
				{
					type: "text",
					text: [
						`Requested event cue: ${args.cue}`,
						`Frame programme time ≈ ${args.programmeSec.toFixed(2)}s`,
						`Frame source time ≈ ${args.sourceSec.toFixed(2)}s`,
						"Is the requested visual UI present as a primary object in this frame?",
					].join("\n"),
				},
				{ type: "image_url", image_url: { url } },
			],
		}),
	]);
	const rawText = messageContentToText(response.content);
	let parsed: Record<string, unknown> = {};
	try {
		parsed = JSON.parse(stripJson(rawText)) as Record<string, unknown>;
	} catch {
		return {
			present: false,
			confidence: "LOW",
			reason: "Presence response was not valid JSON — treating as absent.",
			rawText: rawText.slice(0, 400),
			providerId,
			model: args.chatModelConfig.model,
		};
	}

	const present = parsed.present === true;
	const confidence =
		parsed.confidence === "HIGH" || parsed.confidence === "MEDIUM" || parsed.confidence === "LOW"
			? parsed.confidence
			: "LOW";
	const reason =
		typeof parsed.reason === "string" && parsed.reason.trim()
			? parsed.reason.trim().slice(0, 400)
			: "No reason provided";

	const accepted = present && (confidence === "HIGH" || confidence === "MEDIUM");

	return {
		present: accepted,
		confidence,
		reason: accepted
			? reason
			: present
				? `Presence suggested but confidence too low (${reason})`
				: reason,
		rawText: rawText.slice(0, 400),
		providerId,
		model: args.chatModelConfig.model,
	};
}

/**
 * @deprecated Pair-wise path retained only as a thin wrapper for older call sites.
 * Does NOT certify first appearance — maps to presence on AFTER only.
 */
export async function judgeEventIdentityWithProviderVision(args: {
	cue: string;
	beforeImagePath: string;
	afterImagePath: string;
	beforeSourceSec: number;
	afterSourceSec: number;
	earlierImagePath?: string | null;
	earlierSourceSec?: number | null;
	chatModelConfig: OpenScreenChatModelConfig;
}): Promise<VisionIdentityVerdict | null> {
	const after = await judgeVisualUiPresenceWithProviderVision({
		cue: args.cue,
		imagePath: args.afterImagePath,
		sourceSec: args.afterSourceSec,
		programmeSec: args.afterSourceSec,
		chatModelConfig: args.chatModelConfig,
	});
	if (!after) return null;
	return {
		identified: false,
		confidence: after.confidence,
		firstAppearance: false,
		visualUiPresentAfter: after.present,
		visualUiPresentBefore: false,
		visualUiPresentEarlier: false,
		reason: `Pair judge no longer certifies onset; AFTER presence=${after.present} (${after.reason})`,
		rawText: after.rawText,
		providerId: after.providerId,
		model: after.model,
	};
}

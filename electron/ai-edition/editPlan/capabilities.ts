/**
 * OpenScreen EditCapabilityRegistry — populated from agent-tools.ts reality.
 * Do not invent unsupported families (transitions, denoise, stabilize, upscale, TTS).
 */

import type { EditCapabilityRegistry } from "./types";

/**
 * Default registry matching CURRENT OpenScreen agent tools:
 * trim/zoom/crop/speed/annotation/graphic/captions/aspect/background/audioOverlay = true
 * transitions/denoise/stabilize/upscale/tts = false
 */
export function defaultEditCapabilityRegistry(): EditCapabilityRegistry {
	return {
		trim: true,
		zoom: true,
		crop: true,
		annotation: true,
		graphic: true,
		captions: true,
		speed: true,
		audioOverlay: true,
		background: true,
		aspectRatio: true,
		transitions: false,
		denoise: false,
		stabilize: false,
		upscale: false,
		tts: false,
	};
}

export function mergeCapabilities(
	override?: Partial<EditCapabilityRegistry>,
): EditCapabilityRegistry {
	return { ...defaultEditCapabilityRegistry(), ...override };
}

export function familyCapabilityKey(family: string): keyof EditCapabilityRegistry | null {
	switch (family) {
		case "trim":
			return "trim";
		case "zoom":
			return "zoom";
		case "crop":
			return "crop";
		case "speed":
			return "speed";
		case "caption":
			return "captions";
		case "annotation":
			return "annotation";
		case "graphic":
			return "graphic";
		case "audio":
			return "audioOverlay";
		case "background":
			return "background";
		case "aspect_ratio":
			return "aspectRatio";
		default:
			return null;
	}
}

export function isFamilySupported(caps: EditCapabilityRegistry, family: string): boolean {
	if (
		family === "preserve" ||
		family === "no_safe_edit" ||
		family === "avoid_implication" ||
		family === "needs_more_evidence"
	) {
		return true;
	}
	const key = familyCapabilityKey(family);
	if (!key) return false;
	return caps[key] === true;
}

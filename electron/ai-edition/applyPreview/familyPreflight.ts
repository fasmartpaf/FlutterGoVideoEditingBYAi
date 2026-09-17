/**
 * Family-specific preflight checks for Verified Apply Expansion V1.
 * Trim keeps existing landing checks; zoom/crop/speed validate operation args.
 */

import {
	effectiveZoomScale,
	MAX_ZOOM_SCALE,
	MIN_ZOOM_SCALE,
	type ZoomDepth,
} from "../../../src/lib/ai-edition/timeline/zoom-scale";
import type { EditProposalItem } from "../editProposal/types";
import type { EligibilityBlockReason } from "./types";

export const VERIFIED_APPLY_TOOLS = new Set([
	"addTrim",
	"addZoom",
	"setZoom",
	"setClipCrop",
	"addSpeed",
	"setSpeed",
	"enableCaptions",
	"addGraphic",
	"setClipIncomingTransition",
]);

const MIN_SPEED = 0.1;
const MAX_SPEED = 100;

function isZoomDepth(n: unknown): n is ZoomDepth {
	return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6;
}

export function validateFamilyOperationArgs(proposal: EditProposalItem): EligibilityBlockReason[] {
	const tool = proposal.proposedCall?.toolName;
	const args = proposal.proposedCall?.provisionalArgs ?? {};
	const reasons: EligibilityBlockReason[] = [];
	if (!tool || !VERIFIED_APPLY_TOOLS.has(tool)) return reasons;

	if (tool === "addZoom" || tool === "setZoom") {
		const depth = args.depth;
		const focus = args.focus as { cx?: unknown; cy?: unknown } | undefined;
		if (!isZoomDepth(depth)) reasons.push("invalid_operation_args");
		if (
			!focus ||
			typeof focus.cx !== "number" ||
			typeof focus.cy !== "number" ||
			focus.cx < 0 ||
			focus.cx > 1 ||
			focus.cy < 0 ||
			focus.cy > 1
		) {
			reasons.push("invalid_operation_args");
		} else if (isZoomDepth(depth)) {
			const scale = effectiveZoomScale({
				depth,
				customScale: typeof args.customScale === "number" ? args.customScale : undefined,
			});
			if (scale < MIN_ZOOM_SCALE - 1e-9 || scale > MAX_ZOOM_SCALE + 1e-9) {
				reasons.push("invalid_operation_args");
			}
		}
		if (!proposal.landing) reasons.push("missing_landing");
	}

	if (tool === "setClipCrop") {
		const crop = args.crop as
			| { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
			| null
			| undefined;
		const clipId = args.clipId;
		if (typeof clipId !== "string" || !clipId) reasons.push("missing_clip");
		if (
			!crop ||
			typeof crop.x !== "number" ||
			typeof crop.y !== "number" ||
			typeof crop.width !== "number" ||
			typeof crop.height !== "number" ||
			crop.width <= 0 ||
			crop.height <= 0 ||
			crop.x < 0 ||
			crop.y < 0 ||
			crop.x + crop.width > 1 + 1e-9 ||
			crop.y + crop.height > 1 + 1e-9
		) {
			reasons.push("invalid_operation_args");
		}
		// Crop can use landing as affected range hint; still required by eligible shape.
	}

	if (tool === "addSpeed" || tool === "setSpeed") {
		const speed = args.speed;
		if (typeof speed !== "number" || !(speed >= MIN_SPEED && speed <= MAX_SPEED)) {
			reasons.push("invalid_operation_args");
		}
		if (!proposal.landing) reasons.push("missing_landing");
	}

	if (tool === "enableCaptions") {
		const cueCount = args.cueCount;
		const layoutStatus = args.layoutStatus;
		const transcriptFp = args.transcriptFingerprint;
		const programmeFp = args.programmeFingerprint;
		const styleFp = args.styleFingerprint;
		if (typeof cueCount !== "number" || cueCount < 1) reasons.push("invalid_operation_args");
		if (layoutStatus !== "ok") reasons.push("invalid_operation_args");
		if (typeof transcriptFp !== "string" || !transcriptFp) reasons.push("invalid_operation_args");
		if (typeof programmeFp !== "string" || !programmeFp) reasons.push("invalid_operation_args");
		if (typeof styleFp !== "string" || !styleFp) reasons.push("invalid_operation_args");
		if (args.preserveManualCaptions !== true) reasons.push("invalid_operation_args");
		if (!proposal.landing) reasons.push("missing_landing");
	}

	if (tool === "addGraphic") {
		const kind = args.kind;
		const startSec = args.startSec;
		const endSec = args.endSec;
		const allowedKinds = new Set(["title", "cta", "lowerThird", "badge", "bar", "figure", "image"]);
		if (typeof kind !== "string" || !allowedKinds.has(kind)) {
			reasons.push("invalid_operation_args");
		}
		if (typeof startSec !== "number" || typeof endSec !== "number" || !(endSec > startSec)) {
			reasons.push("invalid_operation_args");
		}
		if (kind === "title" || kind === "cta" || kind === "lowerThird" || kind === "badge") {
			if (typeof args.text !== "string" || args.text.trim().length < 2) {
				reasons.push("invalid_operation_args");
			}
		}
		if (kind === "figure" || kind === "bar") {
			if (
				typeof args.x !== "number" ||
				typeof args.y !== "number" ||
				args.x < 0 ||
				args.x > 100 ||
				args.y < 0 ||
				args.y > 100
			) {
				reasons.push("invalid_operation_args");
			}
		}
		if (!proposal.landing) reasons.push("missing_landing");
	}

	if (tool === "setClipIncomingTransition") {
		const clipId = args.clipId;
		const kind = args.kind;
		if (typeof clipId !== "string" || !clipId) reasons.push("missing_clip");
		if (kind !== "cut" && kind !== "dissolve") reasons.push("invalid_operation_args");
		if (kind === "dissolve") {
			const d = args.durationSec;
			if (d !== undefined && (typeof d !== "number" || d < 0 || d > 2)) {
				reasons.push("invalid_operation_args");
			}
		}
	}

	return [...new Set(reasons)];
}

/** Deterministic fingerprint of operation args for consent binding. */
export function operationArgsFingerprint(proposal: EditProposalItem): string {
	const tool = proposal.proposedCall?.toolName ?? "";
	const args = proposal.proposedCall?.provisionalArgs ?? {};
	const landing = proposal.landing
		? {
				s: proposal.landing.startSourceTimeSec,
				e: proposal.landing.endSourceTimeSec,
			}
		: null;
	const payload = JSON.stringify({ tool, args, landing });
	let h = 0;
	for (let i = 0; i < payload.length; i += 1) {
		h = (h * 31 + payload.charCodeAt(i)) >>> 0;
	}
	return `op_${tool}_${h.toString(16)}`;
}

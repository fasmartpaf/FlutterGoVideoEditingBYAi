/**
 * Post-edit structural + must-survive + damage-risk verification.
 * Tool success alone is never sufficient.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { EditProposalItem } from "../editProposal/types";
import { fingerprintDocument } from "./fingerprint";
import type { ApplyPreflight } from "./types";

export interface VerificationResult {
	structuralOk: boolean;
	preservationOk: boolean;
	qualityUnverified: boolean;
	passed: boolean;
	notes: string[];
	structuralMs: number;
	preservationMs: number;
	affectedClipIds: string[];
	affectedAssetIds: string[];
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
	return a0 < b1 && b0 < a1;
}

function trimFullyCovers(
	trimStart: number,
	trimEnd: number,
	segStart: number,
	segEnd: number,
): boolean {
	return trimStart <= segStart && trimEnd >= segEnd;
}

function documentStructurallyValid(doc: AxcutDocument, notes: string[]): boolean {
	let ok = true;
	for (const clip of doc.timeline.clips) {
		if (clip.timelineEndSec < clip.timelineStartSec) {
			ok = false;
			notes.push(`invalid_clip_timeline_bounds:${clip.id}`);
		}
		if (clip.sourceEndSec != null && clip.sourceEndSec < clip.sourceStartSec) {
			ok = false;
			notes.push(`invalid_clip_source_bounds:${clip.id}`);
		}
	}
	for (const t of doc.timeline.trimRanges) {
		if (!(t.endSec > t.startSec) || t.startSec < 0) {
			ok = false;
			notes.push(`invalid_trim:${t.id}`);
		}
	}
	try {
		JSON.stringify(doc);
	} catch {
		ok = false;
		notes.push("document_not_serializable");
	}
	return ok;
}

/**
 * Independent verification after mutation.
 * For addTrim: confirm a new trim exists matching landing, no clip deletion,
 * must-survive speech/text ranges not fully removed by the new trim.
 */
export function verifyAfterApply(args: {
	before: AxcutDocument;
	after: AxcutDocument;
	proposal: EditProposalItem;
	preflight: ApplyPreflight;
	forceFailure?: boolean;
}): VerificationResult {
	const notes: string[] = [];
	const tStruct0 = Date.now();
	const beforeFp = fingerprintDocument(args.before).value;
	const afterFp = fingerprintDocument(args.after).value;

	if (beforeFp === afterFp) {
		notes.push("no_document_change_detected");
	}

	const beforeClipIds = new Set(args.before.timeline.clips.map((c) => c.id));
	const afterClipIds = new Set(args.after.timeline.clips.map((c) => c.id));
	for (const id of beforeClipIds) {
		if (!afterClipIds.has(id)) {
			notes.push(`accidental_clip_deletion:${id}`);
		}
	}
	for (const id of afterClipIds) {
		if (!beforeClipIds.has(id)) {
			notes.push(`unexpected_clip_addition:${id}`);
		}
	}

	const beforeTrimIds = new Set(args.before.timeline.trimRanges.map((t) => t.id));
	const newTrims = args.after.timeline.trimRanges.filter((t) => !beforeTrimIds.has(t.id));
	const landing = args.preflight.landing;
	const toolName = args.proposal.proposedCall?.toolName;
	let mutationExists = false;

	if (toolName === "addTrim" && landing) {
		mutationExists = newTrims.some(
			(t) =>
				Math.abs(t.startSec - landing.startSourceTimeSec) < 1e-6 &&
				Math.abs(t.endSec - landing.endSourceTimeSec) < 1e-6 &&
				(!args.preflight.assetId || t.assetId === args.preflight.assetId),
		);
		if (!mutationExists) {
			notes.push("requested_trim_not_found");
		}
		if (newTrims.length > 1) {
			notes.push("multiple_new_trims");
		}
	} else if (toolName === "addZoom" || toolName === "setZoom") {
		const beforeZoomIds = new Set(args.before.zoomRanges.map((z) => z.id));
		const newZooms = args.after.zoomRanges.filter((z) => !beforeZoomIds.has(z.id));
		mutationExists = newZooms.length >= 1 || afterFp !== beforeFp;
		if (toolName === "addZoom" && newZooms.length < 1) notes.push("requested_zoom_not_found");
		if (newZooms.length > 1) notes.push("multiple_new_zooms");
	} else if (toolName === "setClipCrop") {
		const clipId = args.preflight.clipId;
		const beforeClip = clipId ? args.before.timeline.clips.find((c) => c.id === clipId) : null;
		const afterClip = clipId ? args.after.timeline.clips.find((c) => c.id === clipId) : null;
		const beforeCrop = JSON.stringify(beforeClip?.cropRegion ?? null);
		const afterCrop = JSON.stringify(afterClip?.cropRegion ?? null);
		mutationExists = beforeCrop !== afterCrop;
		if (!mutationExists) notes.push("requested_crop_not_found");
	} else if (toolName === "addSpeed" || toolName === "setSpeed") {
		const beforeSpeeds =
			((args.before.legacyEditor as Record<string, unknown> | null)?.speedRegions as
				| Array<{ id: string }>
				| undefined) ?? [];
		const afterSpeeds =
			((args.after.legacyEditor as Record<string, unknown> | null)?.speedRegions as
				| Array<{ id: string }>
				| undefined) ?? [];
		const beforeIds = new Set(beforeSpeeds.map((s) => s.id));
		const newSpeeds = afterSpeeds.filter((s) => !beforeIds.has(s.id));
		mutationExists = newSpeeds.length >= 1 || afterFp !== beforeFp;
		if (toolName === "addSpeed" && newSpeeds.length < 1) notes.push("requested_speed_not_found");
	} else if (toolName === "enableCaptions") {
		const beforeOn = Boolean(
			(
				(args.before.legacyEditor as Record<string, unknown> | null)?.captions as
					| { enabled?: boolean }
					| undefined
			)?.enabled,
		);
		const afterOn = Boolean(
			(
				(args.after.legacyEditor as Record<string, unknown> | null)?.captions as
					| { enabled?: boolean }
					| undefined
			)?.enabled,
		);
		mutationExists = !beforeOn && afterOn;
		if (!mutationExists) notes.push("requested_captions_enable_not_found");
		// Manual annotations must be byte-identical.
		const beforeAnn = JSON.stringify(args.before.annotations ?? []);
		const afterAnn = JSON.stringify(args.after.annotations ?? []);
		if (beforeAnn !== afterAnn) {
			notes.push("manual_annotations_mutated");
		}
	} else if (toolName === "addGraphic") {
		const beforeIds = new Set((args.before.annotations ?? []).map((a) => a.id));
		const newAnns = (args.after.annotations ?? []).filter((a) => !beforeIds.has(a.id));
		mutationExists = newAnns.length >= 1;
		if (!mutationExists) notes.push("requested_graphic_not_found");
		if (newAnns.length > 1) notes.push("multiple_new_graphics");
		// Existing annotations (including manual) must survive unchanged.
		for (const before of args.before.annotations ?? []) {
			const after = (args.after.annotations ?? []).find((a) => a.id === before.id);
			if (!after || JSON.stringify(after) !== JSON.stringify(before)) {
				notes.push(`existing_annotation_mutated:${before.id}`);
			}
		}
	} else if (toolName === "setClipIncomingTransition") {
		const clipId =
			(typeof args.proposal.proposedCall?.provisionalArgs?.clipId === "string"
				? args.proposal.proposedCall.provisionalArgs.clipId
				: args.preflight.clipId) ?? "";
		const beforeClip = args.before.timeline.clips.find((c) => c.id === clipId);
		const afterClip = args.after.timeline.clips.find((c) => c.id === clipId);
		const beforeT = JSON.stringify(
			(beforeClip as { incomingTransition?: unknown } | undefined)?.incomingTransition ?? null,
		);
		const afterT = JSON.stringify(
			(afterClip as { incomingTransition?: unknown } | undefined)?.incomingTransition ?? null,
		);
		mutationExists = beforeT !== afterT;
		if (!mutationExists) notes.push("requested_transition_not_found");
	} else if (afterFp !== beforeFp) {
		mutationExists = true;
	}

	const unrelatedClipTouched = args.after.timeline.clips.some((c) => {
		const before = args.before.timeline.clips.find((b) => b.id === c.id);
		if (!before) return false;
		if (
			before.sourceStartSec !== c.sourceStartSec ||
			before.sourceEndSec !== c.sourceEndSec ||
			before.timelineStartSec !== c.timelineStartSec ||
			before.timelineEndSec !== c.timelineEndSec
		) {
			if (args.preflight.clipId && c.id !== args.preflight.clipId) return true;
		}
		return false;
	});
	if (unrelatedClipTouched) notes.push("unrelated_clip_mutated");

	const structuralOk =
		documentStructurallyValid(args.after, notes) &&
		!notes.some(
			(n) =>
				n.startsWith("accidental_clip_deletion") ||
				n.startsWith("invalid_") ||
				n === "document_not_serializable" ||
				n === "unrelated_clip_mutated" ||
				n === "requested_trim_not_found" ||
				n === "requested_zoom_not_found" ||
				n === "requested_crop_not_found" ||
				n === "requested_speed_not_found" ||
				n === "requested_captions_enable_not_found" ||
				n === "requested_graphic_not_found" ||
				n === "requested_transition_not_found" ||
				n === "manual_annotations_mutated" ||
				n.startsWith("existing_annotation_mutated:") ||
				n === "no_document_change_detected",
		);
	const structuralMs = Date.now() - tStruct0;

	const tPres0 = Date.now();
	let preservationOk = true;
	if (landing && newTrims.length > 0) {
		const trim = newTrims[0];
		const transcript =
			args.after.transcripts.find((t) => t.assetId === trim.assetId) ??
			args.after.transcripts[0] ??
			null;
		for (const req of args.proposal.mustSurvive) {
			const textHint = req.text.toLowerCase();
			const speechSegs =
				transcript?.segments.filter(
					(s) =>
						s.kind === "speech" &&
						typeof s.text === "string" &&
						s.text.length > 0 &&
						(textHint.includes(s.text.toLowerCase().slice(0, 12)) ||
							s.text.toLowerCase().includes("effect") ||
							/corrected|meaning|explanation|preserve/i.test(req.text)),
				) ?? [];
			for (const seg of speechSegs) {
				if (trimFullyCovers(trim.startSec, trim.endSec, seg.startSec, seg.endSec)) {
					preservationOk = false;
					notes.push(`must_survive_removed:${req.id}:${seg.id}`);
				} else if (rangesOverlap(trim.startSec, trim.endSec, seg.startSec, seg.endSec)) {
					notes.push(`must_survive_partial_overlap:${req.id}:${seg.id}`);
					// Partial overlap is damage-risk, not automatic fail unless marked blocking.
					if (
						args.proposal.preservationViolationRisk === "high" ||
						args.proposal.preservationViolationRisk === "blocking"
					) {
						preservationOk = false;
					}
				}
			}
			// Explicit protected source range via evidenceRefs note pattern "survive:start-end"
			const rangeMatch = /survive:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/i.exec(req.reason);
			if (rangeMatch) {
				const s0 = Number(rangeMatch[1]);
				const s1 = Number(rangeMatch[2]);
				if (trimFullyCovers(trim.startSec, trim.endSec, s0, s1)) {
					preservationOk = false;
					notes.push(`must_survive_range_removed:${req.id}`);
				}
			}
		}
	}
	const preservationMs = Date.now() - tPres0;

	if (args.forceFailure) {
		preservationOk = false;
		notes.push("forced_verification_failure");
	}

	const qualityUnverified = true; // V1: no perceptual quality score
	notes.push("structurally_valid_but_quality_unverified");

	const passed = structuralOk && preservationOk && mutationExists && !args.forceFailure;

	const affectedAssetIds = [
		...new Set(
			newTrims.map((t) => t.assetId).concat(args.preflight.assetId ? [args.preflight.assetId] : []),
		),
	];
	const affectedClipIds = args.preflight.clipId ? [args.preflight.clipId] : [];

	return {
		structuralOk,
		preservationOk,
		qualityUnverified,
		passed,
		notes,
		structuralMs,
		preservationMs,
		affectedClipIds,
		affectedAssetIds,
	};
}

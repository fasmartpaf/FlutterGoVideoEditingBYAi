/**
 * Caption layout verification — scene metadata + optional native compositor frame validity.
 * Does not OCR our own captions. Compares scene text to known cue text.
 */

import { patchCaptionSettings } from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import type { CompositedFrameSampler } from "../compositorVerify/types";
import type { CaptionLayoutResult } from "./types";
import { LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID } from "./types";

export interface CaptionRenderVerification {
	providerId: typeof LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID;
	passed: boolean;
	blockingReasons: string[];
	notes: string[];
	sceneCaptionCount: number;
	sampledProgrammeTimes: number[];
	frameProvider: string | null;
	authoritativeSatisfied: boolean;
	liveVerifiedCaptionRender: boolean;
	aspectValue: number;
	verifyMs: number;
	additionalModelCalls: 0;
	timingChecks?: Array<{
		programmeTimeSec: number;
		phase: "before" | "during" | "after";
		captionActiveInScene: boolean;
		expectedActive: boolean;
	}>;
	textIdentityOk?: boolean;
}

function sceneCaptionsAt(
	annotations: Array<{ id: string; startSec: number; endSec: number; text?: { content: string } }>,
	t: number,
): Array<{ id: string; content: string }> {
	return annotations
		.filter(
			(a) =>
				a.id.startsWith("caption-") &&
				t >= a.startSec - 1e-6 &&
				t < a.endSec - 1e-9 &&
				typeof a.text?.content === "string",
		)
		.map((a) => ({ id: a.id, content: a.text!.content }));
}

export async function verifyCaptionLayoutRender(args: {
	document: AxcutDocument;
	layout: CaptionLayoutResult;
	aspectValue: number;
	sampler?: CompositedFrameSampler;
	allowInjectedAsAuthoritative?: boolean;
	/** Require native compositor for LIVE_VERIFIED_CAPTION_RENDER. */
	requireNativeAuthoritative?: boolean;
}): Promise<CaptionRenderVerification> {
	const t0 = Date.now();
	const notes: string[] = [];
	const blocking: string[] = [];
	const requireNative = args.requireNativeAuthoritative === true;

	const enabledDoc = patchCaptionSettings(args.document, { enabled: true }, args.aspectValue);
	let sceneCaptionCount = 0;
	let textIdentityOk = true;
	const timingChecks: NonNullable<CaptionRenderVerification["timingChecks"]> = [];
	let annotations: Array<{
		id: string;
		startSec: number;
		endSec: number;
		space?: "frame";
		text?: { content: string };
	}> = [];

	try {
		const scene = buildSceneDescription(enabledDoc);
		annotations = (scene.annotations ?? []).map((a) => ({
			id: a.id,
			startSec: a.startSec,
			endSec: a.endSec,
			space: a.space,
			text: a.text,
		}));
		const captionAnns = annotations.filter((a) => a.id.startsWith("caption-"));
		sceneCaptionCount = captionAnns.length;
		if (args.layout.metrics.cueCount > 0 && sceneCaptionCount < 1) {
			blocking.push("scene_missing_caption_annotations");
		} else {
			notes.push(`scene_caption_annotations=${sceneCaptionCount}`);
		}
		const frameSpace = captionAnns.filter((a) => a.space === "frame");
		if (captionAnns.length > 0 && frameSpace.length !== captionAnns.length) {
			blocking.push("caption_not_frame_space");
		} else {
			notes.push(`frame_space_captions=${frameSpace.length}`);
		}

		// Text identity: scene captions must be transcript-derived (no invented words).
		const transcriptWords = args.layout.cues
			.flatMap((c) => c.words.map((w) => w.text.trim().toLowerCase()))
			.filter(Boolean);
		const transcriptSet = new Set(transcriptWords);
		for (const ann of captionAnns) {
			const parts = (ann.text?.content ?? "")
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.map((p) => p.toLowerCase().replace(/[^\w./:-]+$/g, ""));
			for (const part of parts) {
				if (!transcriptSet.has(part) && !transcriptWords.some((w) => w === part)) {
					// Allow punctuation-only differences by normalizing transcript tokens.
					const loose = transcriptWords.some((w) => w.replace(/[^\w./:-]+$/g, "") === part);
					if (!loose) {
						textIdentityOk = false;
						blocking.push(`text_identity_mismatch:${ann.id}`);
						break;
					}
				}
			}
		}
		if (textIdentityOk && captionAnns.length > 0) {
			notes.push("text_identity_transcript_derived");
		}

		// Timing: before / during / after mid scene caption — for THIS cue id only.
		// Continuous abutting captions must not fail because a neighbor is active.
		const kept = args.layout.cues.filter((c) => !c.omitted);
		if (kept.length > 0 && captionAnns.length > 0) {
			const sceneMid = captionAnns[Math.floor(captionAnns.length / 2)]!;
			const start = sceneMid.startSec;
			const end = sceneMid.endSec;
			const midId = sceneMid.id;
			const samples: Array<{ t: number; phase: "before" | "during" | "after"; expect: boolean }> = [
				{ t: (start + end) / 2, phase: "during", expect: true },
				{ t: end + 0.12, phase: "after", expect: false },
			];
			if (start > 0.12) {
				samples.unshift({
					t: Math.max(0, start - 0.12),
					phase: "before",
					expect: false,
				});
			}
			for (const s of samples) {
				const active = sceneCaptionsAt(captionAnns, s.t);
				const midActive = active.some((a) => a.id === midId);
				const ok = s.expect ? midActive : !midActive;
				timingChecks.push({
					programmeTimeSec: s.t,
					phase: s.phase,
					captionActiveInScene: midActive,
					expectedActive: s.expect,
				});
				if (!ok) blocking.push(`timing_${s.phase}_unexpected`);
			}
		}
	} catch (err) {
		blocking.push("scene_build_failed");
		notes.push(err instanceof Error ? err.message : String(err));
	}

	const sampled: number[] = [];
	let frameProvider: string | null = null;
	let authoritative = false;

	const active = args.layout.cues.filter((c) => !c.omitted);
	if (args.sampler && active.length > 0) {
		const mid = active[Math.floor(active.length / 2)]!;
		const times = [
			Math.max(0, mid.programmeStartSec - 0.15),
			(mid.programmeStartSec + mid.programmeEndSec) / 2,
			mid.programmeEndSec + 0.15,
		];
		for (const t of times) {
			sampled.push(t);
			const frame = await args.sampler.sampleFrame({
				document: enabledDoc,
				programmeTimeSec: t,
				width: 320,
				height: 180,
			});
			frameProvider = frame.frameProvider;
			if (frame.status === "unavailable") {
				blocking.push("native_compositor_unavailable");
			} else if (frame.status !== "ok" || frame.pixelStats?.valid === false) {
				blocking.push("invalid_compositor_frame");
			} else {
				authoritative =
					frame.frameProvider === "native_compositor" ||
					(args.allowInjectedAsAuthoritative === true && frame.frameProvider === "injected_test");
				notes.push(`frame_ok t=${t.toFixed(2)} provider=${frame.frameProvider}`);
			}
		}
		if (!authoritative) {
			notes.push("frames_not_native_authoritative");
			if (requireNative) blocking.push("native_compositor_required_for_live_verified");
		}
	} else {
		notes.push("compositor_sampling_skipped_metadata_only");
		if (requireNative) blocking.push("native_compositor_required_for_live_verified");
	}

	for (const cue of active) {
		const b = cue.boundingBox;
		if (b.x < -0.01 || b.y < -0.01 || b.x + b.width > 1.01 || b.y + b.height > 1.01) {
			blocking.push(`bbox_outside_frame:${cue.id}`);
		}
		if (cue.lines.length < 1 || !cue.text.trim()) {
			blocking.push(`blank_cue:${cue.id}`);
		}
		if (cue.styleRef.fontSizePxAt1080 < 28) {
			blocking.push(`font_below_minimum:${cue.id}`);
		}
	}

	const liveVerified =
		authoritative &&
		frameProvider === "native_compositor" &&
		!blocking.includes("native_compositor_unavailable") &&
		blocking.filter((b) => b.startsWith("timing_") || b.startsWith("text_")).length === 0;

	return {
		providerId: LOCAL_CAPTION_LAYOUT_V1_PROVIDER_ID,
		passed: blocking.length === 0,
		blockingReasons: [...new Set(blocking)],
		notes,
		sceneCaptionCount,
		sampledProgrammeTimes: sampled,
		frameProvider,
		authoritativeSatisfied: authoritative || (!args.sampler && !requireNative),
		liveVerifiedCaptionRender: liveVerified,
		aspectValue: args.aspectValue,
		verifyMs: Date.now() - t0,
		additionalModelCalls: 0,
		timingChecks,
		textIdentityOk,
	};
}

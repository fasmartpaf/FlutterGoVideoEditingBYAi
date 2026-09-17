/**
 * Direct document mutations for local Chat follow-ups (0 LLM, no Director redesign).
 */

import {
	getCaptionSettings,
	patchCaptionSettings,
} from "../../../src/lib/ai-edition/captions/settings";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import {
	DEFAULT_ZOOM_DEPTH,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
} from "../../../src/lib/ai-edition/timeline/zoom-scale";
import { executeAgentTool } from "../agent-tools";
import {
	applyDirectCalloutAdd,
	applyDirectCalloutAdjust,
	applyDirectCalloutRemove,
} from "./directCallout";
import { applyDirectCaptionStyle, applyDirectCaptionTextCorrection } from "./directCaptions";
import { applyDirectSpeedAdjust, applyDirectSpeedRange } from "./directSpeed";
import { applyDirectTitleAdd, applyDirectTitleAdjust, applyDirectTitleRemove } from "./directTitle";
import {
	applyDirectTransitionAdd,
	applyDirectTransitionAdjust,
	applyDirectTransitionRemove,
} from "./directTransition";
import { applyDirectRemoveRange, applyDirectTrimAdjust } from "./directTrim";
import {
	type CursorSampleLite,
	type DirectZoomFocusTrace,
	loadCursorSamplesFromSidecar,
	selectDirectZoomFocus,
} from "./directZoomFocus";
import type { LocalEditorialRequestV1 } from "./types";

function popLastSpeed(doc: AxcutDocument): { document: AxcutDocument; mutated: boolean } {
	const timelineSpeeds = [...(doc.timeline?.speedRanges ?? [])];
	if (timelineSpeeds.length > 0) {
		timelineSpeeds.pop();
		return {
			document: {
				...doc,
				timeline: { ...doc.timeline, speedRanges: timelineSpeeds },
			},
			mutated: true,
		};
	}
	const legacy = { ...((doc.legacyEditor as Record<string, unknown>) ?? {}) };
	const regions = [...((legacy.speedRegions as unknown[]) ?? [])];
	if (regions.length > 0) {
		regions.pop();
		legacy.speedRegions = regions;
		return { document: { ...doc, legacyEditor: legacy }, mutated: true };
	}
	return { document: doc, mutated: false };
}

function clampDepth(d: number): ZoomDepth {
	const n = Math.round(d);
	if (n <= 1) return 1;
	if (n === 2) return 2;
	if (n === 3) return 3;
	if (n === 4) return 4;
	if (n === 5) return 5;
	return 6;
}

function resolveDepth(req: LocalEditorialRequestV1, current?: ZoomDepth): ZoomDepth {
	if (req.zoomDepth != null) return req.zoomDepth;
	if (req.zoomScale != null) {
		let best: ZoomDepth = 3;
		let bestDist = Number.POSITIVE_INFINITY;
		for (const [k, v] of Object.entries(ZOOM_DEPTH_SCALES)) {
			const d = Number(k) as ZoomDepth;
			const dist = Math.abs(v - req.zoomScale);
			if (dist < bestDist) {
				bestDist = dist;
				best = d;
			}
		}
		return best;
	}
	const base = current ?? DEFAULT_ZOOM_DEPTH;
	if (req.relativeAdjustment === "A_LITTLE" && req.intent === "ADD_ZOOM") return 2;
	if (req.relativeAdjustment === "MORE" || req.relativeAdjustment === "MORE_AGGRESSIVE") {
		return clampDepth(base + 1);
	}
	if (req.relativeAdjustment === "LESS" || req.relativeAdjustment === "LESS_AGGRESSIVE") {
		return clampDepth(base - 1);
	}
	return base;
}

function overlapsSec(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > 0.05;
}

function lastZoom(doc: AxcutDocument) {
	const zooms = doc.zoomRanges ?? [];
	return zooms.length > 0 ? zooms[zooms.length - 1]! : null;
}

function applyDirectZoomIn(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
	cursorSamples?: CursorSampleLite[] | null;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
	focusTrace: DirectZoomFocusTrace | null;
} {
	const req = args.request;
	const range = req.range;
	if (!range || !(range.endSec > range.startSec)) {
		return {
			document: args.document,
			mutated: false,
			userFacingText:
				"I need a time range to place that zoom (for example “zoom in from 5s to 10s”).",
			families: [],
			focusTrace: null,
		};
	}

	let doc = args.document;
	const startSec = range.startSec;
	const endSec = range.endSec;

	// Collision: replace overlapping zooms when the user is clearly placing the same edit.
	const kept = (doc.zoomRanges ?? []).filter(
		(z) => !overlapsSec(z.startMs / 1000, z.endMs / 1000, startSec, endSec),
	);
	const removed = (doc.zoomRanges ?? []).length - kept.length;
	if (removed > 0) {
		doc = { ...doc, zoomRanges: kept };
	}

	const depth = resolveDepth(req);
	let samples = args.cursorSamples ?? null;
	if (!samples || samples.length === 0) {
		const media =
			doc.assets.find((a) => a.id === doc.project.primaryAssetId)?.originalPath ??
			doc.assets[0]?.originalPath ??
			null;
		samples = loadCursorSamplesFromSidecar(media);
	}
	const focusTrace = selectDirectZoomFocus({
		startSec,
		endSec,
		userFocus: req.zoomUserFocus,
		cursorSamples: samples,
	});
	const focus = focusTrace.selectedFocus;
	const focusSource = focusTrace.focusSource;

	const result = executeAgentTool(
		doc,
		"addZoom",
		JSON.stringify({ startSec, endSec, depth, focus }),
		{ editsAllowed: true },
	);
	if (!result.ok || !result.document) {
		return {
			document: doc,
			mutated: false,
			userFacingText:
				result.summary ||
				"I couldn't place that zoom on the timeline (the range may fall outside the clip).",
			families: [],
			focusTrace,
		};
	}

	const scale = ZOOM_DEPTH_SCALES[depth];
	const replaceNote = removed > 0 ? " (replaced an overlapping zoom)" : "";
	const focusNote = focusTrace.fallbackUsed
		? "focus: center fallback"
		: `focus: ${focusSource} (${focus.cx.toFixed(2)}, ${focus.cy.toFixed(2)})`;
	return {
		document: result.document,
		mutated: true,
		userFacingText: `I added a zoom from ${startSec.toFixed(1)}s to ${endSec.toFixed(1)}s at ${scale.toFixed(2)}× (${focusNote})${replaceNote}.`,
		families: ["zoom"],
		focusTrace,
	};
}

function applyDirectZoomAdjust(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
}): { document: AxcutDocument; mutated: boolean; userFacingText: string; families: string[] } {
	const req = args.request;
	const dir = req.zoomDirection;
	const n = req.rawText.toLowerCase();
	let doc = args.document;
	const zooms = [...(doc.zoomRanges ?? [])];

	// Zoom-out / reset: return to 1× by ending or removing coverage — document has no wider-than-1× primitive.
	if (dir === "out" || dir === "reset") {
		const wantsWiderThanBase =
			/\bwider\b/.test(n) &&
			!/\breturn\s+to\s+(?:the\s+)?(?:full|normal|base)\b|\bzoom\s+out\b|\bafter\b/.test(n);
		if (zooms.length === 0) {
			if (wantsWiderThanBase) {
				return {
					document: doc,
					mutated: false,
					userFacingText:
						"I can't zoom wider than the full frame — the editor's zoom primitive only goes from base 1× inward. Already at full-screen framing.",
					families: [],
				};
			}
			return {
				document: doc,
				mutated: false,
				userFacingText:
					"Framing is already at full screen (1×) for that range — the editor has no wider-than-base zoom-out primitive.",
				families: [],
			};
		}
		if (wantsWiderThanBase && req.range) {
			// Honest limitation when asking for wider-than-1× over a span that is already base.
			const covered = zooms.some((z) =>
				overlapsSec(z.startMs / 1000, z.endMs / 1000, req.range!.startSec, req.range!.endSec),
			);
			if (!covered) {
				return {
					document: doc,
					mutated: false,
					userFacingText:
						"That span is already at base 1× framing. Wider-than-base zoom-out is not supported — only return-to-normal / exit of an existing zoom-in.",
					families: [],
				};
			}
		}
		const last = zooms[zooms.length - 1]!;
		const afterThat = /\bafter\s+that\b/.test(n);
		const cutAt =
			req.range != null
				? dir === "reset" || afterThat || /\bafter\b/.test(n)
					? req.range.startSec
					: req.range.startSec
				: last.endMs / 1000;

		if (dir === "reset" || afterThat || /\bafter\b/.test(n) || req.range == null) {
			// Ensure return-to-normal at/after cutAt: truncate last zoom so it ends at cutAt.
			const endMs = Math.round(Math.max(last.startMs + 200, cutAt * 1000));
			if (endMs >= last.endMs && req.range == null && !afterThat) {
				// Explicit "zoom out from A to B" overlapping the hold → remove coverage in that span.
				const startSec = req.range?.startSec ?? last.startMs / 1000;
				const endSec = req.range?.endSec ?? last.endMs / 1000;
				const next = zooms.filter(
					(z) => !overlapsSec(z.startMs / 1000, z.endMs / 1000, startSec, endSec),
				);
				if (next.length === zooms.length) {
					return {
						document: doc,
						mutated: false,
						userFacingText: "There wasn't an active zoom covering that span to pull back from.",
						families: [],
					};
				}
				doc = { ...doc, zoomRanges: next };
				return {
					document: doc,
					mutated: true,
					userFacingText: `I returned that section to full-screen framing (removed zoom coverage ${startSec.toFixed(1)}s–${endSec.toFixed(1)}s).`,
					families: ["zoom"],
				};
			}
			const result = executeAgentTool(
				doc,
				"setZoom",
				JSON.stringify({ zoomId: last.id, endSec: endMs / 1000 }),
				{ editsAllowed: true },
			);
			if (!result.ok || !result.document) {
				// Fallback: pop last zoom entirely (reset).
				zooms.pop();
				doc = { ...doc, zoomRanges: zooms };
				return {
					document: doc,
					mutated: true,
					userFacingText: "I returned to full-screen framing by removing the latest zoom.",
					families: ["zoom"],
				};
			}
			return {
				document: result.document,
				mutated: true,
				userFacingText: `I zoomed out / returned to normal after ${(endMs / 1000).toFixed(1)}s (base 1× framing).`,
				families: ["zoom"],
			};
		}

		// Explicit wider request over a span: remove overlapping zoom coverage.
		const startSec = req.range.startSec;
		const endSec = req.range.endSec;
		const next = zooms.flatMap((z) => {
			const zs = z.startMs / 1000;
			const ze = z.endMs / 1000;
			if (!overlapsSec(zs, ze, startSec, endSec)) return [z];
			// Truncate before the out span when the zoom started earlier.
			if (zs < startSec && ze > startSec) {
				return [{ ...z, endMs: Math.round(startSec * 1000) }];
			}
			return [];
		});
		doc = { ...doc, zoomRanges: next };
		return {
			document: doc,
			mutated: true,
			userFacingText: `I pulled back to full-screen framing between ${startSec.toFixed(1)}s and ${endSec.toFixed(1)}s.`,
			families: ["zoom"],
		};
	}

	const target = lastZoom(doc);
	if (!target) {
		return {
			document: doc,
			mutated: false,
			userFacingText: "There isn't a zoom on the timeline to adjust yet.",
			families: [],
		};
	}

	const patch: Record<string, unknown> = { zoomId: target.id };
	let summary = "";

	// Bound edits: start / end from range slots
	if (req.range) {
		const raw = n;
		if (/\bstart(?:\s+it)?\s+at\b|\bfrom\b.*\binstead\b|\binstead\b/.test(raw)) {
			patch.startSec = req.range.startSec;
			summary = `I moved that zoom to start at ${req.range.startSec.toFixed(1)}s.`;
		} else if (/\bkeep\s+it\s+until\b|\buntil\b|\bend(?:\s+it)?\s+at\b/.test(raw)) {
			patch.endSec = req.range.endSec;
			summary = `I kept that zoom until ${req.range.endSec.toFixed(1)}s.`;
		} else if (
			/\bfrom\b/.test(raw) &&
			/\b(?:to|until)\b/.test(raw) &&
			req.range.endSec - req.range.startSec > 0.5
		) {
			patch.startSec = req.range.startSec;
			patch.endSec = req.range.endSec;
			summary = `I updated that zoom to ${req.range.startSec.toFixed(1)}s–${req.range.endSec.toFixed(1)}s.`;
		} else {
			patch.endSec = req.range.endSec;
			summary = `I updated that zoom’s timing (end ${req.range.endSec.toFixed(1)}s).`;
		}
	}

	const nextDepth = resolveDepth(req, target.depth as ZoomDepth);
	if (
		nextDepth !== target.depth ||
		req.relativeAdjustment != null ||
		req.zoomDepth != null ||
		req.zoomScale != null ||
		/\bstronger|weaker|more|less|notch|dial|1\.\d+\s*x|\d\s*x\b/.test(n)
	) {
		patch.depth = nextDepth;
		const scale = ZOOM_DEPTH_SCALES[nextDepth];
		summary =
			summary ||
			`I made that zoom ${nextDepth > (target.depth as number) ? "stronger" : nextDepth < (target.depth as number) ? "gentler" : "the same strength"} (${scale.toFixed(2)}×).`;
	}

	if (Object.keys(patch).length <= 1) {
		return {
			document: doc,
			mutated: false,
			userFacingText: "I couldn't tell how to adjust that zoom.",
			families: [],
		};
	}

	const result = executeAgentTool(doc, "setZoom", JSON.stringify(patch), {
		editsAllowed: true,
	});
	if (!result.ok || !result.document) {
		return {
			document: doc,
			mutated: false,
			userFacingText: result.summary || "I couldn't adjust that zoom.",
			families: [],
		};
	}
	return {
		document: result.document,
		mutated: true,
		userFacingText: summary || "I updated that zoom.",
		families: ["zoom"],
	};
}

export function applyLocalDirectDocumentEdit(args: {
	document: AxcutDocument;
	request: LocalEditorialRequestV1;
	aspectValue?: number;
	cursorSamples?: CursorSampleLite[] | null;
}): {
	document: AxcutDocument;
	mutated: boolean;
	userFacingText: string;
	families: string[];
	focusTrace?: DirectZoomFocusTrace | null;
} {
	const t = args.request.rawText;
	let doc = args.document;
	const aspect = args.aspectValue ?? 16 / 9;
	const families: string[] = [];

	if (args.request.intent === "REMOVE_RANGE") {
		return applyDirectRemoveRange({ document: doc, request: args.request });
	}

	if (
		args.request.intent === "REVISE_PREVIOUS_EDIT" &&
		(args.request.referencedPreviousEdit === "last_trim" || /\b(?:cut|trim)\b/i.test(t))
	) {
		return applyDirectTrimAdjust({ document: doc, request: args.request });
	}

	if (
		(args.request.intent === "SPEED_UP" || args.request.intent === "SLOW_DOWN") &&
		args.request.range != null
	) {
		return applyDirectSpeedRange({ document: doc, request: args.request });
	}

	if (
		args.request.referencedPreviousEdit === "last_speed" &&
		(args.request.intent === "SPEED_UP" ||
			args.request.intent === "SLOW_DOWN" ||
			args.request.intent === "REVISE_PREVIOUS_EDIT" ||
			/\b(?:faster|slower|speed|normal)\b/i.test(t))
	) {
		return applyDirectSpeedAdjust({ document: doc, request: args.request });
	}

	if (args.request.intent === "ADD_ZOOM") {
		return applyDirectZoomIn({
			document: doc,
			request: args.request,
			cursorSamples: args.cursorSamples,
		});
	}

	if (args.request.intent === "ADJUST_ZOOM") {
		return applyDirectZoomAdjust({ document: doc, request: args.request });
	}

	if (args.request.intent === "REMOVE_ZOOM") {
		const zooms = [...(doc.zoomRanges ?? [])];
		if (zooms.length === 0) {
			return {
				document: doc,
				mutated: false,
				userFacingText: "There isn't a zoom on the timeline to remove.",
				families,
			};
		}
		zooms.pop();
		doc = { ...doc, zoomRanges: zooms };
		families.push("zoom");
		return {
			document: doc,
			mutated: true,
			userFacingText: "I removed the latest zoom from the timeline.",
			families,
		};
	}

	if (args.request.referencedPreviousEdit === "last_speed") {
		const next = popLastSpeed(doc);
		if (!next.mutated) {
			return {
				document: doc,
				mutated: false,
				userFacingText: "There isn't a speed change on the timeline to undo.",
				families,
			};
		}
		families.push("speed");
		return {
			document: next.document,
			mutated: true,
			userFacingText: "I undid the last speed change.",
			families,
		};
	}

	if (args.request.intent === "ENABLE_CAPTIONS") {
		const cur = getCaptionSettings(doc, aspect);
		if (cur.enabled) {
			return {
				document: doc,
				mutated: false,
				userFacingText: "Captions are already enabled.",
				families,
			};
		}
		const assetId =
			doc.project.primaryAssetId ?? doc.assets.find((a) => a.kind !== "audio")?.id ?? null;
		const transcript =
			(assetId ? doc.transcripts.find((t) => t.assetId === assetId) : null) ??
			doc.transcripts[0] ??
			doc.transcript ??
			null;
		const wordCount = transcript?.words?.length ?? 0;
		const speechSegs =
			transcript?.segments?.filter(
				(s) => s.kind === "speech" && String(s.text ?? "").trim().length > 0,
			).length ?? 0;
		if (wordCount === 0 && speechSegs === 0) {
			return {
				document: doc,
				mutated: false,
				userFacingText:
					"I couldn't enable captions yet because this project has no transcript words. Ask me again after transcription finishes, or say “make it professional” first so I can prepare speech.",
				families,
			};
		}
		doc = patchCaptionSettings(doc, { enabled: true }, aspect);
		families.push("captions");
		return {
			document: doc,
			mutated: true,
			userFacingText: "I enabled captions from the transcript.",
			families,
		};
	}

	if (args.request.intent === "CAPTIONS") {
		const cur = getCaptionSettings(doc, aspect);
		if (!cur.enabled) {
			return {
				document: doc,
				mutated: false,
				userFacingText: "Captions are already off.",
				families,
			};
		}
		doc = patchCaptionSettings(doc, { enabled: false }, aspect);
		families.push("captions");
		return {
			document: doc,
			mutated: true,
			userFacingText: "I turned captions off.",
			families,
		};
	}

	if (args.request.intent === "CAPTION_STYLE") {
		return applyDirectCaptionStyle({
			document: doc,
			request: args.request,
			aspectValue: aspect,
		});
	}

	if (args.request.intent === "CORRECT_CAPTION") {
		return applyDirectCaptionTextCorrection({
			document: doc,
			request: args.request,
			aspectValue: aspect,
		});
	}

	if (args.request.intent === "TITLE") {
		return applyDirectTitleAdd({ document: doc, request: args.request });
	}

	if (args.request.intent === "ADJUST_TITLE") {
		return applyDirectTitleAdjust({ document: doc, request: args.request });
	}

	if (args.request.intent === "REMOVE_TITLE") {
		return applyDirectTitleRemove({ document: doc, request: args.request });
	}

	if (args.request.intent === "CALLOUT") {
		return applyDirectCalloutAdd({
			document: doc,
			request: args.request,
			cursorSamples: args.cursorSamples,
		});
	}

	if (args.request.intent === "ADJUST_CALLOUT") {
		return applyDirectCalloutAdjust({ document: doc, request: args.request });
	}

	if (args.request.intent === "REMOVE_CALLOUT") {
		return applyDirectCalloutRemove({ document: doc, request: args.request });
	}

	if (args.request.intent === "TRANSITION") {
		return applyDirectTransitionAdd({ document: doc, request: args.request });
	}

	if (args.request.intent === "ADJUST_TRANSITION") {
		return applyDirectTransitionAdjust({ document: doc, request: args.request });
	}

	if (args.request.intent === "REMOVE_TRANSITION") {
		return applyDirectTransitionRemove({ document: doc, request: args.request });
	}

	if (args.request.intent === "AUDIO_LEVEL") {
		const legacy = { ...((doc.legacyEditor as Record<string, unknown>) ?? {}) };
		const cur = typeof legacy.audioGainDb === "number" ? legacy.audioGainDb : 0;
		const quieter = /\bquieter\b/i.test(t);
		legacy.audioGainDb = quieter ? cur - 2 : cur + 2;
		doc = { ...doc, legacyEditor: legacy };
		families.push("loudness");
		return {
			document: doc,
			mutated: true,
			userFacingText: quieter
				? "I turned the audio down a little."
				: "I turned the audio up a little.",
			families,
		};
	}

	return {
		document: doc,
		mutated: false,
		userFacingText: "I couldn't apply that follow-up edit locally.",
		families,
	};
}

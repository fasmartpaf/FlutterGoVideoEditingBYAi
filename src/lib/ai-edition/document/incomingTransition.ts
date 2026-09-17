/**
 * Pure document mutation for clip.incomingTransition.
 * Same authority as agent-tools setClipIncomingTransition — Registry SSOT.
 */

import {
	resolveTransitionId,
	validateAndClampTransitionApply,
} from "../../../../electron/ai-edition/transitionLibrary";
import type { AxcutDocument } from "../schema";

export type SetIncomingTransitionResult =
	| { ok: true; document: AxcutDocument; transitionId: string; durationSec: number }
	| { ok: false; reason: string };

export function setClipIncomingTransitionInDocument(
	document: AxcutDocument,
	args: {
		clipId: string;
		transitionId?: string;
		kind?: "cut" | "dissolve";
		durationSec?: number;
		params?: Record<string, unknown>;
	},
): SetIncomingTransitionResult {
	const clipIndex = document.timeline.clips.findIndex((c) => c.id === args.clipId);
	if (clipIndex < 0) return { ok: false, reason: `Unknown clip: ${args.clipId}` };
	if (clipIndex <= 0) {
		return { ok: false, reason: "incoming transition requires a non-first clip (a join)" };
	}
	const transitionId = resolveTransitionId({
		transitionId: args.transitionId,
		kind: args.kind ?? null,
	});
	const validated = validateAndClampTransitionApply({
		transitionId,
		durationSec: args.durationSec,
		params: args.params ?? null,
	});
	if (!validated.ok) return { ok: false, reason: validated.reason };
	const isCut = validated.transitionId === "openscreen.cut";
	const durationSec = validated.durationSec;
	const kind = isCut ? ("cut" as const) : ("dissolve" as const);
	const params = Object.keys(validated.params).length > 0 && !isCut ? validated.params : undefined;
	const nextClips = document.timeline.clips.map((c) =>
		c.id === args.clipId
			? {
					...c,
					incomingTransition: {
						kind,
						transitionId: validated.transitionId,
						...(isCut ? {} : { durationSec }),
						...(params ? { params } : {}),
					},
				}
			: c,
	);
	return {
		ok: true,
		document: {
			...document,
			timeline: { ...document.timeline, clips: nextClips },
		},
		transitionId: validated.transitionId,
		durationSec: isCut ? 0 : durationSec,
	};
}

/**
 * Autonomous Transition Intelligence V5 — editorial relationship → family → Registry id.
 * Registry remains SSOT. CUT/KEEP is first-class. No new Director/planner/TCS.
 * LOCAL ONLY — TOTAL_CLOUD_CALLS = 0.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type {
	MultimodalSourceStoryV1,
	TargetEditStoryV1,
} from "../autonomousProfessionalEditor/types";
import {
	type GpuBackend,
	getTransitionById,
	listAutonomousEligible,
	type TransitionRegistryEntry,
} from "./registry";

export type BoundaryCauseV5 =
	| "original_clip_boundary"
	| "user_created_cut"
	| "autonomous_trim_join"
	| "unknown";

export type EditorialRelationshipV5 =
	| "CONTINUITY"
	| "SECTION_CHANGE"
	| "DIRECTIONAL_CHANGE"
	| "TIME_PASSAGE"
	| "HARD_CHANGE"
	| "UNKNOWN_WEAK";

export type TransitionFamilyV5 = "CUT" | "DISSOLVE_FADE" | "WIPE" | "SLIDE" | "NONE";

export interface BoundaryEvidenceV5 {
	clipId: string;
	clipIndex: number;
	programmeJoinSec: number;
	before: {
		transcriptSnippet: string;
		beatKind: string | null;
		sourceAssetId: string | null;
	};
	after: {
		transcriptSnippet: string;
		beatKind: string | null;
		sourceAssetId: string | null;
	};
	boundaryCause: BoundaryCauseV5;
	nearbyBusyVisual: boolean;
	relationship: EditorialRelationshipV5;
	family: TransitionFamilyV5;
	decision: "APPLY" | "KEEP";
	transitionId: string | null;
	durationSec: number;
	confidence: "HIGH" | "MEDIUM" | "LOW";
	reason: string;
}

function snippetAt(
	story: MultimodalSourceStoryV1 | null | undefined,
	tSec: number,
	prefer: "before" | "after" = "before",
	windowSec = 2.5,
): { text: string; kind: string | null } {
	if (!story?.beats?.length) return { text: "", kind: null };
	const hits = story.beats.filter(
		(b) => b.endSec >= tSec - windowSec && b.startSec <= tSec + windowSec,
	);
	if (hits.length === 0) {
		const nearest = [...story.beats].sort(
			(a, b) =>
				Math.abs((a.startSec + a.endSec) / 2 - tSec) - Math.abs((b.startSec + b.endSec) / 2 - tSec),
		)[0];
		return {
			text: (nearest?.speechSummary ?? "").slice(0, 160),
			kind: nearest?.kind ?? null,
		};
	}
	const sorted = [...hits].sort((a, b) => a.startSec - b.startSec);
	const pick =
		prefer === "after"
			? (sorted.find((b) => (b.startSec + b.endSec) / 2 >= tSec) ?? sorted.at(-1)!)
			: (sorted.filter((b) => (b.startSec + b.endSec) / 2 <= tSec).at(-1) ?? sorted[0]!);
	return {
		text: (pick.speechSummary ?? "").slice(0, 160),
		kind: pick.kind ?? null,
	};
}

function beatKindsAcross(
	story: MultimodalSourceStoryV1 | null | undefined,
	tSec: number,
): { prev: string | null; next: string | null } {
	if (!story?.beats?.length) return { prev: null, next: null };
	const prev =
		[...story.beats].filter((b) => b.endSec <= tSec + 0.05).sort((a, b) => b.endSec - a.endSec)[0]
			?.kind ?? null;
	const next =
		[...story.beats]
			.filter((b) => b.startSec >= tSec - 0.05)
			.sort((a, b) => a.startSec - b.startSec)[0]?.kind ?? null;
	return { prev, next };
}

function classifyRelationship(args: {
	prevKind: string | null;
	nextKind: string | null;
	sameAsset: boolean;
	targetWantsDissolveNear: boolean;
	boundaryCause: BoundaryCauseV5;
}): EditorialRelationshipV5 {
	const { prevKind, nextKind, sameAsset, targetWantsDissolveNear, boundaryCause } = args;
	if (boundaryCause === "autonomous_trim_join") return "CONTINUITY";
	if (!prevKind || !nextKind) {
		return targetWantsDissolveNear ? "SECTION_CHANGE" : "UNKNOWN_WEAK";
	}
	const sameKind = prevKind === nextKind;
	const continuousKinds =
		(prevKind === "EXPLANATION" && nextKind === "EXPLANATION") ||
		(prevKind === "ACTION_DEMONSTRATION" && nextKind === "ACTION_DEMONSTRATION") ||
		(prevKind === "WAITING_REPETITION" && nextKind === "WAITING_REPETITION");
	if (continuousKinds || (sameKind && sameAsset)) return "CONTINUITY";

	const chapterLike =
		(prevKind === "OPENING_SETUP" && nextKind !== "OPENING_SETUP") ||
		(prevKind === "EXPLANATION" && nextKind === "ACTION_DEMONSTRATION") ||
		(prevKind === "ACTION_DEMONSTRATION" && nextKind === "RESULT_REVEAL") ||
		(prevKind === "OPENING_SETUP" && nextKind === "ACTION_DEMONSTRATION") ||
		(prevKind === "RESULT_REVEAL" && nextKind === "CLOSING");

	if (!sameAsset && chapterLike) return "HARD_CHANGE";
	if (!sameAsset) return "HARD_CHANGE";
	if (chapterLike || targetWantsDissolveNear) return "SECTION_CHANGE";
	if (prevKind !== nextKind) return "TIME_PASSAGE";
	return "UNKNOWN_WEAK";
}

function familyForRelationship(rel: EditorialRelationshipV5): TransitionFamilyV5 {
	switch (rel) {
		case "CONTINUITY":
		case "HARD_CHANGE":
		case "UNKNOWN_WEAK":
			return "CUT";
		case "SECTION_CHANGE":
		case "TIME_PASSAGE":
			return "DISSOLVE_FADE";
		case "DIRECTIONAL_CHANGE":
			return "SLIDE";
		default:
			return "CUT";
	}
}

function pickRegistryId(
	family: TransitionFamilyV5,
	backend: GpuBackend,
): { transitionId: string | null; durationSec: number } {
	if (family === "CUT" || family === "NONE") {
		return { transitionId: "openscreen.cut", durationSec: 0 };
	}
	const eligible = listAutonomousEligible(backend).filter((e) => e.id !== "openscreen.cut");
	const byFamily = (pred: (e: TransitionRegistryEntry) => boolean) => eligible.find(pred) ?? null;
	let entry: TransitionRegistryEntry | null = null;
	if (family === "DISSOLVE_FADE") {
		entry =
			byFamily((e) => e.id === "openscreen.dissolve") ??
			byFamily((e) => e.category === "subtle" || e.category === "fade") ??
			null;
	} else if (family === "WIPE") {
		entry = byFamily((e) => e.category === "wipe") ?? null;
	} else if (family === "SLIDE") {
		entry = byFamily((e) => e.category === "movement") ?? null;
	}
	if (!entry || !entry.autonomousEligible || !entry.userAvailable) {
		return { transitionId: "openscreen.cut", durationSec: 0 };
	}
	if (
		entry.availability === "QUARANTINED_RENDER" ||
		entry.availability === "QUARANTINED_PERFORMANCE"
	) {
		return { transitionId: "openscreen.cut", durationSec: 0 };
	}
	// Subtle default — never exceed Registry bounds.
	const durationSec = Math.min(
		entry.maxDurationSec,
		Math.max(entry.minDurationSec, entry.defaultDurationSec),
	);
	return { transitionId: entry.id, durationSec };
}

function clampDuration(
	entry: TransitionRegistryEntry,
	relationship: EditorialRelationshipV5,
): number {
	let d = entry.defaultDurationSec;
	if (relationship === "TIME_PASSAGE") {
		d = Math.min(entry.maxDurationSec, entry.defaultDurationSec * 1.15);
	} else if (relationship === "SECTION_CHANGE") {
		d = entry.defaultDurationSec;
	}
	return Math.min(entry.maxDurationSec, Math.max(entry.minDurationSec, d));
}

function joinIsBusy(args: { document: AxcutDocument; programmeJoinSec: number }): boolean {
	const t = args.programmeJoinSec;
	const window = 0.85;
	const zooms = args.document.zoomRanges ?? [];
	for (const z of zooms) {
		const s = z.startMs / 1000;
		const e = z.endMs / 1000;
		if (e >= t - window && s <= t + window) return true;
	}
	const anns = args.document.annotations ?? [];
	for (const a of anns) {
		const kind = String((a as { type?: string }).type ?? "");
		if (kind !== "text" && kind !== "arrow" && kind !== "spotlight") continue;
		const s = a.startMs / 1000;
		const e = a.endMs / 1000;
		if (e >= t - window && s <= t + window) return true;
	}
	return false;
}

/**
 * Decide APPLY/KEEP for every authorable document clip join (index > 0).
 * Trim-created programme joins are NOT authorable as document transitions —
 * they inherit CUT via playback segment stripping (see timeline resolvePlaybackSegments).
 */
export function decideAutonomousTransitions(args: {
	document: AxcutDocument;
	sourceStory?: MultimodalSourceStoryV1 | null;
	targetStory?: TargetEditStoryV1 | null;
	backend?: GpuBackend;
	/** Max APPLY decisions per programme — precision over quantity. */
	maxApply?: number;
}): BoundaryEvidenceV5[] {
	const backend = args.backend ?? "metal";
	const maxApply = args.maxApply ?? 2;
	const clips = args.document.timeline?.clips ?? [];
	const out: BoundaryEvidenceV5[] = [];
	let applied = 0;

	for (let i = 1; i < clips.length; i++) {
		const clip = clips[i]!;
		const prev = clips[i - 1]!;
		const joinSec = clip.timelineStartSec;
		const before = snippetAt(args.sourceStory ?? null, joinSec - 0.05, "before");
		const after = snippetAt(args.sourceStory ?? null, joinSec + 0.05, "after");
		const kinds = beatKindsAcross(args.sourceStory ?? null, joinSec);
		const sameAsset = prev.assetId === clip.assetId;
		const boundaryCause: BoundaryCauseV5 =
			clip.origin === "system" || clip.origin === "user"
				? clip.reason === "join" || clip.origin === "user"
					? "original_clip_boundary"
					: "user_created_cut"
				: "original_clip_boundary";

		const targetWantsDissolveNear = Boolean(
			args.targetStory?.beats.some(
				(b) =>
					b.visualTreatment.transition === "DISSOLVE" &&
					// beat id embeds source beat; approximate by purpose change near join
					true,
			) &&
				kinds.prev &&
				kinds.next &&
				kinds.prev !== kinds.next,
		);

		const relationship = classifyRelationship({
			prevKind: kinds.prev ?? before.kind,
			nextKind: kinds.next ?? after.kind,
			sameAsset,
			targetWantsDissolveNear,
			boundaryCause,
		});
		let family = familyForRelationship(relationship);
		const busy = joinIsBusy({ document: args.document, programmeJoinSec: joinSec });
		if (busy && family !== "CUT") {
			family = "CUT";
		}

		let decision: "APPLY" | "KEEP" = family === "CUT" ? "KEEP" : "APPLY";
		if (decision === "APPLY" && applied >= maxApply) {
			decision = "KEEP";
			family = "CUT";
		}

		let pick =
			decision === "APPLY"
				? pickRegistryId(family, backend)
				: { transitionId: "openscreen.cut", durationSec: 0 };

		if (decision === "APPLY" && (!pick.transitionId || pick.transitionId === "openscreen.cut")) {
			decision = "KEEP";
			family = "CUT";
			pick = { transitionId: "openscreen.cut", durationSec: 0 };
		}

		if (decision === "APPLY") {
			applied += 1;
			const entryForDur = pick.transitionId ? getTransitionById(pick.transitionId) : null;
			if (entryForDur) {
				pick = {
					transitionId: pick.transitionId,
					durationSec: clampDuration(entryForDur, relationship),
				};
			}
		}

		const entry = pick.transitionId ? getTransitionById(pick.transitionId) : null;
		const reason =
			decision === "KEEP"
				? busy
					? `KEEP/CUT — join at ${joinSec.toFixed(1)}s is already visually busy (zoom/title/callout nearby)`
					: relationship === "CONTINUITY"
						? `KEEP/CUT — continuity across join (${kinds.prev ?? "?"}→${kinds.next ?? "?"}); effect would decorate without meaning`
						: relationship === "HARD_CHANGE"
							? `KEEP/CUT — hard context switch communicates better as a clean cut`
							: `KEEP/CUT — weak or unknown evidence; CUT is safer than decorating`
				: `APPLY ${entry?.displayName ?? pick.transitionId} — ${relationship} at ${joinSec.toFixed(1)}s (${kinds.prev ?? "?"}→${kinds.next ?? "?"})`;

		out.push({
			clipId: clip.id,
			clipIndex: i,
			programmeJoinSec: joinSec,
			before: {
				transcriptSnippet: before.text,
				beatKind: kinds.prev ?? before.kind,
				sourceAssetId: prev.assetId,
			},
			after: {
				transcriptSnippet: after.text,
				beatKind: kinds.next ?? after.kind,
				sourceAssetId: clip.assetId,
			},
			boundaryCause,
			nearbyBusyVisual: busy,
			relationship,
			family,
			decision,
			transitionId: decision === "APPLY" ? pick.transitionId : "openscreen.cut",
			durationSec: decision === "APPLY" ? pick.durationSec : 0,
			confidence:
				decision === "KEEP" && relationship === "CONTINUITY"
					? "HIGH"
					: decision === "APPLY"
						? "MEDIUM"
						: "LOW",
			reason,
		});
	}
	return out;
}

/**
 * Post-validate / sanitize V1 SourceStory prose against V2 evidence constraints.
 */

import type { SourceStory, SourceStoryBeat } from "../types";
import {
	assertsForbiddenRestartAction,
	assertsForbiddenSettingsAction,
	assertsForbiddenUpworkAction,
	sanitizeStoryProse,
} from "./guards";
import type { SourceStoryV2 } from "./types";

function hasVerifiedAction(story: SourceStoryV2, needle: RegExp): boolean {
	return story.beats.some((b) =>
		b.actions.some((a) => a.epistemic === "verified" && needle.test(a.text)),
	);
}

/** Sanitize model SourceStory so forbidden actions cannot ship as facts. */
export function constrainSourceStoryWithV2(
	story: SourceStory,
	storyV2: SourceStoryV2,
): { story: SourceStory; warnings: string[] } {
	const warnings: string[] = [];
	const beats: SourceStoryBeat[] = story.storyBeats.map((b) => {
		const rawBlob = `${b.summary} ${b.visualMeaning ?? ""} ${b.interactionMeaning ?? ""}`;
		let summary = b.summary;
		let visualMeaning = b.visualMeaning;
		let interactionMeaning = b.interactionMeaning;
		let spokenMeaning = b.spokenMeaning;
		let confidence = b.confidence;

		if (
			(/upwork/i.test(rawBlob) &&
				/\b(open|opened|navigat|visit|worked)\b/i.test(rawBlob) &&
				!hasVerifiedAction(storyV2, /upwork/i)) ||
			(assertsForbiddenUpworkAction(rawBlob) && !hasVerifiedAction(storyV2, /upwork/i))
		) {
			warnings.push("stripped forbidden Upwork action assertion");
			summary = sanitizeStoryProse(summary);
			interactionMeaning = undefined;
			if (visualMeaning && /upwork/i.test(visualMeaning)) {
				visualMeaning = "Upwork tab visible as passive chrome (context only)";
			}
			confidence = "low";
		}
		if (assertsForbiddenRestartAction(rawBlob) && !hasVerifiedAction(storyV2, /restart/i)) {
			warnings.push("stripped forbidden restart action assertion");
			summary = sanitizeStoryProse(summary);
			interactionMeaning = undefined;
			if (visualMeaning && assertsForbiddenRestartAction(visualMeaning)) {
				visualMeaning = "Restart recording tooltip visibility (not a verified restart action)";
			}
			confidence = "medium";
		}
		if (assertsForbiddenSettingsAction(rawBlob) && !hasVerifiedAction(storyV2, /settings/i)) {
			warnings.push("stripped forbidden Settings action assertion");
			summary = sanitizeStoryProse(summary);
			interactionMeaning = undefined;
			confidence = "low";
		}

		summary = sanitizeStoryProse(summary);
		if (visualMeaning) visualMeaning = sanitizeStoryProse(visualMeaning);
		if (interactionMeaning) interactionMeaning = sanitizeStoryProse(interactionMeaning);

		// Prefer marking unresolved actions in unresolvedEvidence via confidence
		if (/\b(opened?|navigated|worked on)\b/i.test(summary) && confidence === "high") {
			const verified = storyV2.beats.some((vb) =>
				vb.actions.some((a) => a.epistemic === "verified"),
			);
			if (!verified) {
				confidence = "low";
				warnings.push("downgraded unverified action language");
			}
		}

		return {
			...b,
			summary,
			visualMeaning,
			interactionMeaning,
			spokenMeaning,
			confidence,
		};
	});

	const overallRaw = story.overallSummary;
	let overallSummary = sanitizeStoryProse(story.overallSummary);
	if (
		overallRaw !== overallSummary ||
		assertsForbiddenUpworkAction(overallRaw) ||
		assertsForbiddenRestartAction(overallRaw) ||
		assertsForbiddenSettingsAction(overallRaw)
	) {
		if (overallRaw !== overallSummary) {
			warnings.push("sanitized overallSummary against V2 guards");
		}
	}
	const unresolved = [...(story.unresolvedEvidence ?? [])];
	for (const u of storyV2.unresolved.slice(0, 8)) {
		unresolved.push({
			startSourceTimeSec: u.startSourceTimeSec,
			endSourceTimeSec: u.endSourceTimeSec,
			note: `[V2 ${u.epistemic}] ${u.text}`,
		});
	}
	for (const c of storyV2.contradictions.slice(0, 6)) {
		unresolved.push({
			startSourceTimeSec: c.startSourceTimeSec,
			endSourceTimeSec: c.endSourceTimeSec,
			note: `[V2 contradicted] ${c.claim}`,
		});
	}

	return {
		story: {
			...story,
			overallSummary,
			storyBeats: beats,
			unresolvedEvidence: unresolved.length ? unresolved : story.unresolvedEvidence,
		},
		warnings,
	};
}

/** Derive a minimal V1-compatible SourceStory from V2 when model story is absent. */
export function sourceStoryFromV2(storyV2: SourceStoryV2): SourceStory {
	return {
		sourceDurationSec: storyV2.sourceDurationSec,
		overallSummary: storyV2.mediaSummary,
		contentType: "screen_recording",
		primaryGoal: undefined,
		storyBeats: storyV2.beats.map((b, i) => ({
			id: b.id || `b${i + 1}`,
			startSourceTimeSec: b.startSourceTimeSec,
			endSourceTimeSec: b.endSourceTimeSec,
			purpose: b.purposeHint,
			summary: b.summary,
			spokenMeaning: b.spoken.map((s) => s.text).join(" / ") || undefined,
			visualMeaning: [...b.facts, ...b.context].map((x) => x.text).join(" / ") || undefined,
			interactionMeaning: undefined,
			evidence: {
				speechSegmentIds: b.evidenceRefs.speechSegmentIds,
				visualTimes: undefined,
				cursorEventTimes: undefined,
			},
			confidence: b.contradictions.length || b.actions.length ? "low" : "medium",
		})),
		unresolvedEvidence: [
			...storyV2.unresolved.map((u) => ({
				startSourceTimeSec: u.startSourceTimeSec,
				endSourceTimeSec: u.endSourceTimeSec,
				note: u.text,
			})),
			...storyV2.contradictions.map((c) => ({
				startSourceTimeSec: c.startSourceTimeSec,
				endSourceTimeSec: c.endSourceTimeSec,
				note: c.claim,
			})),
		],
	};
}

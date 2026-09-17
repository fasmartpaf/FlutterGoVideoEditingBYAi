/**
 * Professional edit transformation summary + skill consideration (product diagnostics).
 */

import type {
	CompiledIntentResultV1,
	EditorialIntentPlanV1,
} from "../autonomousProfessionalEditor";
import { buildEditingSkillRegistryV1 } from "../autonomousProfessionalEditor";
import type { ProfessionalEditOrchestratorResultV1 } from "./types";

export type TransformationBucketV1 =
	| "storyChanges"
	| "timingChanges"
	| "framingChanges"
	| "attentionChanges"
	| "visualPolishChanges"
	| "audioChanges"
	| "accessibilityChanges";

export interface ProfessionalEditTransformationSummaryV1 {
	version: 1;
	storyChanges: number;
	timingChanges: number;
	framingChanges: number;
	attentionChanges: number;
	visualPolishChanges: number;
	audioChanges: number;
	accessibilityChanges: number;
	assessmentLabel:
		| "NO_MATERIAL_IMPROVEMENT"
		| "ACCESSIBILITY_IMPROVED_ONLY"
		| "ACCESSIBILITY_AND_AUDIO_POLISH_ONLY"
		| "POLISH_IMPROVED"
		| "EDITORIALLY_IMPROVED"
		| "PROFESSIONAL_TRANSFORMATION"
		| "NEEDS_REVIEW";
}

export interface SkillConsiderationRowV1 {
	skill: string;
	considered: true;
	editoriallyUseful: boolean | null;
	supported: boolean;
	groundable: boolean;
	executionReady: boolean;
	selected: boolean;
	rejectedReason: string | null;
	desired: boolean;
	executable: boolean;
}

export function buildTransformationSummary(
	result: ProfessionalEditOrchestratorResultV1,
): ProfessionalEditTransformationSummaryV1 {
	const committed = result.session.completed.filter((c) => c.status === "committed");
	const families = new Set(
		committed.map((c) => result.plan.steps.find((s) => s.stepId === c.stepId)?.family),
	);
	if (result.loudness?.committed) families.add("loudness");
	const trims = result.document?.timeline?.trimRanges?.length ?? 0;
	const zooms = result.document?.zoomRanges?.length ?? 0;
	const speeds =
		(result.document?.timeline?.speedRanges?.length ?? 0) +
		(((result.document?.legacyEditor as { speedRegions?: unknown[] } | null)?.speedRegions
			?.length ?? 0) as number);
	if (trims === 0) families.delete("trim");
	if (zooms === 0) families.delete("zoom");
	if (speeds === 0) families.delete("speed");

	const timingChanges = [...families].filter((f) => f === "trim" || f === "speed").length;
	const attentionChanges = families.has("zoom") || families.has("callout") ? 1 : 0;
	const framingChanges = families.has("crop") ? 1 : 0;
	const audioChanges = families.has("loudness") ? 1 : 0;
	const accessibilityChanges = families.has("captions") ? 1 : 0;
	const visualPolishChanges = families.has("title") || families.has("callout") ? 1 : 0;
	const storyChanges = timingChanges > 0 || attentionChanges > 0 || visualPolishChanges > 0 ? 1 : 0;

	const qcFail = result.finalSequenceQc?.overall === "FAIL";
	let assessmentLabel: ProfessionalEditTransformationSummaryV1["assessmentLabel"] =
		"NO_MATERIAL_IMPROVEMENT";
	if (qcFail) assessmentLabel = "NEEDS_REVIEW";
	else if (
		accessibilityChanges > 0 &&
		audioChanges > 0 &&
		timingChanges === 0 &&
		attentionChanges === 0 &&
		framingChanges === 0 &&
		visualPolishChanges === 0
	) {
		assessmentLabel = "ACCESSIBILITY_AND_AUDIO_POLISH_ONLY";
	} else if (
		accessibilityChanges > 0 &&
		timingChanges === 0 &&
		attentionChanges === 0 &&
		framingChanges === 0 &&
		audioChanges === 0 &&
		visualPolishChanges === 0
	) {
		assessmentLabel = "ACCESSIBILITY_IMPROVED_ONLY";
	} else if (
		(audioChanges > 0 || accessibilityChanges > 0) &&
		timingChanges === 0 &&
		attentionChanges === 0 &&
		framingChanges === 0 &&
		visualPolishChanges === 0
	) {
		assessmentLabel = "POLISH_IMPROVED";
	} else if (timingChanges + attentionChanges + framingChanges + visualPolishChanges >= 2) {
		assessmentLabel = "PROFESSIONAL_TRANSFORMATION";
	} else if (timingChanges + attentionChanges + framingChanges + visualPolishChanges >= 1) {
		assessmentLabel = "EDITORIALLY_IMPROVED";
	}

	return {
		version: 1,
		storyChanges,
		timingChanges,
		framingChanges,
		attentionChanges,
		visualPolishChanges,
		audioChanges,
		accessibilityChanges,
		assessmentLabel,
	};
}

export function buildSkillConsiderationTable(args: {
	intentPlan: EditorialIntentPlanV1 | null | undefined;
	compiled: CompiledIntentResultV1[] | null | undefined;
}): SkillConsiderationRowV1[] {
	const registry = buildEditingSkillRegistryV1();
	const compiled = args.compiled ?? [];
	const rejected = new Map((args.intentPlan?.rejectedSkills ?? []).map((r) => [r.skill, r.reason]));
	const intentKinds = new Set((args.intentPlan?.intents ?? []).map((i) => i.kind));

	return registry.map((s) => {
		const relatedCompiled = compiled.filter((c) => s.intentKinds.includes(c.kind as never));
		const selected = relatedCompiled.some((c) => c.status === "GROUNDED");
		const desired =
			selected ||
			s.intentKinds.some((k) => intentKinds.has(k)) ||
			rejected.has(s.skill) ||
			s.intentKinds.some((k) => rejected.has(k));
		const useful =
			relatedCompiled.some((c) => c.status === "GROUNDED") ||
			(desired && s.classification === "FULL_AUTONOMOUS_PATH");
		const rejectedReason =
			rejected.get(s.skill) ??
			s.intentKinds.map((k) => rejected.get(k)).find(Boolean) ??
			relatedCompiled.find((c) => c.status === "UNSUPPORTED" || c.status === "NEEDS_EVIDENCE")
				?.reason ??
			(s.classification === "MISSING"
				? "CAPABILITY_NOT_IMPLEMENTED"
				: s.classification === "EXECUTION_ONLY"
					? "execution_only_no_autonomous_generation"
					: null);
		return {
			skill: s.skill,
			considered: true,
			editoriallyUseful: desired ? useful : null,
			supported: s.supported,
			groundable: s.classification === "FULL_AUTONOMOUS_PATH" || s.classification === "PARTIAL",
			executionReady: s.executionReady,
			selected,
			rejectedReason: selected ? null : rejectedReason,
			desired,
			executable: selected && s.executionReady,
		};
	});
}

export function formatEditorFacingReceipt(args: {
	summary: ProfessionalEditTransformationSummaryV1;
	baseText: string;
	unsupportedDesired: Array<{ skill: string; reason: string }>;
}): string {
	let text = args.baseText.trim();
	// Soften overclaim when only accessibility/audio polish
	if (
		args.summary.assessmentLabel === "ACCESSIBILITY_IMPROVED_ONLY" ||
		args.summary.assessmentLabel === "ACCESSIBILITY_AND_AUDIO_POLISH_ONLY"
	) {
		if (
			/I improved the video by enabling captions/i.test(text) &&
			!/pause|zoom|speed|crop/i.test(text)
		) {
			text = text.replace(/I improved the video by/i, "I made a light polish pass —");
		}
		if (!/not a full professional reshape/i.test(text)) {
			text +=
				" This was mainly accessibility/audio polish, not a full professional reshape of pacing or framing.";
		}
		if (
			!/play the preview|timeline tracks look the same|not as a separate timeline clip/i.test(text)
		) {
			text +=
				" Tip: captions and louder/balanced audio do not add new timeline clips — press play on the preview to hear and see them.";
		}
	}
	// CUT|DISSOLVE transitions are authorable — never claim they are unavailable.
	// Strip internal jargon if any leaked
	text = text
		.replace(/\bPEAK_LIMITED_SAFE_NORMALIZATION\b/g, "safe audio leveling")
		.replace(/\bNO_GROUNDED_FOCAL_TARGET\b/g, "no clear on-screen focus")
		.replace(/\bGROUNDED_READY\b/g, "")
		.replace(/\s{2,}/g, " ")
		.trim();
	return text;
}

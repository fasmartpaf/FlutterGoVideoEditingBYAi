/**
 * Generate bounded PlanningEvidenceRequest from Edit Plan items.
 * Only when preferred strategy / feasibility is needs_more_evidence
 * (or crop-safety genuinely required). Prefer minimum necessary investigation.
 */

import type { EditPlanItem, EditPlanV1 } from "../editPlan/types";
import type { InvestigatorRole } from "../videoInvestigator/rolePolicy/types";
import type {
	PlanningEvidenceModality,
	PlanningEvidencePriority,
	PlanningEvidenceQuestion,
	PlanningEvidenceRequest,
} from "./types";
import { itemNeedsEvidence } from "./types";

function roundRange(
	start?: number,
	end?: number,
): { startSec: number; endSec: number } | undefined {
	if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) {
		return undefined;
	}
	const a = Math.max(0, Math.min(start, end));
	const b = Math.max(start, end);
	// Bound window: prefer ±2s around beat, never whole video by default
	const pad = 2;
	return {
		startSec: Math.max(0, a - 0.25),
		endSec: Math.max(a + 0.25, Math.min(b + pad, a + 8)),
	};
}

function rolesFor(question: PlanningEvidenceQuestion): InvestigatorRole[] {
	switch (question) {
		case "identify_visual_target":
			return ["GROUNDING", "VISUAL_INSPECTION", "OCR_INSPECTION", "VERIFICATION", "STOP"];
		case "verify_cursor_target":
			return ["GROUNDING", "CURSOR_INSPECTION", "VISUAL_INSPECTION", "VERIFICATION", "STOP"];
		case "read_ui_text":
			return ["GROUNDING", "OCR_INSPECTION", "VERIFICATION", "STOP"];
		case "resolve_speech_visual_conflict":
			return [
				"GROUNDING",
				"SPEECH_INSPECTION",
				"VISUAL_INSPECTION",
				"CONTRADICTION_CHECK",
				"VERIFICATION",
				"STOP",
			];
		case "verify_temporary_state":
		case "verify_crop_safety":
			return ["GROUNDING", "VISUAL_INSPECTION", "OCR_INSPECTION", "VERIFICATION", "STOP"];
		case "verify_action":
			return ["GROUNDING", "VISUAL_INSPECTION", "CURSOR_INSPECTION", "VERIFICATION", "STOP"];
		case "verify_timing":
			return ["GROUNDING", "SPEECH_INSPECTION", "VISUAL_INSPECTION", "VERIFICATION", "STOP"];
		default:
			return ["GROUNDING", "VISUAL_INSPECTION", "VERIFICATION", "STOP"];
	}
}

function modalitiesFor(question: PlanningEvidenceQuestion): PlanningEvidenceModality[] {
	switch (question) {
		case "identify_visual_target":
			return ["visual", "ocr"];
		case "verify_cursor_target":
			return ["cursor", "visual"];
		case "read_ui_text":
			return ["ocr", "visual"];
		case "resolve_speech_visual_conflict":
			return ["speech", "visual", "comparison"];
		case "verify_temporary_state":
		case "verify_crop_safety":
			return ["visual", "comparison", "ocr"];
		case "verify_action":
			return ["visual", "cursor"];
		case "verify_timing":
			return ["speech", "visual"];
		default:
			return ["visual"];
	}
}

function classifyQuestion(item: EditPlanItem): PlanningEvidenceQuestion {
	const blob = `${item.editorialIntent} ${item.candidateStrategies.map((s) => s.rationale).join(" ")}`;
	const reqs = item.candidateStrategies.flatMap((s) => s.evidenceRequirements ?? []).join(" ");
	const text = `${blob} ${reqs}`.toLowerCase();

	if (
		/crop.?safety|underlying|overlap/.test(text) &&
		/hud|tooltip|recording|temporary/.test(text)
	) {
		return "verify_crop_safety";
	}
	if (/cursor|click/.test(text) && /target|button|control|ui/.test(text)) {
		return "verify_cursor_target";
	}
	if (/button|control|ui element|focal|publish|identify/.test(text)) {
		return "identify_visual_target";
	}
	if (/settings|opened|action|verify/.test(text) && /speech|unsupported|implication/.test(text)) {
		return "verify_action";
	}
	if (/ocr|read.*text|label/.test(text)) return "read_ui_text";
	if (/contradict|speech.?visual|mismatch/.test(text)) return "resolve_speech_visual_conflict";
	if (/temporary|tooltip|hud/.test(text)) return "verify_temporary_state";
	return "other";
}

function identityKey(
	planItemId: string,
	question: PlanningEvidenceQuestion,
	range: { startSec: number; endSec: number } | undefined,
	modalities: PlanningEvidenceModality[],
	subject: string,
): string {
	const r = range ? `${range.startSec.toFixed(2)}-${range.endSec.toFixed(2)}` : "norange";
	const m = [...modalities].sort().join(",");
	const subj = subject.toLowerCase().replace(/\s+/g, " ").slice(0, 48);
	return `${planItemId}|${question}|${r}|${m}|${subj}`;
}

function focusedMessage(
	question: PlanningEvidenceQuestion,
	range: { startSec: number; endSec: number } | undefined,
	outcome: string,
): string {
	const window = range
		? ` Focus only on SOURCE_MEDIA_TIME ~${range.startSec.toFixed(1)}–${range.endSec.toFixed(1)}s. Do not rescan the whole video.`
		: " Use the smallest relevant range only.";
	switch (question) {
		case "identify_visual_target":
		case "verify_cursor_target":
			return `Identify which UI element is the visual/cursor target near the relevant beat.${window} Required: ${outcome}`;
		case "read_ui_text":
			return `Read UI text in the bounded ROI only.${window} Required: ${outcome}`;
		case "verify_action":
			return `Verify whether the claimed action actually occurred visually.${window} Required: ${outcome}`;
		case "resolve_speech_visual_conflict":
			return `Resolve speech vs visual contradiction in the bounded range.${window} Required: ${outcome}`;
		case "verify_crop_safety":
			return `Check whether temporary recording UI overlaps essential application content (crop safety).${window} Required: ${outcome}`;
		case "verify_temporary_state":
			return `Verify temporary UI state in the bounded range.${window} Required: ${outcome}`;
		default:
			return `Gather minimum evidence for planning.${window} Required: ${outcome}`;
	}
}

/**
 * Crop-safety is the only extra request for grounded HUD plans that prefer crop.
 */
function cropSafetyNeeded(item: EditPlanItem): boolean {
	if (item.preferredStrategy !== "crop") return false;
	return /temporary|HUD|recording|tooltip/i.test(item.editorialIntent);
}

export function generateEvidenceRequests(
	plan: EditPlanV1,
	opts?: { maxRequests?: number },
): PlanningEvidenceRequest[] {
	const max = opts?.maxRequests ?? 3;
	const out: PlanningEvidenceRequest[] = [];
	let seq = 0;

	const candidates = plan.items.filter((item) => itemNeedsEvidence(item) || cropSafetyNeeded(item));

	// Sort by priority
	const rank = { critical: 4, high: 3, medium: 2, low: 1 };
	candidates.sort((a, b) => rank[b.priority] - rank[a.priority] || a.id.localeCompare(b.id));

	for (const item of candidates) {
		if (out.length >= max) break;

		// Already-grounded HUD trim/preserve: skip unless crop safety
		if (!itemNeedsEvidence(item) && !cropSafetyNeeded(item)) {
			continue;
		}

		const question = itemNeedsEvidence(item) ? classifyQuestion(item) : "verify_crop_safety";

		// Do not chase Upwork as a workflow
		if (/upwork/i.test(item.editorialIntent) && question !== "verify_crop_safety") {
			continue;
		}

		const range = roundRange(
			item.evidenceRange?.startSourceTimeSec,
			item.evidenceRange?.endSourceTimeSec,
		);
		const modalities = modalitiesFor(question);
		const roles = rolesFor(question);
		const outcome =
			item.candidateStrategies
				.find((s) => s.evidenceRequirements?.length)
				?.evidenceRequirements?.join("; ") ??
			(question === "verify_crop_safety"
				? "determine if crop would damage essential content"
				: "establish or refute the missing evidence for this plan item");
		const subject = item.editorialIntent.slice(0, 80);
		const key = identityKey(item.id, question, range, modalities, subject);
		seq += 1;
		const id = `pev_${seq}`;
		const priority = item.priority as PlanningEvidencePriority;

		out.push({
			id,
			identityKey: key,
			planItemId: item.id,
			gapIds: [...item.gapIds],
			question,
			sourceRange: range,
			modalitiesNeeded: modalities,
			investigatorRoles: roles,
			requiredOutcome: outcome,
			provenanceRefs: [...item.provenanceRefs],
			priority,
			focusedUserMessage: focusedMessage(question, range, outcome),
		});
	}

	return out;
}

export function requestIdentityKey(req: PlanningEvidenceRequest): string {
	return req.identityKey;
}

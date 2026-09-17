/**
 * Crop restraint — never equate crop with zoom.
 */

import type { CropDecisionV1, GroundedEditorialFocalTargetV1 } from "./types";

export function decideCrop(args: {
	targets: GroundedEditorialFocalTargetV1[];
	/** Explicit aspect/framing requirement from caller (e.g. vertical export). */
	aspectFramingRequired?: boolean;
}): CropDecisionV1 {
	const grounded = args.targets.find((t) => t.status === "GROUNDED");
	if (!args.aspectFramingRequired) {
		return {
			decision: "NO_CROP_RECOMMENDED",
			reasonCode: "NO_ASPECT_FRAMING_REASON",
			targetId: grounded?.targetId ?? null,
			notes: ["crop_requires_separate_framing_reason"],
		};
	}
	if (!grounded) {
		return {
			decision: "NO_CROP_RECOMMENDED",
			reasonCode: "STATUS_NOT_GROUNDED",
			targetId: null,
			notes: ["no_grounded_target_for_crop"],
		};
	}
	const ambiguous = args.targets.find(
		(t) => t.status === "AMBIGUOUS" || t.status === "CONFLICTING",
	);
	if (ambiguous) {
		return {
			decision: "NO_CROP_RECOMMENDED",
			reasonCode: "AMBIGUOUS_TARGET",
			targetId: ambiguous.targetId,
			notes: [],
		};
	}
	return {
		decision: "CROP_ELIGIBLE",
		reasonCode: "FRAMING_REQUIRED",
		targetId: grounded.targetId,
		notes: ["aspect_framing_with_grounded_target"],
	};
}

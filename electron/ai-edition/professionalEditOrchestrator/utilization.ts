/**
 * Capability utilization diagnostic — considered vs skipped vs committed.
 */

import type { EditFamily } from "./types";

export interface CapabilityUtilizationRowV1 {
	family: EditFamily;
	available: boolean;
	evidenceFound: boolean;
	editoriallyUseful: boolean;
	parametersGrounded: boolean;
	safeToApply: boolean;
	attempted: boolean;
	committed: boolean;
	skippedReason: string | null;
}

export interface ProfessionalEditCapabilityUtilizationV1 {
	version: 1;
	invariant: "MORE_EDITS_NE_MORE_PROFESSIONAL";
	rows: CapabilityUtilizationRowV1[];
}

const FAMILIES: EditFamily[] = [
	"trim",
	"zoom",
	"crop",
	"speed",
	"captions",
	"loudness",
	"title",
	"callout",
];

export function emptyUtilization(): ProfessionalEditCapabilityUtilizationV1 {
	return {
		version: 1,
		invariant: "MORE_EDITS_NE_MORE_PROFESSIONAL",
		rows: FAMILIES.map((family) => ({
			family,
			available: family !== "crop" && family !== "speed",
			evidenceFound: false,
			editoriallyUseful: false,
			parametersGrounded: false,
			safeToApply: false,
			attempted: false,
			committed: false,
			skippedReason: "not_considered_yet",
		})),
	};
}

export function upsertUtilization(
	util: ProfessionalEditCapabilityUtilizationV1,
	family: EditFamily,
	patch: Partial<CapabilityUtilizationRowV1>,
): void {
	const row = util.rows.find((r) => r.family === family);
	if (!row) return;
	Object.assign(row, patch);
	if (patch.skippedReason === undefined && patch.committed) {
		row.skippedReason = null;
	}
}

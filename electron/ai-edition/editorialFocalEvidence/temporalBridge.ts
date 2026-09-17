/**
 * Index focal evidence/targets into Temporal Context Store via references.
 */

import type { TemporalContextRecordV1 } from "../temporalContextStore/types";
import type {
	EditorialFocalAnalysisBundleV1,
	EditorialFocalEvidenceV1,
	GroundedEditorialFocalTargetV1,
} from "./types";

export function focalEvidenceToTemporalRecords(args: {
	bundle: EditorialFocalAnalysisBundleV1;
	mediaFingerprint: string;
	programmeFingerprint?: string;
	now?: string;
}): TemporalContextRecordV1[] {
	const now = args.now ?? new Date().toISOString();
	const out: TemporalContextRecordV1[] = [];

	for (const e of args.bundle.evidence) {
		out.push(evidenceToRecord(e, args.mediaFingerprint, args.programmeFingerprint, now));
	}
	for (const t of args.bundle.targets) {
		if (t.status === "NO_TARGET") continue;
		out.push(targetToRecord(t, args.mediaFingerprint, args.programmeFingerprint, now));
	}
	return out;
}

function evidenceToRecord(
	e: EditorialFocalEvidenceV1,
	mediaFingerprint: string,
	programmeFingerprint: string | undefined,
	now: string,
): TemporalContextRecordV1 {
	return {
		id: `tcs_${e.id}`,
		kind: "EDITORIAL_FOCAL_EVIDENCE",
		sourceRange: { ...e.sourceRange },
		confidence: e.confidence,
		status: "CURRENT",
		provenance: {
			module: e.provenance.module,
			evidenceId: e.id,
			version: e.provenance.version,
			observedOrDerived: e.epistemic,
		},
		payloadRef: e.payloadRef ?? e.id,
		normalizedSummary: `Focal evidence ${e.kind}`,
		internalCode: e.kind,
		mediaFingerprint,
		programmeFingerprint,
		createdAt: now,
		updatedAt: now,
		privacy: "SAFE_STRUCTURED",
		epistemic: e.epistemic,
	};
}

function targetToRecord(
	t: GroundedEditorialFocalTargetV1,
	mediaFingerprint: string,
	programmeFingerprint: string | undefined,
	now: string,
): TemporalContextRecordV1 {
	return {
		id: `tcs_${t.targetId}`,
		kind: "EDITORIAL_FOCAL_TARGET",
		sourceRange: { ...t.sourceRange },
		programmeRanges: t.programmeRanges,
		confidence: t.confidence,
		status: "CURRENT",
		provenance: {
			module: "editorialFocalEvidence",
			evidenceId: t.targetId,
			version: "v1",
			observedOrDerived: "DERIVED",
		},
		payloadRef: t.targetId,
		normalizedSummary: `Focal target ${t.status}:${t.reasonCode}`,
		internalCode: t.status,
		mediaFingerprint,
		programmeFingerprint,
		createdAt: now,
		updatedAt: now,
		privacy: "SAFE_STRUCTURED",
		epistemic: "DERIVED",
	};
}

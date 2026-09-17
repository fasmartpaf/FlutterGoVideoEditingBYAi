/**
 * Final-sequence warning disposition — classify, do not hide.
 */

export type FinalSequenceWarningDispositionKind =
	| "ACCEPTABLE_INTENTIONAL"
	| "ACTIONABLE_EXISTING_CAPABILITY"
	| "INSUFFICIENT_EVIDENCE"
	| "NEEDS_USER_REVIEW";

export interface FinalSequenceWarningDispositionV1 {
	warning: string;
	joinId: string | null;
	disposition: FinalSequenceWarningDispositionKind;
	notes: string;
}

export function disposeFinalSequenceWarning(
	warning: string,
	joinId: string | null = null,
): FinalSequenceWarningDispositionV1 {
	const w = warning.toLowerCase();
	if (/intentional|hard.?cut|visual_discontinuity|expected_cut|acceptable_discontinuity/.test(w)) {
		return {
			warning,
			joinId,
			disposition: "ACCEPTABLE_INTENTIONAL",
			notes: "Hard visual cut treated as intentional under verifier policy",
		};
	}
	if (
		/no_pcm_provider|no_compositor_frames|preservation_evidence_unavailable|insufficient|unknown|missing_/.test(
			w,
		)
	) {
		return {
			warning,
			joinId,
			disposition: "INSUFFICIENT_EVIDENCE",
			notes: "Verifier lacked optional modality input; not a join failure",
		};
	}
	if (/caption|loudness|gain|trim_overlap/.test(w)) {
		return {
			warning,
			joinId,
			disposition: "ACTIONABLE_EXISTING_CAPABILITY",
			notes: "May be addressable by an existing verified family",
		};
	}
	return {
		warning,
		joinId,
		disposition: "NEEDS_USER_REVIEW",
		notes: "Unclassified warning",
	};
}

export function disposeFinalSequenceResult(args: {
	joins: Array<{ joinId: string; warnings: string[] }>;
}): FinalSequenceWarningDispositionV1[] {
	const out: FinalSequenceWarningDispositionV1[] = [];
	for (const j of args.joins) {
		for (const w of j.warnings) {
			out.push(disposeFinalSequenceWarning(w, j.joinId));
		}
	}
	return out;
}

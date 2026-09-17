/**
 * Bridge for Source Story V2 consumption of promoted claims.
 * Prefer typed SourceStoryEvidenceInput via buildSourceStoryEvidenceInput;
 * this summary helper remains for lightweight prompt dumps.
 */

import type { ClaimPromotionSet, SourceStoryClaimBridge } from "./types";

export function buildSourceStoryClaimBridge(set: ClaimPromotionSet): SourceStoryClaimBridge {
	const promotedSummaries: string[] = [];
	const unresolvedSummaries: string[] = [];
	const contradictionSummaries: string[] = [];

	for (const c of set.claims) {
		const line = `[${c.status}/${c.verificationLevel}] ${c.text}`;
		if (c.status === "contradicted") {
			contradictionSummaries.push(line);
			continue;
		}
		if (
			c.status === "supported" ||
			c.status === "verified" ||
			c.status === "observed" ||
			c.status === "spoken"
		) {
			if (c.isActionClaim && c.status !== "verified") {
				unresolvedSummaries.push(line);
			} else {
				promotedSummaries.push(line);
			}
			continue;
		}
		unresolvedSummaries.push(line);
	}

	return {
		promotedSummaries: promotedSummaries.slice(0, 32),
		unresolvedSummaries: unresolvedSummaries.slice(0, 32),
		contradictionSummaries: contradictionSummaries.slice(0, 16),
	};
}

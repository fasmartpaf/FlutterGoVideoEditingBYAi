/**
 * Rank opportunities — material improvement × evidence × readiness × preservation.
 * No effect quotas.
 */

import { PLANNER_POLICY_V1 } from "./policy";
import type { ProfessionalEditorialOpportunityV1 } from "./types";

export function rankOpportunities(
	opportunities: ProfessionalEditorialOpportunityV1[],
): ProfessionalEditorialOpportunityV1[] {
	return [...opportunities].sort((a, b) => {
		const score = (o: ProfessionalEditorialOpportunityV1) => {
			const material = o.generationStatus === "GROUNDED_READY" ? 1 : 0;
			const evidence = o.confidence === "HIGH" ? 1 : o.confidence === "MEDIUM" ? 0.6 : 0.2;
			const readiness = o.executionReadiness === "READY" ? 1 : 0;
			const preservation =
				o.preservationStatus === "SAFE" ? 1 : o.preservationStatus === "RISKY" ? 0.3 : 0;
			return (
				material * PLANNER_POLICY_V1.rankWeights.material +
				evidence * PLANNER_POLICY_V1.rankWeights.evidence +
				readiness * PLANNER_POLICY_V1.rankWeights.readiness +
				preservation * PLANNER_POLICY_V1.rankWeights.preservation +
				o.rankScore * 0.1
			);
		};
		return score(b) - score(a);
	});
}

export function selectReadyOpportunities(
	ranked: ProfessionalEditorialOpportunityV1[],
	maxOps = PLANNER_POLICY_V1.maxOpsFromPlanner,
): ProfessionalEditorialOpportunityV1[] {
	const ready = ranked.filter(
		(o) => o.generationStatus === "GROUNDED_READY" && o.executionReadiness === "READY",
	);
	/** Timeline-visible families before captions — captions must not starve cuts/zooms/speed. */
	const familyPriority = (family: string): number => {
		switch (family) {
			case "TRIM":
				return 0;
			case "ZOOM":
				return 1;
			case "SPEED":
				return 2;
			case "TITLE":
				return 3;
			case "CALLOUT":
				return 4;
			case "CROP":
				return 5;
			case "CAPTIONS":
				return 9;
			default:
				return 6;
		}
	};
	const ordered = [...ready].sort((a, b) => {
		const fp = familyPriority(a.family) - familyPriority(b.family);
		if (fp !== 0) return fp;
		return (b.rankScore ?? 0) - (a.rankScore ?? 0);
	});
	const out: ProfessionalEditorialOpportunityV1[] = [];
	const seen = new Set<string>();
	const selectedRanges: Array<{ family: string; startSec: number; endSec: number }> = [];
	const rangeOf = (o: ProfessionalEditorialOpportunityV1) => {
		const r = o.sourceRange;
		if (r && typeof r.startSec === "number" && typeof r.endSec === "number") {
			return { startSec: r.startSec, endSec: r.endSec };
		}
		const d = o.derivedParameters as Record<string, unknown>;
		const start = Number(d.startSec ?? d.startSourceTimeSec);
		const end = Number(d.endSec ?? d.endSourceTimeSec);
		if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
			return { startSec: start, endSec: end };
		}
		return null;
	};
	const overlaps = (
		a: { startSec: number; endSec: number },
		b: { startSec: number; endSec: number },
	) => Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));

	for (const o of ordered) {
		if (out.length >= maxOps) break;
		// Loudness executes outside the plan step list.
		if (o.family === "LOUDNESS") continue;
		if (
			seen.has(o.family) &&
			(o.family === "CAPTIONS" || o.family === "CROP" || o.family === "TITLE")
		)
			continue;

		const range = rangeOf(o);
		if (range) {
			// Temporal collision: trim+speed (or overlapping speeds) on same quiet.
			const conflict = selectedRanges.some((s) => {
				const ov = overlaps(range, s);
				const fracA = ov / Math.max(1e-6, range.endSec - range.startSec);
				const fracB = ov / Math.max(1e-6, s.endSec - s.startSec);
				if (fracA < 0.2 && fracB < 0.2) return false;
				if (o.family === "SPEED" && s.family === "TRIM") return true;
				if (o.family === "TRIM" && s.family === "SPEED") return true;
				if (o.family === "SPEED" && s.family === "SPEED") return true;
				return false;
			});
			if (conflict) continue;
			selectedRanges.push({ family: o.family, ...range });
		}

		seen.add(o.family);
		out.push(o);
	}
	return out;
}

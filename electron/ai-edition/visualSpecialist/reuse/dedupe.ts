/**
 * Perceptual redundancy filter — clean-room adapt of watch-video `dedupe`.
 * Hash similarity is a signal, not semantic truth. Protected candidates are kept.
 * @see reuse/NOTICE.md
 */

import { DEFAULT_DEDUP_HAMMING } from "./constants";
import { type DHash, hammingDistance } from "./dhash";

export interface DedupeCandidate {
	id: string;
	sourceTimeSec: number;
	/** Optional image path for hashing; if absent, never dropped by hash. */
	imagePath?: string;
	hash?: DHash;
	/**
	 * When true, never remove for hash proximity (ROI / interaction / Investigator picks).
	 */
	protected?: boolean;
	reason: string;
}

export interface DedupeResult {
	kept: DedupeCandidate[];
	dropped: Array<DedupeCandidate & { droppedBecause: string; neighborId?: string }>;
	beforeCount: number;
	afterCount: number;
}

/**
 * Chronological pass: drop near-duplicates vs last *kept* hash when hamming &lt; distance.
 * Protected frames always keep and may update the last-hash anchor.
 */
export function dedupeByDhash(
	candidates: DedupeCandidate[],
	options?: { distance?: number; maxKeep?: number },
): DedupeResult {
	const distance = options?.distance ?? DEFAULT_DEDUP_HAMMING;
	const sorted = [...candidates].sort(
		(a, b) => a.sourceTimeSec - b.sourceTimeSec || a.id.localeCompare(b.id),
	);
	const kept: DedupeCandidate[] = [];
	const dropped: DedupeResult["dropped"] = [];
	let lastHash: DHash | null = null;
	let lastKeptId: string | undefined;

	for (const c of sorted) {
		if (c.protected || c.hash === undefined) {
			kept.push(c);
			if (c.hash !== undefined) {
				lastHash = c.hash;
				lastKeptId = c.id;
			}
			continue;
		}
		if (lastHash !== null && hammingDistance(c.hash, lastHash) < distance) {
			dropped.push({
				...c,
				droppedBecause: `dhash_hamming<${distance}`,
				neighborId: lastKeptId,
			});
			continue;
		}
		kept.push(c);
		lastHash = c.hash;
		lastKeptId = c.id;
	}

	let finalKept = kept;
	const maxKeep = options?.maxKeep;
	if (typeof maxKeep === "number" && maxKeep >= 1 && finalKept.length > maxKeep) {
		const protectedOnes = finalKept.filter((c) => c.protected);
		const rest = finalKept.filter((c) => !c.protected);
		const slots = Math.max(0, maxKeep - protectedOnes.length);
		if (slots <= 0) {
			finalKept = protectedOnes.slice(0, maxKeep);
		} else if (rest.length > slots) {
			const idx = new Set<number>();
			if (slots === 1) idx.add(0);
			else {
				for (let i = 0; i < slots; i++) {
					idx.add(Math.round((i * (rest.length - 1)) / (slots - 1)));
				}
			}
			const thinned = rest.filter((_, i) => idx.has(i));
			for (const c of rest) {
				if (!idx.has(rest.indexOf(c))) {
					// handled below via set
				}
			}
			const keepRest = new Set(thinned.map((c) => c.id));
			for (const c of rest) {
				if (!keepRest.has(c.id)) {
					dropped.push({ ...c, droppedBecause: "max_keep_thinning" });
				}
			}
			finalKept = [...protectedOnes, ...thinned].sort(
				(a, b) => a.sourceTimeSec - b.sourceTimeSec || a.id.localeCompare(b.id),
			);
		}
	}

	return {
		kept: finalKept,
		dropped,
		beforeCount: candidates.length,
		afterCount: finalKept.length,
	};
}

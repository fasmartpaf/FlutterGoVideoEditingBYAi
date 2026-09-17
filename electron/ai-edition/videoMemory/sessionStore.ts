/**
 * Session store for source-asset memory reuse across turns.
 * Programme-derived state is versioned separately and invalidated on fingerprint change.
 */

import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import type { ClaimPromotionSet } from "../claimPromotion/types";
import type { SourceStoryV2 } from "../sourceStory/v2/types";
import type { TemporalEventLedger } from "../temporalEventLedger/types";
import {
	fingerprintProgramme,
	fingerprintSourceAsset,
	type VideoMemoryV1,
	validateVideoMemory,
} from "./index";

export type SourceAssetMemoryBundle = {
	documentId: string;
	assetId: string;
	sourceFingerprint: string;
	ledger: TemporalEventLedger | null;
	claims: ClaimPromotionSet | null;
	/** Last known Source Story while programme fingerprint matched. */
	sourceStoryV2: SourceStoryV2 | null;
	programmeFingerprintWhenStoryBuilt: string | null;
	memory: VideoMemoryV1;
	turnCount: number;
	lastQueryClass: string | null;
	storedAtIso: string;
};

export type VideoMemorySessionStore = {
	get: (
		documentId: string,
		assetId: string,
		document: AxcutDocument,
	) => SourceAssetMemoryBundle | null;
	put: (bundle: SourceAssetMemoryBundle) => void;
	invalidateDocument: (documentId: string) => void;
	size: () => number;
};

/**
 * Speech / general turns may not recompute Source Story. Do not overwrite a
 * still-valid cached story with null — that was wiping programmeMemoryHit on
 * the next turn (Promotion Gate P2→P3).
 */
export function mergeProgrammeStoryForPut(input: {
	computedStory: SourceStoryV2 | null | undefined;
	cached: SourceAssetMemoryBundle | null;
	programmeFingerprintNow: string;
}): { sourceStoryV2: SourceStoryV2 | null; programmeFingerprintWhenStoryBuilt: string | null } {
	if (input.computedStory) {
		return {
			sourceStoryV2: input.computedStory,
			programmeFingerprintWhenStoryBuilt: input.programmeFingerprintNow,
		};
	}
	if (
		input.cached?.sourceStoryV2 &&
		input.cached.programmeFingerprintWhenStoryBuilt === input.programmeFingerprintNow
	) {
		return {
			sourceStoryV2: input.cached.sourceStoryV2,
			programmeFingerprintWhenStoryBuilt: input.cached.programmeFingerprintWhenStoryBuilt,
		};
	}
	return { sourceStoryV2: null, programmeFingerprintWhenStoryBuilt: null };
}

export function createVideoMemorySessionStore(): VideoMemorySessionStore {
	const byKey = new Map<string, SourceAssetMemoryBundle>();
	const key = (documentId: string, assetId: string) => `${documentId}::${assetId}`;

	return {
		get(documentId, assetId, document) {
			const e = byKey.get(key(documentId, assetId));
			if (!e) return null;
			const sourceNow = fingerprintSourceAsset(document, assetId);
			if (e.sourceFingerprint !== sourceNow) {
				byKey.delete(key(documentId, assetId));
				return null;
			}
			const validity = validateVideoMemory(e.memory, document);
			if (!validity.sourceReusable) {
				byKey.delete(key(documentId, assetId));
				return null;
			}
			// Programme may be stale — caller must drop story/plan but can keep ledger.
			return {
				...e,
				sourceStoryV2:
					validity.programmeCurrent &&
					e.programmeFingerprintWhenStoryBuilt === fingerprintProgramme(document)
						? e.sourceStoryV2
						: null,
				programmeFingerprintWhenStoryBuilt: validity.programmeCurrent
					? e.programmeFingerprintWhenStoryBuilt
					: null,
			};
		},
		put(bundle) {
			byKey.set(key(bundle.documentId, bundle.assetId), bundle);
		},
		invalidateDocument(documentId) {
			for (const k of [...byKey.keys()]) {
				if (k.startsWith(`${documentId}::`)) byKey.delete(k);
			}
		},
		size() {
			return byKey.size;
		},
	};
}

/** Module-level store for Electron process lifetime (tests may replace). */
let defaultSessionStore: VideoMemorySessionStore | null = null;

export function getDefaultVideoMemorySessionStore(): VideoMemorySessionStore {
	if (!defaultSessionStore) defaultSessionStore = createVideoMemorySessionStore();
	return defaultSessionStore;
}

export function _resetVideoMemorySessionStoreForTests(): void {
	defaultSessionStore = createVideoMemorySessionStore();
}

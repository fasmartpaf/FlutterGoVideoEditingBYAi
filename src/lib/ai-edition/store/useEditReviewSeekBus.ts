/**
 * Seek bus for Edit Review “Review section” — programme/timeline seconds.
 * NewEditorShell subscribes and calls handleSeek; no document mutation.
 */

import { create } from "zustand";

interface EditReviewSeekBusState {
	pendingSec: number | null;
	requestId: number;
	seekToProgrammeSec: (sec: number) => void;
	consume: () => void;
}

export const useEditReviewSeekBus = create<EditReviewSeekBusState>((set, get) => ({
	pendingSec: null,
	requestId: 0,
	seekToProgrammeSec: (sec) => set({ pendingSec: sec, requestId: get().requestId + 1 }),
	consume: () => set({ pendingSec: null }),
}));

/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const applyPreviewRun = vi.fn();

vi.mock("@/native/client", () => ({
	nativeBridgeClient: {
		aiEdition: {
			applyPreviewRun: (...args: unknown[]) => applyPreviewRun(...args),
		},
	},
}));

vi.mock("@/lib/ai-edition/store/projectStore", () => {
	const document = {
		schemaVersion: 7,
		project: { id: "p", primaryAssetId: "a" },
		timeline: { clips: [], trimRanges: [] },
		assets: [],
	};
	const state = { document };
	const useProjectStore = Object.assign((sel: (s: typeof state) => unknown) => sel(state), {
		getState: () => state,
	});
	return { useProjectStore };
});

vi.mock("@/lib/ai-edition/store/useEditReviewSeekBus", () => ({
	useEditReviewSeekBus: (sel: (s: { seekToProgrammeSec: () => void }) => unknown) =>
		sel({ seekToProgrammeSec: () => undefined }),
}));

vi.mock("@/lib/ai-edition/store/agentDocumentApply", () => ({
	applyAgentDocumentIfCurrent: vi.fn(async () => "applied"),
}));

import { EditReviewCardView } from "./EditReviewCard";

const readyCard = {
	proposalId: "prop_1",
	title: "Shorten a quiet pause",
	explanation: "OpenScreen found a 3-second pause with no protected speech.",
	changeSummary: "Remove about 3 seconds of quiet pause.",
	reasonSummary: "silence",
	affectedRange: {
		label: "5.0s–8.0s of the source recording",
		startSourceSec: 5,
		endSourceSec: 8,
		durationSec: 3,
	},
	preserves: ["The corrected Effects explanation"],
	risks: [],
	readiness: "ready" as const,
	capabilityLabel: "Shorten a pause",
	canApply: true,
	consentScope: "single_proposal_preview" as const,
	documentFingerprint: "fp",
};

const blockedCard = {
	...readyCard,
	proposalId: "prop_blocked",
	title: "No safe edit found",
	canApply: false,
	readiness: "blocked" as const,
	blockedReason: "There isn’t a safe edit OpenScreen can offer for this situation.",
	preserves: [],
};

afterEach(() => {
	cleanup();
	applyPreviewRun.mockReset();
});

describe("EditReviewCardView", () => {
	it("ready card shows Apply; Keep as is does not call apply IPC", () => {
		render(<EditReviewCardView card={readyCard} editProposalV1={{}} />);
		expect(screen.getByTestId("edit-review-apply")).toBeTruthy();
		expect(screen.getByText(/Will keep/i)).toBeTruthy();
		fireEvent.click(screen.getByTestId("edit-review-dismiss"));
		expect(screen.getByTestId("edit-review-result").textContent).toMatch(/Kept as is/i);
		expect(applyPreviewRun).not.toHaveBeenCalled();
	});

	it("blocked card has no Apply", () => {
		render(<EditReviewCardView card={blockedCard} editProposalV1={{}} />);
		expect(screen.queryByTestId("edit-review-apply")).toBeNull();
		expect(screen.getByTestId("edit-review-blocked")).toBeTruthy();
	});

	it("Apply calls applyPreviewRun (not executeAgentTool)", async () => {
		applyPreviewRun.mockResolvedValue({
			success: true,
			phase: "verified",
			mutationsApplied: 1,
			document: { schemaVersion: 7 },
			userMessage: "Edit applied and checked",
			detailMessage: "ok",
			warnings: [],
			additionalModelCalls: 0,
			latencyMs: { preflightMs: 1, consentMintMs: 1, applyVerifyMs: 1, totalMs: 3 },
		});
		render(<EditReviewCardView card={readyCard} editProposalV1={{ version: 1 }} />);
		fireEvent.click(screen.getByTestId("edit-review-apply"));
		await screen.findByTestId("edit-review-result");
		expect(applyPreviewRun).toHaveBeenCalledTimes(1);
		expect(applyPreviewRun.mock.calls[0]?.[0]).toMatchObject({
			selectedProposalId: "prop_1",
			proposalDocumentFingerprint: "fp",
		});
	});
});

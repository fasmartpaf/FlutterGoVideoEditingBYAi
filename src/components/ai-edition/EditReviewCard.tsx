/**
 * UI Consent Surface V1 — chat-embedded edit review card.
 * Typed proposal/preflight only — never parses assistant prose for Apply.
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { projectRawTimelineSecToPlayback } from "@/lib/ai-edition/document/timeline";
import { applyAgentDocumentIfCurrent } from "@/lib/ai-edition/store/agentDocumentApply";
import { useProjectStore } from "@/lib/ai-edition/store/projectStore";
import { useEditReviewSeekBus } from "@/lib/ai-edition/store/useEditReviewSeekBus";
import { nativeBridgeClient } from "@/native/client";
import type { AiEditionChatResult } from "@/native/contracts";
import styles from "./EditReviewCard.module.css";

type ReviewCard = NonNullable<AiEditionChatResult["editReview"]>["cards"][number];

export type EditReviewUiPhase =
	| "idle"
	| "applying"
	| "verified"
	| "verified_with_warning"
	| "rolled_back"
	| "apply_failed"
	| "rejected"
	| "stale_blocked";

export function EditReviewCardView({
	card,
	editProposalV1,
	onTerminal,
}: {
	card: ReviewCard;
	editProposalV1: unknown;
	/** Fired once when apply finishes or user dismisses — parent may clear pending apply. */
	onTerminal?: (phase: EditReviewUiPhase) => void;
}) {
	const [phase, setPhase] = useState<EditReviewUiPhase>("idle");
	const [detail, setDetail] = useState<string | undefined>();
	const [warnings, setWarnings] = useState<string[]>([]);
	const applyingRef = useRef(false);
	const seekToProgrammeSec = useEditReviewSeekBus((s) => s.seekToProgrammeSec);
	const document = useProjectStore((s) => s.document);

	const reviewSection = useCallback(() => {
		if (!card.affectedRange || !document) return;
		const programmeSec = projectRawTimelineSecToPlayback(
			document.timeline.clips,
			document.timeline.trimRanges,
			card.affectedRange.startSourceSec,
		);
		seekToProgrammeSec(programmeSec);
	}, [card.affectedRange, document, seekToProgrammeSec]);

	const dismiss = useCallback(() => {
		setPhase("rejected");
		onTerminal?.("rejected");
		console.info("[ui-consent] user_rejected", { proposalId: card.proposalId });
	}, [card.proposalId, onTerminal]);

	const apply = useCallback(async () => {
		if (!card.canApply || applyingRef.current) return;
		if (phase !== "idle" && phase !== "stale_blocked") return;
		applyingRef.current = true;
		setPhase("applying");
		setDetail("Applying and checking the edit…");
		console.info("[ui-consent] user_approved", { proposalId: card.proposalId });

		try {
			const liveDoc = useProjectStore.getState().document;
			if (!liveDoc) {
				setPhase("apply_failed");
				setDetail("The edit could not be applied. Your project was not changed.");
				onTerminal?.("apply_failed");
				return;
			}

			const result = await nativeBridgeClient.aiEdition.applyPreviewRun({
				document: liveDoc,
				editProposalV1,
				selectedProposalId: card.proposalId,
				proposalDocumentFingerprint: card.documentFingerprint,
			});

			setWarnings(result.warnings ?? []);
			setDetail(result.detailMessage);

			if (result.stale || result.phase === "stale_blocked") {
				setPhase("stale_blocked");
				setDetail(
					result.detailMessage ??
						"The project changed since this edit was proposed. OpenScreen needs to review it again before applying.",
				);
				console.info("[ui-consent] stale", { proposalId: card.proposalId });
				onTerminal?.("stale_blocked");
				return;
			}

			if (result.success && result.document) {
				const applyResult = await applyAgentDocumentIfCurrent(result.document);
				if (applyResult === "save-failed") {
					setPhase("apply_failed");
					setDetail("The edit could not be saved. Your project was not changed.");
					toast.error("Could not save the verified edit");
					onTerminal?.("apply_failed");
					return;
				}
				if (applyResult === "conflict") {
					toast.warning("Project changed while applying — open the edit again if needed.");
					setPhase("stale_blocked");
					onTerminal?.("stale_blocked");
					return;
				}
				const nextPhase: EditReviewUiPhase =
					result.phase === "verified_with_warning" ? "verified_with_warning" : "verified";
				setPhase(nextPhase);
				console.info("[ui-consent] verified", {
					proposalId: card.proposalId,
					phase: nextPhase,
				});
				onTerminal?.(nextPhase);
				return;
			}

			if (result.phase === "rolled_back") {
				setPhase("rolled_back");
				console.info("[ui-consent] rolled_back", {
					proposalId: card.proposalId,
					verificationStatus: result.verificationStatus,
				});
				onTerminal?.("rolled_back");
				return;
			}

			setPhase("apply_failed");
			console.info("[ui-consent] apply_failed", { proposalId: card.proposalId });
			onTerminal?.("apply_failed");
		} catch (err) {
			setPhase("apply_failed");
			setDetail(
				err instanceof Error
					? err.message
					: "The edit could not be applied. Your project was not changed.",
			);
			onTerminal?.("apply_failed");
		} finally {
			applyingRef.current = false;
		}
	}, [card, editProposalV1, onTerminal, phase]);

	const showActions = phase === "idle" || phase === "stale_blocked";
	const terminal = phase !== "idle" && phase !== "applying";

	return (
		<section
			className={styles.card}
			data-testid="edit-review-card"
			data-readiness={card.readiness}
			data-phase={phase}
			data-can-apply={card.canApply ? "true" : "false"}
			aria-label={card.title}
		>
			<header className={styles.header}>
				<span className={styles.kicker}>{card.capabilityLabel}</span>
				<h3 className={styles.title}>{card.title}</h3>
			</header>

			<p className={styles.explanation}>{card.explanation}</p>

			{card.affectedRange ? (
				<div className={styles.section}>
					<div className={styles.sectionLabel}>Proposed change</div>
					<p className={styles.change}>{card.changeSummary}</p>
					<p className={styles.range}>{card.affectedRange.label}</p>
					{document ? (
						<button type="button" className={styles.linkBtn} onClick={reviewSection}>
							Review section
						</button>
					) : null}
				</div>
			) : null}

			{card.preserves.length > 0 ? (
				<div className={styles.section}>
					<div className={styles.sectionLabel}>Will keep</div>
					<ul className={styles.list}>
						{card.preserves.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>
			) : null}

			{card.risks.length > 0 && card.canApply ? (
				<div className={styles.section}>
					<div className={styles.sectionLabel}>Note</div>
					<ul className={styles.risks}>
						{card.risks.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>
			) : null}

			{card.blockedReason && !card.canApply ? (
				<p className={styles.blocked} data-testid="edit-review-blocked">
					{card.blockedReason}
				</p>
			) : null}

			{phase === "applying" ? (
				<p className={styles.progress} data-testid="edit-review-progress">
					{detail ?? "Applying and checking the edit…"}
				</p>
			) : null}

			{terminal ? (
				<div
					className={
						phase === "verified" || phase === "verified_with_warning"
							? styles.resultOk
							: styles.resultBad
					}
					data-testid="edit-review-result"
				>
					<strong>
						{phase === "verified"
							? "Edit applied and checked"
							: phase === "verified_with_warning"
								? "Edit applied with a warning"
								: phase === "rolled_back"
									? "Edit wasn’t kept"
									: phase === "rejected"
										? "Kept as is"
										: phase === "stale_blocked"
											? "Needs another look"
											: "The edit could not be applied"}
					</strong>
					{detail ? <p>{detail}</p> : null}
					{warnings.length > 0 ? (
						<ul className={styles.risks}>
							{warnings.map((w) => (
								<li key={w}>{w}</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}

			{showActions && card.canApply ? (
				<div className={styles.actions}>
					<button
						type="button"
						className={styles.apply}
						data-testid="edit-review-apply"
						onClick={() => void apply()}
					>
						Apply edit
					</button>
					<button
						type="button"
						className={styles.dismiss}
						data-testid="edit-review-dismiss"
						onClick={dismiss}
					>
						Keep as is
					</button>
				</div>
			) : null}

			{showActions && !card.canApply && phase === "idle" ? (
				<div className={styles.actions}>
					<button
						type="button"
						className={styles.dismiss}
						data-testid="edit-review-dismiss"
						onClick={dismiss}
					>
						Dismiss
					</button>
				</div>
			) : null}
		</section>
	);
}

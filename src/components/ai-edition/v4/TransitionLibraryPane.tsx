/**
 * Transition Library — FloatingInspector SelectionPane body.
 * Registry is SSOT. Backend-gated. Local search only.
 */

import { Blend, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { useTimeline } from "@/lib/ai-edition/store/useTimeline";
import { resolveTransitionGpuBackend } from "@/lib/ai-edition/transitions/gpuBackend";
import { useCompositorBackend } from "@/native/hooks/useCompositorBackend";
import {
	getTransitionById,
	listUserAvailableTransitions,
	searchTransitions,
	type TransitionCategory,
	type TransitionRegistryEntry,
} from "../../../../electron/ai-edition/transitionLibrary";
import styles from "./EditorShellV4.module.css";
import { TransitionPreviewThumb } from "./TransitionPreviewThumb";

type TimelineApi = ReturnType<typeof useTimeline>;

const GROUP_ORDER: Array<{
	key: string;
	title: string;
	match: (c: TransitionCategory) => boolean;
}> = [
	{ key: "basic", title: "Basic", match: (c) => c === "utility" },
	{
		key: "fade",
		title: "Dissolve / Fade",
		match: (c) => c === "subtle" || c === "fade",
	},
	{ key: "wipe", title: "Wipes", match: (c) => c === "wipe" },
	{ key: "slide", title: "Slides", match: (c) => c === "movement" },
	{
		key: "other",
		title: "More",
		match: (c) => !["utility", "subtle", "fade", "wipe", "movement"].includes(c),
	},
];

function paneHeader(icon: React.ReactNode, title: string, onClose: () => void) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "12px 14px",
				borderBottom: "1px solid var(--border)",
				flex: "0 0 auto",
			}}
		>
			<span style={{ display: "inline-flex", color: "var(--accent)" }}>{icon}</span>
			<span style={{ font: "600 13px var(--font-display)", flex: 1 }}>{title}</span>
			<button
				type="button"
				onClick={onClose}
				aria-label="Close"
				style={{
					border: "none",
					background: "transparent",
					color: "var(--muted)",
					cursor: "pointer",
					padding: 4,
				}}
			>
				<X size={16} />
			</button>
		</div>
	);
}

export function TransitionLibraryPane({ tl, onClose }: { tl: TimelineApi; onClose: () => void }) {
	const boundary = tl.selectedTransitionBoundary;
	const compositor = useCompositorBackend();
	const gpu = resolveTransitionGpuBackend(compositor);
	const [query, setQuery] = useState("");
	const [hoverId, setHoverId] = useState<string | null>(null);

	const clip = useMemo(() => {
		if (!boundary) return null;
		return tl.clips.find((c) => c.id === boundary.incomingClipId) ?? null;
	}, [boundary, tl.clips]);

	const currentId =
		clip?.incomingTransition?.transitionId ??
		(clip?.incomingTransition?.kind === "cut" ? "openscreen.cut" : "openscreen.dissolve");
	const currentEntry = getTransitionById(currentId);
	const durationSec =
		clip?.incomingTransition?.kind === "cut"
			? 0
			: (clip?.incomingTransition?.durationSec ?? currentEntry?.defaultDurationSec ?? 0.35);

	const entries = useMemo(() => {
		const t0 = performance.now();
		const list = query.trim() ? searchTransitions(query, gpu) : listUserAvailableTransitions(gpu);
		const ms = performance.now() - t0;
		if (typeof window !== "undefined") {
			(window as unknown as { __transitionSearchMs?: number }).__transitionSearchMs = ms;
		}
		return list.filter((e) => e.userAvailable && e.gpuCompatibility[gpu] !== false);
	}, [query, gpu]);

	const groups = useMemo(() => {
		return GROUP_ORDER.map((g) => ({
			...g,
			items: entries.filter((e) => g.match(e.category)),
		})).filter((g) => g.items.length > 0);
	}, [entries]);

	if (!boundary || !clip) {
		return (
			<div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
				{paneHeader(<Blend size={15} />, "Transitions", onClose)}
				<div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>
					Select a clip join on the timeline to edit its transition.
				</div>
			</div>
		);
	}

	const apply = (entry: TransitionRegistryEntry) => {
		void tl.setClipIncomingTransition({
			clipId: boundary.incomingClipId,
			transitionId: entry.id,
			durationSec:
				entry.id === "openscreen.cut"
					? 0
					: durationSec > 0
						? durationSec
						: entry.defaultDurationSec,
		});
	};

	const setDuration = (next: number) => {
		if (currentId === "openscreen.cut") return;
		void tl.setClipIncomingTransition({
			clipId: boundary.incomingClipId,
			transitionId: currentId,
			durationSec: next,
		});
	};

	const minD = currentEntry?.minDurationSec ?? 0.1;
	const maxD = currentEntry?.maxDurationSec ?? 2;

	return (
		<div
			data-testid="transition-library-pane"
			style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
		>
			{paneHeader(<Blend size={15} />, "Transitions", onClose)}
			<div
				style={{
					padding: "12px 14px 16px",
					display: "flex",
					flexDirection: "column",
					gap: 12,
					flex: "1 1 auto",
					minHeight: 0,
					overflowY: "auto",
				}}
			>
				<div style={{ fontSize: 12, color: "var(--muted)" }}>
					Join before <strong style={{ color: "var(--fg)" }}>{clip.id}</strong>
					{" · "}
					{currentEntry?.displayName ?? currentId}
					{durationSec > 0 ? ` · ${durationSec.toFixed(2)}s` : ""}
				</div>

				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "8px 10px",
						borderRadius: 10,
						border: "1px solid var(--border)",
						background: "var(--surface-1)",
					}}
				>
					<Search size={14} style={{ color: "var(--muted)" }} />
					<input
						data-testid="transition-library-search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search fade, wipe, left…"
						style={{
							flex: 1,
							border: "none",
							background: "transparent",
							outline: "none",
							font: "13px var(--font-body)",
							color: "var(--fg)",
						}}
					/>
				</label>

				{currentId !== "openscreen.cut" ? (
					<label style={{ display: "grid", gap: 6, fontSize: 12 }}>
						<span style={{ color: "var(--muted)" }}>Duration {durationSec.toFixed(2)}s</span>
						<input
							data-testid="transition-duration-slider"
							type="range"
							min={minD}
							max={maxD}
							step={0.05}
							value={Math.min(maxD, Math.max(minD, durationSec))}
							onChange={(e) => setDuration(Number(e.target.value))}
						/>
					</label>
				) : null}

				{groups.map((g) => (
					<section key={g.key} style={{ display: "grid", gap: 8 }}>
						<div
							style={{
								font: "600 11px var(--font-display)",
								letterSpacing: "0.04em",
								textTransform: "uppercase",
								color: "var(--muted)",
							}}
						>
							{g.title}
						</div>
						<div className={styles.transitionGrid}>
							{g.items.map((entry) => {
								const selected = entry.id === currentId;
								const playing = hoverId === entry.id || selected;
								return (
									<button
										key={entry.id}
										type="button"
										data-testid={`transition-card-${entry.id}`}
										data-selected={selected ? "true" : "false"}
										className={styles.transitionCard}
										onMouseEnter={() => setHoverId(entry.id)}
										onMouseLeave={() => setHoverId(null)}
										onClick={() => apply(entry)}
									>
										<TransitionPreviewThumb
											transitionId={entry.id}
											implementationRef={entry.implementationRef}
											playing={playing}
											selected={selected}
										/>
										<span className={styles.transitionCardName}>{entry.displayName}</span>
									</button>
								);
							})}
						</div>
					</section>
				))}

				<button
					type="button"
					data-testid="transition-remove-to-cut"
					onClick={() =>
						void tl.setClipIncomingTransition({
							clipId: boundary.incomingClipId,
							transitionId: "openscreen.cut",
						})
					}
					style={{
						marginTop: 4,
						padding: "9px 12px",
						borderRadius: 10,
						border: "1px solid var(--border)",
						background: "var(--surface-1)",
						color: "var(--fg)",
						font: "600 12px var(--font-display)",
						cursor: "pointer",
					}}
				>
					Remove → Cut
				</button>
			</div>
		</div>
	);
}

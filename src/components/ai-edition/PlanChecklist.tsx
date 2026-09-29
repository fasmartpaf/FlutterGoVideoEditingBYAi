import { Check, Circle, Loader2, MinusCircle } from "lucide-react";
import type { AiEditionPlanItem } from "@/native/contracts";

/**
 * The agent's step plan as a checklist. Live while the turn runs (items tick
 * over as the agent reports progress) and kept on the finished message.
 */
export function PlanChecklist({
	items,
	title,
	live = false,
}: {
	items: AiEditionPlanItem[];
	title: string;
	live?: boolean;
}) {
	if (items.length === 0) return null;
	const done = items.filter((i) => i.status === "done").length;
	return (
		<div
			role="list"
			aria-label={title}
			data-testid="plan-checklist"
			style={{
				marginTop: 8,
				padding: "8px 10px",
				borderRadius: "var(--r-md, 8px)",
				border: "1px solid var(--border-soft, rgba(127,127,127,0.25))",
				background: "var(--surface-2, transparent)",
				fontSize: 12.5,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					color: "var(--muted)",
					marginBottom: 4,
					fontSize: 11.5,
				}}
			>
				<span>{title}</span>
				<span>
					{done}/{items.length}
				</span>
			</div>
			{items.map((item, idx) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: steps have no ids and never reorder mid-render
					key={idx}
					role="listitem"
					data-status={item.status}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						padding: "2px 0",
						color: item.status === "done" || item.status === "skipped" ? "var(--muted)" : undefined,
						textDecoration: item.status === "skipped" ? "line-through" : undefined,
					}}
				>
					{item.status === "done" ? (
						<Check size={12} aria-label="done" />
					) : item.status === "in_progress" ? (
						live ? (
							<Loader2 size={12} className="animate-spin" aria-label="in progress" />
						) : (
							<Circle size={12} aria-label="in progress" />
						)
					) : item.status === "skipped" ? (
						<MinusCircle size={12} aria-label="skipped" />
					) : (
						<Circle size={12} aria-label="pending" style={{ opacity: 0.5 }} />
					)}
					<span>{item.text}</span>
				</div>
			))}
		</div>
	);
}

import { Check, ChevronRight, Loader2, Minus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AiEditionPlanItem } from "@/native/contracts";
import { toolActivityStatus } from "../../../electron/ai-edition/toolActivityLabels";
import styles from "./LiveTurn.module.css";

/** One tool call as the live card shows it. `step` = plan step running when it started. */
export interface LiveToolCall {
	name: string;
	detail?: string;
	summary?: string;
	ok?: boolean;
	step?: number;
}

export interface LiveTurnLabels {
	author: string;
	plan: string;
	reasoning: string;
	working: string;
	stepActions: (count: number) => string;
	earlierActions: (count: number) => string;
}

function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function StepDot({ status, live }: { status: AiEditionPlanItem["status"]; live: boolean }) {
	return (
		<span className={styles.dot} aria-hidden="true">
			{status === "done" ? (
				<Check size={12} strokeWidth={3} />
			) : status === "in_progress" ? (
				live ? (
					<Loader2 size={11} className="animate-spin" />
				) : (
					<span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
				)
			) : status === "skipped" ? (
				<Minus size={11} />
			) : null}
		</span>
	);
}

function ActionRow({ tool }: { tool: LiveToolCall }) {
	const label = toolActivityStatus(tool.name);
	const state = tool.ok === undefined ? "pending" : tool.ok ? "true" : "false";
	return (
		<div className={styles.action} data-ok={state}>
			<span className={styles.actionIcon}>
				{tool.ok === undefined ? (
					<Loader2 size={11} className="animate-spin" />
				) : tool.ok ? (
					<Check size={11} strokeWidth={2.5} />
				) : (
					<X size={11} strokeWidth={2.5} />
				)}
			</span>
			<span title={tool.summary ?? tool.detail}>
				{tool.ok === undefined && tool.detail ? `${label} — ${tool.detail}` : tool.ok === false ? `${label} — failed` : label}
			</span>
		</div>
	);
}

/** The last few actions, with the rest behind "+N earlier". */
function ActionList({ tools, labels, keep = 3 }: { tools: LiveToolCall[]; labels: LiveTurnLabels; keep?: number }) {
	const [all, setAll] = useState(false);
	if (tools.length === 0) return null;
	const hidden = all ? 0 : Math.max(0, tools.length - keep);
	return (
		<div className={styles.actions}>
			{hidden > 0 ? (
				<button type="button" className={styles.more} onClick={() => setAll(true)}>
					{labels.earlierActions(hidden)}
				</button>
			) : null}
			{tools.slice(hidden).map((tool, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: append-only list
				<ActionRow key={hidden + i} tool={tool} />
			))}
		</div>
	);
}

/** Plan / stage stepper. Live: the running step shows its actions; finished steps show a count. */
export function PlanSteps({
	items,
	title,
	live = false,
	tools = [],
	labels,
	variant = "inline",
}: {
	items: AiEditionPlanItem[];
	title: string;
	live?: boolean;
	tools?: LiveToolCall[];
	labels?: LiveTurnLabels;
	variant?: "inline" | "card";
}) {
	if (items.length === 0) return null;
	const done = items.filter((i) => i.status === "done").length;
	return (
		<div className={variant === "card" ? styles.planCard : undefined} data-testid="plan-checklist">
			<div className={styles.stepsHead}>
				<span>{title}</span>
				<span className={styles.stepsCount}>
					{done}/{items.length}
				</span>
			</div>
			<ol className={styles.steps} aria-label={title}>
				{items.map((item, idx) => {
					const stepTools = tools.filter((t) => t.step === idx);
					return (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: steps have no ids and never reorder
							key={idx}
							className={styles.step}
							data-status={item.status}
						>
							<StepDot status={item.status} live={live} />
							<div className={styles.stepTitle}>
								{item.text}
								{live && item.status === "done" && stepTools.length > 0 && labels ? (
									<span className={styles.stepMeta}>{labels.stepActions(stepTools.length)}</span>
								) : null}
							</div>
							{live && item.status === "in_progress" && labels ? <ActionList tools={stepTools} labels={labels} /> : null}
						</li>
					);
				})}
			</ol>
		</div>
	);
}

/** Short, human status: the running action, else the agent's status line, else "Working". */
export function liveHeadline(tools: LiveToolCall[], status: string | null, working: string): string {
	const running = [...tools].reverse().find((t) => t.ok === undefined);
	if (running) {
		const label = toolActivityStatus(running.name);
		return running.detail ? `${label} — ${running.detail}` : label;
	}
	const s = status?.trim();
	if (s && !/^(thinking|agent_started|stage)$/i.test(s)) return s.replace(/…$/, "");
	return working;
}

/** The in-flight assistant turn: header + elapsed, one "now" line, stepper, reasoning, streamed reply. */
export function LiveTurnCard({
	startedAt,
	status,
	plan,
	tools,
	thinking,
	text,
	labels,
}: {
	startedAt: number;
	status: string | null;
	plan: AiEditionPlanItem[];
	tools: LiveToolCall[];
	thinking: string;
	text: string;
	labels: LiveTurnLabels;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);
	// With a plan, the running action already shows under its step — the headline
	// only speaks while the agent is between actions (thinking, reading, preparing).
	const running = tools.some((t) => t.ok === undefined);
	const headline = plan.length > 0 && running ? null : liveHeadline(tools, status, labels.working);
	const looseTools = useMemo(() => (plan.length ? [] : tools), [plan.length, tools]);
	return (
		<div className={styles.card} aria-live="polite" aria-busy="true" data-testid="live-turn">
			<div className={styles.head}>
				<span className={styles.mark} aria-hidden="true" />
				<span className={styles.who}>{labels.author}</span>
				<span className={styles.elapsed} title="Elapsed">
					{formatElapsed(now - startedAt)}
				</span>
			</div>
			{headline ? (
				<div className={styles.now}>
					<span className={styles.shimmer}>{headline}</span>
				</div>
			) : null}
			{plan.length > 0 ? (
				<PlanSteps items={plan} title={labels.plan} live tools={tools} labels={labels} />
			) : (
				<ActionList tools={looseTools} labels={labels} keep={4} />
			)}
			{thinking.trim() ? (
				<details className={styles.reasoning}>
					<summary>
						<ChevronRight size={12} className={styles.chev} aria-hidden="true" />
						{labels.reasoning}
					</summary>
					<div className={styles.reasoningText}>{thinking.length > 1500 ? `…${thinking.slice(-1500)}` : thinking}</div>
				</details>
			) : null}
			{text ? <div className={styles.reply}>{text}</div> : null}
		</div>
	);
}

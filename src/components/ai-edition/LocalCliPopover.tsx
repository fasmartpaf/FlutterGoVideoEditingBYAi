import { Check, RefreshCw, Settings, Star, Terminal, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useScopedT } from "@/contexts/I18nContext";
import { nativeBridgeClient } from "@/native/client";
import type { AiEditionLlmConfig, AiEditionLocalAgent } from "@/native/contracts";
import styles from "./NewEditorShell.module.css";

const PERMISSIONS = ["ask", "always", "never"] as const;

export function LocalAgentPermissionPicker({
	value,
	onChange,
	disabled,
}: {
	value: "ask" | "always" | "never";
	onChange: (next: "ask" | "always" | "never") => void;
	disabled?: boolean;
}) {
	const t = useScopedT("editor");
	return (
		<fieldset className={styles.localCliPermission}>
			<legend>{t("chat.localCli.permissionLabel")}</legend>
			<p className={styles.localCliPermissionHint}>{t("chat.localCli.permissionHint")}</p>
			{PERMISSIONS.map((id) => (
				<label key={id} className={styles.localCliPermissionOption}>
					<input
						type="radio"
						name="local-agent-permission"
						checked={value === id}
						disabled={disabled}
						onChange={() => onChange(id)}
					/>
					<span>
						{t(`chat.localCli.permission${id[0].toUpperCase()}${id.slice(1)}`)}
						<em>{t(`chat.localCli.permission${id[0].toUpperCase()}${id.slice(1)}Hint`)}</em>
					</span>
				</label>
			))}
		</fieldset>
	);
}

function selectionForAgent(agent: AiEditionLocalAgent, model?: string) {
	if (agent.kind === "http") {
		return {
			provider: "local-cli" as const,
			model: model ?? agent.models?.[0] ?? agent.id,
			baseUrl: agent.baseUrl,
		};
	}
	return {
		provider: "local-cli" as const,
		model: agent.id,
		baseUrl: agent.path ? `cli:${agent.path}` : undefined,
		...(agent.id === "claude" && model && !model.startsWith("locked:")
			? { localCliModel: model }
			: {}),
	};
}

export function LocalCliPopover({
	anchorRect,
	llmConfig,
	agents,
	onClose,
	onConfigChange,
	onOpenFullSettings,
	onAgentsChange,
}: {
	anchorRect: { left: number; bottom: number; maxHeight: number };
	llmConfig: AiEditionLlmConfig | null;
	agents: AiEditionLocalAgent[];
	onClose: () => void;
	onConfigChange: () => void;
	onOpenFullSettings: () => void;
	onAgentsChange: (agents: AiEditionLocalAgent[]) => void;
}) {
	const t = useScopedT("editor");
	const [busyId, setBusyId] = useState<string | null>(null);
	const [scanning, setScanning] = useState(false);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		const onPointer = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest("[data-local-cli-popover]")) return;
			onClose();
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("pointerdown", onPointer);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointer);
		};
	}, [onClose]);

	const selectedId =
		llmConfig?.provider === "local-cli"
			? agents.find(
					(agent) =>
						agent.id === llmConfig.model ||
						agent.models?.includes(llmConfig.model) ||
						(agent.path && llmConfig.baseUrl === `cli:${agent.path}`) ||
						(agent.baseUrl && llmConfig.baseUrl === agent.baseUrl),
				)?.id
			: null;

	const selectedClaudeModel =
		llmConfig?.provider === "local-cli" && llmConfig.model === "claude"
			? llmConfig.localCliModel
			: undefined;

	const select = async (agent: AiEditionLocalAgent, model?: string) => {
		if (model?.startsWith("locked:")) return;
		setBusyId(model ? `${agent.id}:${model}` : agent.id);
		try {
			if (!agent.ready) {
				const login = await nativeBridgeClient.aiEdition.llmLoginLocalAgent(agent.id);
				if (login.success) toast.message(t("chat.localCli.loginHint"));
				else toast.error(login.error ?? t("chat.localCli.needsLogin"));
				return;
			}
			const next = {
				...selectionForAgent(agent, model),
				localAgentPermission: llmConfig?.localAgentPermission,
				allowAgentEdits: llmConfig?.allowAgentEdits,
				// Keep prior Claude model when switching to Claude without picking one.
				...(agent.id === "claude" && !model && llmConfig?.localCliModel
					? { localCliModel: llmConfig.localCliModel }
					: {}),
			};
			const result = await nativeBridgeClient.aiEdition.llmSetConfig(next);
			if (result.success) {
				onConfigChange();
				if (model || agent.id !== "claude" || !agent.modelOptions?.length) {
					onClose();
				}
			}
		} finally {
			setBusyId(null);
		}
	};

	const rescan = async () => {
		setScanning(true);
		try {
			const snap = await nativeBridgeClient.aiEdition.llmRescanLocalAgents();
			onAgentsChange(snap.localAgents ?? []);
			onConfigChange();
		} finally {
			setScanning(false);
		}
	};

	return createPortal(
		<div
			data-local-cli-popover
			className={styles.localCliPopover}
			style={{
				position: "fixed",
				left: anchorRect.left,
				bottom: anchorRect.bottom,
				maxHeight: anchorRect.maxHeight,
			}}
			role="menu"
		>
			<header className={styles.localCliHeader}>
				<div>
					<strong>{t("chat.localCli.title")}</strong>
					<p>{t("chat.localCli.subtitle")}</p>
				</div>
			</header>
			<div className={styles.localCliRow} data-active="true">
				<Terminal size={14} />
				<span>{t("chat.localCli.useLocalCli")}</span>
				<em>{t("chat.localCli.active")}</em>
				<Check size={14} />
			</div>
			<p className={styles.localCliSection}>{t("chat.localCli.agentsHeading")}</p>
			{agents.length === 0 ? (
				<p className={styles.localCliEmpty}>{t("chat.localCli.noneFound")}</p>
			) : (
				agents.map((agent) => {
					const selected = agent.id === selectedId;
					const meta = !agent.ready
						? t("chat.localCli.needsLogin")
						: ([agent.activeModel, agent.version].filter(Boolean).join(" · ") ||
							agent.models?.[0] ||
							agent.path);
					const Icon = agent.kind === "http" ? Zap : Star;
					const showModels = selected && agent.id === "claude" && (agent.modelOptions?.length ?? 0) > 0;
					return (
						<div key={agent.id} className={styles.localCliAgentBlock}>
							<button
								type="button"
								role="menuitem"
								className={styles.localCliRow}
								data-selected={selected ? "true" : undefined}
								disabled={busyId === agent.id}
								onClick={() => void select(agent)}
							>
								<Icon size={14} />
								<span>{agent.name}</span>
								{meta ? <em>{meta}</em> : null}
								{selected ? (
									<>
										<em>{t("chat.localCli.selected")}</em>
										<Check size={14} />
									</>
								) : null}
							</button>
							{showModels ? (
								<>
									<p className={styles.localCliModelsHeading}>{t("chat.localCli.modelsHeading")}</p>
									{agent.modelOptions!.map((opt) => {
										const picked = selectedClaudeModel === opt.id;
										const busy = busyId === `${agent.id}:${opt.id}`;
										return (
											<button
												key={opt.id}
												type="button"
												role="menuitem"
												className={styles.localCliModelRow}
												data-selected={picked ? "true" : undefined}
												data-unavailable={opt.available ? undefined : "true"}
												disabled={!opt.available || busy}
												title={opt.available ? opt.label : (opt.note ?? t("chat.localCli.modelUpdateRequired"))}
												onClick={() => void select(agent, opt.id)}
											>
												<span>{opt.label}</span>
												<em>
													{opt.available
														? picked
															? t("chat.localCli.selected")
															: opt.id
														: (opt.note ?? t("chat.localCli.modelUpdateRequired"))}
												</em>
												{picked ? <Check size={14} /> : null}
											</button>
										);
									})}
								</>
							) : null}
						</div>
					);
				})
			)}
			<button
				type="button"
				className={styles.localCliRow}
				disabled={scanning}
				onClick={() => void rescan()}
			>
				<RefreshCw size={14} className={scanning ? "animate-spin" : undefined} />
				<span>{scanning ? t("chat.localCli.scanning") : t("chat.localCli.rescanPath")}</span>
			</button>
			<LocalAgentPermissionPicker
				value={llmConfig?.localAgentPermission ?? "ask"}
				onChange={(localAgentPermission) => {
					if (!llmConfig) return;
					void nativeBridgeClient.aiEdition
						.llmSetConfig({ ...llmConfig, localAgentPermission })
						.then(() => onConfigChange());
				}}
			/>
			<div className={styles.localCliFooter}>
				<button type="button" className={styles.localCliRow} onClick={onOpenFullSettings}>
					<Settings size={14} />
					<span>{t("chat.localCli.openSettings")}</span>
				</button>
			</div>
		</div>,
		document.body,
	);
}

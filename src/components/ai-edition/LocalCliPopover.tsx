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

	const select = async (agent: AiEditionLocalAgent, model?: string) => {
		setBusyId(agent.id);
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
			};
			const result = await nativeBridgeClient.aiEdition.llmSetConfig(next);
			if (result.success) {
				onConfigChange();
				onClose();
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
						: (agent.version ?? agent.models?.[0] ?? agent.path);
					const Icon = agent.kind === "http" ? Zap : Star;
					return (
						<button
							key={agent.id}
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

/**
 * Runs a staged whole-video edit (see stagedEdit.ts): one focused agent run
 * per stage, in order, each on the document the previous stage produced.
 */

import { join } from "node:path";
import type { AxcutDocument } from "../../src/lib/ai-edition/schema";
import type { AiEditionPlanItem } from "../../src/native/contracts";
import { resolveFfmpeg } from "../media/audioPeaks";
import { resolveGeneratedGraphicsDir } from "./agentToolMedia";
import type { InvokeResult } from "./deep-agent/service";
import { sampleFramesForAgent, timelineDurationSec } from "./frameCheck";
import {
	EDIT_STAGES,
	type EditStage,
	type StageOutcome,
	previewTimeSec,
	stagedFinalMessage,
	stagePlan,
	stagePrompt,
	stageSummary,
	stageToolNames,
} from "./stagedEdit";
import { uniqueStem } from "./startThumbnail";

export interface StageRun {
	stage: EditStage;
	index: number;
	document: AxcutDocument;
	prompt: string;
	toolNames: string[];
	budget: EditStage["budget"];
	/**
	 * The earlier stages as chat turns (their prompt, then what they did). Sent
	 * as history so each stage continues the same live Claude conversation
	 * instead of looking like a rewind that restarts it.
	 */
	history: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface StagedEditInput {
	invoke: (stage: StageRun) => Promise<InvokeResult>;
	document: AxcutDocument;
	request: string;
	/** Project memory (earlier turns, standing instructions) — given to the first stage. */
	projectNotes?: string;
	abortSignal?: AbortSignal;
	emit: {
		plan: (items: AiEditionPlanItem[]) => void;
		status: (phase: string, detail?: string) => void;
		text: (delta: string) => void;
	};
	onPlan?: (items: AiEditionPlanItem[]) => void;
	/** A frame of the edited video after a stage, for the chat. */
	onPreview?: (path: string, label: string) => void;
	/** Test seam: renders the preview frame (default: offscreen compositor + ffmpeg). */
	renderPreview?: (document: AxcutDocument, stage: EditStage) => Promise<string | null>;
	stages?: readonly EditStage[];
}

async function defaultPreview(document: AxcutDocument, stage: EditStage): Promise<string | null> {
	const ffmpegPath = resolveFfmpeg()?.trim();
	if (!ffmpegPath) return null;
	const duration = timelineDurationSec(document);
	if (duration <= 0) return null;
	const { defaultCompositorSampler } = await import("./deep-agent/service");
	const r = await sampleFramesForAgent(
		document,
		{ from: "timeline", times: [previewTimeSec(document, stage, duration)] },
		{
			ffmpegPath,
			outDir: join(resolveGeneratedGraphicsDir(document), ".checks"),
			stem: uniqueStem(`stage-${stage.id}`),
			createSampler: defaultCompositorSampler,
		},
	);
	return r.frames[0]?.path ?? null;
}

export async function runStagedEdit(input: StagedEditInput): Promise<InvokeResult> {
	const stages = input.stages ?? EDIT_STAGES;
	const outcomes: StageOutcome[] = [];
	const history: StageRun["history"] = [];
	let document = input.document;
	let mutated = false;
	let last: InvokeResult | null = null;
	const publishPlan = (current: number | null) => {
		const items = stagePlan(outcomes, current, stages) as AiEditionPlanItem[];
		input.onPlan?.(items);
		input.emit.plan(items);
	};

	for (const [index, stage] of stages.entries()) {
		if (input.abortSignal?.aborted) break;
		publishPlan(index);
		input.emit.status("stage", `${stage.title} (${index + 1}/${stages.length})`);
		if (index > 0) input.emit.text("\n\n");
		let r: InvokeResult;
		const prompt =
			stagePrompt(stage, index, input.request, outcomes, stages.length) +
			(index === 0 && input.projectNotes ? `\n\n${input.projectNotes}` : "");
		try {
			r = await input.invoke({
				stage,
				index,
				document,
				prompt,
				toolNames: stageToolNames(stage),
				budget: stage.budget,
				history: [...history],
			});
		} catch (err) {
			const aborted = input.abortSignal?.aborted || (err as Error)?.name === "AbortError";
			outcomes.push({
				stage,
				status: aborted ? "stopped" : "failed",
				summary: aborted ? "Stopped." : `Failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
				mutated: false,
			});
			if (aborted) break;
			continue;
		}
		last = r;
		// Tools applied edits even if the stage was stopped part-way: keep them.
		if (r.mutated) {
			document = r.document;
			mutated = true;
		}
		if (input.abortSignal?.aborted || r.failureReason === "request_aborted") {
			outcomes.push({ stage, status: "stopped", summary: "Stopped.", mutated: r.mutated });
			break;
		}
		const { summary, skipped } = stageSummary(r.text || r.userMessage, stage);
		history.push({ role: "user", content: prompt }, { role: "assistant", content: summary });
		const outcome: StageOutcome = { stage, status: skipped ? "skipped" : "done", summary, mutated: r.mutated };
		if (stage.preview && r.mutated) {
			const path = await (input.renderPreview ?? defaultPreview)(document, stage).catch(() => null);
			if (path) {
				outcome.previewPath = path;
				input.onPreview?.(path, `After ${stage.title.toLowerCase()}`);
			}
		}
		outcomes.push(outcome);
	}
	publishPlan(null);
	input.emit.status("stage", "done");

	return {
		...(last ?? {}),
		text: stagedFinalMessage(outcomes),
		document,
		mutated,
		status: "completed",
		failureReason: undefined,
		userMessage: undefined,
		reason: undefined,
		// The stages each passed the mutation gate on their own; the combined
		// result must not be re-judged as one editorial turn.
		mutationAuthority: undefined,
		editReview: undefined,
	} as InvokeResult;
}

// Safe Way-1 agent wrapper: load any on-disk .openscreen, migrate through the
// official chain, edit only via executeAgentTool / patchEditorSettings, then
// write the v2 EditorProjectData the existing CLI (captions / export) accepts.
//
// Disk formats:
//   CLI record/captions/export  → EditorProjectData (`version: 2`)
//   In-memory AI-edition model  → AxcutDocument (`schemaVersion: 7`)
// Never invent fields. Every write is re-validated.

import { z } from "zod";
import {
	type EditorProjectData,
	PROJECT_VERSION,
	validateProjectData,
} from "@/components/video-editor/projectPersistence";
import {
	migrateAxcutDocumentToProjectData,
	migrateProjectDataToAxcutDocument,
} from "@/lib/ai-edition/document/migrate";
import { resequenceClips } from "@/lib/ai-edition/document/timeline";
import {
	type AxcutDocument,
	axcutSchemaVersion,
	documentSchema,
	migrateRawDocumentToCurrent,
} from "@/lib/ai-edition/schema";
import { patchEditorSettings } from "@/lib/ai-edition/store/editorSettings";
import { classifyWallpaper, WALLPAPER_PATHS } from "@/lib/wallpaper";
import { isAspectRatio } from "@/utils/aspectRatioUtils";
import {
	addAnnotationArgs,
	addSpeedArgs,
	addTrimArgs,
	addZoomArgs,
	executeAgentTool,
} from "../../electron/ai-edition/agent-tools";

export const CLI_PROJECT_VERSION = PROJECT_VERSION;
export const AXCUT_SCHEMA_VERSION = axcutSchemaVersion;

const trimCommandSchema = addTrimArgs.extend({ op: z.literal("trim") });
const zoomCommandSchema = addZoomArgs.extend({ op: z.literal("zoom") });
const speedCommandSchema = addSpeedArgs.extend({ op: z.literal("speed") });
const annotationCommandSchema = addAnnotationArgs.extend({ op: z.literal("annotation") });
const aspectRatioCommandSchema = z.object({
	op: z.literal("aspectRatio"),
	value: z.string().min(1),
});
const backgroundCommandSchema = z.object({
	op: z.literal("background"),
	wallpaper: z.string().min(1),
});
const captionsCommandSchema = z.object({
	op: z.literal("captions"),
	minWords: z.number().int().positive().optional(),
	maxWords: z.number().int().positive().optional(),
});
const exportCommandSchema = z.object({
	op: z.literal("export"),
	out: z.string().min(1),
	quality: z.enum(["medium", "good", "source"]).optional(),
	format: z.enum(["mp4", "gif"]).optional(),
	autoZoom: z.boolean().optional(),
});

export const agentCommandSchema = z.discriminatedUnion("op", [
	trimCommandSchema,
	zoomCommandSchema,
	speedCommandSchema,
	annotationCommandSchema,
	aspectRatioCommandSchema,
	backgroundCommandSchema,
	captionsCommandSchema,
	exportCommandSchema,
]);

export type AgentCommand = z.infer<typeof agentCommandSchema>;

export const agentCommandListSchema = z.array(agentCommandSchema).min(1);

export interface LoadedProject {
	document: AxcutDocument;
	source: "v2" | "axcut";
}

export function loadProjectForEdit(raw: unknown): LoadedProject {
	if (validateProjectData(raw)) {
		return { document: migrateProjectDataToAxcutDocument(raw), source: "v2" };
	}
	const parsed = documentSchema.safeParse(migrateRawDocumentToCurrent(raw));
	if (!parsed.success) {
		throw new Error(
			`Not a valid OpenScreen project (CLI v${PROJECT_VERSION} or Axcut v${axcutSchemaVersion}): ${parsed.error.message}`,
		);
	}
	return { document: parsed.data, source: "axcut" };
}

export interface ProbedMedia {
	durationSec: number;
	width?: number;
	height?: number;
}

export async function probeMediaWithFfprobe(
	ffprobePath: string,
	mediaPath: string,
): Promise<ProbedMedia> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);
	const { stdout } = await execFileAsync(
		ffprobePath,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-show_entries",
			"format=duration",
			"-of",
			"json",
			mediaPath,
		],
		{ timeout: 15_000 },
	);
	const parsed = JSON.parse(stdout) as {
		format?: { duration?: string };
		streams?: Array<{ width?: number; height?: number }>;
	};
	const durationSec = Number(parsed.format?.duration);
	if (!Number.isFinite(durationSec) || durationSec <= 0) {
		throw new Error(`ffprobe could not read a duration from ${mediaPath}`);
	}
	const stream = parsed.streams?.[0];
	return {
		durationSec,
		width: stream?.width,
		height: stream?.height,
	};
}

/** Node stand-in for the editor's DOM `probeAndCorrectClip` — same fields, official resequence. */
export async function fillProbedMedia(
	document: AxcutDocument,
	ffprobePath: string,
): Promise<AxcutDocument> {
	let assets = document.assets;
	let clips = document.timeline.clips;
	for (const asset of document.assets) {
		if (asset.kind !== "video" || !asset.originalPath) continue;
		if ((asset.durationSec ?? 0) > 0) continue;
		const probed = await probeMediaWithFfprobe(ffprobePath, asset.originalPath);
		assets = assets.map((row) =>
			row.id === asset.id
				? {
						...row,
						durationSec: probed.durationSec,
						...(probed.width && probed.height
							? {
									video: {
										codec: row.video?.codec ?? "unknown",
										fps: row.video?.fps ?? 0,
										width: probed.width,
										height: probed.height,
									},
								}
							: {}),
					}
				: row,
		);
		clips = clips.map((clip) =>
			clip.assetId === asset.id && (clip.sourceEndSec === undefined || clip.timelineEndSec === 0)
				? {
						...clip,
						sourceEndSec: probed.durationSec,
						timelineEndSec: clip.timelineStartSec + probed.durationSec,
					}
				: clip,
		);
	}
	return documentSchema.parse({
		...document,
		assets,
		timeline: { ...document.timeline, clips: resequenceClips(clips) },
	});
}

export function persistForCli(document: AxcutDocument): EditorProjectData {
	const current = documentSchema.parse(document);
	const v2 = migrateAxcutDocumentToProjectData(current);
	if (!validateProjectData(v2)) {
		throw new Error("Round-trip to CLI v2 project failed validateProjectData");
	}
	if (v2.version !== PROJECT_VERSION) {
		throw new Error(`CLI project version must be ${PROJECT_VERSION}, got ${v2.version}`);
	}
	return v2;
}

export function inspectProject(document: AxcutDocument, source: LoadedProject["source"]) {
	const legacy =
		document.legacyEditor && typeof document.legacyEditor === "object"
			? (document.legacyEditor as {
					aspectRatio?: string;
					wallpaper?: string;
					speedRegions?: unknown[];
				})
			: null;
	return {
		diskFormat: source === "v2" ? `EditorProjectData v${PROJECT_VERSION}` : "AxcutDocument",
		axcutSchemaVersion: document.schemaVersion,
		expectedAxcutSchemaVersion: axcutSchemaVersion,
		projectId: document.project.id,
		title: document.project.title,
		primaryAssetId: document.project.primaryAssetId ?? null,
		assets: document.assets.map((asset) => ({
			id: asset.id,
			kind: asset.kind,
			label: asset.label,
			originalPath: asset.originalPath,
		})),
		clips: document.timeline.clips.map((clip) => ({
			id: clip.id,
			assetId: clip.assetId,
			sourceStartSec: clip.sourceStartSec,
			sourceEndSec: clip.sourceEndSec ?? null,
		})),
		trimCount: document.timeline.trimRanges.length,
		zoomCount: document.zoomRanges.length,
		annotationCount: document.annotations.length,
		speedCount: Array.isArray(legacy?.speedRegions)
			? legacy.speedRegions.length
			: document.timeline.speedRanges.length,
		aspectRatio: legacy?.aspectRatio ?? null,
		wallpaper: legacy?.wallpaper ?? null,
	};
}

export interface AppliedEdit {
	op: AgentCommand["op"];
	ok: true;
	summary: string;
	document: AxcutDocument;
}

function toolArgs(command: AgentCommand): Record<string, unknown> {
	const { op: _op, ...rest } = command;
	return rest;
}

export function resolveBundledWallpaper(input: string): string {
	const trimmed = input.trim();
	if (/^\d+$/.test(trimmed)) {
		const index = Number(trimmed);
		const wallpaperPath = WALLPAPER_PATHS[index - 1];
		if (!wallpaperPath) {
			throw new Error(`Wallpaper index must be 1–${WALLPAPER_PATHS.length}`);
		}
		return wallpaperPath;
	}
	if (/^wallpaper\d+$/i.test(trimmed)) {
		const mapped = `/wallpapers/${trimmed.toLowerCase()}.jpg`;
		if ((WALLPAPER_PATHS as readonly string[]).includes(mapped)) return mapped;
	}
	if ((WALLPAPER_PATHS as readonly string[]).includes(trimmed)) return trimmed;
	const classified = classifyWallpaper(trimmed);
	if (classified.kind === "color" || classified.kind === "gradient") return trimmed;
	if (classified.kind === "image" && trimmed.startsWith("/wallpapers/")) return trimmed;
	throw new Error(
		"background.wallpaper must be a bundled /wallpapers/wallpaperN.jpg path, index 1–18, a CSS color, or a CSS gradient",
	);
}

export function applyDocumentCommand(document: AxcutDocument, command: AgentCommand): AppliedEdit {
	switch (command.op) {
		case "trim":
		case "zoom":
		case "speed":
		case "annotation": {
			const toolName =
				command.op === "trim"
					? "addTrim"
					: command.op === "zoom"
						? "addZoom"
						: command.op === "speed"
							? "addSpeed"
							: "addAnnotation";
			const result = executeAgentTool(document, toolName, JSON.stringify(toolArgs(command)));
			if (!result.ok || !result.document) {
				throw new Error(`${command.op} rejected: ${result.resultJson}`);
			}
			return {
				op: command.op,
				ok: true,
				summary: result.summary ?? toolName,
				document: documentSchema.parse(result.document),
			};
		}
		case "aspectRatio": {
			if (!isAspectRatio(command.value)) {
				throw new Error(
					`aspectRatio "${command.value}" is not a valid W:H token (see isAspectRatio)`,
				);
			}
			const next = documentSchema.parse(
				patchEditorSettings(document, { aspectRatio: command.value }),
			);
			return {
				op: command.op,
				ok: true,
				summary: `aspectRatio → ${command.value}`,
				document: next,
			};
		}
		case "background": {
			const wallpaper = resolveBundledWallpaper(command.wallpaper);
			const next = documentSchema.parse(patchEditorSettings(document, { wallpaper }));
			return {
				op: command.op,
				ok: true,
				summary: `background → ${wallpaper}`,
				document: next,
			};
		}
		case "captions":
		case "export":
			throw new Error(`${command.op} is a CLI process command, not an in-document edit`);
	}
}

export function parseAgentCommands(raw: unknown): AgentCommand[] {
	const parsed = agentCommandListSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`Invalid agent commands: ${parsed.error.message}`);
	}
	return parsed.data;
}

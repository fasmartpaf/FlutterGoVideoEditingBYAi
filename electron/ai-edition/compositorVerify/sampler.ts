/**
 * Offscreen composited frame sampler — live readFrame + bounded exportMulti.
 * Uses CompositorViewService (same addon as preview/export). No second renderer.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSceneDescription } from "../../../src/native/sceneDescription";
import { resolveFfmpeg } from "../../media/audioPeaks";
import { CompositorViewService } from "../../native-bridge/services/compositorViewService";
import { analyzeRgba8, makeGradientRgba, makeSolidRgba } from "./pixels";
import { clipInputsForProgrammeWindow, locateProgrammeInstant } from "./programmeMap";
import type {
	CompositedFrameResult,
	CompositedFrameSampleRequest,
	CompositedFrameSampler,
	CompositorBackendLabel,
	FrameProviderKind,
} from "./types";

const DEFAULT_W = 320;
const DEFAULT_H = 180;

function emptyLatency() {
	return {
		sceneBuildMs: 0,
		compositorSetupMs: 0,
		presentMs: 0,
		readFrameMs: 0,
		exportMs: 0,
		decodeMs: 0,
		perFrameMs: 0,
	};
}

function resultBase(
	partial: Partial<CompositedFrameResult> &
		Pick<CompositedFrameResult, "requestedProgrammeTimeSec" | "status" | "frameProvider">,
): CompositedFrameResult {
	return {
		evidenceId: partial.evidenceId ?? `cvf_${randomUUID().slice(0, 10)}`,
		width: partial.width ?? 0,
		height: partial.height ?? 0,
		pixelFormat: "rgba8",
		byteLength: partial.byteLength ?? 0,
		compositorBackend: partial.compositorBackend ?? "unknown",
		capturePath: partial.capturePath ?? "live_readFrame",
		latencyMs: partial.latencyMs ?? emptyLatency(),
		...partial,
	};
}

export function createInjectedCompositorSampler(opts?: {
	/** Valid gradient frames (default). */
	mode?: "valid" | "blank" | "transparent" | "dark_valid" | "unavailable";
}): CompositedFrameSampler {
	const mode = opts?.mode ?? "valid";
	return {
		providerKind: mode === "unavailable" ? "injected_test" : "injected_test",
		async sampleFrame(input) {
			if (mode === "unavailable") {
				return resultBase({
					requestedProgrammeTimeSec: input.programmeTimeSec,
					status: "unavailable",
					frameProvider: "injected_test",
					compositorBackend: "injected",
					capturePath: "injected",
					error: "injected_unavailable",
				});
			}
			const w = input.width ?? 64;
			const h = input.height ?? 36;
			let rgba: Uint8Array;
			if (mode === "blank") rgba = makeSolidRgba(w, h, [0, 0, 0, 255]);
			else if (mode === "transparent") rgba = makeSolidRgba(w, h, [0, 0, 0, 0]);
			else if (mode === "dark_valid") rgba = makeGradientRgba(w, h, true);
			else rgba = makeGradientRgba(w, h, false);
			const stats = analyzeRgba8(rgba, w, h);
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				width: w,
				height: h,
				rgba,
				byteLength: rgba.byteLength,
				frameProvider: "injected_test",
				compositorBackend: "injected",
				capturePath: "injected",
				status: stats.valid ? "ok" : "invalid",
				pixelStats: stats,
			});
		},
	};
}

/**
 * Production sampler: CompositorViewService.
 * Prefer live presentTime+readFrame; fall back to bounded exportMulti + rawvideo extract
 * from the *composited* export (not source media).
 */
export class NativeCompositorFrameSampler implements CompositedFrameSampler {
	readonly providerKind: FrameProviderKind = "native_compositor";
	private readonly service: CompositorViewService;
	private viewId: number | null = null;
	private workDir: string;
	private retain: boolean;

	constructor(opts?: {
		appRoot?: string;
		workDir?: string;
		retain?: boolean;
		envOverride?: string | null;
	}) {
		this.service = new CompositorViewService({
			appRoot: opts?.appRoot,
			envOverride: opts?.envOverride ?? process.env.OPENSCREEN_COMPOSITOR_VIEW_NODE ?? null,
		});
		this.workDir = opts?.workDir ?? join(tmpdir(), `openscreen-cv-${process.pid}`);
		this.retain = opts?.retain === true;
		mkdirSync(this.workDir, { recursive: true });
	}

	hasAddon(): boolean {
		return this.service.hasAddon();
	}

	probeBackend(): CompositorBackendLabel {
		const b = this.service.probeBackend();
		// Some restricted hosts report "none" even when the .node loads and can
		// still present/read frames (exportMulti/readFrame). Prefer trying.
		if (b === "none" && this.hasAddon()) return "cpu";
		return b === "hardware" || b === "cpu" || b === "none" ? b : "unknown";
	}

	async sampleFrame(input: CompositedFrameSampleRequest): Promise<CompositedFrameResult> {
		const t0 = Date.now();
		const latency = emptyLatency();
		const backend = this.probeBackend();

		if (!this.hasAddon()) {
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				status: "unavailable",
				frameProvider: "native_compositor",
				compositorBackend: backend,
				capturePath: "live_readFrame",
				error: "compositor_addon_unavailable",
				latencyMs: { ...latency, perFrameMs: Date.now() - t0 },
			});
		}

		const located = locateProgrammeInstant(input.document, input.programmeTimeSec);
		if (!located) {
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				status: "error",
				frameProvider: "native_compositor",
				compositorBackend: backend,
				capturePath: "live_readFrame",
				error: "programme_time_unmapped",
				latencyMs: { ...latency, perFrameMs: Date.now() - t0 },
			});
		}

		if (!existsSync(located.screenPath)) {
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				actualSourceTimeSec: located.sourceTimeSec,
				sourceProvenance: {
					assetId: located.assetId,
					clipId: located.clipId,
					sourceStartSec: located.sourceStartSec,
					sourceEndSec: located.sourceEndSec,
				},
				status: "unavailable",
				frameProvider: "native_compositor",
				compositorBackend: backend,
				capturePath: "live_readFrame",
				error: "media_path_missing",
				latencyMs: { ...latency, perFrameMs: Date.now() - t0 },
			});
		}

		const live = await this.tryLiveRead(input, located, backend, latency);
		if (live.status === "ok") {
			live.latencyMs.perFrameMs = Date.now() - t0;
			return live;
		}

		const exported = await this.tryBoundedExport(input, located, backend, latency);
		exported.latencyMs.perFrameMs = Date.now() - t0;
		return exported;
	}

	private async tryLiveRead(
		input: CompositedFrameSampleRequest,
		located: NonNullable<ReturnType<typeof locateProgrammeInstant>>,
		backend: CompositorBackendLabel,
		latency: ReturnType<typeof emptyLatency>,
	): Promise<CompositedFrameResult> {
		const w = input.width ?? DEFAULT_W;
		const h = input.height ?? DEFAULT_H;
		const tSetup = Date.now();
		try {
			if (this.viewId == null) {
				this.viewId = this.service.createView(
					{ x: 0, y: 0, width: w, height: h },
					{ screenPath: located.screenPath, webcamPath: "", cursorPath: "" },
				);
			}
			const tScene = Date.now();
			const scene = buildSceneDescription(input.document);
			this.service.setScene(this.viewId, JSON.stringify(scene));
			latency.sceneBuildMs = Date.now() - tScene;

			this.service.setActiveClip(
				this.viewId,
				located.screenPath,
				located.webcamPath,
				located.webcamOffsetSec,
				located.clipIndex,
				located.sourceTimeSec,
			);
			latency.compositorSetupMs = Date.now() - tSetup;

			const tPresent = Date.now();
			this.service.setPlaying(this.viewId, false);
			this.service.presentTime(this.viewId, located.sourceTimeSec);
			latency.presentMs = Date.now() - tPresent;

			const tRead = Date.now();
			let packet: { gen: number; width: number; height: number; data: Buffer } | null = null;
			for (let i = 0; i < 40; i += 1) {
				try {
					packet = this.service.readFrame(this.viewId, 0);
				} catch (err) {
					latency.readFrameMs = Date.now() - tRead;
					return resultBase({
						requestedProgrammeTimeSec: input.programmeTimeSec,
						actualSourceTimeSec: located.sourceTimeSec,
						sourceProvenance: {
							assetId: located.assetId,
							clipId: located.clipId,
							sourceStartSec: located.sourceStartSec,
							sourceEndSec: located.sourceEndSec,
						},
						status: "error",
						frameProvider: "native_compositor",
						compositorBackend: backend,
						capturePath: "live_readFrame",
						error: err instanceof Error ? err.message : String(err),
						latencyMs: { ...latency },
					});
				}
				if (packet) break;
				await new Promise((r) => setTimeout(r, 25));
			}
			latency.readFrameMs = Date.now() - tRead;

			if (!packet) {
				return resultBase({
					requestedProgrammeTimeSec: input.programmeTimeSec,
					actualSourceTimeSec: located.sourceTimeSec,
					sourceProvenance: {
						assetId: located.assetId,
						clipId: located.clipId,
						sourceStartSec: located.sourceStartSec,
						sourceEndSec: located.sourceEndSec,
					},
					status: "empty",
					frameProvider: "native_compositor",
					compositorBackend: backend,
					capturePath: "live_readFrame",
					error: "live_readFrame_timeout",
					latencyMs: { ...latency },
				});
			}

			const rgba = new Uint8Array(packet.data);
			const stats = analyzeRgba8(rgba, packet.width, packet.height);
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				actualSourceTimeSec: located.sourceTimeSec,
				sourceProvenance: {
					assetId: located.assetId,
					clipId: located.clipId,
					sourceStartSec: located.sourceStartSec,
					sourceEndSec: located.sourceEndSec,
				},
				width: packet.width,
				height: packet.height,
				rgba,
				byteLength: rgba.byteLength,
				frameProvider: "native_compositor",
				compositorBackend: backend,
				capturePath: "live_readFrame",
				status: stats.valid ? "ok" : "invalid",
				pixelStats: stats,
				latencyMs: { ...latency },
			});
		} catch (err) {
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				actualSourceTimeSec: located.sourceTimeSec,
				status: "error",
				frameProvider: "native_compositor",
				compositorBackend: backend,
				capturePath: "live_readFrame",
				error: err instanceof Error ? err.message : String(err),
				latencyMs: { ...latency },
			});
		}
	}

	private async tryBoundedExport(
		input: CompositedFrameSampleRequest,
		located: NonNullable<ReturnType<typeof locateProgrammeInstant>>,
		backend: CompositorBackendLabel,
		latency: ReturnType<typeof emptyLatency>,
	): Promise<CompositedFrameResult> {
		const pad = 0.15;
		const windowStart = Math.max(0, input.programmeTimeSec - pad);
		const windowEnd = input.programmeTimeSec + pad;
		const clips = clipInputsForProgrammeWindow(input.document, windowStart, windowEnd);
		if (clips.length === 0) {
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				actualSourceTimeSec: located.sourceTimeSec,
				sourceProvenance: {
					assetId: located.assetId,
					clipId: located.clipId,
					sourceStartSec: located.sourceStartSec,
					sourceEndSec: located.sourceEndSec,
				},
				status: "unavailable",
				frameProvider: "native_compositor",
				compositorBackend: backend,
				capturePath: "bounded_exportMulti",
				error: "no_clips_in_programme_window",
				latencyMs: { ...latency },
			});
		}

		const tScene = Date.now();
		const sceneJson = JSON.stringify(buildSceneDescription(input.document));
		latency.sceneBuildMs += Date.now() - tScene;

		const outMp4 = join(
			this.workDir,
			`cv_export_${createHash("sha1").update(String(input.programmeTimeSec)).digest("hex").slice(0, 10)}.mp4`,
		);
		const tExp = Date.now();
		const stats = await this.service.exportMulti(clips, outMp4, sceneJson, {
			width: input.width ?? DEFAULT_W,
			height: input.height ?? DEFAULT_H,
			fps: 10,
			codec: "h264",
		});
		latency.exportMs = Date.now() - tExp;

		if (!stats || !existsSync(outMp4)) {
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				actualSourceTimeSec: located.sourceTimeSec,
				sourceProvenance: {
					assetId: located.assetId,
					clipId: located.clipId,
					sourceStartSec: located.sourceStartSec,
					sourceEndSec: located.sourceEndSec,
				},
				status: "unavailable",
				frameProvider: "native_compositor",
				compositorBackend: backend,
				capturePath: "bounded_exportMulti",
				error: "exportMulti_failed",
				latencyMs: { ...latency },
			});
		}

		const w = input.width ?? DEFAULT_W;
		const h = input.height ?? DEFAULT_H;
		const rel = Math.min(
			Math.max(0, input.programmeTimeSec - windowStart),
			Math.max(0, windowEnd - windowStart - 0.05),
		);
		const decoded = decodeExportFrameRgba(outMp4, rel, w, h);
		latency.decodeMs = decoded.decodeMs;

		if (!this.retain) {
			try {
				rmSync(outMp4, { force: true });
			} catch {
				/* ignore */
			}
		}

		if (!decoded.rgba) {
			return resultBase({
				requestedProgrammeTimeSec: input.programmeTimeSec,
				actualSourceTimeSec: located.sourceTimeSec,
				sourceProvenance: {
					assetId: located.assetId,
					clipId: located.clipId,
					sourceStartSec: located.sourceStartSec,
					sourceEndSec: located.sourceEndSec,
				},
				status: "empty",
				frameProvider: "native_compositor",
				compositorBackend: backend,
				capturePath: "bounded_exportMulti",
				error: decoded.error ?? "export_frame_decode_failed",
				latencyMs: { ...latency },
			});
		}

		const pixelStats = analyzeRgba8(decoded.rgba, decoded.width, decoded.height);
		return resultBase({
			requestedProgrammeTimeSec: input.programmeTimeSec,
			actualSourceTimeSec: located.sourceTimeSec,
			sourceProvenance: {
				assetId: located.assetId,
				clipId: located.clipId,
				sourceStartSec: located.sourceStartSec,
				sourceEndSec: located.sourceEndSec,
			},
			width: decoded.width,
			height: decoded.height,
			rgba: decoded.rgba,
			byteLength: decoded.rgba.byteLength,
			frameProvider: "native_compositor",
			compositorBackend: backend,
			capturePath: "bounded_exportMulti",
			status: pixelStats.valid ? "ok" : "invalid",
			pixelStats,
			latencyMs: { ...latency },
		});
	}

	dispose(): void {
		if (this.viewId != null) {
			try {
				this.service.destroyView(this.viewId);
			} catch {
				/* ignore */
			}
			this.viewId = null;
		}
		if (!this.retain) {
			try {
				rmSync(this.workDir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}
}

function decodeExportFrameRgba(
	mp4Path: string,
	timeSec: number,
	width: number,
	height: number,
): { rgba: Uint8Array | null; width: number; height: number; decodeMs: number; error?: string } {
	const t0 = Date.now();
	let ffmpeg: string | null = null;
	try {
		ffmpeg = resolveFfmpeg();
	} catch {
		ffmpeg = null;
	}
	if (!ffmpeg || !existsSync(ffmpeg)) {
		return { rgba: null, width, height, decodeMs: Date.now() - t0, error: "ffmpeg_missing" };
	}
	const rawPath = `${mp4Path}.${Math.round(timeSec * 1000)}.rgba`;
	const result = spawnSync(
		ffmpeg,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-ss",
			String(Math.max(0, timeSec)),
			"-i",
			mp4Path,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"-s",
			`${width}x${height}`,
			"-y",
			rawPath,
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0 || !existsSync(rawPath)) {
		return {
			rgba: null,
			width,
			height,
			decodeMs: Date.now() - t0,
			error: result.stderr?.slice(0, 120) ?? "rawvideo_failed",
		};
	}
	const buf = readFileSync(rawPath);
	try {
		rmSync(rawPath, { force: true });
	} catch {
		/* ignore */
	}
	return {
		rgba: new Uint8Array(buf),
		width,
		height,
		decodeMs: Date.now() - t0,
	};
}

export function writeCompositorMeta(dir: string, meta: unknown): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "compositor-verify-meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

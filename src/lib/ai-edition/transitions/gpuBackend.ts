/**
 * Map compositor probe + runtime to Transition Registry GpuBackend.
 * Compositor only reports hardware|cpu|none; API family is Metal / D3D11 / wgpu.
 * Until native probe exposes the API enum, platform is the honest identity signal.
 */

import type { CompositorBackend } from "@/native/contracts";
import type { GpuBackend } from "../../../electron/ai-edition/transitionLibrary";

export function resolveTransitionGpuBackend(compositor: CompositorBackend | null): GpuBackend {
	if (compositor === "none" || compositor == null) {
		// No native path — only universal cut should appear; use metal list then
		// filter is still registry-gated. Prefer metal catalog for browsing in web/dev.
		return "metal";
	}
	if (typeof process !== "undefined" && process.platform === "win32") return "d3d11";
	if (typeof process !== "undefined" && process.platform === "linux") return "wgpu";
	return "metal";
}

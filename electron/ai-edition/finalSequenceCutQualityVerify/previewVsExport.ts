/**
 * Preview (compositor) vs export parity notes — evidence-backed, no pretending.
 */

export interface PreviewVsExportAssessment {
	authoritativeForVisualIntegrity: "native_compositor_frames" | "exported_mp4" | "both_needed";
	authoritativeForAudioJoin: "bounded_exportMulti_pcm" | "exported_mp4" | "both_needed";
	gaps: string[];
	recommendation: string;
	parityVerdict: "PASS" | "PARTIAL" | "FAIL";
}

/**
 * Controlled comparison design result (no live encode required for unit path).
 * Live corpus may attach measured deltas when exportMulti is available.
 */
export function assessPreviewVsExportParity(args?: {
	measuredCompositorJump?: number | null;
	measuredExportFileJump?: number | null;
}): PreviewVsExportAssessment {
	const gaps = [
		"compositorVerify samples native readFrame / short exportMulti windows — not full encode ladder.",
		"Full user export may remux/encode with different GOP/keyframes near joins.",
		"Native AUDIO_BOUNDARY_FADE_SAMPLES (~5ms) applies in assemble_concatenated_pcm for both preview-export paths that use the compositor audio assembler.",
		"CUT_FADE_HALF_SEC (0.35s) video dissolve applies in native compositor for multi-clip programmes.",
	];

	let parityVerdict: PreviewVsExportAssessment["parityVerdict"] = "PARTIAL";
	if (
		typeof args?.measuredCompositorJump === "number" &&
		typeof args?.measuredExportFileJump === "number"
	) {
		const delta = Math.abs(args.measuredCompositorJump - args.measuredExportFileJump);
		parityVerdict = delta < 0.05 ? "PASS" : delta < 0.2 ? "PARTIAL" : "FAIL";
		gaps.push(
			`measured_jump_delta=${delta.toFixed(4)} (compositor=${args.measuredCompositorJump}, exportFile=${args.measuredExportFileJump})`,
		);
	} else {
		gaps.push("No paired live export-file vs compositor jump measurement in this run.");
	}

	return {
		authoritativeForVisualIntegrity: "native_compositor_frames",
		authoritativeForAudioJoin: "bounded_exportMulti_pcm",
		gaps,
		recommendation:
			"Treat native compositor + bounded exportMulti PCM as authoritative for join QC; optionally spot-check full MP4 encode when shipping release candidates.",
		parityVerdict,
	};
}

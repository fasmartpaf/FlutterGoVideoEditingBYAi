/**
 * Parse FFmpeg loudnorm print_format=json from stderr.
 */

export interface LoudnormPrintValues {
	inputIntegratedLufs: number;
	inputTruePeakDbTp: number;
	inputLra: number;
	inputThresholdLufs: number;
	outputIntegratedLufs?: number;
	outputTruePeakDbTp?: number;
	normalizationType?: string;
	targetOffset?: number;
}

export function parseLoudnormPrintJson(stderr: string): LoudnormPrintValues | null {
	const start = stderr.lastIndexOf("{");
	const end = stderr.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const raw = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
		const input_i = Number(raw.input_i);
		const input_tp = Number(raw.input_tp);
		const input_lra = Number(raw.input_lra);
		const input_thresh = Number(raw.input_thresh);
		if (![input_i, input_tp, input_lra, input_thresh].every(Number.isFinite)) return null;
		return {
			inputIntegratedLufs: input_i,
			inputTruePeakDbTp: input_tp,
			inputLra: input_lra,
			inputThresholdLufs: input_thresh,
			...(Number.isFinite(Number(raw.output_i))
				? { outputIntegratedLufs: Number(raw.output_i) }
				: {}),
			...(Number.isFinite(Number(raw.output_tp))
				? { outputTruePeakDbTp: Number(raw.output_tp) }
				: {}),
			...(typeof raw.normalization_type === "string"
				? { normalizationType: raw.normalization_type }
				: {}),
			...(Number.isFinite(Number(raw.target_offset))
				? { targetOffset: Number(raw.target_offset) }
				: {}),
		};
	} catch {
		return null;
	}
}

export function parseFfmpegVersionBanner(text: string): string | null {
	const m = text.match(/ffmpeg version\s+([^\s]+)/i);
	return m?.[1] ?? null;
}

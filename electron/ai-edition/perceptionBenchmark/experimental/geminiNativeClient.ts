/**
 * Experimental-only Gemini Files API + generateContent client (REST).
 * NOT wired into production provider routing / chat-service.
 *
 * Uses Google Generative Language API directly (not OpenAI-compat), because
 * the OpenAI-compat path cannot attach native video file parts.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const API_ROOT = "https://generativelanguage.googleapis.com";

export interface GeminiNativeVideoRequest {
	apiKey: string;
	model: string;
	videoPath: string;
	prompt: string;
	/** Optional MIME; default video/mp4. */
	mimeType?: string;
}

export interface GeminiNativeVideoResult {
	model: string;
	uploadMethod: "files_api_resumable";
	requestMode: "generateContent_fileData";
	fileName: string;
	fileUri: string;
	fileState: string;
	videoBytes: number;
	uploadMs: number;
	processingMs: number;
	modelLatencyMs: number;
	totalMs: number;
	rawText: string;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
	rawResponse: unknown;
}

function assertOk(res: Response, body: string, label: string): void {
	if (res.ok) return;
	throw new Error(`${label} HTTP ${res.status}: ${body.slice(0, 800)}`);
}

/**
 * Resumable upload → poll until ACTIVE → generateContent with file_data.
 * Never logs the API key.
 */
export async function runGeminiNativeVideo(
	input: GeminiNativeVideoRequest,
): Promise<GeminiNativeVideoResult> {
	const t0 = Date.now();
	const mimeType = input.mimeType ?? "video/mp4";
	const videoBytes = statSync(input.videoPath).size;
	const displayName = basename(input.videoPath);

	// 1) Start resumable upload
	const startRes = await fetch(
		`${API_ROOT}/upload/v1beta/files?key=${encodeURIComponent(input.apiKey)}`,
		{
			method: "POST",
			headers: {
				"X-Goog-Upload-Protocol": "resumable",
				"X-Goog-Upload-Command": "start",
				"X-Goog-Upload-Header-Content-Length": String(videoBytes),
				"X-Goog-Upload-Header-Content-Type": mimeType,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ file: { display_name: displayName } }),
		},
	);
	const startBody = await startRes.text();
	assertOk(startRes, startBody, "files.upload.start");
	const uploadUrl = startRes.headers.get("x-goog-upload-url");
	if (!uploadUrl) throw new Error("files.upload.start missing x-goog-upload-url");

	// 2) Upload bytes
	const fileBuf = await readFileBuffer(input.videoPath);
	const putRes = await fetch(uploadUrl, {
		method: "POST",
		headers: {
			"Content-Length": String(videoBytes),
			"X-Goog-Upload-Offset": "0",
			"X-Goog-Upload-Command": "upload, finalize",
		},
		body: fileBuf,
	});
	const putBody = await putRes.text();
	assertOk(putRes, putBody, "files.upload.finalize");
	const uploadMs = Date.now() - t0;
	const uploaded = JSON.parse(putBody) as {
		file?: { name?: string; uri?: string; state?: string };
		name?: string;
		uri?: string;
		state?: string;
	};
	const fileObj = uploaded.file ?? uploaded;
	let fileName = fileObj.name ?? "";
	let fileUri = fileObj.uri ?? "";
	let fileState = fileObj.state ?? "";
	if (!fileName) throw new Error("files.upload.finalize missing file.name");

	// 3) Poll until ACTIVE
	const pollStart = Date.now();
	for (let i = 0; i < 60; i++) {
		if (fileState === "ACTIVE") break;
		if (fileState === "FAILED") throw new Error(`file processing FAILED: ${fileName}`);
		await sleep(1500);
		const getRes = await fetch(
			`${API_ROOT}/v1beta/${fileName}?key=${encodeURIComponent(input.apiKey)}`,
		);
		const getBody = await getRes.text();
		assertOk(getRes, getBody, "files.get");
		const got = JSON.parse(getBody) as { name?: string; uri?: string; state?: string };
		fileName = got.name ?? fileName;
		fileUri = got.uri ?? fileUri;
		fileState = got.state ?? fileState;
	}
	const processingMs = Date.now() - pollStart;
	if (fileState !== "ACTIVE") {
		throw new Error(`file not ACTIVE after wait (state=${fileState})`);
	}

	// 4) generateContent with native video file reference (no JPEG sampling)
	const modelLatencyStart = Date.now();
	const modelPath = input.model.startsWith("models/") ? input.model : `models/${input.model}`;
	const genRes = await fetch(
		`${API_ROOT}/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [
					{
						role: "user",
						parts: [
							{
								file_data: {
									mime_type: mimeType,
									file_uri: fileUri,
								},
							},
							{ text: input.prompt },
						],
					},
				],
			}),
		},
	);
	const genBody = await genRes.text();
	assertOk(genRes, genBody, "generateContent");
	const modelLatencyMs = Date.now() - modelLatencyStart;
	const rawResponse = JSON.parse(genBody) as {
		candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
		usageMetadata?: {
			promptTokenCount?: number;
			candidatesTokenCount?: number;
			totalTokenCount?: number;
		};
	};
	const rawText =
		rawResponse.candidates
			?.flatMap((c) => c.content?.parts ?? [])
			.map((p) => p.text ?? "")
			.join("")
			.trim() ?? "";

	return {
		model: input.model,
		uploadMethod: "files_api_resumable",
		requestMode: "generateContent_fileData",
		fileName,
		fileUri,
		fileState,
		videoBytes,
		uploadMs,
		processingMs,
		modelLatencyMs,
		totalMs: Date.now() - t0,
		rawText,
		usageMetadata: rawResponse.usageMetadata,
		rawResponse,
	};
}

async function readFileBuffer(filePath: string): Promise<Buffer> {
	const { readFile } = await import("node:fs/promises");
	return readFile(filePath);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Load Gemini API key from env / local env files. Never logs the value. */
export function loadGeminiApiKey(): string {
	const names = [
		"GOOGLE_GENERATIVE_AI_API_KEY",
		"GEMINI_API_KEY",
		"GOOGLE_API_KEY",
		"GEMINI_LLM_API_KEY",
		"GOOGLE_LLM_API_KEY",
	] as const;
	for (const n of names) {
		const v = process.env[n]?.trim();
		if (v) return v;
	}
	const candidates = [
		join(process.cwd(), "tmp/perception-benchmark/.env.gemini"),
		join(process.cwd(), "tmp/bug6-live-validation/.env.gemini"),
		join(process.cwd(), "tmp/perception-benchmark/.env.google"),
	];
	for (const p of candidates) {
		if (!existsSync(p)) continue;
		const raw = readFileSync(p, "utf8");
		for (const n of names) {
			const m = raw.match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)\\s*$`, "m"));
			if (m?.[1]) return m[1]!.trim().replace(/^["']|["']$/g, "");
		}
	}
	return "";
}

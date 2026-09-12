/**
 * Corpus registry — paths + ground truth.
 * Ground truth written only after media inspection (or RECORDING_REQUIRED).
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PerceptionGroundTruth } from "./types";

const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");

export const CORPUS_DIR = path.join(
	process.cwd(),
	"electron/ai-edition/perceptionBenchmark/corpus",
);

export function recording(name: string): string {
	return path.join(REC, name);
}

/** Case 1 — narrated tutorial (inspected + Whisper reference from Bug 5). */
export const CASE_01: PerceptionGroundTruth = {
	caseId: "case01_narrated_tutorial",
	title: "Narrated software tutorial with document progression",
	mediaPath: recording("recording-bug5-narrated.mp4"),
	durationSec: 16.896,
	status: "READY",
	notes:
		"Inspected frames: Cursor IDE + AI_VIDEO_EDITOR_TECHNICAL_AUDIT.md; HUD timer advances; later frames show capability matrix (document scroll). Speech from controlled Bug 5 narration.",
	referenceSpeech: [
		{
			startSec: 0,
			endSec: 4.5,
			text: "Today I am going to show you the open screen editor and walk through a short demo.",
		},
		{
			startSec: 4.5,
			endSec: 8.5,
			text: "First we look at the timeline and how clips are arranged on the ruler.",
		},
		{
			startSec: 10.9,
			endSec: 16.9,
			text: "Now, let's move into the code and open the technical audit document so we can review the architecture notes together.",
		},
	],
	events: [
		{
			id: "e_speech_intro",
			startSec: 0,
			endSec: 4.5,
			modality: "speech",
			expectedMeaning: "Speaker introduces OpenScreen editor demo",
			importance: "critical",
			matchHints: ["open screen", "openscreen", "demo", "editor", "walk through"],
		},
		{
			id: "e_speech_timeline",
			startSec: 4.5,
			endSec: 8.5,
			modality: "speech",
			expectedMeaning: "Speaker explains timeline / clips on the ruler",
			importance: "critical",
			matchHints: ["timeline", "clips", "ruler"],
		},
		{
			id: "e_speech_pause",
			startSec: 8.5,
			endSec: 10.9,
			modality: "speech",
			expectedMeaning: "Speech gap / pause between explanation and next topic",
			importance: "important",
			matchHints: ["pause", "gap", "silence", "speech gap", "no speech"],
		},
		{
			id: "e_speech_audit",
			startSec: 10.9,
			endSec: 16.9,
			modality: "speech",
			expectedMeaning: "Speaker moves into code / technical audit document",
			importance: "critical",
			matchHints: ["technical audit", "architecture", "code", "audit document"],
		},
		{
			id: "e_visual_editor",
			startSec: 0,
			endSec: 8,
			modality: "visual",
			expectedMeaning: "Cursor IDE showing technical audit markdown (stable app)",
			importance: "important",
			matchHints: ["cursor", "editor", "audit", "markdown", "technical"],
		},
		{
			id: "e_visual_matrix_scroll",
			startSec: 12,
			endSec: 16.9,
			modality: "visual",
			expectedMeaning: "Document content progresses to capability matrix section",
			importance: "important",
			matchHints: ["capability", "matrix", "implemented", "ocr", "whisper", "table"],
		},
	],
	mustNotClaim: [
		{
			id: "m_emotion",
			kind: "EMOTION_HALLUCINATION",
			description: "Do not invent speaker frustration/anger",
			forbiddenPatterns: ["\\bfrustrat", "\\bangry\\b", "\\bannoyed\\b", "\\bnervous\\b"],
		},
		{
			id: "m_dead_time",
			kind: "INTENT_HALLUCINATION",
			description: "Pause must not be labeled dead time to delete",
			forbiddenPatterns: ["dead\\s*time", "should be deleted", "unnecessary pause"],
		},
		{
			id: "m_settings_open",
			kind: "UI_HALLUCINATION",
			description: "Do not claim settings UI was opened",
			forbiddenPatterns: ["opened the settings", "settings (is|are) open", "user opens settings"],
		},
	],
};

/** Case 5 — same media; GT focuses on stable visual + continuous narration (s2). */
export const CASE_05: PerceptionGroundTruth = {
	caseId: "case05_stable_visual_narration",
	title: "Stable visuals with important continuous narration",
	mediaPath: recording("recording-bug5-narrated.mp4"),
	durationSec: 16.896,
	status: "READY",
	notes:
		"Same file as case01. Focus window 4.5–8.5s: speech about timeline while visuals remain the same editor/document layout (inspected).",
	referenceSpeech: CASE_01.referenceSpeech,
	events: [
		{
			id: "e_stable_visual",
			startSec: 4.5,
			endSec: 8.5,
			modality: "visual",
			expectedMeaning: "Editor layout remains the same application during narration",
			importance: "important",
			matchHints: ["stable", "unchanged", "same", "editor", "layout", "no significant"],
		},
		{
			id: "e_narration_timeline",
			startSec: 4.5,
			endSec: 8.5,
			modality: "speech",
			expectedMeaning: "Important narration about timeline/clips continues",
			importance: "critical",
			matchHints: ["timeline", "clips", "ruler"],
		},
	],
	mustNotClaim: [
		{
			id: "m_fake_app_switch",
			kind: "UI_HALLUCINATION",
			description: "Do not invent an application switch in 4.5–8.5",
			forbiddenPatterns: ["switched (to|into) (a )?(different|new) (app|application)"],
		},
		...CASE_01.mustNotClaim.filter((m) => m.id === "m_emotion"),
	],
};

/** Case 3 — partial: scroll + small table text in audit doc (21s clip). */
export const CASE_03: PerceptionGroundTruth = {
	caseId: "case03_scroll_small_text",
	title: "Code/editor document scroll with small table text",
	mediaPath: recording("recording-1788978271417.mp4"),
	cursorPath: recording("recording-1788978271417.mp4.cursor.json"),
	durationSec: 21.438,
	status: "PARTIAL",
	notes:
		"Inspected: frames change MD5 across clip; content scrolls within AI_VIDEO_EDITOR_TECHNICAL_AUDIT.md to capability matrix with small table text (OCR-relevant). Not a code-editor rapid line scroll — markdown document scroll. No controlled sub-second UI flash.",
	events: [
		{
			id: "e_doc_scroll",
			startSec: 0,
			endSec: 21,
			modality: "visual",
			expectedMeaning: "Visible document content/scroll position changes over time",
			importance: "important",
			matchHints: ["scroll", "capability", "matrix", "change", "section", "table"],
		},
		{
			id: "e_small_table_text",
			startSec: 12,
			endSec: 21,
			modality: "visual",
			expectedMeaning: "Small readable table text about OCR/NOT IMPLEMENTED becomes visible",
			importance: "critical",
			matchHints: ["ocr", "not implemented", "whisper", "cursor telemetry", "semantic"],
		},
	],
	mustNotClaim: [
		{
			id: "m_clicked_publish",
			kind: "UI_HALLUCINATION",
			description: "Do not claim a named Publish click",
			forbiddenPatterns: ["clicked Publish", "pressed Publish"],
		},
	],
};

/** Case 6 — silent + cursor. */
export const CASE_06: PerceptionGroundTruth = {
	caseId: "case06_silent_cursor",
	title: "Silent screen recording with cursor motion/clicks",
	mediaPath: recording("recording-1788958840550.mp4"),
	cursorPath: recording("recording-1788958840550.mp4.cursor.json"),
	durationSec: 4.875,
	status: "READY",
	notes:
		"Inspected: no audio stream; Cursor IDE + audit doc; cursor.json has move+click samples. No invented narration.",
	events: [
		{
			id: "e_no_speech",
			startSec: 0,
			endSec: 4.875,
			modality: "speech",
			expectedMeaning: "No spoken narration (no audio / silent)",
			importance: "critical",
			matchHints: ["no audio", "no speech", "silent", "without narration"],
		},
		{
			id: "e_cursor_activity",
			startSec: 0,
			endSec: 4.875,
			modality: "cursor",
			expectedMeaning: "Cursor movement/click activity present",
			importance: "important",
			matchHints: ["cursor", "pointer", "click", "move"],
		},
		{
			id: "e_visual_editor",
			startSec: 0,
			endSec: 4.875,
			modality: "visual",
			expectedMeaning: "Code editor / audit document visible",
			importance: "important",
			matchHints: ["editor", "audit", "cursor", "document", "code"],
		},
	],
	mustNotClaim: [
		{
			id: "m_fake_speech",
			kind: "SPEECH_HALLUCINATION",
			description: "Do not invent spoken dialogue",
			forbiddenPatterns: [
				"the (speaker|narrator) (said|says|explains)",
				"you (said|say|explain)",
				"the (user|presenter) (said|says|explains|narrates)",
			],
		},
	],
};

/** Case 8 — webcam + screen. */
export const CASE_08: PerceptionGroundTruth = {
	caseId: "case08_webcam_screen",
	title: "Screen recording with separate webcam track",
	mediaPath: recording("recording-1788895487347.mp4"),
	webcamPath: recording("recording-1788895487347-webcam.webm"),
	cursorPath: recording("recording-1788895487347.mp4.cursor.json"),
	durationSec: 12.38,
	status: "READY",
	notes:
		"Inspected: screen shows Cursor + Openscreen localhost preview; webcam webm shows a person (face). Current OpenScreen visual prep may only attach screen frames unless webcam is primary — baseline must report that honestly.",
	events: [
		{
			id: "e_screen_openscreen",
			startSec: 0,
			endSec: 12,
			modality: "visual",
			expectedMeaning: "Screen shows development UI / OpenScreen or editor",
			importance: "important",
			matchHints: ["openscreen", "editor", "cursor", "localhost", "electron"],
		},
		{
			id: "e_webcam_person",
			startSec: 0,
			endSec: 12,
			modality: "visual",
			expectedMeaning: "Webcam track contains a visible person/face",
			importance: "critical",
			matchHints: ["webcam", "camera", "face", "person", "talking", "pip"],
		},
	],
	mustNotClaim: [
		{
			id: "m_emotion_face",
			kind: "EMOTION_HALLUCINATION",
			description: "Do not claim specific emotions from face",
			forbiddenPatterns: ["\\bfrustrat", "\\bangry\\b", "\\bhappy\\b", "\\bsad\\b"],
		},
	],
};

/** Case 10 — contradiction fixture (visual from real clip; speech injected at eval time). */
export const CASE_10: PerceptionGroundTruth = {
	caseId: "case10_speech_visual_contradiction",
	title: "Speech claims settings open; visuals do not confirm",
	mediaPath: recording("recording-1788930909064.mp4"),
	cursorPath: recording("recording-1788930909064.mp4.cursor.json"),
	durationSec: 11.8,
	status: "READY",
	notes:
		"Visual inspected: code editor, not a settings panel. Eval injects transcript 'Now I'm opening the settings.' System must preserve contradiction.",
	referenceSpeech: [{ startSec: 0, endSec: 4, text: "Now I'm opening the settings." }],
	events: [
		{
			id: "e_speech_settings_claim",
			startSec: 0,
			endSec: 4,
			modality: "speech",
			expectedMeaning: "Speech mentions opening settings",
			importance: "critical",
			matchHints: ["settings", "opening"],
		},
		{
			id: "e_visual_not_settings",
			startSec: 0,
			endSec: 8,
			modality: "visual",
			expectedMeaning: "Visuals remain code editor; settings UI not established",
			importance: "critical",
			matchHints: ["code", "editor", "no significant", "stable", "not", "does not", "unclear"],
		},
		{
			id: "e_contradiction_preserved",
			startSec: 0,
			endSec: 8,
			modality: "multimodal",
			expectedMeaning: "Speech≠visual distinction retained",
			importance: "critical",
			matchHints: [
				"but",
				"does not",
				"not clearly",
				"no visual",
				"cannot confirm",
				"without",
				"mentions",
			],
		},
	],
	mustNotClaim: [
		{
			id: "m_settings_confirmed",
			kind: "UI_HALLUCINATION",
			description: "Do not assert settings were actually opened",
			forbiddenPatterns: [
				"as the user opens settings",
				"opened the settings",
				"settings (is|are) open",
				"successfully opened settings",
			],
		},
	],
};

export const CASE_02_REQUIRED: PerceptionGroundTruth = {
	caseId: "case02_fast_ui_event",
	title: "Fast sub-second UI event (dropdown/modal)",
	mediaPath: null,
	status: "RECORDING_REQUIRED",
	recordingScript: [
		"CASE 2 — FAST UI EVENT",
		"",
		"Duration: ~10–12 seconds",
		"Voice: none (silent)",
		"",
		"Procedure:",
		"0.0–2.0s  Keep Cursor (or any app) fully stable — no clicks.",
		"~2.5s     Open a dropdown or menu (e.g. editor tab context menu OR macOS menu).",
		"~2.5–2.9s Close it within ~0.4 seconds (important: fully closed before 3.0s).",
		"3.0–6.0s  Continue with stable screen; move mouse slowly only.",
		"6.0–8.0s  Optional: one normal click on a file in the sidebar (slow, deliberate).",
		"8.0–10s   Hold still, then stop recording.",
		"",
		"Do NOT narrate. Do NOT leave the menu open.",
		"After recording: we will annotate the exact open/close times from the file.",
	].join("\n"),
	events: [],
	mustNotClaim: [],
};

export const CASE_04_REQUIRED: PerceptionGroundTruth = {
	caseId: "case04_spoken_correction",
	title: "Spoken correction (Actually… / let me go back…)",
	mediaPath: null,
	status: "RECORDING_REQUIRED",
	recordingScript: [
		"CASE 4 — SPOKEN CORRECTION",
		"",
		"Duration: ~15–20 seconds",
		"Voice: required (mic on)",
		"Visual: stay on one stable editor screen (no app switching).",
		"",
		"Script (say clearly):",
		'0–5s   "First I will open the timeline panel to arrange clips."',
		'5–8s   "I mean — actually, let me go back. I meant the effects panel, not the timeline."',
		'8–14s  "Okay, now looking at the effects panel settings."',
		"",
		"Visual: do NOT actually open either panel if possible — or open something different —",
		"so speech correction is the signal, not a perfect UI match.",
		"Stop after ~15–20s.",
		"",
		"After recording: annotate correction span from waveform/transcript.",
	].join("\n"),
	events: [],
	mustNotClaim: [],
};

export const CASE_07_REQUIRED: PerceptionGroundTruth = {
	caseId: "case07_brief_notification",
	title: "Brief notification / transient UI state",
	mediaPath: null,
	status: "RECORDING_REQUIRED",
	recordingScript: [
		"CASE 7 — BRIEF NOTIFICATION",
		"",
		"Duration: ~12 seconds",
		"Voice: optional short line OR silent",
		"",
		"Procedure:",
		"0–3s   Stable editor fullscreen.",
		"~3.5s  Trigger a brief OS or app notification that appears then disappears",
		"       (examples: Toggle macOS Focus / send a test notification /",
		"       unmute-mute mic so OpenScreen HUD or system toast flashes).",
		"       The toast must be visible <1.5s then gone.",
		"5–10s  Continue stable; do not reopen notification center.",
		"Stop.",
		"",
		"Goal: a visual event shorter than the 2s sampling grid.",
		"After recording: mark exact appear/disappear times.",
	].join("\n"),
	events: [],
	mustNotClaim: [],
};

export const CASE_09_REQUIRED: PerceptionGroundTruth = {
	caseId: "case09_pause_nonspeech_sound",
	title: "Speech pause plus meaningful non-speech sound",
	mediaPath: null,
	status: "RECORDING_REQUIRED",
	recordingScript: [
		"CASE 9 — PAUSE + NON-SPEECH SOUND",
		"",
		"Duration: ~15 seconds",
		"Voice: mic on; capture system/keyboard if possible",
		"",
		"Procedure:",
		'0–4s    Say: "Next I will save the project."',
		"4–7s    Stay silent. During silence, press several keyboard keys loudly",
		"        OR play a short notification chime once (non-speech).",
		'7–12s   Say: "Saved. Now we continue with the export settings."',
		"Stop.",
		"",
		"Do not talk over the non-speech sound.",
		"After recording: mark speech spans, silence span, and non-speech event time.",
	].join("\n"),
	events: [],
	mustNotClaim: [],
};

export const ALL_CASES: PerceptionGroundTruth[] = [
	CASE_01,
	CASE_02_REQUIRED,
	CASE_03,
	CASE_04_REQUIRED,
	CASE_05,
	CASE_06,
	CASE_07_REQUIRED,
	CASE_08,
	CASE_09_REQUIRED,
	CASE_10,
];

export function resolveCorpusMedia(gt: PerceptionGroundTruth): {
	mediaReady: boolean;
	missing: string[];
} {
	const missing: string[] = [];
	if (!gt.mediaPath) missing.push("mediaPath");
	else if (!existsSync(gt.mediaPath)) missing.push(`missing file: ${gt.mediaPath}`);
	if (gt.cursorPath && !existsSync(gt.cursorPath)) missing.push(`cursor: ${gt.cursorPath}`);
	if (gt.webcamPath && !existsSync(gt.webcamPath)) missing.push(`webcam: ${gt.webcamPath}`);
	return { mediaReady: missing.length === 0 && gt.mediaPath != null, missing };
}

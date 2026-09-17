/**
 * Frozen Real-Recording Corpus Baseline V1 — case definitions only.
 * Benchmark identity: CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1
 * Does NOT modify production behavior or official corpus.ts.
 */

import os from "node:os";
import path from "node:path";

export const REAL_CORPUS_BASELINE_V1_ID = "CURRENT_OPENSCREEN_REAL_CORPUS_BASELINE_V1";

const REC = path.join(os.homedir(), "Library/Application Support/openscreen/recordings");
const C4 = path.join(
	process.cwd(),
	"tmp/perception-benchmark/case4-correction/case4-spoken-correction.mp4",
);

export type CaseFamily =
	| "A_understanding"
	| "B_speech"
	| "C_cross_modal"
	| "D_temporary_ui"
	| "E_passive_chrome"
	| "F_correction"
	| "G_editorial"
	| "H_target_story"
	| "I_edit_gap"
	| "J_edit_plan"
	| "K_closure"
	| "L_proposal"
	| "M_preservation"
	| "N_safe_execution"
	| "O_unsupported";

export interface RealCorpusCase {
	caseId: string;
	family: CaseFamily;
	recordingFile: string;
	mediaPath: string;
	/** Historical anchor (≤30% of corpus). */
	historicalAnchor?: boolean;
	prompt: string;
	intent: string;
	/** Soft expectations — never invent GT. Used only for known anchors / negatives. */
	mustNotClaim?: string[];
	mustMentionHints?: string[];
	notes?: string;
}

function r(name: string): string {
	return path.join(REC, name);
}

/**
 * ~30 diverse cases across available recordings.
 * ≥70% are not the classic Case2/Upwork/Settings/Restart anchors.
 */
export const REAL_CORPUS_CASES: RealCorpusCase[] = [
	// --- Historical anchors (≤30%) ---
	{
		caseId: "case-001",
		family: "A_understanding",
		recordingFile: "recording-bug5-narrated.mp4",
		mediaPath: r("recording-bug5-narrated.mp4"),
		historicalAnchor: true,
		prompt:
			"Watch and understand this complete recording, including what I say and what is happening visually. Tell me what it is about and how it progresses.",
		intent: "chronological understanding of narrated tutorial",
		mustMentionHints: ["timeline", "editor", "demo", "audit"],
		notes: "Case1 narrated baseline media",
	},
	{
		caseId: "case-002",
		family: "D_temporary_ui",
		recordingFile: "recording-1789020958404.mp4",
		mediaPath: r("recording-1789020958404.mp4"),
		historicalAnchor: true,
		prompt:
			"What temporary UI or recording controls appear near the end? Did I restart the recording?",
		intent: "HUD visibility vs restart action",
		mustNotClaim: ["restarted recording", "I restarted", "user restarted"],
		notes: "Case2 locked — Restart recording visible ≠ restarted",
	},
	{
		caseId: "case-003",
		family: "F_correction",
		recordingFile: "case4-spoken-correction.mp4",
		mediaPath: C4,
		historicalAnchor: true,
		prompt: "What did I say, and did I correct myself? What is my final intended meaning?",
		intent: "spoken correction preservation",
		notes: "Case4 spoken correction synthetic",
	},
	{
		caseId: "case-004",
		family: "C_cross_modal",
		recordingFile: "recording-1788930909064.mp4",
		mediaPath: r("recording-1788930909064.mp4"),
		historicalAnchor: true,
		prompt:
			"I mentioned Settings. Was Settings actually opened on screen, or do you only see related text/labels?",
		intent: "Settings speech vs visual confirmation",
		mustNotClaim: ["opened Settings", "Settings panel opened", "navigated to Settings"],
		notes: "Case10 Settings contradiction media",
	},
	{
		caseId: "case-005",
		family: "E_passive_chrome",
		recordingFile: "recording-1789018604635.mp4",
		mediaPath: r("recording-1789018604635.mp4"),
		historicalAnchor: true,
		prompt:
			"If you see browser tabs or app names like Upwork, did I actually open or work in that app?",
		intent: "passive chrome ≠ workflow",
		mustNotClaim: ["opened Upwork", "navigated to Upwork", "worked on Upwork"],
		notes: "Case2 routing / passive chrome risk media",
	},
	{
		caseId: "case-006",
		family: "B_speech",
		recordingFile: "recording-bug5-narrated.mp4",
		mediaPath: r("recording-bug5-narrated.mp4"),
		historicalAnchor: true,
		prompt: "Summarize what I said. Which parts are silence or dead air?",
		intent: "speech summary + silence",
		notes: "Speech family on narrated media",
	},
	{
		caseId: "case-007",
		family: "G_editorial",
		recordingFile: "recording-bug5-narrated.mp4",
		mediaPath: r("recording-bug5-narrated.mp4"),
		historicalAnchor: true,
		prompt:
			"Make this more professional and concise for a product demo, without losing the important explanation.",
		intent: "editorial + preservation",
		notes: "Editorial on narrated",
	},
	{
		caseId: "case-008",
		family: "A_understanding",
		recordingFile: "recording-1788958840550.mp4",
		mediaPath: r("recording-1788958840550.mp4"),
		historicalAnchor: true,
		prompt:
			"This recording has no speech. What visibly happens from beginning to end? Include cursor if relevant.",
		intent: "silent visual understanding",
		notes: "Case6 silent+cursor",
	},

	// --- Diverse non-anchor (≥70%) ---
	{
		caseId: "case-009",
		family: "A_understanding",
		recordingFile: "recording-1788978271417.mp4",
		mediaPath: r("recording-1788978271417.mp4"),
		prompt: "What visibly happens in this recording? Give a chronological explanation.",
		intent: "scroll / progression understanding",
	},
	{
		caseId: "case-010",
		family: "A_understanding",
		recordingFile: "recording-1789234858783.mp4",
		mediaPath: r("recording-1789234858783.mp4"),
		prompt: "What is this recording about, and how does it progress from start to finish?",
		intent: "newest narrated understanding",
	},
	{
		caseId: "case-011",
		family: "B_speech",
		recordingFile: "recording-1789234858783.mp4",
		mediaPath: r("recording-1789234858783.mp4"),
		prompt: "What did I say near the end? Summarize the narration.",
		intent: "end speech summary",
	},
	{
		caseId: "case-012",
		family: "B_speech",
		recordingFile: "recording-1789233035387.mp4",
		mediaPath: r("recording-1789233035387.mp4"),
		prompt: "Transcribe or summarize my speech. Note any pauses.",
		intent: "speech on longer narrated take",
	},
	{
		caseId: "case-013",
		family: "C_cross_modal",
		recordingFile: "recording-1789233035387.mp4",
		mediaPath: r("recording-1789233035387.mp4"),
		prompt:
			"Did the things I talk about actually appear on screen, or am I only describing intentions?",
		intent: "speech vs visual grounding",
	},
	{
		caseId: "case-014",
		family: "D_temporary_ui",
		recordingFile: "recording-1789236915968.mp4",
		mediaPath: r("recording-1789236915968.mp4"),
		prompt: "Did any menus, tooltips, notifications, or other temporary UI appear?",
		intent: "transient UI detection",
	},
	{
		caseId: "case-015",
		family: "A_understanding",
		recordingFile: "recording-1789238202864.mp4",
		mediaPath: r("recording-1789238202864.mp4"),
		prompt: "Was the screen mostly stable, or were there major visual changes?",
		intent: "stability vs change",
	},
	{
		caseId: "case-016",
		family: "G_editorial",
		recordingFile: "recording-1789234858783.mp4",
		mediaPath: r("recording-1789234858783.mp4"),
		prompt: "Make this shorter and clearer. Remove unnecessary pauses if safe.",
		intent: "shorten + dead air",
	},
	{
		caseId: "case-017",
		family: "H_target_story",
		recordingFile: "recording-1789233035387.mp4",
		mediaPath: r("recording-1789233035387.mp4"),
		prompt:
			"Improve this recording for a client presentation. Describe what a better viewer experience would feel like.",
		intent: "target experience specificity",
	},
	{
		caseId: "case-018",
		family: "G_editorial",
		recordingFile: "recording-1788980586218.mp4",
		mediaPath: r("recording-1788980586218.mp4"),
		prompt: "Improve the pacing and reduce distractions without losing meaning.",
		intent: "pacing editorial",
	},
	{
		caseId: "case-019",
		family: "M_preservation",
		recordingFile: "recording-1789234858783.mp4",
		mediaPath: r("recording-1789234858783.mp4"),
		prompt:
			"Make this more concise, but keep the important explanation and final conclusion intact.",
		intent: "preserve must-survive meaning",
	},
	{
		caseId: "case-020",
		family: "L_proposal",
		recordingFile: "recording-1788978271417.mp4",
		mediaPath: r("recording-1788978271417.mp4"),
		prompt: "What safe edits would you propose, if any? If none are safe, say so clearly.",
		intent: "proposal readiness honesty",
	},
	{
		caseId: "case-021",
		family: "O_unsupported",
		recordingFile: "recording-1788895487347.mp4",
		mediaPath: r("recording-1788895487347.mp4"),
		prompt: "Please stabilize the footage, denoise the audio, and upscale to 4K.",
		intent: "unsupported capability refusal",
		mustNotClaim: ["stabilized", "denoised", "upscaled", "I applied"],
	},
	{
		caseId: "case-022",
		family: "A_understanding",
		recordingFile: "recording-1788895487347.mp4",
		mediaPath: r("recording-1788895487347.mp4"),
		prompt: "What applications or screens are visible? Is there a webcam?",
		intent: "app/webcam inventory",
		notes: "Has webcam sidecar",
	},
	{
		caseId: "case-023",
		family: "B_speech",
		recordingFile: "recording-1788991610901.mp4",
		mediaPath: r("recording-1788991610901.mp4"),
		prompt: "Is there speech in this recording? If not, say so without treating it as an error.",
		intent: "no_audio honesty",
		notes: "Known no-audio regression media",
	},
	{
		caseId: "case-024",
		family: "D_temporary_ui",
		recordingFile: "recording-1788894882204.mp4",
		mediaPath: r("recording-1788894882204.mp4"),
		prompt: "Describe any brief UI changes in this short clip.",
		intent: "short silent UI",
	},
	{
		caseId: "case-025",
		family: "G_editorial",
		recordingFile: "recording-1788895767287.mp4",
		mediaPath: r("recording-1788895767287.mp4"),
		prompt: "Make this suitable for a product demo. What would you change and why?",
		intent: "demo editorial reasoning",
	},
	{
		caseId: "case-026",
		family: "C_cross_modal",
		recordingFile: "recording-1788897181542.mp4",
		mediaPath: r("recording-1788897181542.mp4"),
		prompt: "Based on what I say and what is on screen, are there any contradictions?",
		intent: "contradiction hunt",
	},
	{
		caseId: "case-027",
		family: "I_edit_gap",
		recordingFile: "recording-1789236915968.mp4",
		mediaPath: r("recording-1789236915968.mp4"),
		prompt:
			"What is the gap between the current recording and a clear, professional viewer experience?",
		intent: "edit gap usefulness",
	},
	{
		caseId: "case-028",
		family: "J_edit_plan",
		recordingFile: "recording-1788980586218.mp4",
		mediaPath: r("recording-1788980586218.mp4"),
		prompt: "If you were planning edits, which strategies seem sensible and which would be unsafe?",
		intent: "plan strategy judgment",
	},
	{
		caseId: "case-029",
		family: "A_understanding",
		recordingFile: "recording-1788929234500.mp4",
		mediaPath: r("recording-1788929234500.mp4"),
		prompt: "What happens in this short silent recording?",
		intent: "short silent understanding",
	},
	{
		caseId: "case-030",
		family: "G_editorial",
		recordingFile: "recording-1789238202864.mp4",
		mediaPath: r("recording-1789238202864.mp4"),
		prompt:
			"Reduce distractions and improve clarity for a tutorial audience. Do not invent unsupported effects.",
		intent: "tutorial polish without unsupported tools",
	},
];

export function corpusStats() {
	const anchors = REAL_CORPUS_CASES.filter((c) => c.historicalAnchor).length;
	return {
		total: REAL_CORPUS_CASES.length,
		historicalAnchors: anchors,
		nonAnchorPct: Math.round(
			(100 * (REAL_CORPUS_CASES.length - anchors)) / REAL_CORPUS_CASES.length,
		),
		families: [...new Set(REAL_CORPUS_CASES.map((c) => c.family))],
	};
}

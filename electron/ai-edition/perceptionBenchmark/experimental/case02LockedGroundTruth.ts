/**
 * Locked Case 2 ground truth for recording-1789020958404.mp4.
 * Used ONLY for post-hoc scoring of provider predictions.
 * Never injected into provider prompts.
 */

import type { PerceptionGroundTruth } from "../types";

export const CASE2_LOCKED_MEDIA =
	"/Users/osama/Library/Application Support/openscreen/recordings/recording-1789020958404.mp4";

export const CASE2_LOCKED_DURATION_SEC = 19.886667;

/**
 * Human GT from manual frame inspection (benchmark Case 2 / temporary UI).
 * Timestamps are approximate windows from inspect evidence.
 */
export const CASE2_LOCKED_GROUND_TRUTH: PerceptionGroundTruth = {
	caseId: "case02_fast_ui_event",
	title: "Case 2 FAST UI — locked recording 1789020958404",
	mediaPath: CASE2_LOCKED_MEDIA,
	durationSec: CASE2_LOCKED_DURATION_SEC,
	status: "READY",
	notes:
		"Experiment GT for provider comparison. Do not feed into provider prompts. Official corpus case02 remains RECORDING_REQUIRED separately.",
	events: [
		{
			id: "file_menu_open",
			startSec: 0,
			endSec: 3.5,
			modality: "visual",
			importance: "critical",
			expectedMeaning: "Chrome File menu is open at the beginning of the recording",
			matchHints: [
				"file menu",
				'"file" menu',
				'file" menu',
				"file dropdown",
				"menu open",
				"open file menu",
				"chrome menu",
				"dropdown list",
				"menu is visible",
				"menu dropdown is still open",
			],
		},
		{
			id: "menu_highlight",
			startSec: 0,
			endSec: 3.5,
			modality: "visual",
			importance: "critical",
			expectedMeaning: "A File-menu item is highlighted (New Incognito Window)",
			matchHints: [
				"incognito",
				"new incognito",
				"highlighted",
				"highlight",
				"selected menu",
				"blue highlight",
			],
		},
		{
			id: "menu_closure",
			startSec: 3,
			endSec: 5.5,
			modality: "visual",
			importance: "important",
			expectedMeaning: "File menu closes / is no longer open",
			matchHints: [
				"menu closed",
				"menu closes",
				"closed the menu",
				"menu disappears",
				"dropdown closed",
				"no longer open",
				"no longer visible",
				"is no longer visible",
			],
		},
		{
			id: "app_transition",
			startSec: 4.5,
			endSec: 8,
			modality: "visual",
			importance: "critical",
			expectedMeaning: "Major transition from Chrome/ChatGPT to Android Studio",
			matchHints: [
				"android studio",
				"switches to",
				"transitions to",
				"changes to android",
				"ide",
				"chatgpt",
				"chrome",
			],
		},
		{
			id: "deeplink_json",
			startSec: 14,
			endSec: 19.9,
			modality: "visual",
			importance: "supporting",
			expectedMeaning: "deeplink.json (or similar JSON config) is open later",
			matchHints: ["deeplink", "deeplink.json", "applicationid", "json"],
		},
		{
			id: "restart_tooltip",
			startSec: 16.5,
			endSec: 19.9,
			modality: "visual",
			importance: "critical",
			expectedMeaning: "Brief bottom-center 'Restart recording' tooltip/HUD near the end",
			matchHints: [
				"restart recording",
				"restart tooltip",
				"tooltip saying restart",
				"tooltip: restart",
				'"restart"',
				"restart button tooltip",
			],
		},
	],
	mustNotClaim: [
		{
			id: "invented_speech",
			kind: "SPEECH_HALLUCINATION",
			description: "Must not invent spoken narration (recording has no audio)",
			forbiddenPatterns: [
				"\\b(he|she|they|narrator|speaker)\\s+(said|says|explained|explains)\\b",
				"\\btranscript shows\\b",
			],
		},
		{
			id: "invented_click_intent",
			kind: "INTENT_HALLUCINATION",
			description: "Must not invent user intent that is not visible",
			forbiddenPatterns: ["\\bfrustrated\\b", "\\bintentionally clicked\\b"],
		},
	],
};

/** Fair user task shared with CURRENT_OPENSCREEN Case 2 product turn (no GT hints). */
export const CASE2_FAIR_USER_PROMPT = `Watch this complete recording carefully and explain what visibly happens from beginning to end.

Pay particular attention to temporary UI states: menus opening or closing, tooltips, notifications, popovers, highlighted items, or anything that appears only briefly.

Tell me the important visual changes in chronological order.

Do not invent button names, menu names, clicks, or user intent that you cannot clearly verify from what is visible.

There is no audio in this recording, so focus only on the visual sequence.

Explain it naturally.`;

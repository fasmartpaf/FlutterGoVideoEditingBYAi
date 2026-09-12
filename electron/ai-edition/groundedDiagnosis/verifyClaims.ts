/**
 * Grounded video diagnosis — fact ledger + claim verification.
 *
 * Inspired by VideoMind / VideoHV-Agent / MMCTAgent patterns:
 * perceive structured surfaces → ledger → verify user claims → narrate.
 * Stops “tab chrome” (e.g. Upwork tab) from becoming invented active browsing.
 */

import type {
	VisualSemanticGrounding,
	VisualSemanticObservation,
} from "../visualEvidence/semantic";

export type SurfaceRole = "frontmost" | "tab" | "behind" | "dock" | "unknown";

export interface SurfaceFact {
	name: string;
	role: SurfaceRole;
	sourceTimeSec?: number;
}

export interface DiagnosisLedger {
	frontmostNames: string[];
	backgroundNames: string[];
	spokenText: string;
}

const APP_ALIASES: Array<{ canonical: string; patterns: RegExp }> = [
	{ canonical: "upwork", patterns: [/\bupwork\b/i] },
	{ canonical: "cursor", patterns: [/\bcursor\b/i] },
	{ canonical: "chatgpt", patterns: [/\bchatgpt\b/i, /\bchat\s*gpt\b/i] },
	{ canonical: "chrome", patterns: [/\bchrome\b/i, /\bgoogle chrome\b/i] },
	{ canonical: "strathclyde", patterns: [/\bstrathclyde\b/i, /\bpegasus\b/i, /\badmissions?\b/i] },
	{ canonical: "app store connect", patterns: [/\bapp store connect\b/i, /\btestflight\b/i] },
	{ canonical: "whatsapp", patterns: [/\bwhatsapp\b/i] },
	{ canonical: "openscreen", patterns: [/\bopenscreen\b/i] },
];

/** Activity language that implies the app was the working surface, not just a tab. */
const ACTIVE_BROWSING = [
	/\bnavigat(?:e|ing)\b/i,
	/\bbrows(?:e|ing)\b/i,
	/\bjob listings?\b/i,
	/\bexplore (?:job|jobs|opportunit)/i,
	/\blooking (?:at|through) (?:jobs?|listings?)\b/i,
	/\bworking (?:in|on|inside)\b/i,
	/\bopen(?:ed|ing)?\b.{0,40}\b(?:page|site|dashboard)\b/i,
];

function normalizeName(raw: string): string {
	const t = raw.trim().toLowerCase();
	for (const a of APP_ALIASES) {
		if (a.patterns.some((p) => p.test(t))) return a.canonical;
	}
	return t;
}

function namesFromText(text: string): string[] {
	const found: string[] = [];
	for (const a of APP_ALIASES) {
		if (a.patterns.some((p) => p.test(text))) found.push(a.canonical);
	}
	return found;
}

function observationFrontmost(obs: VisualSemanticObservation): string[] {
	const surf = (
		obs as VisualSemanticObservation & {
			frontmostSurface?: { name?: string };
			backgroundSurfaces?: Array<{ name?: string }>;
		}
	).frontmostSurface;
	if (surf?.name) return [normalizeName(surf.name)];
	// Fallback: prefer observed[] lines that mention frontmost / focused.
	const lines = [...(obs.observed ?? []), obs.frameSummary];
	const out: string[] = [];
	for (const line of lines) {
		if (/\b(frontmost|focused|foreground|active window)\b/i.test(line)) {
			out.push(...namesFromText(line));
		}
	}
	if (out.length === 0) {
		// Weak fallback: first app name in frameSummary is often the main UI.
		const fromSummary = namesFromText(obs.frameSummary);
		if (fromSummary.length > 0) out.push(fromSummary[0]!);
	}
	return [...new Set(out)];
}

function observationBackground(obs: VisualSemanticObservation): string[] {
	const bg = (
		obs as VisualSemanticObservation & {
			backgroundSurfaces?: Array<{ name?: string }>;
		}
	).backgroundSurfaces;
	if (bg?.length) {
		return [...new Set(bg.map((b) => normalizeName(b.name ?? "")).filter(Boolean))];
	}
	const lines = [...(obs.observed ?? []), ...(obs.inferred ?? []), obs.frameSummary];
	const out: string[] = [];
	for (const line of lines) {
		if (/\b(tab|tabs|behind|background|dock)\b/i.test(line)) {
			out.push(...namesFromText(line));
		}
	}
	return [...new Set(out)];
}

export function buildDiagnosisLedger(input: {
	grounding?: VisualSemanticGrounding | null;
	speechText?: string;
}): DiagnosisLedger {
	const front = new Set<string>();
	const back = new Set<string>();
	for (const obs of input.grounding?.observations ?? []) {
		for (const n of observationFrontmost(obs)) front.add(n);
		for (const n of observationBackground(obs)) back.add(n);
	}
	// Anything only named in background stays background even if also guessed front.
	for (const n of back) {
		if (!front.has(n)) continue;
		// Keep dual-listed names in both; verifier uses "active claim needs frontmost".
	}
	return {
		frontmostNames: [...front],
		backgroundNames: [...back].filter((n) => !front.has(n) || back.has(n)),
		spokenText: (input.speechText ?? "").toLowerCase(),
	};
}

export interface ClaimViolation {
	app: string;
	reason: string;
	snippet: string;
}

/**
 * Detect user-facing overclaims: treating a background tab as an active workspace.
 * Classic failure: Upwork tab visible → “navigating Upwork job listings”.
 */
export function findUngroundedActiveSurfaceClaims(
	userFacingText: string,
	ledger: DiagnosisLedger,
): ClaimViolation[] {
	const violations: ClaimViolation[] = [];
	const sentences = userFacingText
		.split(/(?<=[.!?])\s+|\n+/)
		.map((s) => s.trim())
		.filter(Boolean);

	for (const sentence of sentences) {
		const hasActiveVerb = ACTIVE_BROWSING.some((p) => p.test(sentence));
		if (!hasActiveVerb) continue;
		for (const a of APP_ALIASES) {
			if (!a.patterns.some((p) => p.test(sentence))) continue;
			const name = a.canonical;
			const wasFrontmost = ledger.frontmostNames.includes(name);
			const wasBackgroundOnly = ledger.backgroundNames.includes(name) && !wasFrontmost;
			const spokenSupports = a.patterns.some((p) => p.test(ledger.spokenText));
			if (wasBackgroundOnly && !spokenSupports) {
				violations.push({
					app: name,
					reason: "active browsing claimed for background-only surface",
					snippet: sentence.slice(0, 180),
				});
			}
			// Also catch invented activity when the app never appears in ledger at all
			// but sentence invents job-listing browsing (Upwork-specific strong prior).
			if (
				name === "upwork" &&
				/\bjob listings?\b|\bexplore (?:job|jobs)/i.test(sentence) &&
				!wasFrontmost
			) {
				if (!violations.some((v) => v.app === name && v.snippet === sentence.slice(0, 180))) {
					violations.push({
						app: name,
						reason: "job-listing activity not supported by frontmost evidence",
						snippet: sentence.slice(0, 180),
					});
				}
			}
		}
	}
	return violations;
}

/**
 * Soft sanitize: remove or rewrite sentences that invent active use of background tabs.
 * Keeps calm, precise narration without inventing replacements.
 */
export function sanitizeUngroundedActiveClaims(
	userFacingText: string,
	violations: ClaimViolation[],
): string {
	if (violations.length === 0) return userFacingText;
	const dropApps = new Set(violations.map((v) => v.app));
	const parts = userFacingText.split(/(?<=[.!?])\s+|\n+/);
	const kept: string[] = [];
	let insertedUpworkNote = false;
	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const lower = trimmed.toLowerCase();
		const mentionsViolatingApp = [...dropApps].some((app) => {
			const alias = APP_ALIASES.find((a) => a.canonical === app);
			return alias ? alias.patterns.some((p) => p.test(trimmed)) : lower.includes(app);
		});
		const isOrphanJobBrowse =
			dropApps.has("upwork") &&
			(/\bjob listings?\b/i.test(trimmed) ||
				/\bexplore (?:job|jobs|opportunit)/i.test(trimmed) ||
				(/\bnavigat(?:e|ing)\b/i.test(trimmed) && /\b(site|website|page)\b/i.test(trimmed)));

		if (mentionsViolatingApp && ACTIVE_BROWSING.some((p) => p.test(trimmed))) {
			if (dropApps.has("upwork") && !insertedUpworkNote) {
				kept.push(
					"An Upwork tab is visible in the browser, but the recording does not show you actively using Upwork.",
				);
				insertedUpworkNote = true;
			}
			continue;
		}
		if (isOrphanJobBrowse) continue;
		kept.push(trimmed);
	}
	return kept.join(" ").replace(/\s+/g, " ").trim();
}

export function verifyAndSanitizeUserFacingNarration(input: {
	userFacingText: string;
	grounding?: VisualSemanticGrounding | null;
	speechText?: string;
}): { text: string; violations: ClaimViolation[]; ledger: DiagnosisLedger } {
	const ledger = buildDiagnosisLedger({
		grounding: input.grounding,
		speechText: input.speechText,
	});
	const violations = findUngroundedActiveSurfaceClaims(input.userFacingText, ledger);
	const text = sanitizeUngroundedActiveClaims(input.userFacingText, violations);
	return { text, violations, ledger };
}

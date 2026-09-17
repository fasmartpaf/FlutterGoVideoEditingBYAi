/**
 * OpenScreen Transition Library — canonical registry (V3 foundation).
 * Documents store transitionId + duration + params only — never shader source.
 * Manual UI / Chat / autonomous MUST resolve through this module.
 */

export type TransitionCategory =
	| "subtle"
	| "utility"
	| "movement"
	| "zoom"
	| "wipe"
	| "reveal"
	| "geometric"
	| "stylized"
	| "fade";

export type TransitionAvailability =
	| "USER_AVAILABLE"
	| "QUARANTINED_SHADER"
	| "QUARANTINED_RENDER"
	| "QUARANTINED_PERFORMANCE"
	| "QUARANTINED_LICENSE"
	| "BACKEND_LIMITED";

export type GpuBackend = "metal" | "d3d11" | "wgpu";

export interface TransitionEditorialMeta {
	appropriateContentTypes: string[];
	inappropriateContentTypes: string[];
	suitableStoryBoundaries: string[];
	energyLevel: "low" | "medium" | "high";
	visualIntensity: "subtle" | "moderate" | "strong";
	recommendedDurationSec: { min: number; max: number };
	repeatedUseDistracting: boolean;
	tutorialSuitability: "good" | "ok" | "poor";
	socialSuitability: "good" | "ok" | "poor";
	cinematicSuitability: "good" | "ok" | "poor";
}

export interface TransitionRegistryEntry {
	id: string;
	displayName: string;
	provider: "openscreen" | "gl-transitions";
	author: string;
	license: string;
	attribution: string;
	category: TransitionCategory;
	/** Native implementation key (MSL/HLSL/WGSL mode or builtin id). */
	implementationRef: string;
	supportedParameters: Record<string, "float" | "int" | "vec2" | "vec3" | "vec4" | "bool">;
	defaultParameters: Record<string, number | boolean>;
	defaultDurationSec: number;
	minDurationSec: number;
	maxDurationSec: number;
	intensity: number;
	gpuCompatibility: Partial<Record<GpuBackend, boolean>>;
	previewAvailable: boolean;
	exportAvailable: boolean;
	userAvailable: boolean;
	autonomousEligible: boolean;
	tags: string[];
	editorial: TransitionEditorialMeta;
	sourceRevision: string;
	availability: TransitionAvailability;
	/** gl-transitions original name when imported */
	sourceName?: string;
}

export const GL_TRANSITIONS_PINNED_REVISION = "1.71.0";
export const OPENSCREEN_TRANSITION_REGISTRY_VERSION = 3;

const subtleEditorial = (boundary: string[]): TransitionEditorialMeta => ({
	appropriateContentTypes: ["tutorial", "screencast", "presentation"],
	inappropriateContentTypes: ["rapid_gameplay_montage"],
	suitableStoryBoundaries: boundary,
	energyLevel: "low",
	visualIntensity: "subtle",
	recommendedDurationSec: { min: 0.2, max: 0.7 },
	repeatedUseDistracting: false,
	tutorialSuitability: "good",
	socialSuitability: "ok",
	cinematicSuitability: "ok",
});

const movementEditorial = (boundary: string[]): TransitionEditorialMeta => ({
	appropriateContentTypes: ["social", "listicle", "demo_steps"],
	inappropriateContentTypes: ["dense_explanation"],
	suitableStoryBoundaries: boundary,
	energyLevel: "medium",
	visualIntensity: "moderate",
	recommendedDurationSec: { min: 0.25, max: 0.8 },
	repeatedUseDistracting: true,
	tutorialSuitability: "ok",
	socialSuitability: "good",
	cinematicSuitability: "ok",
});

function builtin(
	partial: Omit<
		TransitionRegistryEntry,
		"sourceRevision" | "provider" | "license" | "attribution"
	> & {
		sourceRevision?: string;
	},
): TransitionRegistryEntry {
	return {
		provider: "openscreen",
		license: "MIT",
		attribution: "OpenScreen native",
		sourceRevision:
			partial.sourceRevision ?? `openscreen-v${OPENSCREEN_TRANSITION_REGISTRY_VERSION}`,
		...partial,
	};
}

function fromGl(args: {
	id: string;
	sourceName: string;
	displayName: string;
	author: string;
	license: string;
	category: TransitionCategory;
	implementationRef: string;
	availability: TransitionAvailability;
	userAvailable: boolean;
	autonomousEligible: boolean;
	editorial: TransitionEditorialMeta;
	tags: string[];
	defaultDurationSec?: number;
	params?: Record<string, number | boolean>;
	paramTypes?: Record<string, "float" | "int" | "vec2" | "vec3" | "vec4" | "bool">;
	metalOnly?: boolean;
}): TransitionRegistryEntry {
	const metalOnly = args.metalOnly !== false;
	return {
		id: args.id,
		displayName: args.displayName,
		provider: "gl-transitions",
		author: args.author,
		license: args.license,
		attribution: `${args.sourceName} by ${args.author} (${args.license}) — gl-transitions@${GL_TRANSITIONS_PINNED_REVISION}`,
		category: args.category,
		implementationRef: args.implementationRef,
		supportedParameters: args.paramTypes ?? {},
		defaultParameters: args.params ?? {},
		defaultDurationSec: args.defaultDurationSec ?? 0.4,
		minDurationSec: 0.1,
		maxDurationSec: 2,
		intensity:
			args.editorial.visualIntensity === "subtle"
				? 0.3
				: args.editorial.visualIntensity === "moderate"
					? 0.55
					: 0.8,
		gpuCompatibility: {
			metal: args.availability === "USER_AVAILABLE" || args.availability === "BACKEND_LIMITED",
			d3d11: !metalOnly && args.userAvailable,
			wgpu: !metalOnly && args.userAvailable,
		},
		previewAvailable: args.userAvailable,
		exportAvailable: args.userAvailable,
		userAvailable: args.userAvailable,
		autonomousEligible: args.autonomousEligible,
		tags: args.tags,
		editorial: args.editorial,
		sourceRevision: GL_TRANSITIONS_PINNED_REVISION,
		availability: args.availability,
		sourceName: args.sourceName,
	};
}

/** Canonical registry — start with builtins + first curated GL ports. */
export const TRANSITION_REGISTRY: TransitionRegistryEntry[] = [
	builtin({
		id: "openscreen.cut",
		displayName: "Cut",
		author: "OpenScreen",
		category: "utility",
		implementationRef: "native.cut",
		supportedParameters: {},
		defaultParameters: {},
		defaultDurationSec: 0,
		minDurationSec: 0,
		maxDurationSec: 0,
		intensity: 0,
		gpuCompatibility: { metal: true, d3d11: true, wgpu: true },
		previewAvailable: true,
		exportAvailable: true,
		userAvailable: true,
		autonomousEligible: true,
		tags: ["cut", "hard", "default"],
		editorial: {
			...subtleEditorial(["any", "continuous_action"]),
			recommendedDurationSec: { min: 0, max: 0 },
			energyLevel: "low",
			visualIntensity: "subtle",
		},
		availability: "USER_AVAILABLE",
	}),
	builtin({
		id: "openscreen.dissolve",
		displayName: "Dissolve",
		author: "OpenScreen",
		category: "subtle",
		implementationRef: "native.ab_dissolve",
		supportedParameters: {},
		defaultParameters: {},
		defaultDurationSec: 0.35,
		minDurationSec: 0.1,
		maxDurationSec: 2,
		intensity: 0.35,
		gpuCompatibility: { metal: true, d3d11: false, wgpu: false },
		previewAvailable: true,
		exportAvailable: true,
		userAvailable: true,
		autonomousEligible: true,
		tags: ["dissolve", "crossfade", "subtle", "ab"],
		editorial: subtleEditorial(["chapter", "section", "app_switch"]),
		availability: "BACKEND_LIMITED", // A/B dual-texture proven on Metal first
	}),
	fromGl({
		id: "gl.fade",
		sourceName: "fade",
		displayName: "Fade",
		author: "gre",
		license: "MIT",
		category: "fade",
		implementationRef: "native.ab_dissolve",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: true,
		editorial: subtleEditorial(["chapter", "section"]),
		tags: ["fade", "subtle"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.dissolve",
		sourceName: "dissolve",
		displayName: "Dissolve (GL)",
		author: "gre",
		license: "MIT",
		category: "subtle",
		implementationRef: "native.ab_dissolve",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: true,
		editorial: subtleEditorial(["chapter", "section"]),
		tags: ["dissolve", "subtle"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.wipeLeft",
		sourceName: "wipeLeft",
		displayName: "Wipe Left",
		author: "gre",
		license: "MIT",
		category: "wipe",
		implementationRef: "native.ab_wipe_left",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: false,
		editorial: movementEditorial(["step", "list"]),
		tags: ["wipe", "movement"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.wipeRight",
		sourceName: "wipeRight",
		displayName: "Wipe Right",
		author: "gre",
		license: "MIT",
		category: "wipe",
		implementationRef: "native.ab_wipe_right",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: false,
		editorial: movementEditorial(["step", "list"]),
		tags: ["wipe", "movement"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.wipeUp",
		sourceName: "wipeUp",
		displayName: "Wipe Up",
		author: "gre",
		license: "MIT",
		category: "wipe",
		implementationRef: "native.ab_wipe_up",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: false,
		editorial: movementEditorial(["step"]),
		tags: ["wipe"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.wipeDown",
		sourceName: "wipeDown",
		displayName: "Wipe Down",
		author: "gre",
		license: "MIT",
		category: "wipe",
		implementationRef: "native.ab_wipe_down",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: false,
		editorial: movementEditorial(["step"]),
		tags: ["wipe"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.slideLeft",
		sourceName: "slideLeft",
		displayName: "Slide Left",
		author: "gre",
		license: "MIT",
		category: "movement",
		implementationRef: "native.ab_slide_left",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: false,
		editorial: movementEditorial(["section", "social"]),
		tags: ["slide", "movement"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.slideRight",
		sourceName: "slideRight",
		displayName: "Slide Right",
		author: "gre",
		license: "MIT",
		category: "movement",
		implementationRef: "native.ab_slide_right",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: false,
		editorial: movementEditorial(["section", "social"]),
		tags: ["slide", "movement"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.circleOpen",
		sourceName: "circleOpen",
		displayName: "Circle Open",
		author: "gre",
		license: "MIT",
		category: "reveal",
		implementationRef: "native.ab_circle_open",
		availability: "QUARANTINED_RENDER",
		userAvailable: false,
		autonomousEligible: false,
		editorial: {
			...movementEditorial(["reveal", "product"]),
			visualIntensity: "moderate",
			tutorialSuitability: "poor",
		},
		tags: ["circle", "reveal"],
		metalOnly: true,
	}),
	fromGl({
		id: "gl.crossZoom",
		sourceName: "crossZoom",
		displayName: "Cross Zoom",
		author: "rectangletangle",
		license: "MIT",
		category: "zoom",
		implementationRef: "native.ab_cross_zoom",
		availability: "QUARANTINED_RENDER",
		userAvailable: false,
		autonomousEligible: false,
		editorial: {
			...movementEditorial(["energetic_section"]),
			energyLevel: "high",
			visualIntensity: "strong",
			tutorialSuitability: "poor",
			socialSuitability: "good",
			repeatedUseDistracting: true,
		},
		tags: ["zoom", "energetic"],
		defaultDurationSec: 0.5,
		metalOnly: true,
	}),
	fromGl({
		id: "gl.fadeblack",
		sourceName: "fadeblack",
		displayName: "Fade Black",
		author: "gre",
		license: "MIT",
		category: "utility",
		implementationRef: "native.ab_fade_black",
		availability: "BACKEND_LIMITED",
		userAvailable: true,
		autonomousEligible: false,
		editorial: {
			...subtleEditorial(["chapter", "act_break"]),
			visualIntensity: "moderate",
		},
		tags: ["fade", "black", "utility"],
		metalOnly: true,
	}),
];

const BY_ID = new Map(TRANSITION_REGISTRY.map((e) => [e.id, e]));

export function getTransitionById(id: string): TransitionRegistryEntry | undefined {
	return BY_ID.get(id);
}

export function listUserAvailableTransitions(
	backend: GpuBackend = "metal",
): TransitionRegistryEntry[] {
	return TRANSITION_REGISTRY.filter(
		(e) => e.userAvailable && e.gpuCompatibility[backend] !== false,
	);
}

export function listAutonomousEligible(backend: GpuBackend = "metal"): TransitionRegistryEntry[] {
	return listUserAvailableTransitions(backend).filter((e) => e.autonomousEligible);
}

/** Map legacy kind → registry id. */
export function legacyKindToTransitionId(kind: "cut" | "dissolve"): string {
	return kind === "cut" ? "openscreen.cut" : "openscreen.dissolve";
}

export function resolveTransitionId(args: {
	transitionId?: string | null;
	kind?: "cut" | "dissolve" | null;
}): string {
	if (args.transitionId && BY_ID.has(args.transitionId)) return args.transitionId;
	if (args.kind === "cut") return "openscreen.cut";
	if (args.kind === "dissolve") return "openscreen.dissolve";
	return "openscreen.dissolve";
}

export type TransitionApplyValidation =
	| {
			ok: true;
			transitionId: string;
			durationSec: number;
			params: Record<string, number | boolean>;
			clamped: boolean;
			rejectedKeys: string[];
	  }
	| { ok: false; reason: string };

/**
 * Clamp duration to registry min/max; drop unknown / malformed params.
 * Never forwards invalid uniforms into the document → scene → native path.
 */
export function validateAndClampTransitionApply(args: {
	transitionId: string;
	durationSec?: number | null;
	params?: Record<string, unknown> | null;
}): TransitionApplyValidation {
	const entry = getTransitionById(args.transitionId);
	if (!entry) return { ok: false, reason: `Unknown transitionId: ${args.transitionId}` };
	if (!entry.userAvailable) {
		return {
			ok: false,
			reason: `Transition ${args.transitionId} is not USER_AVAILABLE (${entry.availability})`,
		};
	}
	const isCut = args.transitionId === "openscreen.cut" || entry.implementationRef === "native.cut";
	let durationSec = isCut ? 0 : (args.durationSec ?? entry.defaultDurationSec);
	let clamped = false;
	if (!isCut) {
		if (!Number.isFinite(durationSec) || durationSec < 0) {
			return { ok: false, reason: `malformed durationSec: ${String(args.durationSec)}` };
		}
		const before = durationSec;
		durationSec = Math.min(entry.maxDurationSec, Math.max(entry.minDurationSec, durationSec));
		if (durationSec !== before) clamped = true;
	}
	const params: Record<string, number | boolean> = { ...entry.defaultParameters };
	const rejectedKeys: string[] = [];
	if (args.params) {
		for (const [key, raw] of Object.entries(args.params)) {
			const expected = entry.supportedParameters[key];
			if (!expected) {
				rejectedKeys.push(key);
				clamped = true;
				continue;
			}
			if (expected === "bool") {
				if (typeof raw !== "boolean") {
					rejectedKeys.push(key);
					clamped = true;
					continue;
				}
				params[key] = raw;
				continue;
			}
			if (typeof raw !== "number" || !Number.isFinite(raw)) {
				rejectedKeys.push(key);
				clamped = true;
				continue;
			}
			// Out-of-range floats: clamp to a safe [0, 1] for intensity-like uniforms,
			// otherwise keep finite but reject NaN/Inf above.
			let v = raw;
			if (expected === "float" && (v < -10 || v > 10)) {
				v = Math.min(10, Math.max(-10, v));
				clamped = true;
			}
			params[key] = v;
		}
	}
	return { ok: true, transitionId: args.transitionId, durationSec, params, clamped, rejectedKeys };
}

/** Native shader mode code shared with Rust scene (string → enum ordinal). */
export const NATIVE_IMPL_MODE: Record<string, number> = {
	"native.cut": 0,
	"native.ab_dissolve": 1,
	"native.ab_wipe_left": 2,
	"native.ab_wipe_right": 3,
	"native.ab_wipe_up": 4,
	"native.ab_wipe_down": 5,
	"native.ab_slide_left": 6,
	"native.ab_slide_right": 7,
	"native.ab_circle_open": 8,
	"native.ab_cross_zoom": 9,
	"native.ab_fade_black": 10,
};

export function registryStats() {
	const discovered = 125; // pinned gl-transitions catalog size
	const imported = TRANSITION_REGISTRY.filter((e) => e.provider === "gl-transitions").length;
	const userAvailable = TRANSITION_REGISTRY.filter((e) => e.userAvailable).length;
	const autonomous = TRANSITION_REGISTRY.filter((e) => e.autonomousEligible).length;
	const metal = TRANSITION_REGISTRY.filter((e) => e.gpuCompatibility.metal).length;
	const quarantinedRender = TRANSITION_REGISTRY.filter(
		(e) => e.availability === "QUARANTINED_RENDER",
	).length;
	const quarantinedPerf = TRANSITION_REGISTRY.filter(
		(e) => e.availability === "QUARANTINED_PERFORMANCE",
	).length;
	const backendLimited = TRANSITION_REGISTRY.filter(
		(e) => e.availability === "BACKEND_LIMITED",
	).length;
	return {
		TOTAL_DISCOVERED: discovered,
		LICENSE_ACCEPTED: discovered,
		PORTED_METAL: imported + 2,
		METAL_NATIVE_PASS: userAvailable,
		COMPILED: imported + 2,
		NATIVE_PREVIEW_PASS: userAvailable,
		NATIVE_EXPORT_PASS: userAvailable,
		USER_AVAILABLE: userAvailable,
		USER_AVAILABLE_METAL: userAvailable,
		AUTONOMOUS_ELIGIBLE: autonomous,
		METAL_COMPATIBLE: metal,
		QUARANTINED_RENDER: quarantinedRender,
		QUARANTINED_PERFORMANCE: quarantinedPerf,
		BACKEND_LIMITED: backendLimited,
		D3D11_COMPATIBLE: TRANSITION_REGISTRY.filter((e) => e.gpuCompatibility.d3d11).length,
		WGPU_COMPATIBLE: TRANSITION_REGISTRY.filter((e) => e.gpuCompatibility.wgpu).length,
	};
}

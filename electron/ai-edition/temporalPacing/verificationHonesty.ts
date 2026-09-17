/**
 * Production vs injected compositor verification honesty.
 */

export type CompositorEvidenceStateV1 =
	| "NATIVE_PRODUCTION_VERIFIED"
	| "INJECTED_TEST_VERIFIED"
	| "STRUCTURAL_ONLY"
	| "NOT_VERIFIED"
	| "NATIVE_UNAVAILABLE";

export function classifyCompositorEvidenceState(args: {
	frameProvider?: string | null;
	authoritativeSatisfied?: boolean;
	allowInjectedAsAuthoritative?: boolean;
	productionCompositorAttached?: boolean;
	hardwareBackend?: boolean;
	structurallyValid?: boolean;
}): CompositorEvidenceStateV1 {
	const provider = String(args.frameProvider ?? "").toLowerCase();
	const injected =
		provider.includes("injected") ||
		provider.includes("test") ||
		args.allowInjectedAsAuthoritative === true;
	const native =
		args.productionCompositorAttached === true ||
		args.hardwareBackend === true ||
		provider.includes("native") ||
		provider.includes("metal") ||
		provider.includes("hardware");

	if (native && args.authoritativeSatisfied === true && !injected) {
		return "NATIVE_PRODUCTION_VERIFIED";
	}
	if (injected && args.authoritativeSatisfied === true) {
		return "INJECTED_TEST_VERIFIED";
	}
	if (args.structurallyValid === true) {
		return "STRUCTURAL_ONLY";
	}
	if (!native && !injected) {
		return "NATIVE_UNAVAILABLE";
	}
	return "NOT_VERIFIED";
}

/** Never report injected frames as production compositor proof. */
export function productionVerificationLabel(state: CompositorEvidenceStateV1): string {
	switch (state) {
		case "NATIVE_PRODUCTION_VERIFIED":
			return "NATIVE_PRODUCTION_VERIFIED";
		case "INJECTED_TEST_VERIFIED":
			return "INJECTED_TEST_VERIFIED (not production compositor proof)";
		case "STRUCTURAL_ONLY":
			return "STRUCTURAL_ONLY";
		case "NATIVE_UNAVAILABLE":
			return "NATIVE_UNAVAILABLE (Metal/hardware compositor not attached)";
		default:
			return "NOT_VERIFIED";
	}
}

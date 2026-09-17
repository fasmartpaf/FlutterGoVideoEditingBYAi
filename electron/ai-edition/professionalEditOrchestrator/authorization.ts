/**
 * Durable plan authorization (verbal proceed) — does not bypass createApplyConsent.
 * Authorization covers minting per-step consent for the bound plan fingerprint.
 */

import { createHash } from "node:crypto";
import { isBareAffirmation, isVerbalProceed } from "./intent";
import type { PlanAuthorizationV1, ProfessionalEditPlanV1 } from "./types";

export function fingerprintPlan(plan: ProfessionalEditPlanV1): string {
	const h = createHash("sha256");
	h.update(plan.planId);
	h.update("|");
	for (const s of plan.steps) {
		h.update(s.stepId);
		h.update(s.family);
		h.update(s.operationType);
		h.update(JSON.stringify(s.operationArgs));
		h.update("|");
	}
	return h.digest("hex").slice(0, 24);
}

export function authorizePlanFromUserText(args: {
	plan: ProfessionalEditPlanV1;
	userMessage: string;
	prior?: PlanAuthorizationV1 | null;
	/** When true, bare "yes"/"ok" authorizes (pending proposal / auth-ask turn). */
	allowBareAffirmation?: boolean;
}): PlanAuthorizationV1 | null {
	const fp = args.plan.planFingerprint || fingerprintPlan(args.plan);
	if (args.prior?.valid && args.prior.planFingerprint === fp) {
		return args.prior;
	}
	const intentAutonomy = args.plan.intent.autonomy === "you_decide";
	const proceed =
		isVerbalProceed(args.userMessage) ||
		intentAutonomy ||
		(Boolean(args.allowBareAffirmation) && isBareAffirmation(args.userMessage));
	if (!proceed) return null;
	const phrase =
		isVerbalProceed(args.userMessage) || isBareAffirmation(args.userMessage)
			? args.userMessage.trim().slice(0, 80)
			: "you_decide";
	return {
		planFingerprint: fp,
		authorizedAtIso: new Date().toISOString(),
		sourcePhrase: phrase,
		scope: "bounded_plan_execution",
		valid: true,
	};
}

export function authorizationStillValid(
	auth: PlanAuthorizationV1 | null | undefined,
	planFingerprint: string,
): boolean {
	return Boolean(auth?.valid && auth.planFingerprint === planFingerprint);
}

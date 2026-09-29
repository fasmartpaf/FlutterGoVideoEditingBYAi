import type { AiEditionPlanItem } from "@/native/contracts";
import { PlanSteps } from "./LiveTurn";

/**
 * The agent's step plan (or a staged edit's stages) on a finished message:
 * the same stepper the live turn shows, as a quiet card.
 */
export function PlanChecklist({
	items,
	title,
	live = false,
}: {
	items: AiEditionPlanItem[];
	title: string;
	live?: boolean;
}) {
	return <PlanSteps items={items} title={title} live={live} variant="card" />;
}

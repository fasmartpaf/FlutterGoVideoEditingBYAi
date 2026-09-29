// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanChecklist } from "./PlanChecklist";

describe("PlanChecklist", () => {
	it("shows each step with its status and a done count", () => {
		render(
			<PlanChecklist
				title="Plan"
				live
				items={[
					{ text: "Cut dead air", status: "done" },
					{ text: "Add intro title", status: "in_progress" },
					{ text: "Export 1080p", status: "pending" },
				]}
			/>,
		);
		expect(screen.getByText("1/3")).toBeTruthy();
		const rows = screen.getAllByRole("listitem");
		expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["done", "in_progress", "pending"]);
		expect(screen.getByText("Add intro title")).toBeTruthy();
	});

	it("renders nothing without steps", () => {
		const { container } = render(<PlanChecklist title="Plan" items={[]} />);
		expect(container.innerHTML).toBe("");
	});
});

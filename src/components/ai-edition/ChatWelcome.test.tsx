// @vitest-environment jsdom
// ChatWelcome guards the "no local agent connected" empty state: the copy reaches
// the DOM, the CTA fires, and a non-English locale is really translated rather
// than falling back to English. localeParity.test.ts covers key presence for
// the other locales; only the fallback check needs a rendered card.

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { LOCALE_STORAGE_KEY } from "@/i18n/config";
import { ChatWelcome } from "./ChatWelcome";

function renderIn(locale: string, ui: ReactElement) {
	localStorage.setItem(LOCALE_STORAGE_KEY, locale);
	return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("ChatWelcome", () => {
	it("renders the English welcome card with the CTA and disclaimer", () => {
		const onOpen = vi.fn();
		renderIn("en", <ChatWelcome onOpenLocalCli={onOpen} />);

		expect(screen.getByRole("heading", { name: /talk to a local agent/i })).toBeInTheDocument();
		expect(screen.getByText(/already installed on this computer/i)).toBeInTheDocument();
		expect(screen.getByText(/cut silences/i)).toBeInTheDocument();
		expect(screen.getByText(/add captions/i)).toBeInTheDocument();
		expect(screen.getByText(/rewrite a section/i)).toBeInTheDocument();
		expect(screen.getByText(/stay with that local cli/i)).toBeInTheDocument();
	});

	it("invokes the onOpenLocalCli callback when the CTA is clicked", () => {
		const onOpen = vi.fn();
		renderIn("en", <ChatWelcome onOpenLocalCli={onOpen} />);

		fireEvent.click(screen.getByRole("button", { name: /scan for local agents/i }));

		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("renders the French welcome card with translated copy", () => {
		renderIn("fr", <ChatWelcome onOpenLocalCli={vi.fn()} />);

		expect(screen.getByRole("heading", { name: /parlez à un agent local/i })).toBeInTheDocument();
		expect(screen.getByText(/rechercher les agents locaux/i)).toBeInTheDocument();
		expect(screen.queryByText(/stay with that local cli/i)).not.toBeInTheDocument();
		expect(screen.getByText(/cli local/i)).toBeInTheDocument();
	});
});

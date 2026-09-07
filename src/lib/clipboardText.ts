/** Copy plain text. Electron denies `navigator.clipboard` unless the session
 *  allows clipboard-sanitized-write, so prefer the main-process clipboard. */
export async function writeClipboardText(text: string): Promise<void> {
	const api = typeof window !== "undefined" ? window.electronAPI : undefined;
	if (typeof api?.writeClipboardText === "function") {
		await api.writeClipboardText(text);
		return;
	}
	if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			// Fall through to the execCommand path used when the Clipboard API is blocked.
		}
	}
	writeViaExecCommand(text);
}

function writeViaExecCommand(text: string): void {
	if (typeof document === "undefined") {
		throw new Error("Couldn't copy");
	}
	const field = document.createElement("textarea");
	field.value = text;
	field.setAttribute("readonly", "");
	field.style.position = "fixed";
	field.style.top = "0";
	field.style.left = "-9999px";
	document.body.appendChild(field);
	field.focus();
	field.select();
	field.setSelectionRange(0, text.length);
	const ok = document.execCommand("copy");
	field.remove();
	if (!ok) throw new Error("Couldn't copy");
}

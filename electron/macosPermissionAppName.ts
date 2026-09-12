/**
 * The name macOS shows in Privacy & Security lists for THIS running copy.
 *
 * Packaged builds appear as the product name (electron-builder `productName`).
 * `npm run dev` runs `Electron.app`, so System Settings lists **Electron** —
 * never "OpenScreen" — until the host Electron.app is branded (see
 * `scripts/brand-electron-dev-macos.mjs`). Hard-coding "OpenScreen" in the
 * permission dialog sent users looking for an entry that does not exist.
 */
export function macOsPrivacyListAppName(input: {
	platform: NodeJS.Platform;
	isPackaged: boolean;
	/** electron `app.getName()` / builder productName when packaged. */
	packagedAppName: string;
	/** Optional override when the local Electron.app Info.plist was branded. */
	devHostDisplayName?: string;
}): string {
	if (input.platform !== "darwin") {
		return input.packagedAppName;
	}
	if (input.isPackaged) {
		return input.packagedAppName;
	}
	const branded = input.devHostDisplayName?.trim();
	if (branded && branded.toLowerCase() !== "electron") {
		return branded;
	}
	return "Electron";
}

export function screenRecordingPermissionDetail(listAppName: string): string {
	return (
		`In System Settings, find “${listAppName}” under Privacy & Security → ` +
		`Screen & System Audio Recording and turn it ON. ` +
		`Then fully quit the app, open it again, and choose a screen or window.`
	);
}

export function accessibilityPermissionDetail(listAppName: string): string {
	return (
		`Allow “${listAppName}” under System Settings → Privacy & Security → Accessibility, ` +
		`then press record again to start the countdown.`
	);
}

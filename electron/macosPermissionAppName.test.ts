import { describe, expect, it } from "vitest";
import {
	accessibilityPermissionDetail,
	macOsPrivacyListAppName,
	screenRecordingPermissionDetail,
} from "./macosPermissionAppName";

describe("macOsPrivacyListAppName", () => {
	it("uses the packaged app name on macOS when packaged", () => {
		expect(
			macOsPrivacyListAppName({
				platform: "darwin",
				isPackaged: true,
				packagedAppName: "Openscreen",
			}),
		).toBe("Openscreen");
	});

	it("defaults to Electron for unpackaged macOS builds", () => {
		expect(
			macOsPrivacyListAppName({
				platform: "darwin",
				isPackaged: false,
				packagedAppName: "openscreen",
			}),
		).toBe("Electron");
	});

	it("uses a branded host display name when present", () => {
		expect(
			macOsPrivacyListAppName({
				platform: "darwin",
				isPackaged: false,
				packagedAppName: "openscreen",
				devHostDisplayName: "OpenScreen",
			}),
		).toBe("OpenScreen");
	});

	it("ignores an unbranded Electron display name", () => {
		expect(
			macOsPrivacyListAppName({
				platform: "darwin",
				isPackaged: false,
				packagedAppName: "openscreen",
				devHostDisplayName: "Electron",
			}),
		).toBe("Electron");
	});

	it("passes through the packaged name on non-macOS", () => {
		expect(
			macOsPrivacyListAppName({
				platform: "win32",
				isPackaged: false,
				packagedAppName: "Openscreen",
			}),
		).toBe("Openscreen");
	});
});

describe("permission detail copy", () => {
	it("names the System Settings entry for screen recording", () => {
		expect(screenRecordingPermissionDetail("Electron")).toContain("“Electron”");
		expect(screenRecordingPermissionDetail("Electron")).toContain(
			"Screen & System Audio Recording",
		);
	});

	it("names the System Settings entry for accessibility", () => {
		expect(accessibilityPermissionDetail("OpenScreen")).toContain("“OpenScreen”");
		expect(accessibilityPermissionDetail("OpenScreen")).toContain("Accessibility");
	});
});

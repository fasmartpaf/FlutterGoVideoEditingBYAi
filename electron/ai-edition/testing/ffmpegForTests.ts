// One place for tests to find ffmpeg. Tests that need it use
// `it.skipIf(!TEST_FFMPEG)` so a missing binary shows up as SKIPPED in the
// report — never as a silently green test that asserted nothing.
import { resolveFfmpeg } from "../../media/audioPeaks";
import { whichOnPath } from "../local-agents";

function find(): string | null {
	try {
		const bundled = resolveFfmpeg()?.trim();
		if (bundled) return bundled;
	} catch {
		// fall through to PATH
	}
	return whichOnPath("ffmpeg");
}

export const TEST_FFMPEG: string | null = find();

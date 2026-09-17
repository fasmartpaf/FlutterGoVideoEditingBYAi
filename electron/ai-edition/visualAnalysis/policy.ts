/**
 * Visual analysis policy — observation thresholds (not editorial taste).
 * Bug-3 thresholds reused from visualEvidence (KEEP / UNIFY).
 */

import {
	CHANGE_MINIMAL_MAX,
	CHANGE_MODERATE_MAX,
	PERIODIC_INTERVAL_SEC,
} from "../visualEvidence/types";
import type { VisualAnalysisParameters } from "./types";

export const DEFAULT_VISUAL_ANALYSIS_PARAMETERS: VisualAnalysisParameters = {
	sceneThreshold: 0.08,
	changeSampleIntervalSec: PERIODIC_INTERVAL_SEC,
	blackDetect: { d: 0.2, pixTh: 0.1 },
	freezeDetect: { n: 0.003, d: 0.5 },
	stableMinDurationSec: 1.0,
	activityMergeGapSec: 0.35,
	changeMinimalMax: CHANGE_MINIMAL_MAX,
	changeModerateMax: CHANGE_MODERATE_MAX,
};

/**
 * What gradeClip / stabilizeClip / cleanVoice want done to each recording:
 * the current treatments plus or minus the requested one. Shared by media
 * prep (which bakes) and the executor (which lands), so both agree.
 */

import { z } from "zod";
import type { AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { VOICE_LEVELS, type VoiceLevel } from "../audioPro/cleanVoice";
import { type GradeParams, LOOKS, type ProcessOps, type ProcessTarget, normalizeOps, processTargets } from "./process";

const num = z.number().optional();
const planArgs = z
	.object({
		assetId: z.string().min(1).optional(),
		undo: z.boolean().optional(),
		level: z.enum(VOICE_LEVELS).optional(),
		look: z.enum(LOOKS).optional(),
		exposure: num,
		contrast: num,
		saturation: num,
		warmth: num,
		tint: num,
		vignette: num,
		sharpen: num,
		lutPath: z.string().min(1).optional(),
	})
	.passthrough();

export type PlannedTarget = ProcessTarget & {
	/** The treatments after this call; null = back to the original file. */
	nextOps: ProcessOps | null;
	/** True when the call changes nothing for this recording. */
	unchanged: boolean;
};

export type ProcessPlan =
	| { ok: true; targets: PlannedTarget[]; assetId?: string; verb: string }
	| { ok: false; error: string };

function sameOps(a: ProcessOps, b: ProcessOps | null): boolean {
	return JSON.stringify(normalizeOps(a) ?? {}) === JSON.stringify(b ?? {});
}

export function planProcess(name: string, rawArgs: unknown, document: AxcutDocument): ProcessPlan {
	const parsed = planArgs.safeParse(rawArgs ?? {});
	if (!parsed.success) return { ok: false, error: parsed.error.message };
	const a = parsed.data;
	const targets = processTargets(document, a.assetId);
	let verb = "";
	const planned = targets.map((t): PlannedTarget => {
		const ops: ProcessOps = { ...t.ops };
		if (name === "cleanVoice") {
			if (a.undo) delete ops.voice;
			else ops.voice = a.level ?? "medium";
			verb = a.undo ? "original voice restored" : `voice cleaned (${ops.voice})`;
		} else if (name === "stabilizeClip") {
			if (a.undo) delete ops.stabilize;
			else ops.stabilize = true;
			verb = a.undo ? "stabilisation removed" : "stabilised";
		} else {
			if (a.undo) delete ops.grade;
			else {
				// A new look replaces the previous grade; plain values adjust the current one.
				const base: GradeParams = a.look ? {} : { ...(ops.grade ?? {}) };
				const grade: GradeParams = { ...base };
				if (a.look) grade.look = a.look;
				for (const k of ["exposure", "contrast", "saturation", "warmth", "tint", "vignette", "sharpen"] as const) {
					if (typeof a[k] === "number") grade[k] = a[k];
				}
				if (a.lutPath) grade.lutPath = a.lutPath;
				ops.grade = grade;
			}
			verb = a.undo ? "grade removed" : `graded${a.look ? ` (${a.look})` : ""}`;
		}
		const nextOps = normalizeOps(ops);
		return { ...t, nextOps, unchanged: sameOps(t.ops, nextOps) };
	});
	return { ok: true, targets: planned, assetId: a.assetId, verb };
}

export type { VoiceLevel };

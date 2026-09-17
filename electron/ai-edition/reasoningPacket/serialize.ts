/**
 * Serialize ReasoningPacketV1 for provider user message (text).
 */

import type { ReasoningPacketSerializeResult, ReasoningPacketV1 } from "./types";

function section(title: string, lines: string[]): string[] {
	if (!lines.length) return [];
	return [title, ...lines.map((l) => `  - ${l}`), ""];
}

export function serializeReasoningPacket(
	packet: ReasoningPacketV1,
): ReasoningPacketSerializeResult {
	const lines: string[] = [
		"REASONING_PACKET_V1 (canonical projections — not full Ledger/Claims/Story dumps)",
		`identity=${packet.identity}`,
		`phase=${packet.phase}`,
		`queryClass=${packet.queryClass}`,
		`queryScope=${packet.queryScope}`,
		`requiredModalities=speech:${packet.requiredModalities.speech},visual:${packet.requiredModalities.visual},cursor:${packet.requiredModalities.cursor},ocr:${packet.requiredModalities.ocr}`,
		`decisionKind=${packet.decisionKind}`,
		`requiredSections=${packet.decisionRequirements.requiredSections.join(",") || "none"}`,
		`optionalSections=${packet.decisionRequirements.optionalSections.join(",") || "none"}`,
		`requestedDecision=${packet.requestedDecision}`,
		`selfContained=${packet.selfContainment?.selfContained ?? "n/a"}`,
		packet.selfContainment?.missing?.length
			? `missingSections=${packet.selfContainment.missing.join(",")}`
			: "missingSections=none",
		`mediaSummary=${packet.mediaSummary}`,
		`evidenceCoverage=${packet.evidenceCoverage ?? "n/a"}`,
		`speechMediaState=${packet.sufficiency.speechMediaState ?? "unknown"}`,
		`packetEvidenceSufficient=${packet.sufficiency.packetEvidenceSufficient}`,
		packet.sufficiency.missingEvidenceKinds.length
			? `missingEvidenceKinds=${packet.sufficiency.missingEvidenceKinds.join(",")}`
			: "missingEvidenceKinds=none",
		"",
		`REQUESTED: ${packet.userIntent}`,
		"",
	];

	lines.push(
		...section(
			"KNOWN (visible/context — not proven actions):",
			packet.known.map((k) => `${k.text}${k.claimId ? ` [${k.claimId}]` : ""}`),
		),
	);
	lines.push(
		...section(
			"SPOKEN:",
			packet.spoken.map((k) => `${k.text}${k.claimId ? ` [${k.claimId}]` : ""}`),
		),
	);
	lines.push(
		...section(
			"SUPPORTED:",
			packet.supported.map((k) => k.text),
		),
	);
	lines.push(
		...section(
			"CONTRADICTED:",
			packet.contradicted.map((k) => k.text),
		),
	);
	lines.push(
		...section(
			"UNKNOWN:",
			packet.unknown.map((k) => k.text),
		),
	);
	lines.push(...section("PRESERVE:", packet.preservationConstraints));
	lines.push(...section("HISTORY_CONSTRAINTS:", packet.historyConstraints));

	if (packet.selectedSpeech.length) {
		lines.push("SELECTED_SPEECH:");
		for (const s of packet.selectedSpeech) {
			lines.push(`  ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s: ${s.preview}`);
		}
		lines.push("");
	}

	if (packet.selectedVisualEvidence.length) {
		lines.push("SELECTED_VISUAL (frames attached separately when present):");
		for (const v of packet.selectedVisualEvidence) {
			lines.push(`  t=${v.sourceTimeSec.toFixed(2)}s reason=${v.reason} — ${v.note}`);
		}
		lines.push("");
	}

	if (packet.crossModalRelations.length) {
		lines.push("CROSS_MODAL_RELATIONS:");
		for (const r of packet.crossModalRelations) {
			lines.push(`  - spoken: ${r.spokenText.slice(0, 120)}`);
			lines.push(
				`    visual: ${r.visualRange.startSec != null ? `${r.visualRange.startSec.toFixed(1)}–${r.visualRange.endSec?.toFixed(1)}s frames` : "none"}`,
			);
			lines.push(`    status: ${r.visualSupport}`);
			lines.push(`    evidenceRefs: ${r.evidenceRefs.join(",") || "n/a"}`);
			lines.push(`    note: ${r.note}`);
		}
		lines.push(
			"Compact rule: Do not promote UNKNOWN or NOT_VISUALLY_VERIFIED to MATCH. Lack of contradiction ≠ confirmation.",
			"",
		);
	}

	if (packet.correctionScaffold.present) {
		lines.push("CORRECTION_SCAFFOLD:");
		for (const it of packet.correctionScaffold.items) {
			lines.push(
				`  ${it.role}: "${it.text.slice(0, 140)}" state=${it.state} superseded=${it.superseded} visual=${it.visualVerification}`,
			);
		}
		if (packet.correctionScaffold.summary) {
			lines.push(`  ${packet.correctionScaffold.summary}`);
		}
		lines.push("");
	}

	if (packet.focalTargetCandidates.length) {
		lines.push("FOCAL_TARGET_CANDIDATES (evaluate each — do not invent zoom):");
		for (const f of packet.focalTargetCandidates) {
			lines.push(
				`  ${f.id} t=${f.range.startSec.toFixed(2)}–${f.range.endSec.toFixed(2)} kind=${f.targetKind} conf=${f.visibilityConfidence}`,
			);
			lines.push(`    subject: ${f.subject.slice(0, 140)}`);
			lines.push(
				`    decide: HELPFUL | NOT_HELPFUL | INSUFFICIENT_EVIDENCE — ${f.reasonCandidate}`,
			);
		}
		lines.push(
			"REQUIRED sidecar before prose:",
			"FOCAL_TARGET_DECISIONS: [{candidateId, decision, reason}, ...]",
			"Then natural explanation. Do not force HELPFUL.",
			"",
		);
	}

	if (packet.editorialFindings.length) {
		const improve = packet.editorialFindings.filter((f) => f.disposition === "IMPROVE_CANDIDATE");
		const preserve = packet.editorialFindings.filter((f) => f.disposition === "PRESERVE");
		const leave = packet.editorialFindings.filter((f) => f.disposition === "LEAVE_AS_IS");
		const unknown = packet.editorialFindings.filter((f) => f.disposition === "UNKNOWN");
		lines.push("EDITORIAL_FINDINGS (evidence-backed — not edit commands):");
		if (packet.editorialFindingCoverage) {
			lines.push(
				`  coverage=${packet.editorialFindingCoverage.status} improve=${packet.editorialFindingCoverage.improveCandidateCount} preserve=${packet.editorialFindingCoverage.preserveCount} leaveAsIs=${packet.editorialFindingCoverage.leaveAsIsCount}`,
			);
		}
		const emitGroup = (title: string, list: typeof packet.editorialFindings) => {
			if (!list.length) return;
			lines.push(`  ${title}:`);
			for (const f of list) {
				const r = f.range.startSec != null ? ` t≈${f.range.startSec.toFixed(1)}s` : "";
				lines.push(`    [${f.id}] ${f.kind}${r} conf=${f.confidence} src=${f.sourceLayer}`);
				lines.push(`      ${f.statement}`);
				if (f.actionClaimForbidden) {
					lines.push(
						"      NOTE: visibility≠action; do not claim the user performed the labeled action.",
					);
				}
			}
		};
		emitGroup("IMPROVE_CANDIDATES", improve);
		emitGroup("PRESERVE", preserve);
		emitGroup("LEAVE_AS_IS", leave);
		emitGroup("UNKNOWN", unknown);
		lines.push(
			"REQUIRED sidecar before prose:",
			"EDITORIAL_DECISIONS: [{findingId, disposition: IMPROVE|PRESERVE|IGNORE|INSUFFICIENT_EVIDENCE, rationale}, ...]",
			"Then natural prose. Prioritize improve candidates; protect preserve; respect leave-as-is.",
			"If no improve candidates: say you don't see a safe recording-specific improvement.",
			"Do not invent generic transitions/zooms/mic/captions polish.",
			"",
		);
	} else if (packet.phase === "PLAN" && packet.queryClass === "editorial") {
		lines.push(
			"EDITORIAL_FINDINGS: none grounded. Valid answer: no recording-specific change. Invalid: generic transitions/zooms/mic/captions list.",
			"",
		);
	}

	if (packet.selectedTemporalEvents.length) {
		lines.push(...section("TEMPORAL_EVENTS (brief):", packet.selectedTemporalEvents));
	}
	if (packet.relevantSourceStory) {
		lines.push("SOURCE_STORY_PROJECTION:", packet.relevantSourceStory, "");
	}
	if (packet.relevantEditorialState) {
		lines.push("TRUSTED_EDITORIAL_STATE:", packet.relevantEditorialState, "");
	}
	if (packet.capabilitySummary) {
		lines.push("CAPABILITY_SUMMARY:", packet.capabilitySummary, "");
	}
	if (packet.toolPolicyNote) {
		lines.push(`TOOL_POLICY: ${packet.toolPolicyNote}`, "");
	}

	const text = lines.join("\n");
	return { text, chars: text.length, packet };
}

export type { AppendPacketResult } from "./packetDelivery";
export {
	appendReasoningPacketToUserMessage,
	assertReasoningPacketDelivered,
	extractProviderBoundUserText,
	REASONING_PACKET_MARKER,
} from "./packetDelivery";

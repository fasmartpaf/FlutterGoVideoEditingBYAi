import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { insertClip } from "../../../src/lib/ai-edition/document/timeline";
import { createEmptyDocument, documentSchema, type AxcutDocument } from "../../../src/lib/ai-edition/schema";
import { executeAgentTool } from "../agent-tools";
import { guessLanguage, parseEspeakVoices, parseSayVoices, pickVoice } from "./tts";

const SAY = `Alex                en_US    # Most people recognize me by my voice.
Daniel              en_GB    # Hello, my name is Daniel.
Lekha               hi_IN    # नमस्ते, मेरा नाम लेखा है।
Majed               ar_001   # مرحبًا! اسمي ماجد.
Eddy (English (US)) en_US    # Hello! My name is Eddy.
`;
const ESPEAK = ` Pty Language       Age/Gender VoiceName          File                 Other Languages
 5  en-gb           --/M      English_(Great_Britain) gmw/en
 5  ur              --/M      Urdu               inc/ur
`;

describe("local voices", () => {
	it("reads the installed voices", () => {
		const say = parseSayVoices(SAY);
		expect(say.map((v) => v.language)).toEqual(["en_US", "en_GB", "hi_IN", "ar_001", "en_US"]);
		expect(say[4]!.name).toBe("Eddy (English (US))");
		expect(parseEspeakVoices(ESPEAK)).toEqual([
			{ engine: "espeak-ng", name: "en-gb", language: "en_gb" },
			{ engine: "espeak-ng", name: "ur", language: "ur" },
		]);
	});

	it("guesses the language from the script and never falls back to another language", () => {
		expect(guessLanguage("یہ ایک ڈریگن ہے")).toBe("ur");
		expect(guessLanguage("नमस्ते")).toBe("hi");
		expect(guessLanguage("Hello")).toBe("en");
		const say = parseSayVoices(SAY);
		expect(pickVoice(say, "en_GB")!.name).toBe("Daniel");
		expect(pickVoice(say, "en")!.name).toBe("Alex");
		expect(pickVoice(say, "hi")!.name).toBe("Lekha");
		expect(pickVoice(say, "ur")).toBeNull();
		expect(pickVoice(say, "en", "daniel")!.name).toBe("Daniel");
	});
});

describe("generateVoiceover tool", () => {
	const dir = mkdtempSync(join(tmpdir(), "tts-"));
	function doc(): AxcutDocument {
		let d = createEmptyDocument({ title: "t", projectId: "p", createdAt: "2026-01-01T00:00:00.000Z" });
		d = {
			...d,
			assets: [{ id: "asset_v", kind: "video", label: "rec.mp4", originalPath: join(dir, "rec.mp4"), durationSec: 20, cameraTrack: null }] as AxcutDocument["assets"],
			project: { ...d.project, primaryAssetId: "asset_v" },
		};
		return insertClip(d, "asset_v", 0, "user", "rec");
	}

	it("lays the spoken file on the voiceover lane", () => {
		const vo = join(dir, "vo.m4a");
		writeFileSync(vo, "a");
		const r = executeAgentTool(doc(), "generateVoiceover", JSON.stringify({ text: "Welcome to FlutterGo", atSec: 2 }), {
			prepared: { voiceover: { path: vo, durationSec: 3.2, voice: "Daniel", language: "en_GB" } },
		});
		expect(r.ok).toBe(true);
		expect(() => documentSchema.parse(r.document)).not.toThrow();
		const track = r.document!.audioTracks[0]!;
		expect(track).toMatchObject({ kind: "voiceover", startMs: 2000, endMs: 5200 });
		expect(JSON.parse(r.resultJson!)).toMatchObject({ voice: "Daniel", startSec: 2 });
	});

	it("passes on why it could not speak", () => {
		const r = executeAgentTool(doc(), "generateVoiceover", JSON.stringify({ text: "یہ" }), {
			prepared: { voiceoverError: 'No installed voice speaks "ur". Installed languages: ar, en, hi.' },
		});
		expect(r.ok).toBe(false);
		expect(r.error ?? r.summary ?? "").toMatch(/Installed languages: ar, en, hi/);
	});
});

/**
 * Built-in motion templates. Each one is an HTML composition (CSS animations
 * + a little script) driven by the brand kit, timed to fit `durationSec`
 * exactly: an entrance, a hold, and a short exit so clips cut cleanly into
 * the recording. The agent can use these for speed, or write its own HTML.
 */

import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { BrandKit } from "./brandKit";

export const MOTION_TEMPLATE_IDS = [
	"titleCard",
	"sectionCard",
	"outroCta",
	"kineticText",
	"statHighlight",
	"bulletList",
	"logoReveal",
] as const;
export type MotionTemplateId = (typeof MOTION_TEMPLATE_IDS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

/** Params per template (validated before rendering). */
export const TEMPLATE_PARAMS = {
	titleCard: z.object({ title: text(80), subtitle: text(120).optional() }),
	sectionCard: z.object({ title: text(80), kicker: text(40).optional(), number: z.number().int().min(1).max(99).optional() }),
	outroCta: z.object({ title: text(80), cta: text(40), url: text(80).optional() }),
	kineticText: z.object({ lines: z.array(text(60)).min(1).max(6) }),
	statHighlight: z.object({
		value: z.number().finite(),
		label: text(80),
		prefix: z.string().max(4).optional(),
		suffix: z.string().max(6).optional(),
		decimals: z.number().int().min(0).max(2).optional(),
	}),
	bulletList: z.object({ title: text(60), bullets: z.array(text(80)).min(1).max(5) }),
	logoReveal: z.object({ tagline: text(80).optional() }),
} as const;

/** Suggested length when the agent does not give one. */
export const TEMPLATE_DEFAULT_SEC: Record<MotionTemplateId, number> = {
	titleCard: 3,
	sectionCard: 2.2,
	outroCta: 3.5,
	kineticText: 3.5,
	statHighlight: 3,
	bulletList: 4.5,
	logoReveal: 2.5,
};

export const TEMPLATE_DESCRIPTIONS: Record<MotionTemplateId, string> = {
	titleCard: "Opening title with subtitle — {title, subtitle?}",
	sectionCard: "Chapter / section divider — {title, kicker?, number?}",
	outroCta: "Ending call to action — {title, cta, url?}",
	kineticText: "Punchy lines popping in one after another — {lines[]}",
	statHighlight: "A number counting up with a label — {value, label, prefix?, suffix?, decimals?}",
	bulletList: "Title with staggered bullet points — {title, bullets[]}",
	logoReveal: "Brand logo reveal with tagline — {tagline?}",
};

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function fontStack(kit: BrandKit): string {
	const family = kit.fontFamily.replace(/["<>;{}]/g, "");
	return `"${family}", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
}

function logoTag(kit: BrandKit, className: string): string {
	if (!kit.logoPath) return "";
	return `<img class="${className}" src="${escapeHtml(pathToFileURL(kit.logoPath).href)}" alt="">`;
}

/** Motion feel per brand style: entrance duration and easing. */
function feel(kit: BrandKit): { enter: number; ease: string } {
	switch (kit.style) {
		case "bold":
			return { enter: 0.45, ease: "cubic-bezier(.2,1.4,.3,1)" };
		case "playful":
			return { enter: 0.6, ease: "cubic-bezier(.34,1.56,.64,1)" };
		case "tech":
			return { enter: 0.5, ease: "cubic-bezier(.7,0,.2,1)" };
		default:
			return { enter: 0.7, ease: "cubic-bezier(.16,1,.3,1)" };
	}
}

interface Frame {
	width: number;
	height: number;
	durationSec: number;
}

/** Shared page shell: background, scale unit, exit fade timed to the clip end. */
function shell(kit: BrandKit, frame: Frame, css: string, body: string, script = ""): string {
	const u = Math.min(frame.width / 1920, frame.height / 1080); // 1 design px
	const exitAt = Math.max(0.3, frame.durationSec - 0.45);
	const f = feel(kit);
	return `<!doctype html><html><head><style>
:root{--u:${u}px;--p:${kit.primary};--s:${kit.secondary};--bg:${kit.background};--fg:${kit.text};--enter:${f.enter}s;--ease:${f.ease}}
*{box-sizing:border-box}
body{margin:0;width:${frame.width}px;height:${frame.height}px;overflow:hidden;background:var(--bg);color:var(--fg);font-family:${fontStack(kit)}}
.stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
 animation:exit .45s ease-in ${exitAt}s both}
.glow{position:absolute;inset:-20%;background:radial-gradient(circle at 30% 30%,color-mix(in srgb,var(--p) 45%,transparent),transparent 55%),
 radial-gradient(circle at 75% 70%,color-mix(in srgb,var(--s) 35%,transparent),transparent 55%);animation:drift ${frame.durationSec}s linear both}
@keyframes exit{to{opacity:0;transform:scale(1.03)}}
@keyframes drift{from{transform:translate3d(-2%,-1%,0) scale(1)}to{transform:translate3d(2%,1%,0) scale(1.08)}}
@keyframes rise{from{opacity:0;transform:translateY(calc(40*var(--u)))}to{opacity:1;transform:none}}
@keyframes pop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:scale(1)}}
@keyframes wipe{from{transform:scaleX(0)}to{transform:scaleX(1)}}
${css}
</style></head><body><div class="glow"></div><div class="stage">${body}</div>${script}</body></html>`;
}

const delay = (s: number) => `animation-delay:${s.toFixed(2)}s`;

export function renderTemplate(
	id: MotionTemplateId,
	rawParams: unknown,
	kit: BrandKit,
	frame: Frame,
): string {
	switch (id) {
		case "titleCard": {
			const p = TEMPLATE_PARAMS.titleCard.parse(rawParams);
			const words = p.title.split(/\s+/);
			const title = words
				.map((w, i) => `<span class="w" style="${delay(0.15 + i * 0.08)}">${escapeHtml(w)}</span>`)
				.join(" ");
			const sub = p.subtitle
				? `<div class="sub" style="${delay(0.35 + words.length * 0.08)}">${escapeHtml(p.subtitle)}</div>`
				: "";
			return shell(
				kit,
				frame,
				`.logo{height:calc(90*var(--u));margin-bottom:calc(40*var(--u));animation:pop var(--enter) var(--ease) both}
.t{font-size:calc(120*var(--u));font-weight:800;letter-spacing:-.02em;line-height:1.05;max-width:85%}
.w{display:inline-block;animation:rise var(--enter) var(--ease) both}
.bar{height:calc(10*var(--u));width:calc(220*var(--u));margin:calc(36*var(--u)) auto 0;border-radius:99px;
 background:linear-gradient(90deg,var(--p),var(--s));transform-origin:left;animation:wipe .6s var(--ease) .5s both}
.sub{margin-top:calc(30*var(--u));font-size:calc(44*var(--u));opacity:.85;animation:rise var(--enter) var(--ease) both}`,
				`${logoTag(kit, "logo")}<div class="t">${title}</div><div class="bar"></div>${sub}`,
			);
		}
		case "sectionCard": {
			const p = TEMPLATE_PARAMS.sectionCard.parse(rawParams);
			const num = p.number != null ? `<div class="n">${String(p.number).padStart(2, "0")}</div>` : "";
			const kicker = p.kicker ? `<div class="k">${escapeHtml(p.kicker)}</div>` : "";
			return shell(
				kit,
				frame,
				`.stage{align-items:flex-start;text-align:left;padding-left:12%}
.n{font-size:calc(200*var(--u));font-weight:800;line-height:1;background:linear-gradient(135deg,var(--p),var(--s));
 -webkit-background-clip:text;background-clip:text;color:transparent;animation:pop var(--enter) var(--ease) both}
.k{text-transform:uppercase;letter-spacing:.3em;font-size:calc(30*var(--u));opacity:.7;margin-top:calc(20*var(--u));animation:rise var(--enter) var(--ease) .15s both}
.t{font-size:calc(96*var(--u));font-weight:800;margin-top:calc(12*var(--u));animation:rise var(--enter) var(--ease) .25s both}
.line{height:calc(8*var(--u));width:calc(420*var(--u));margin-top:calc(30*var(--u));background:var(--p);transform-origin:left;animation:wipe .5s var(--ease) .4s both}`,
				`${num}${kicker}<div class="t">${escapeHtml(p.title)}</div><div class="line"></div>`,
			);
		}
		case "outroCta": {
			const p = TEMPLATE_PARAMS.outroCta.parse(rawParams);
			const url = p.url ? `<div class="url">${escapeHtml(p.url)}</div>` : "";
			return shell(
				kit,
				frame,
				`.logo{height:calc(80*var(--u));margin-bottom:calc(30*var(--u));animation:pop var(--enter) var(--ease) both}
.t{font-size:calc(96*var(--u));font-weight:800;max-width:80%;animation:rise var(--enter) var(--ease) .1s both}
.btn{margin-top:calc(50*var(--u));padding:calc(26*var(--u)) calc(64*var(--u));border-radius:99px;font-size:calc(44*var(--u));font-weight:700;
 background:linear-gradient(90deg,var(--p),var(--s));color:#fff;box-shadow:0 calc(20*var(--u)) calc(60*var(--u)) color-mix(in srgb,var(--p) 50%,transparent);
 animation:pop var(--enter) var(--ease) .45s both,pulse 1.2s ease-in-out 1.2s infinite}
@keyframes pulse{50%{transform:scale(1.06)}}
.url{margin-top:calc(34*var(--u));font-size:calc(34*var(--u));opacity:.75;animation:rise var(--enter) var(--ease) .7s both}`,
				`${logoTag(kit, "logo")}<div class="t">${escapeHtml(p.title)}</div><div class="btn">${escapeHtml(p.cta)}</div>${url}`,
			);
		}
		case "kineticText": {
			const p = TEMPLATE_PARAMS.kineticText.parse(rawParams);
			const usable = Math.max(0.6, frame.durationSec - 0.9);
			const step = Math.min(0.55, usable / p.lines.length);
			const lines = p.lines
				.map(
					(l, i) =>
						`<div class="l ${i % 2 ? "alt" : ""}" style="${delay(0.1 + i * step)}">${escapeHtml(l)}</div>`,
				)
				.join("");
			return shell(
				kit,
				frame,
				`.l{font-size:calc(100*var(--u));font-weight:900;line-height:1.1;text-transform:uppercase;animation:pop var(--enter) var(--ease) both}
.l.alt{color:var(--p)}`,
				lines,
			);
		}
		case "statHighlight": {
			const p = TEMPLATE_PARAMS.statHighlight.parse(rawParams);
			const decimals = p.decimals ?? (Number.isInteger(p.value) ? 0 : 1);
			const countFor = Math.min(1.6, Math.max(0.6, frame.durationSec - 1.2));
			const script = `<script>
const el=document.getElementById("v");const target=${JSON.stringify(p.value)};const dur=${countFor};
const fmt=(n)=>n.toLocaleString("en-US",{minimumFractionDigits:${decimals},maximumFractionDigits:${decimals}});
window.render=(t)=>{const k=Math.min(1,Math.max(0,(t-0.2)/dur));const e=1-Math.pow(1-k,3);el.textContent=fmt(target*e);};
</script>`;
			return shell(
				kit,
				frame,
				`.v{font-size:calc(220*var(--u));font-weight:900;line-height:1;background:linear-gradient(135deg,var(--p),var(--s));
 -webkit-background-clip:text;background-clip:text;color:transparent;font-variant-numeric:tabular-nums;animation:pop var(--enter) var(--ease) both}
.a{font-size:calc(96*var(--u));font-weight:800;color:var(--p)}
.lab{margin-top:calc(24*var(--u));font-size:calc(48*var(--u));opacity:.85;animation:rise var(--enter) var(--ease) .3s both}`,
				`<div class="v">${escapeHtml(p.prefix ?? "")}<span id="v">0</span>${escapeHtml(p.suffix ?? "")}</div><div class="lab">${escapeHtml(p.label)}</div>`,
				script,
			);
		}
		case "bulletList": {
			const p = TEMPLATE_PARAMS.bulletList.parse(rawParams);
			const usable = Math.max(0.8, frame.durationSec - 1.2);
			const step = Math.min(0.5, usable / (p.bullets.length + 1));
			const items = p.bullets
				.map(
					(b, i) =>
						`<li style="${delay(0.35 + i * step)}"><span class="dot"></span>${escapeHtml(b)}</li>`,
				)
				.join("");
			return shell(
				kit,
				frame,
				`.stage{align-items:flex-start;text-align:left;padding-left:14%}
.t{font-size:calc(84*var(--u));font-weight:800;margin-bottom:calc(40*var(--u));animation:rise var(--enter) var(--ease) both}
ul{list-style:none;margin:0;padding:0}
li{display:flex;align-items:center;gap:calc(26*var(--u));font-size:calc(52*var(--u));margin:calc(18*var(--u)) 0;animation:rise var(--enter) var(--ease) both}
.dot{width:calc(22*var(--u));height:calc(22*var(--u));border-radius:50%;background:linear-gradient(135deg,var(--p),var(--s));flex:0 0 auto}`,
				`<div class="t">${escapeHtml(p.title)}</div><ul>${items}</ul>`,
			);
		}
		case "logoReveal": {
			const p = TEMPLATE_PARAMS.logoReveal.parse(rawParams);
			const mark = kit.logoPath
				? logoTag(kit, "logo")
				: `<div class="mono">${escapeHtml((kit.name ?? "FlutterGo").slice(0, 2).toUpperCase())}</div>`;
			const tag = p.tagline ? `<div class="tag">${escapeHtml(p.tagline)}</div>` : "";
			return shell(
				kit,
				frame,
				`.logo,.mono{height:calc(220*var(--u));animation:reveal .9s var(--ease) both}
.mono{width:calc(220*var(--u));border-radius:calc(48*var(--u));display:flex;align-items:center;justify-content:center;
 font-size:calc(110*var(--u));font-weight:900;background:linear-gradient(135deg,var(--p),var(--s));color:#fff}
@keyframes reveal{0%{opacity:0;transform:scale(.4) rotate(-8deg);filter:blur(calc(20*var(--u)))}100%{opacity:1;transform:none;filter:none}}
.tag{margin-top:calc(40*var(--u));font-size:calc(46*var(--u));letter-spacing:.04em;opacity:.9;animation:rise var(--enter) var(--ease) .6s both}`,
				`${mark}${tag}`,
			);
		}
	}
}

// --- overlays -----------------------------------------------------------------
// Transparent compositions drawn ON TOP of the recording (a PNG sequence the
// compositor steps through). Sized to the overlay box, not the full frame.

export const OVERLAY_TEMPLATE_IDS = ["lowerThird", "callout", "cornerBadge", "keywordPop"] as const;
export type OverlayTemplateId = (typeof OVERLAY_TEMPLATE_IDS)[number];

export const OVERLAY_PARAMS = {
	lowerThird: z.object({ name: text(60), title: text(80).optional() }),
	callout: z.object({ text: text(90), pointer: z.enum(["left", "right", "up", "down", "none"]).optional() }),
	cornerBadge: z.object({ text: text(24) }),
	keywordPop: z.object({ text: text(40) }),
} as const;

export const OVERLAY_DESCRIPTIONS: Record<OverlayTemplateId, string> = {
	lowerThird: "Name / title bar that slides in at the bottom — {name, title?}. Suggested box: x 4, y 76, width 46, height 16",
	callout: "Speech-bubble callout pointing at something — {text, pointer?: left|right|up|down|none}. Suggested box ~30×12",
	cornerBadge: "Small pill badge (NEW, TIP, 2×) that bounces in — {text}. Suggested box ~14×8 in a corner",
	keywordPop: "One big emphasis word that pops — {text}. Suggested box ~40×18",
};

export const OVERLAY_DEFAULT_SEC: Record<OverlayTemplateId, number> = {
	lowerThird: 4,
	callout: 3,
	cornerBadge: 2.5,
	keywordPop: 1.8,
};

function overlayShell(kit: BrandKit, frame: Frame, css: string, body: string): string {
	// Design unit: 1/200 of the box height, so text fills the box at any size.
	const u = frame.height / 200;
	const exitAt = Math.max(0.3, frame.durationSec - 0.4);
	const f = feel(kit);
	return `<!doctype html><html><head><style>
:root{--u:${u}px;--p:${kit.primary};--s:${kit.secondary};--bg:${kit.background};--fg:${kit.text};--enter:${f.enter}s;--ease:${f.ease}}
*{box-sizing:border-box}
html,body{margin:0;width:${frame.width}px;height:${frame.height}px;overflow:hidden;background:transparent!important;color:var(--fg);font-family:${fontStack(kit)}}
.o{position:absolute;inset:0;animation:oexit .4s ease-in ${exitAt}s both}
@keyframes oexit{to{opacity:0;transform:translateY(calc(10*var(--u)))}}
@keyframes rise{from{opacity:0;transform:translateY(calc(30*var(--u)))}to{opacity:1;transform:none}}
@keyframes pop{0%{opacity:0;transform:scale(.5)}100%{opacity:1;transform:scale(1)}}
${css}
</style></head><body><div class="o">${body}</div></body></html>`;
}

export function renderOverlayTemplate(
	id: OverlayTemplateId,
	rawParams: unknown,
	kit: BrandKit,
	frame: Frame,
): string {
	switch (id) {
		case "lowerThird": {
			const p = OVERLAY_PARAMS.lowerThird.parse(rawParams);
			const title = p.title ? `<div class="ti">${escapeHtml(p.title)}</div>` : "";
			return overlayShell(
				kit,
				frame,
				`.card{position:absolute;left:0;bottom:0;height:100%;display:flex;align-items:stretch;
 animation:slidein var(--enter) var(--ease) both}
@keyframes slidein{from{transform:translateX(-110%)}to{transform:none}}
.stripe{width:calc(14*var(--u));background:linear-gradient(180deg,var(--p),var(--s));border-radius:calc(8*var(--u)) 0 0 calc(8*var(--u))}
.body{background:color-mix(in srgb,var(--bg) 88%,transparent);padding:calc(22*var(--u)) calc(44*var(--u));display:flex;flex-direction:column;justify-content:center;
 border-radius:0 calc(14*var(--u)) calc(14*var(--u)) 0;box-shadow:0 calc(10*var(--u)) calc(40*var(--u)) rgba(0,0,0,.35)}
.nm{font-size:calc(64*var(--u));font-weight:800;line-height:1.05;white-space:nowrap;animation:rise var(--enter) var(--ease) .15s both}
.ti{font-size:calc(38*var(--u));opacity:.85;margin-top:calc(10*var(--u));white-space:nowrap;animation:rise var(--enter) var(--ease) .3s both}`,
				`<div class="card"><div class="stripe"></div><div class="body"><div class="nm">${escapeHtml(p.name)}</div>${title}</div></div>`,
			);
		}
		case "callout": {
			const p = OVERLAY_PARAMS.callout.parse(rawParams);
			const pointer = p.pointer ?? "down";
			const tail =
				pointer === "none"
					? ""
					: `<div class="tail ${pointer}"></div>`;
			return overlayShell(
				kit,
				frame,
				`.b{position:absolute;inset:calc(18*var(--u));display:flex;align-items:center;justify-content:center;text-align:center;
 padding:0 calc(30*var(--u));border-radius:calc(28*var(--u));background:#fff;color:#111;font-size:calc(52*var(--u));font-weight:700;
 box-shadow:0 calc(10*var(--u)) calc(30*var(--u)) rgba(0,0,0,.3);border:calc(5*var(--u)) solid var(--p)}
.w{position:absolute;inset:0;transform-origin:50% 100%;animation:pop var(--enter) var(--ease) both}
.tail{position:absolute;width:calc(34*var(--u));height:calc(34*var(--u));background:#fff;border:calc(5*var(--u)) solid var(--p);transform:rotate(45deg);z-index:1}
.tail.down{bottom:calc(2*var(--u));left:calc(50% - 17*var(--u));border-top:none;border-left:none}
.tail.up{top:calc(2*var(--u));left:calc(50% - 17*var(--u));border-bottom:none;border-right:none}
.tail.left{left:calc(2*var(--u));top:calc(50% - 17*var(--u));border-top:none;border-right:none}
.tail.right{right:calc(2*var(--u));top:calc(50% - 17*var(--u));border-bottom:none;border-left:none}`,
				`<div class="w"><div class="b">${escapeHtml(p.text)}</div>${tail}</div>`,
			);
		}
		case "cornerBadge": {
			const p = OVERLAY_PARAMS.cornerBadge.parse(rawParams);
			return overlayShell(
				kit,
				frame,
				`.pill{position:absolute;inset:calc(20*var(--u));display:flex;align-items:center;justify-content:center;border-radius:999px;
 background:linear-gradient(90deg,var(--p),var(--s));color:#fff;font-size:calc(80*var(--u));font-weight:900;letter-spacing:.04em;
 box-shadow:0 calc(8*var(--u)) calc(30*var(--u)) rgba(0,0,0,.35);animation:pop var(--enter) cubic-bezier(.34,1.56,.64,1) both}`,
				`<div class="pill">${escapeHtml(p.text)}</div>`,
			);
		}
		case "keywordPop": {
			const p = OVERLAY_PARAMS.keywordPop.parse(rawParams);
			return overlayShell(
				kit,
				frame,
				`.k{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:calc(130*var(--u));font-weight:900;
 text-transform:uppercase;background:linear-gradient(135deg,var(--p),var(--s));-webkit-background-clip:text;background-clip:text;color:transparent;
 filter:drop-shadow(0 calc(6*var(--u)) calc(14*var(--u)) rgba(0,0,0,.45));animation:pop .45s cubic-bezier(.34,1.56,.64,1) both}`,
				`<div class="k">${escapeHtml(p.text)}</div>`,
			);
		}
	}
}

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
	"productIntro",
] as const;
export type MotionTemplateId = (typeof MOTION_TEMPLATE_IDS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

/** Params per template (validated before rendering). */
export const TEMPLATE_PARAMS = {
	titleCard: z.object({
		title: text(80),
		subtitle: text(120).optional(),
		/** Keep it a plain text card. Without this, on a screen recording it renders as productIntro. */
		simple: z.boolean().optional(),
	}),
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
	productIntro: z.object({
		/** Product or brand name shown next to the logo. */
		name: text(40),
		/** The big line — what the product does. */
		headline: text(90),
		tagline: text(140).optional(),
		/** Up to 4 short feature pills ("AI editing", "Auto captions"). */
		features: z.array(text(28)).max(4).optional(),
		/** Absolute image path or data URI shown in the browser window. Default: a frame of the recording. */
		screenshot: z.string().min(1).max(4_000_000).optional(),
		/** Address shown in the browser bar. */
		url: text(60).optional(),
		/** Floating metric card, e.g. {value: 68, suffix: "%", label: "Faster edits"}. */
		stat: z
			.object({ value: z.number().finite(), label: text(30), prefix: z.string().max(3).optional(), suffix: z.string().max(4).optional() })
			.optional(),
		/** Floating notification text. */
		toast: text(40).optional(),
	}),
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
	productIntro: 5,
};

export const TEMPLATE_DESCRIPTIONS: Record<MotionTemplateId, string> = {
	titleCard: "Plain text title — {title, subtitle?, simple?}. On a screen recording this is upgraded to productIntro unless simple:true (only when the user asks for a plain/simple card).",
	sectionCard: "Chapter / section divider — {title, kicker?, number?}",
	outroCta: "Ending call to action — {title, cta, url?}",
	kineticText: "Punchy lines popping in one after another — {lines[]}",
	statHighlight: "A number counting up with a label — {value, label, prefix?, suffix?, decimals?}",
	bulletList: "Title with staggered bullet points — {title, bullets[]}",
	logoReveal: "Brand logo reveal with tagline — {tagline?}",
	productIntro:
		"Premium SaaS product intro: logo + name, headline, feature pills, a 3D browser window showing the product (a frame of the recording by default, or {screenshot}), floating stat card and notification, and a cursor click — {name, headline, tagline?, features?[≤4], url?, stat?{value,label,prefix?,suffix?}, toast?, screenshot?}. Best opener for SaaS / product demos.",
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
		case "productIntro":
			return renderProductIntro(TEMPLATE_PARAMS.productIntro.parse(rawParams), kit, frame);
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

// --- productIntro ---------------------------------------------------------------

function imageSrc(value: string): string {
	return /^data:image\//i.test(value) ? value : pathToFileURL(value).href;
}

/** The dashboard drawn in the browser window when there is no screenshot. */
function mockDashboard(): string {
	const nav = ["Overview", "Projects", "Analytics", "Team", "Settings"]
		.map((n, i) => `<div class="nav${i === 0 ? " on" : ""}"><i></i>${n}</div>`)
		.join("");
	const kpis = [
		["Active users", "k1"],
		["Revenue", "k2"],
		["Conversion", "k3"],
	]
		.map(([l, id]) => `<div class="kpi"><div class="kl">${l}</div><div class="kv" id="${id}">0</div><div class="kd">▲ <span id="${id}d">0</span>%</div></div>`)
		.join("");
	const bars = [42, 58, 51, 70, 64, 82, 76, 94]
		.map((h, i) => `<div class="bar" style="--h:${h}%;animation-delay:${(1.25 + i * 0.07).toFixed(2)}s"></div>`)
		.join("");
	return `<div class="dash"><div class="side"><div class="brandmini"></div>${nav}</div>
<div class="main"><div class="kpis">${kpis}</div>
<div class="charts"><div class="panel"><div class="pt">Weekly growth</div><div class="bars">${bars}</div></div>
<div class="panel"><div class="pt">Engagement</div><svg viewBox="0 0 300 120" preserveAspectRatio="none" class="line">
<defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--p)" stop-opacity=".45"/><stop offset="1" stop-color="var(--p)" stop-opacity="0"/></linearGradient></defs>
<path class="area" d="M0,95 C30,90 50,70 80,72 S130,40 160,48 S220,20 250,26 S290,12 300,10 L300,120 L0,120 Z" fill="url(#lg)"/>
<path class="stroke" d="M0,95 C30,90 50,70 80,72 S130,40 160,48 S220,20 250,26 S290,12 300,10" fill="none" stroke="var(--p)" stroke-width="3"/></svg></div></div>
<div class="btnrow"><div class="cta" id="cta">Create video</div></div></div></div>`;
}

/** "FlutterGo" → "FG", "Acme Cloud" → "AC", "notion" → "NO". */
function initials(name: string): string {
	const words = name.split(/\s+/).filter(Boolean);
	if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
	const caps = name.replace(/[^\p{Lu}]/gu, "");
	if (caps.length >= 2) return caps.slice(0, 2);
	return name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "FG";
}

function renderProductIntro(p: z.infer<(typeof TEMPLATE_PARAMS)["productIntro"]>, kit: BrandKit, frame: Frame): string {
	const words = p.headline.split(/\s+/);
	// The punchline — the last word (last two on a longer line) — carries the brand gradient.
	const accentFrom = words.length - (words.length >= 5 ? 2 : 1);
	const headline = words
		.map(
			(w, i) =>
				`<span class="w${i >= accentFrom && words.length > 1 ? " hl" : ""}" style="${delay(0.35 + i * 0.07)}">${escapeHtml(w)}</span>`,
		)
		.join(" ");
	const afterHeadline = 0.45 + words.length * 0.07;
	const pills = (p.features ?? [])
		.map((f, i) => `<span class="pill" style="${delay(afterHeadline + 0.25 + i * 0.12)}"><b></b>${escapeHtml(f)}</span>`)
		.join("");
	const mark = kit.logoPath
		? logoTag(kit, "logo")
		: `<div class="mono">${escapeHtml(initials(p.name))}</div>`;
	const screen = p.screenshot ? `<img class="shot" src="${escapeHtml(imageSrc(p.screenshot))}" alt="">` : mockDashboard();
	const stat = p.stat
		? `<div class="float stat"><div class="sl">${escapeHtml(p.stat.label)}</div><div class="sv">${escapeHtml(p.stat.prefix ?? "")}<span id="sv">0</span>${escapeHtml(p.stat.suffix ?? "")}</div>
<svg viewBox="0 0 120 36" class="spark"><path d="M0,30 L20,26 L40,28 L60,18 L80,20 L100,8 L120,4" fill="none" stroke="var(--s)" stroke-width="3" stroke-linecap="round"/></svg></div>`
		: "";
	const toast = `<div class="float toast"><span class="ok">✓</span>${escapeHtml(p.toast ?? "Ready to share")}</div>`;
	const statTarget = p.stat?.value ?? 0;
	const statDecimals = p.stat && !Number.isInteger(p.stat.value) ? 1 : 0;
	const script = `<script>
const ease=(k)=>1-Math.pow(1-Math.min(1,Math.max(0,k)),3);
const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
const kpi=[["k1",12480,0],["k2",86200,0],["k3",4.8,1]];
window.render=(t)=>{
 for(const [id,v,d] of kpi){const e=ease((t-1.1)/1.4);set(id,(id==="k2"?"$":"")+(v*e).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d})+(id==="k3"?"%":""));set(id+"d",(12*e).toFixed(1));}
 set("sv",(${JSON.stringify(statTarget)}*ease((t-2.0)/1.2)).toLocaleString("en-US",{minimumFractionDigits:${statDecimals},maximumFractionDigits:${statDecimals}}));
};
</script>`;
	const clickAt = Math.min(frame.durationSec - 1.2, 2.9);
	return shell(
		kit,
		frame,
		`.stage{display:block;text-align:left;animation:exit .45s ease-in ${Math.max(0.3, frame.durationSec - 0.45)}s both,push ${frame.durationSec}s linear both}
@keyframes push{from{transform:scale(1)}to{transform:scale(1.035)}}
.grid{position:absolute;inset:0;background-image:linear-gradient(color-mix(in srgb,var(--fg) 6%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--fg) 6%,transparent) 1px,transparent 1px);
 background-size:calc(64*var(--u)) calc(64*var(--u));mask-image:radial-gradient(circle at 60% 45%,#000 20%,transparent 75%);animation:fade 1s ease both}
@keyframes fade{from{opacity:0}to{opacity:1}}
.left{position:absolute;left:7%;top:50%;width:40%;transform:translateY(-50%)}
.brand{display:flex;align-items:center;gap:calc(20*var(--u));animation:rise var(--enter) var(--ease) .1s both}
.logo{height:calc(72*var(--u))}
.mono{width:calc(72*var(--u));height:calc(72*var(--u));border-radius:calc(20*var(--u));display:grid;place-items:center;font-weight:900;font-size:calc(32*var(--u));
 background:linear-gradient(135deg,var(--p),var(--s));color:#fff;box-shadow:0 calc(12*var(--u)) calc(40*var(--u)) color-mix(in srgb,var(--p) 45%,transparent)}
.name{font-size:calc(40*var(--u));font-weight:700;letter-spacing:-.01em}
.h{margin-top:calc(44*var(--u));font-size:calc(92*var(--u));font-weight:800;line-height:1.04;letter-spacing:-.025em}
.w{display:inline-block;animation:rise var(--enter) var(--ease) both}
.h .hl{background:linear-gradient(90deg,var(--p),var(--s));-webkit-background-clip:text;background-clip:text;color:transparent}
.tag{margin-top:calc(30*var(--u));font-size:calc(34*var(--u));line-height:1.45;opacity:.78;max-width:95%;animation:rise var(--enter) var(--ease) ${afterHeadline.toFixed(2)}s both}
.pills{margin-top:calc(40*var(--u));display:flex;flex-wrap:wrap;gap:calc(16*var(--u))}
.pill{display:inline-flex;align-items:center;gap:calc(12*var(--u));padding:calc(14*var(--u)) calc(24*var(--u));border-radius:99px;font-size:calc(26*var(--u));font-weight:600;
 background:color-mix(in srgb,var(--fg) 7%,transparent);border:calc(1.5*var(--u)) solid color-mix(in srgb,var(--fg) 14%,transparent);animation:pop .5s var(--ease) both}
.pill b{width:calc(12*var(--u));height:calc(12*var(--u));border-radius:50%;background:var(--p);box-shadow:0 0 calc(12*var(--u)) var(--p)}
.scene{position:absolute;left:49%;top:14%;width:46%;height:70%;perspective:calc(2400*var(--u))}
.win{position:absolute;inset:0;border-radius:calc(22*var(--u));overflow:hidden;background:color-mix(in srgb,var(--bg) 70%,#fff 4%);
 border:calc(1.5*var(--u)) solid color-mix(in srgb,var(--fg) 16%,transparent);
 box-shadow:0 calc(60*var(--u)) calc(140*var(--u)) rgba(0,0,0,.45),0 0 0 calc(1*var(--u)) rgba(255,255,255,.04) inset;
 transform-origin:left center;animation:swing 1.3s cubic-bezier(.16,1,.3,1) .45s both}
@keyframes swing{from{opacity:0;transform:translateX(calc(160*var(--u))) rotateY(-28deg) rotateX(6deg)}to{opacity:1;transform:rotateY(-9deg) rotateX(2deg)}}
.chrome{height:calc(56*var(--u));display:flex;align-items:center;gap:calc(10*var(--u));padding:0 calc(22*var(--u));background:color-mix(in srgb,var(--fg) 6%,transparent);border-bottom:calc(1*var(--u)) solid color-mix(in srgb,var(--fg) 10%,transparent)}
.chrome i{width:calc(14*var(--u));height:calc(14*var(--u));border-radius:50%;background:#ff5f57}.chrome i:nth-child(2){background:#febc2e}.chrome i:nth-child(3){background:#28c840}
.addr{margin-left:calc(20*var(--u));flex:1;height:calc(32*var(--u));border-radius:99px;background:color-mix(in srgb,var(--fg) 7%,transparent);font-size:calc(18*var(--u));display:flex;align-items:center;padding:0 calc(18*var(--u));opacity:.75}
.body{position:absolute;top:calc(56*var(--u));left:0;right:0;bottom:0}
.shot{width:100%;height:100%;object-fit:cover;object-position:top left;animation:fade .8s ease .9s both}
.dash{display:flex;height:100%;font-size:calc(18*var(--u))}
.side{width:22%;padding:calc(22*var(--u)) calc(16*var(--u));border-right:calc(1*var(--u)) solid color-mix(in srgb,var(--fg) 8%,transparent)}
.brandmini{height:calc(26*var(--u));width:60%;border-radius:calc(8*var(--u));background:linear-gradient(90deg,var(--p),var(--s));margin-bottom:calc(26*var(--u))}
.nav{display:flex;align-items:center;gap:calc(10*var(--u));padding:calc(10*var(--u)) calc(10*var(--u));border-radius:calc(10*var(--u));opacity:.7;margin-bottom:calc(4*var(--u))}
.nav i{width:calc(14*var(--u));height:calc(14*var(--u));border-radius:calc(4*var(--u));background:color-mix(in srgb,var(--fg) 30%,transparent)}
.nav.on{opacity:1;background:color-mix(in srgb,var(--p) 18%,transparent)}.nav.on i{background:var(--p)}
.main{flex:1;padding:calc(22*var(--u));display:flex;flex-direction:column;gap:calc(18*var(--u))}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:calc(14*var(--u))}
.kpi,.panel{border-radius:calc(14*var(--u));padding:calc(16*var(--u));background:color-mix(in srgb,var(--fg) 5%,transparent);border:calc(1*var(--u)) solid color-mix(in srgb,var(--fg) 9%,transparent);animation:rise .6s var(--ease) both}
.kpi:nth-child(1){animation-delay:.9s}.kpi:nth-child(2){animation-delay:1s}.kpi:nth-child(3){animation-delay:1.1s}
.kl{opacity:.6;font-size:calc(15*var(--u))}.kv{font-size:calc(34*var(--u));font-weight:800;margin-top:calc(6*var(--u));font-variant-numeric:tabular-nums}.kd{color:#34d399;font-size:calc(15*var(--u));margin-top:calc(4*var(--u))}
.charts{flex:1;display:grid;grid-template-columns:1.1fr 1fr;gap:calc(14*var(--u))}
.panel{display:flex;flex-direction:column;animation-delay:1.15s}.pt{opacity:.7;font-size:calc(15*var(--u));margin-bottom:calc(10*var(--u))}
.bars{flex:1;display:flex;align-items:flex-end;gap:calc(10*var(--u))}
.bar{flex:1;height:var(--h);border-radius:calc(6*var(--u)) calc(6*var(--u)) calc(2*var(--u)) calc(2*var(--u));background:linear-gradient(180deg,var(--p),color-mix(in srgb,var(--p) 40%,transparent));transform-origin:bottom;animation:grow .7s var(--ease) both}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.line{flex:1;width:100%}.stroke{stroke-dasharray:420;stroke-dashoffset:420;animation:draw 1.4s ease-out 1.35s forwards}.area{opacity:0;animation:fade .8s ease 1.9s forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.btnrow{display:flex;justify-content:flex-end}
.cta{padding:calc(12*var(--u)) calc(26*var(--u));border-radius:calc(12*var(--u));background:linear-gradient(90deg,var(--p),var(--s));color:#fff;font-weight:700;animation:press .35s ease ${clickAt.toFixed(2)}s both}
@keyframes press{50%{transform:scale(.93)}}
.float{position:absolute;border-radius:calc(18*var(--u));padding:calc(18*var(--u)) calc(22*var(--u));background:color-mix(in srgb,var(--bg) 82%,#fff 6%);
 border:calc(1.5*var(--u)) solid color-mix(in srgb,var(--fg) 14%,transparent);box-shadow:0 calc(30*var(--u)) calc(70*var(--u)) rgba(0,0,0,.4);backdrop-filter:blur(calc(10*var(--u)))}
.stat{left:50%;bottom:6%;min-width:calc(250*var(--u));animation:pop .6s var(--ease) 1.9s both,bob 3s ease-in-out 2.6s infinite}
.sl{font-size:calc(20*var(--u));opacity:.7}.sv{font-size:calc(52*var(--u));font-weight:800;margin-top:calc(4*var(--u));font-variant-numeric:tabular-nums;color:var(--s)}
.spark{width:calc(180*var(--u));height:calc(40*var(--u));margin-top:calc(6*var(--u))}
.toast{right:3%;top:8%;display:flex;align-items:center;gap:calc(14*var(--u));font-size:calc(24*var(--u));font-weight:600;animation:slide .6s var(--ease) 2.3s both,bob 3.4s ease-in-out 3s infinite}
.ok{width:calc(34*var(--u));height:calc(34*var(--u));border-radius:50%;display:grid;place-items:center;background:#22c55e;color:#fff;font-size:calc(20*var(--u))}
@keyframes slide{from{opacity:0;transform:translateY(calc(-30*var(--u)))}to{opacity:1;transform:none}}
@keyframes bob{50%{transform:translateY(calc(-8*var(--u)))}}
.cursor{position:absolute;width:calc(44*var(--u));height:calc(44*var(--u));left:0;top:0;animation:move 1.3s cubic-bezier(.45,0,.2,1) ${(clickAt - 1.3).toFixed(2)}s both;filter:drop-shadow(0 calc(6*var(--u)) calc(10*var(--u)) rgba(0,0,0,.5))}
@keyframes move{from{opacity:0;transform:translate(calc(1780*var(--u)),calc(1000*var(--u)))}20%{opacity:1}to{opacity:1;transform:translate(calc(1740*var(--u)),calc(876*var(--u)))}}
.ripple{position:absolute;left:calc(1753*var(--u));top:calc(884*var(--u));width:calc(80*var(--u));height:calc(80*var(--u));margin:calc(-40*var(--u)) 0 0 calc(-40*var(--u));border-radius:50%;
 border:calc(3*var(--u)) solid var(--p);opacity:0;animation:ripple .7s ease-out ${clickAt.toFixed(2)}s both}
@keyframes ripple{from{opacity:.9;transform:scale(.3)}to{opacity:0;transform:scale(1.6)}}`,
		`<div class="grid"></div>
<div class="left"><div class="brand">${mark}<div class="name">${escapeHtml(p.name)}</div></div>
<div class="h">${headline}</div>${p.tagline ? `<div class="tag">${escapeHtml(p.tagline)}</div>` : ""}<div class="pills">${pills}</div></div>
<div class="scene"><div class="win"><div class="chrome"><i></i><i></i><i></i><div class="addr">${escapeHtml(p.url ?? `${p.name.toLowerCase().replace(/\s+/g, "")}.com`)}</div></div><div class="body">${screen}</div></div></div>
${stat}${toast}<div class="ripple"></div>
<svg class="cursor" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.5 13.8 L17.5 13.8 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
		script,
	);
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

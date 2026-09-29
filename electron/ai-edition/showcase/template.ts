/**
 * Showcase video — the page.
 *
 * One self-contained HTML composition driven by `window.render(t)`: every
 * moving thing is computed from `t`, so the virtual-clock renderer gets the
 * exact same frame every time. The recording is a folder of numbered JPEG
 * frames next to the page (`f/00000.jpg` …), swapped per frame after decode.
 *
 * Layers, back to front: brand background (moving light, grid floor, a big
 * faint logo, the brand name as outlined text, particles, floating tags) →
 * the recording in a tilted glowing window (camera zooms, click ripples,
 * highlight rings, tick badges inside it) → step cards → the logo lockup
 * (intro in the centre, a corner badge while the video plays, outro).
 */

import type { BrandKit } from "../motionStudio/brandKit";
import { escapeHtml } from "../motionStudio/templates";
import { INTER_500, INTER_700, INTER_800 } from "./fonts";
import type { ShowcaseTimeline } from "./plan";

export interface ShowcasePageInput {
	width: number;
	height: number;
	fps: number;
	frameCount: number;
	/** Frame file name pattern width, e.g. 5 → f/00012.jpg */
	frameDigits: number;
	timeline: ShowcaseTimeline;
	kit: BrandKit;
	/** Brand name for the lockup / watermark ("" = none). */
	name: string;
	/** Logo file name next to the page, or null (a monogram is drawn instead). */
	logoFile: string | null;
	intro: boolean;
	outro: boolean;
	tagline: string;
	url: string;
	tags: string[];
	theme: "dark" | "light";
}

export interface ShowcaseTiming {
	/** When the recording starts playing in the finished video. */
	footageStart: number;
	/** Total length of the finished video. */
	totalSec: number;
}

export const INTRO_SEC = 1.45;
const PLAIN_LEAD_SEC = 0.9;
export const OUTRO_SEC = 2.1;
const PLAIN_TAIL_SEC = 0.5;

export function showcaseTiming(footageSec: number, intro: boolean, outro: boolean): ShowcaseTiming {
	const footageStart = intro ? INTRO_SEC : PLAIN_LEAD_SEC;
	return { footageStart, totalSec: footageStart + footageSec + (outro ? OUTRO_SEC : PLAIN_TAIL_SEC) };
}

function hexToRgb(hex: string): [number, number, number] {
	let h = hex.replace("#", "");
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const n = Number.parseInt(h, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => `rgba(${hexToRgb(hex).join(",")},${a})`;
function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function mix(a: string, b: string, t: number): string {
	const A = hexToRgb(a);
	const B = hexToRgb(b);
	return `#${A.map((v, i) => Math.round(v + (B[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Lighten a brand colour until it reads on a dark background. */
function readableOnDark(hex: string): string {
	let c = hex;
	for (let i = 0; i < 6 && luminance(c) < 0.28; i++) c = mix(c, "#ffffff", 0.22);
	return c;
}
/** Darken a brand colour until it reads on a light background. */
function readableOnLight(hex: string): string {
	let c = hex;
	for (let i = 0; i < 6 && luminance(c) > 0.3; i++) c = mix(c, "#0f172a", 0.2);
	return c;
}

function initials(name: string): string {
	const words = name.replace(/\.[a-z]{2,}$/i, "").split(/[\s_-]+|(?=[A-Z][a-z])/).filter(Boolean);
	return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "•").slice(0, 2)).toUpperCase();
}

/** "FlutterGo.ai" → ["FlutterGo", ".ai"]: the suffix gets the gradient. */
function splitName(name: string): [string, string] {
	const i = name.lastIndexOf(".");
	return i > 0 && i < name.length - 1 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

export function renderShowcasePage(input: ShowcasePageInput): string {
	const { kit, theme } = input;
	const dark = theme === "dark";
	const p = kit.primary;
	const s = kit.secondary;
	const a1 = dark ? readableOnDark(p) : readableOnLight(p);
	const a2 = dark ? readableOnDark(s) : readableOnLight(s);
	const base = dark
		? luminance(kit.background) < 0.05
			? kit.background
			: "#06142a"
		: "#f4f7fb";
	const baseDeep = dark ? mix(base, "#000000", 0.45) : "#eaf0f7";
	const baseLift = dark ? mix(base, p, 0.22) : mix("#ffffff", s, 0.08);
	const ink = dark ? "#ffffff" : "#0f172a";
	const inkSoft = dark ? "rgba(226,240,255,.76)" : "rgba(15,23,42,.66)";
	const portrait = input.height > input.width;
	const SW = portrait ? 1080 : 1920;
	const SH = portrait ? 1920 : 1080;
	const hasSteps = input.timeline.steps.length > 0;

	// Window box inside the stage, fitted to the footage's aspect.
	const fw = input.timeline.footage.width;
	const fh = input.timeline.footage.height;
	const aspect = fw / fh;
	const CHROME = 44;
	const area = portrait
		? { x: 60, y: hasSteps ? 190 : 260, w: 960, h: hasSteps ? 1080 : 1340 }
		: hasSteps
			? { x: 628, y: 70, w: 1212, h: 940 }
			: { x: 170, y: 90, w: 1580, h: 900 };
	let vw = area.w;
	let vh = vw / aspect;
	if (vh > area.h - CHROME) {
		vh = area.h - CHROME;
		vw = vh * aspect;
	}
	vw = Math.round(vw);
	vh = Math.round(vh);
	const win = { w: vw, h: vh + CHROME, x: Math.round(area.x + (area.w - vw) / 2), y: Math.round(area.y + (area.h - vh - CHROME) / 2) };
	const card = portrait
		? { x: 90, w: 900, cy: Math.min(SH - 250, win.y + win.h + 230) }
		: { x: 96, w: 480, cy: SH / 2 };

	const [nameMain, nameSuffix] = splitName(input.name);
	const logoTag = input.logoFile
		? `<img class="lg" src="${escapeHtml(input.logoFile)}" alt="">`
		: `<div class="lg mono">${escapeHtml(initials(input.name || "Go"))}</div>`;
	const bigLogo = input.logoFile
		? `<img id="bigmark" src="${escapeHtml(input.logoFile)}" alt="">`
		: `<div id="bigmark" class="mono">${escapeHtml(initials(input.name || "Go"))}</div>`;

	const config = {
		SW,
		SH,
		W: input.width,
		H: input.height,
		portrait,
		fps: input.fps,
		n: input.frameCount,
		digits: input.frameDigits,
		t0: showcaseTiming(input.timeline.footageSec, input.intro, input.outro).footageStart,
		total: showcaseTiming(input.timeline.footageSec, input.intro, input.outro).totalSec,
		ft: input.timeline.footageSec,
		intro: input.intro,
		outro: input.outro,
		hasBrand: Boolean(input.name || input.logoFile),
		fw,
		fh,
		vw,
		vh,
		win,
		card,
		camera: input.timeline.camera,
		steps: input.timeline.steps,
		highlights: input.timeline.highlights,
		checks: input.timeline.checks,
		clicks: input.timeline.clicks,
		covers: input.timeline.covers.map((c) => ({
			in: c.in,
			out: c.out,
			x: c.x,
			y: c.y,
			width: c.width,
			height: c.height,
			mode: c.mode,
			fill: c.fill,
			image: c.image,
			track: c.track,
		})),
		tags: input.tags.slice(0, 8),
	};

	const steps = input.timeline.steps
		.map((st, i) => {
			const title = escapeHtml(st.title);
			const acc = st.accent ? escapeHtml(st.accent) : "";
			const titled = acc && title.includes(acc) ? title.replace(acc, `<em>${acc}</em>`) : title;
			const head =
				st.count !== null
					? `<div class="cnt"><div class="num" id="n${i}">0</div><div class="t">${titled}</div></div>${
							st.count > 0 && st.count <= 12 ? `<div class="bar" id="bar${i}">${"<i></i>".repeat(st.count)}</div>` : ""
						}`
					: `<div class="t">${titled}</div>`;
			return `<div class="co" id="c${i}"><div class="k"><b></b>${escapeHtml(st.kicker)}</div>${head}${
				st.body ? `<div class="s">${escapeHtml(st.body)}</div>` : ""
			}</div><div class="link" id="l${i}"></div>`;
		})
		.join("");

	return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:ShowInter;font-weight:500;src:url(data:font/woff2;base64,${INTER_500}) format('woff2')}
@font-face{font-family:ShowInter;font-weight:700;src:url(data:font/woff2;base64,${INTER_700}) format('woff2')}
@font-face{font-family:ShowInter;font-weight:800;src:url(data:font/woff2;base64,${INTER_800}) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${input.width}px;height:${input.height}px;overflow:hidden;background:${baseDeep};font-family:ShowInter,-apple-system,'Segoe UI',sans-serif}
#all{position:absolute;inset:0;overflow:hidden}
.base{position:absolute;inset:0;background:linear-gradient(135deg,${baseDeep} 0%,${base} 50%,${baseLift} 100%)}
#stage{position:absolute;left:0;top:0;width:${SW}px;height:${SH}px;transform-origin:0 0}
.blob{position:absolute;left:0;top:0;width:1300px;height:1300px;margin:-650px 0 0 -650px;border-radius:50%;${dark ? "mix-blend-mode:screen" : ""}}
#b1{background:radial-gradient(closest-side,${rgba(p, dark ? 0.5 : 0.22)},${rgba(p, 0)})}
#b2{background:radial-gradient(closest-side,${rgba(s, dark ? 0.46 : 0.2)},${rgba(s, 0)})}
#b3{background:radial-gradient(closest-side,${rgba(mix(p, s, 0.5), dark ? 0.38 : 0.16)},${rgba(p, 0)})}
#floor{position:absolute;left:-700px;right:-700px;bottom:${portrait ? -300 : -260}px;height:${portrait ? 900 : 760}px;transform-origin:50% 0;transform:perspective(900px) rotateX(72deg);
 background-image:linear-gradient(${rgba(a2, dark ? 0.3 : 0.2)} 1.5px,transparent 1.5px),linear-gradient(90deg,${rgba(a2, dark ? 0.3 : 0.2)} 1.5px,transparent 1.5px);background-size:90px 90px;
 -webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 45%,#000 100%);opacity:.55}
#bigmark{position:absolute;width:${portrait ? 900 : 980}px;height:${portrait ? 900 : 980}px;left:${portrait ? 380 : 1160}px;top:${portrait ? -200 : -240}px;opacity:${dark ? 0.08 : 0.07};object-fit:contain}
#bigmark.mono{border-radius:50%;border:40px solid ${a1};display:flex;align-items:center;justify-content:center;font:800 360px/1 ShowInter;color:${a1}}
#water{position:absolute;left:0;top:${portrait ? 1700 : 808}px;white-space:nowrap;font:800 250px/1 ShowInter;letter-spacing:-.04em;color:transparent;-webkit-text-stroke:2px ${dark ? "rgba(255,255,255,.07)" : "rgba(15,23,42,.06)"}}
.dot{position:absolute;left:0;top:0;border-radius:50%;background:${dark ? mix(a2, "#ffffff", 0.6) : a2}}
.fchip{position:absolute;left:0;top:0;display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;font:700 19px/1 ShowInter;color:${dark ? "rgba(230,245,255,.86)" : "rgba(15,23,42,.72)"};
 background:${dark ? "linear-gradient(135deg,rgba(255,255,255,.10),rgba(255,255,255,.03))" : "rgba(255,255,255,.7)"};border:1px solid ${dark ? "rgba(255,255,255,.14)" : "rgba(15,23,42,.08)"};white-space:nowrap}
.fchip i{width:9px;height:9px;border-radius:50%;background:${a2};box-shadow:0 0 12px ${a2}}
.fchip.g i{background:${a1};box-shadow:0 0 12px ${a1}}
#winwrap{position:absolute;left:${win.x}px;top:${win.y}px;width:${win.w}px;height:${win.h}px;perspective:2400px}
#win{position:absolute;inset:0;transform-origin:30% 50%}
#glow{position:absolute;inset:-3px;border-radius:25px;background:linear-gradient(135deg,${a2},${a1} 50%,${p})}
#halo{position:absolute;inset:-40px;border-radius:60px;background:radial-gradient(closest-side,${rgba(a1, dark ? 0.35 : 0.22)},transparent)}
#frame{position:absolute;inset:0;border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 60px 140px -30px rgba(0,0,0,${dark ? 0.75 : 0.35})}
.chrome{height:${CHROME}px;display:flex;align-items:center;gap:9px;padding:0 20px;background:linear-gradient(#FBFCFE,#F2F5F9);border-bottom:1px solid rgba(15,23,42,.08)}
.chrome i{width:12px;height:12px;border-radius:50%;background:#FF5F57}.chrome i:nth-child(2){background:#FEBC2E}.chrome i:nth-child(3){background:#28C840}
.view{position:absolute;top:${CHROME}px;left:0;width:${vw}px;height:${vh}px;overflow:hidden;background:#fff}
#cam{position:absolute;left:0;top:0;width:${vw}px;height:${vh}px;transform-origin:0 0}
#img{position:absolute;left:0;top:0;width:${vw}px;height:${vh}px}
#sheen{position:absolute;top:-20%;height:140%;left:0;width:300px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg);mix-blend-mode:screen;opacity:0}
.rip{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:3px solid ${readableOnLight(p)};background:${rgba(s, 0.15)};opacity:0}
.hl{position:absolute;border-radius:12px;border:3px solid ${readableOnLight(p)};box-shadow:0 0 0 6px ${rgba(p, 0.16)},0 10px 30px -8px ${rgba(p, 0.5)};opacity:0}
.cov{position:absolute;border-radius:8px;opacity:0;overflow:hidden;display:flex;align-items:center;justify-content:center}
.cov.blur{backdrop-filter:blur(14px) saturate(.9);-webkit-backdrop-filter:blur(14px);background:rgba(255,255,255,.18)}
.cov img{width:88%;height:88%;object-fit:contain}
.chk{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:linear-gradient(135deg,#22C55E,#15803D);box-shadow:0 0 0 5px rgba(34,197,94,.18),0 6px 14px -4px rgba(21,128,61,.6);opacity:0;display:flex;align-items:center;justify-content:center}
.chk svg{width:20px;height:20px}
.co{position:absolute;left:${card.x}px;width:${card.w}px;padding:30px 32px 32px 38px;border-radius:26px;opacity:0;
 background:${dark ? "linear-gradient(145deg,rgba(255,255,255,.14),rgba(255,255,255,.04))" : "linear-gradient(145deg,rgba(255,255,255,.92),rgba(255,255,255,.72))"};border:1px solid ${dark ? "rgba(255,255,255,.2)" : "rgba(15,23,42,.08)"};
 box-shadow:0 40px 80px -30px rgba(0,0,0,${dark ? 0.6 : 0.25}),inset 0 1px 0 rgba(255,255,255,.25);backdrop-filter:blur(18px)}
.co:before{content:"";position:absolute;left:0;top:28px;bottom:28px;width:5px;border-radius:0 5px 5px 0;background:linear-gradient(${a2},${p})}
.co .k{font:700 16px/1 ShowInter;letter-spacing:.2em;color:${a2};text-transform:uppercase;display:flex;align-items:center;gap:10px}
.co .k b{display:inline-block;width:26px;height:2px;background:${a2}}
.co .t{margin-top:16px;font:800 44px/1.08 ShowInter;letter-spacing:-.025em;color:${ink}}
.co .t em{font-style:normal;background:linear-gradient(90deg,${a2},${a1});-webkit-background-clip:text;background-clip:text;color:transparent}
.co .s{margin-top:14px;font:500 22px/1.4 ShowInter;color:${inkSoft}}
.cnt{display:flex;align-items:flex-end;gap:18px;margin-top:10px}.cnt .t{margin:0 0 14px}
.num{font:800 120px/1 ShowInter;letter-spacing:-.05em;background:linear-gradient(135deg,${dark ? mix(a2, "#ffffff", 0.5) : a2},${a1});-webkit-background-clip:text;background-clip:text;color:transparent}
.bar{margin-top:20px;display:flex;gap:10px}.bar i{flex:1;height:8px;border-radius:4px;background:${dark ? "rgba(255,255,255,.14)" : "rgba(15,23,42,.08)"}}
.bar i.on{background:linear-gradient(90deg,${a2},${a1});box-shadow:0 0 14px ${rgba(a2, 0.6)}}
.link{position:absolute;height:2px;left:${card.x + card.w}px;width:${Math.max(0, win.x - card.x - card.w)}px;background:linear-gradient(90deg,${rgba(a2, 0.9)},${rgba(a2, 0.2)});opacity:0;transform-origin:0 50%;${portrait ? "display:none;" : ""}}
.link:after{content:"";position:absolute;right:-6px;top:-5px;width:12px;height:12px;border-radius:50%;background:${a2};box-shadow:0 0 14px ${a2}}
#lock{position:absolute;left:0;top:0;display:flex;align-items:center;gap:28px;transform-origin:0 50%;opacity:0}
#lock .lg{width:150px;height:150px;object-fit:contain}
.lg.mono{border-radius:36px;background:linear-gradient(135deg,${a2},${p});display:flex;align-items:center;justify-content:center;font:800 64px/1 ShowInter;color:#fff}
#word{font:800 104px/1 ShowInter;letter-spacing:-.04em;color:${ink};white-space:nowrap}
#word span{background:linear-gradient(90deg,${a2},${a1});-webkit-background-clip:text;background-clip:text;color:transparent}
#ring{position:absolute;width:150px;height:150px;border-radius:50%;border:3px solid ${a1};opacity:0}
#tag{position:absolute;left:0;right:0;top:${SH / 2 + 100}px;text-align:center;font:700 34px/1.2 ShowInter;color:${inkSoft};opacity:0}
#url{position:absolute;left:50%;top:${SH / 2 + 172}px;padding:14px 26px;border-radius:999px;font:700 24px/1 ShowInter;color:${dark ? "#fff" : "#0f172a"};
 background:linear-gradient(135deg,${rgba(a2, 0.4)},${rgba(p, 0.4)});border:1px solid ${dark ? "rgba(255,255,255,.3)" : "rgba(15,23,42,.1)"};opacity:0;white-space:nowrap}
#vign{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,${dark ? 0.45 : 0.08}))}
</style></head><body><div id="all"><div class="base"></div><div id="stage">
<div class="blob" id="b1"></div><div class="blob" id="b2"></div><div class="blob" id="b3"></div><div id="floor"></div>
${input.name || input.logoFile ? bigLogo : ""}${input.name ? `<div id="water">${escapeHtml(`${input.name}  ${input.name}  ${input.name}`)}</div>` : ""}
<div id="dots"></div><div id="chips"></div>
<div id="winwrap"><div id="win"><div id="halo"></div><div id="glow"></div><div id="frame"><div class="chrome"><i></i><i></i><i></i></div>
<div class="view"><div id="cam"><img id="img" src="f/${"0".repeat(input.frameDigits)}.jpg" alt=""><div id="marks"></div></div><div id="sheen"></div></div></div></div></div>
${steps}
<div id="ring"></div><div id="lock">${logoTag}${input.name ? `<div id="word">${escapeHtml(nameMain)}${nameSuffix ? `<span>${escapeHtml(nameSuffix)}</span>` : ""}</div>` : ""}</div>
${input.tagline ? `<div id="tag">${escapeHtml(input.tagline)}</div>` : ""}${input.url ? `<div id="url">${escapeHtml(input.url)}</div>` : ""}
</div><div id="vign"></div></div>
<script>
const C=${JSON.stringify(config)};
${PAGE_SCRIPT}
</script></body></html>`;
}

/** The per-frame logic (plain JS, runs in the renderer). */
const PAGE_SCRIPT = String.raw`
const $=id=>document.getElementById(id);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const lin=(t,a,b)=>b<=a?(t>=b?1:0):clamp((t-a)/(b-a));
const eio=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
const eout=x=>1-Math.pow(1-x,3);
const back=x=>{const c1=1.5,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2)};
const stage=$('stage');const sc=Math.min(C.W/C.SW,C.H/C.SH);
stage.style.transform='translate('+((C.W-C.SW*sc)/2)+'px,'+((C.H-C.SH*sc)/2)+'px) scale('+sc+')';
let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646};
const dots=[];for(let i=0;i<46;i++){const d=document.createElement('div');d.className='dot';const s=2+rnd()*4;d.style.width=d.style.height=s+'px';
 $('dots').appendChild(d);dots.push({el:d,x:rnd()*C.SW,y:rnd()*C.SH,sp:14+rnd()*30,ph:rnd()*6.28,a:.15+rnd()*.5});}
// Tags sit in the margins around the window and cards.
const W0=C.win;const spots=C.portrait?[[80,120],[640,120],[90,1500],[640,1560],[330,70],[120,1820],[700,1830],[400,1760]]
 :[[110,C.card.cy-250],[330,C.card.cy-325],[120,C.card.cy+260],[300,C.card.cy+345],[W0.x+W0.w*.7,24],[W0.x+W0.w*.85,C.SH-54],[W0.x+W0.w*.38,C.SH-54],[W0.x+W0.w*.25,24]];
const chips=C.tags.map((txt,i)=>{const d=document.createElement('div');d.className='fchip'+(i%2?'':' g');d.innerHTML='<i></i>';d.appendChild(document.createTextNode(txt));$('chips').appendChild(d);const p=spots[i%spots.length];return {el:d,x:p[0],y:p[1],ph:i*1.3}});
const SX=C.vw/C.fw,SY=C.vh/C.fh;const marks=$('marks');
const mk=(cls,html)=>{const d=document.createElement('div');d.className=cls;if(html)d.innerHTML=html;marks.appendChild(d);return d};
const hls=C.highlights.map(h=>{const d=mk('hl');d.style.left=(h.x*SX-6)+'px';d.style.top=(h.y*SY-6)+'px';d.style.width=(h.width*SX+12)+'px';d.style.height=(h.height*SY+12)+'px';return {h,d}});
const TICK='<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const cks=C.checks.map(c=>{const d=mk('chk',TICK);d.style.left=(c.x*SX)+'px';d.style.top=(c.y*SY)+'px';return {c,d}});
const rps=C.clicks.map(c=>{const d=mk('rip');d.style.left=(c.x*SX)+'px';d.style.top=(c.y*SY)+'px';return {c,d}});
const cvs=C.covers.map(c=>{const d=mk('cov '+c.mode);d.style.left=(c.x*SX)+'px';d.style.width=(c.width*SX)+'px';d.style.height=(c.height*SY)+'px';
 if(c.mode!=='blur')d.style.background=c.fill;if(c.mode==='image'&&c.image){const im=document.createElement('img');im.src=c.image;im.alt='';d.appendChild(im)}
 marks.insertBefore(d,marks.firstChild);return {c,d}});
const K=C.camera;
function cam(t){let i=0;while(i<K.length-2&&t>K[i+1][0])i++;const a=K[i],b=K[i+1]||a,e=eio(lin(t,a[0],b[0]));
 return [a[1]+(b[1]-a[1])*e,a[2]+(b[2]-a[2])*e,a[3]+(b[3]-a[3])*e]}
const img=$('img');let cur=-1;
const pad=n=>String(n).padStart(C.digits,'0');
const lock=$('lock'),word=$('word');
const OUT=C.t0+C.ft;
window.render=async(T)=>{
 const ft=clamp(T-C.t0,0,C.ft);
 const i=Math.min(C.n-1,Math.floor(ft*C.fps+1e-6));
 if(i!==cur){cur=i;const nx=new Image();nx.src='f/'+pad(i)+'.jpg';try{await nx.decode()}catch(e){}img.src=nx.src;try{await img.decode()}catch(e){}}
 // background
 const bx=C.SW,by=C.SH;
 $('b1').style.transform='translate('+(bx*.16+Math.sin(T*.35)*160)+'px,'+(by*.82+Math.cos(T*.3)*90)+'px)';
 $('b2').style.transform='translate('+(bx*.78+Math.cos(T*.27)*180)+'px,'+(by*.2+Math.sin(T*.33)*120)+'px)';
 $('b3').style.transform='translate('+(bx*.5+Math.sin(T*.22+1)*260)+'px,'+(by*.52+Math.cos(T*.25)*140)+'px)';
 $('floor').style.backgroundPosition=(-T*12)+'px '+(T*46)+'px';
 const bm=$('bigmark');if(bm)bm.style.transform='translate('+(Math.sin(T*.3)*30)+'px,'+(Math.cos(T*.35)*24)+'px) rotate('+(Math.sin(T*.25)*6)+'deg) scale('+(1+Math.sin(T*.5)*.03)+')';
 const wt=$('water');if(wt)wt.style.transform='translateX('+(-80-T*38)+'px)';
 dots.forEach(d=>{const y=((d.y-T*d.sp)%by+by)%by;d.el.style.transform='translate('+(d.x+Math.sin(T*.6+d.ph)*18)+'px,'+y+'px)';d.el.style.opacity=(d.a*(0.6+0.4*Math.sin(T*2+d.ph))).toFixed(3)});
 chips.forEach((c,k)=>{c.el.style.transform='translate('+(c.x+Math.sin(T*.5+c.ph)*12)+'px,'+(c.y+Math.cos(T*.45+c.ph)*10)+'px)';
  c.el.style.opacity=(0.55*eout(lin(T,C.t0+k*.12,C.t0+.7+k*.12))*(1-lin(T,OUT+.05,OUT+.65))).toFixed(3)});
 // window
 const wi=eout(lin(T,C.t0-.3,C.t0+.65)), wo=C.outro?eio(lin(T,OUT,OUT+.75)):0;
 const sway=Math.sin(T*.55)*1.3;
 const ry=-26*(1-wi)-(C.portrait?0:5)+sway+wo*10, rx=16*(1-wi)+2+Math.cos(T*.4)*.6, ty=160*(1-wi)+wo*40, s=(0.9+0.1*wi)*(1-0.22*wo);
 $('win').style.transform='translateY('+ty.toFixed(1)+'px) rotateY('+ry.toFixed(2)+'deg) rotateX('+rx.toFixed(2)+'deg) scale('+s.toFixed(4)+')';
 $('win').style.opacity=(clamp(wi*1.4)*(1-wo)).toFixed(3);
 $('winwrap').style.filter=wo>0?'blur('+(wo*8).toFixed(1)+'px)':'none';
 const sh=lin(T,C.t0+.45,C.t0+1.25);$('sheen').style.transform='translateX('+(-400+sh*(C.vw+800))+'px) skewX(-18deg)';$('sheen').style.opacity=(sh>0&&sh<1)?0.8:0;
 // camera
 let [z,fx,fy]=cam(ft);fx*=SX;fy*=SY;let tx=C.vw/2-fx*z,ty2=C.vh/2-fy*z;tx=Math.min(0,Math.max(C.vw-C.vw*z,tx));ty2=Math.min(0,Math.max(C.vh-C.vh*z,ty2));
 $('cam').style.transform='translate('+tx.toFixed(2)+'px,'+ty2.toFixed(2)+'px) scale('+z.toFixed(4)+')';
 cvs.forEach(({c,d})=>{const on=ft>=c.in&&ft<=c.out;d.style.opacity=on?1:0;
  if(!on)return;const k=Math.max(0,i-Math.floor(c.in*C.fps));const off=c.track&&c.track.length?c.track[Math.min(c.track.length-1,k)]:0;d.style.top=((c.y+off)*SY)+'px'});
 rps.forEach(({c,d})=>{const r=(ft-c.at)/0.6;d.style.opacity=(r>0&&r<1)?(1-r).toFixed(3):0;d.style.transform='scale('+(0.4+clamp(r)*1.2).toFixed(3)+')'});
 hls.forEach(({h,d})=>{const o=eout(lin(ft,h.in,h.in+.4))*(1-lin(ft,h.out-.25,h.out));d.style.opacity=o.toFixed(3);d.style.transform='scale('+(1.06-0.06*back(lin(ft,h.in,h.in+.5))).toFixed(4)+')'});
 let done=[];cks.forEach(({c,d})=>{const a=lin(ft,c.at,c.at+.3);if(a>=.5&&ft<c.until)done.push(c.at);const o=clamp(a*2)*(1-lin(ft,c.until-.15,c.until));d.style.opacity=o.toFixed(3);d.style.transform='scale('+(a>0?back(a):0).toFixed(3)+')'});
 // step cards
 C.steps.forEach((st,k)=>{const el=$('c'+k);if(!el)return;const h=el.offsetHeight;const inn=lin(ft,st.in,st.in+.55),out=eio(lin(ft,st.out-.35,st.out));
  const vis=T>=C.t0?1:0;const e=back(inn);
  el.style.top=(C.card.cy-h/2)+'px';
  el.style.opacity=(vis*clamp(inn*1.6)*(1-out)).toFixed(3);
  el.style.transform=(C.portrait?'translateY('+(60*(1-e)).toFixed(1)+'px)':'translate('+(-70*(1-e)).toFixed(1)+'px,'+(-34*out).toFixed(1)+'px)')+' scale('+(0.94+0.06*e).toFixed(4)+')';
  const l=$('l'+k);if(l){l.style.top=C.card.cy+'px';const lp=lin(ft,st.in+.3,st.in+.6);l.style.opacity=(vis*lp*(1-out)).toFixed(3);l.style.transform='scaleX('+eout(lp).toFixed(3)+')'}
  if(st.count!==null){const inWin=done.filter(a=>a>=st.in-.5&&a<=st.out).length;const hasChecks=C.checks.some(c=>c.at>=st.in-.5&&c.at<=st.out);
   const v=hasChecks?Math.min(st.count,inWin):Math.round(st.count*eout(lin(ft,st.in+.35,st.in+1.5)));
   $('n'+k).textContent=v;const bar=$('bar'+k);if(bar)[...bar.children].forEach((b,j)=>b.className=j<v?'on':'');}
 });
 // logo lockup: centre (intro) → corner badge → centre (outro)
 if(C.hasBrand){
  const lw=lock.scrollWidth;const cx=C.SW/2-lw/2, cy=C.SH/2-75;
  const mv=C.intro?eio(lin(T,.8,1.3)):1;const bk=C.outro?eio(lin(T,OUT+.3,OUT+1.0)):0;const k=mv*(1-bk);
  const bs=0.34,bxp=C.portrait?54:60,byp=C.portrait?40:-8;
  const X=cx+(bxp-cx)*k,Y=cy+(byp-cy)*k,S=1+(bs-1)*k;
  const intro=C.intro?lin(T,0,.55):1;
  lock.style.transform='translate('+X.toFixed(1)+'px,'+Y.toFixed(1)+'px) scale('+S.toFixed(4)+')';
  lock.style.opacity=(C.intro?clamp(intro*2):clamp(lin(T,C.t0-.2,C.t0+.4))).toFixed(3);
  const lg=lock.querySelector('.lg');const spin=(-35*(1-eout(intro)))+(C.outro&&T>OUT+.25?(1-eout(lin(T,OUT+.3,OUT+1.05)))*-35:0);
  lg.style.transform='rotate('+spin.toFixed(1)+'deg) scale('+(C.intro&&T<1?0.3+0.7*back(intro):1).toFixed(3)+')';
  if(word){const wr=C.intro?eout(lin(T,.3,.8)):1;word.style.clipPath='inset(0 '+(100-wr*100).toFixed(1)+'% 0 -20px)';word.style.transform='translateX('+(-30*(1-wr)).toFixed(1)+'px)'}
  const rg=C.intro?lin(T,.25,1.0):-1,rg2=C.outro?lin(T,OUT+.75,OUT+1.45):-1;const ra=rg>0&&rg<1?rg:(rg2>0&&rg2<1?rg2:-1);
  const r=$('ring');r.style.left=cx+'px';r.style.top=cy+'px';r.style.opacity=ra<0?0:(1-ra).toFixed(3);r.style.transform='scale('+(1+Math.max(0,ra)*1.6).toFixed(3)+')';
 }
 const tg=$('tag');if(tg){const v=C.outro?eout(lin(T,OUT+.85,OUT+1.35)):0;tg.style.opacity=v.toFixed(3);tg.style.transform='translateY('+(20*(1-v)).toFixed(1)+'px)'}
 const ur=$('url');if(ur){const v=C.outro?lin(T,OUT+1.1,OUT+1.35):0;ur.style.opacity=v.toFixed(3);ur.style.transform='translateX(-50%) scale('+(0.8+0.2*back(C.outro?lin(T,OUT+1.1,OUT+1.55):0)).toFixed(3)+')'}
 $('all').style.opacity=(clamp(T/0.25)*(1-lin(T,C.total-0.25,C.total))).toFixed(3);
};
`;

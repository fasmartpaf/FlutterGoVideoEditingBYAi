/**
 * Deterministic time for agent-written motion graphics.
 *
 * A composition is an ordinary HTML page (CSS animations, Web Animations,
 * requestAnimationFrame / GSAP-style loops, or a <canvas> drawn in
 * `window.render(t)`). To turn it into video frame-exactly, this script runs
 * FIRST in the page and replaces the clock: performance.now, Date,
 * requestAnimationFrame and timers all follow a virtual time that only moves
 * when the renderer calls `window.__osSeek(ms)`. Each seek:
 *   1. fires due timers in order,
 *   2. pauses every Web Animation (incl. CSS ones) at the new time,
 *   3. calls `window.render(seconds)` if the page defines it,
 *   4. runs one round of requestAnimationFrame callbacks,
 * so the screenshot taken afterwards is exactly frame `ms`.
 *
 * Composition contract for authors (and the agent):
 *   - Animate with CSS/Web Animations, rAF, or define `window.render = (t) => …`.
 *   - Everything starts at t = 0 when the page loads.
 *   - No network: only inline assets or files next to the composition.
 */
export const MOTION_DRIVER_JS = String.raw`(() => {
  if (window.__osSeek) return;
  let now = 0;
  const epoch = 1767225600000; // fixed wall clock: renders are reproducible
  let rafSeq = 0;
  let rafQueue = new Map();
  let timerSeq = 0;
  const timers = new Map();
  const createdAt = new WeakMap();

  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  const RealDate = Date;
  function VDate(...args) {
    if (!new.target) return new RealDate(epoch + now).toString();
    return args.length ? new RealDate(...args) : new RealDate(epoch + now);
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = () => epoch + now;
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  window.Date = VDate;

  window.requestAnimationFrame = (cb) => { rafSeq += 1; rafQueue.set(rafSeq, cb); return rafSeq; };
  window.cancelAnimationFrame = (id) => { rafQueue.delete(id); };
  const addTimer = (fn, ms, args, repeat) => {
    timerSeq += 1;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(timerSeq, { at: now + delay, every: repeat ? Math.max(1, delay) : 0, fn, args });
    return timerSeq;
  };
  window.setTimeout = (fn, ms, ...args) => addTimer(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => addTimer(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  // Web Animations created by script start at the virtual time they were made.
  const realAnimate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const a = realAnimate.apply(this, args);
    createdAt.set(a, now);
    try { a.pause(); a.currentTime = 0; } catch {}
    return a;
  };

  const runTimersUntil = (target) => {
    for (let guard = 0; guard < 100000; guard++) {
      let nextId = null, next = null;
      for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next.at)) { nextId = id; next = t; }
      if (!next) return;
      now = next.at;
      if (next.every) next.at += next.every; else timers.delete(nextId);
      try { typeof next.fn === "function" ? next.fn(...next.args) : 0; } catch (e) { console.error(e); }
    }
  };

  window.__osErrors = [];
  window.addEventListener("error", (e) => window.__osErrors.push(String(e.message || e)));

  window.__osSeek = async (ms) => {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch {} }
    runTimersUntil(ms);
    now = ms;
    for (const a of document.getAnimations()) {
      try {
        a.pause();
        const born = createdAt.has(a) ? createdAt.get(a) : 0;
        a.currentTime = Math.max(0, ms - born);
      } catch {}
    }
    if (typeof window.render === "function") {
      try { await window.render(ms / 1000); } catch (e) { window.__osErrors.push(String(e && e.message || e)); }
    }
    const due = rafQueue;
    rafQueue = new Map();
    for (const cb of due.values()) { try { cb(now); } catch (e) { window.__osErrors.push(String(e && e.message || e)); } }
    // Let layout/paint settle before the capture.
    await new Promise((r) => (window.queueMicrotask ? queueMicrotask(r) : r()));
    return window.__osErrors.length;
  };
})();`;

export interface CompositionFrame {
	width: number;
	height: number;
	/** Page background behind the composition (default opaque black). */
	background?: string;
}

/**
 * Wrap a composition (full HTML document or a fragment) so the driver runs
 * before any of its scripts, and the page is exactly width × height with no
 * scrollbars.
 */
export function wrapComposition(html: string, frame: CompositionFrame): string {
	const bg = frame.background ?? "#000";
	const reset =
		`<style>html,body{margin:0;padding:0;width:${frame.width}px;height:${frame.height}px;` +
		`overflow:hidden;background:${bg};}</style>`;
	const inject = `<script>${MOTION_DRIVER_JS}</script>${reset}`;
	// CSP: no network at all, only inline and same-folder assets.
	const csp =
		`<meta http-equiv="Content-Security-Policy" content="default-src 'self' file: data: blob: 'unsafe-inline' 'unsafe-eval'; ` +
		`connect-src 'none'; frame-src 'none'; object-src 'none'">`;
	const hasHtml = /<html[\s>]/i.test(html);
	if (!hasHtml) {
		return `<!doctype html><html><head><meta charset="utf-8">${csp}${inject}</head><body>${html}</body></html>`;
	}
	if (/<head[\s>]/i.test(html)) {
		return html.replace(/<head([^>]*)>/i, (m) => `${m}<meta charset="utf-8">${csp}${inject}`);
	}
	return html.replace(/<html([^>]*)>/i, (m) => `${m}<head><meta charset="utf-8">${csp}${inject}</head>`);
}

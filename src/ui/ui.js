// DOM toolkit on the 1920x1080 stage (port of scripts/bw_ui.gd). Everything is absolutely positioned in design pixels.
// Every helper returns the element; `at(el, x, y, w?, h?)` positions it, `add(parent, el)` appends and returns it.
// Pictures come from Art (null -> a flat stand-in), sounds from audio.js.

import { Art } from "./art.js";
import { A } from "../audio.js";

export const INK = "#1a1714";
export const PAPER = "#ede3cc";
export const GOLD = "#dbb24d";
export const CREAM = "#f2e6bf";
export const BRIGHT = "#fff5d6";
export const CINNABAR = "#b82e1f";
export const JADE = "#4d8c66";
export const MUTED = "#8c8576";
export const TIER_COLORS = ["#9e9e99", "#59a673", "#4d80cc", "#9959bf", "#e6b333"];
export const CAT_COLORS = { cultivate: "#5999cc", craft: "#cc8c40", venture: "#66a666", social: "#bf738c", rest: "#8c8cb3", chance: "#d9a626", combat: "#bf4d40" };
export const ELEM_COLORS = { metal: "#d9bf59", wood: "#59a666", water: "#598cd9", fire: "#d95940", earth: "#a68044", none: "#999999" };

export function tier_color(t) {
  return TIER_COLORS[Math.max(0, Math.min(TIER_COLORS.length - 1, t | 0))];
}

/** rgb 0..1 triple or a css string -> css string */
export function css_color(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
    return "#" + h(c[0]) + h(c[1]) + h(c[2]) + (c.length > 3 ? h(c[3]) : "");
  }
  return INK;
}

// ---- tiny DOM helpers ----------------------------------------------------------------------------------------------------
export function el(tag, cls = "", parent = null) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export function add(parent, child) {
  parent.appendChild(child);
  return child;
}

export function at(e, x, y, w = null, h = null) {
  e.style.left = x + "px";
  e.style.top = y + "px";
  if (w != null) e.style.width = w + "px";
  if (h != null) e.style.height = h + "px";
  if (!e.style.position && !e.classList.contains("abs")) e.style.position = "absolute";
  return e;
}

export function full_rect(e) {
  e.style.position = "absolute";
  e.style.left = "0";
  e.style.top = "0";
  e.style.width = "1920px";
  e.style.height = "1080px";
  return e;
}

export function clear(e) {
  while (e.firstChild) e.removeChild(e.firstChild);
  return e;
}

/** a hit target: pointer events on (the stage lets everything else through to the canvas) */
export function hit(e) {
  e.classList.add("hit");
  return e;
}

// ---- text ----------------------------------------------------------------------------------------------------------------
/** one line of text. `title` uses the brush face. opts: {outline, width, align, bold, italic, shadow} */
export function label(text, size = 22, color = INK, title = false, opts = {}) {
  const l = el("div", "lbl" + (title ? " title" : "") + (opts.outline ? " outline" : ""));
  l.textContent = text;
  l.style.fontSize = size + "px";
  l.style.color = css_color(color);
  if (opts.width) {
    l.style.width = opts.width + "px";
    l.style.textAlign = opts.align || "left";
  }
  if (opts.bold) l.style.fontWeight = "700";
  if (opts.italic) l.style.fontStyle = "italic";
  return l;
}

/** wrapped text in a fixed width */
export function wrap_label(text, size, color, width, opts = {}) {
  const l = label(text, size, color, false, opts);
  l.classList.add("wrap");
  l.style.width = width + "px";
  l.style.whiteSpace = "normal";
  if (opts.align) l.style.textAlign = opts.align;
  return l;
}

/** html text (the BBCode of the Godot version becomes <b>, <i>, <span style="color">): textContent is NOT used, escape yourself */
export function rich(width, size = 22, color = INK) {
  const r = el("div", "lbl wrap");
  r.style.width = width + "px";
  r.style.fontSize = size + "px";
  r.style.color = css_color(color);
  r.style.whiteSpace = "normal";
  return r;
}

export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let _measure = null;
export function text_width(text, size, title = false) {
  if (!_measure) _measure = document.createElement("canvas").getContext("2d");
  const fam = getComputedStyle(document.documentElement).getPropertyValue(title ? "--font-title" : "--font-body");
  _measure.font = `${size}px ${fam}`;
  return _measure.measureText(text).width;
}

/** the largest font size <= size at which `text` fits `width` in one line (>= min_size) */
export function fit_size(text, size, width, title = false, min_size = 14) {
  let s = size;
  while (s > min_size && text_width(text, s, title) > width) s -= 1;
  return s;
}

// ---- pictures and frames -------------------------------------------------------------------------------------------------
/** a picture of a given size. cover: crop to fill, else contain. url null -> an empty box */
export function tex_rect(url, w, h, cover = false) {
  const d = el("div", "img");
  d.style.width = w + "px";
  d.style.height = h + "px";
  if (url) {
    d.style.backgroundImage = `url("${url}")`;
    d.style.backgroundSize = cover ? "cover" : "contain";
    d.style.backgroundRepeat = "no-repeat";
    d.style.backgroundPosition = "center";
  }
  return d;
}

/** a nine-patch panel from art/ui/<tex_name> (margin = the corner size in picture px) */
export function panel(tex_name, margin = 40, fallback = "#1a1614e6") {
  const p = el("div", "panel");
  const url = Art.ui(tex_name);
  if (!url) {
    p.classList.add("flat");
    p.style.background = fallback;
  } else {
    p.style.borderImageSource = `url("${url}")`;
    p.style.borderImageSlice = `${margin} fill`;
    p.style.borderWidth = `${margin * 0.6}px`;
  }
  return p;
}

/** a flat box: background, optional border, radius */
export function flat(bg, border = null, border_w = 0, radius = 8) {
  const b = el("div", "abs");
  b.style.background = css_color(bg);
  if (border) b.style.border = `${border_w}px solid ${css_color(border)}`;
  b.style.borderRadius = radius + "px";
  b.style.boxSizing = "border-box";
  return b;
}

/** a textured button. opts: {tex, font_size, color, pad_left, sound, onclick, title (brush face)} */
export function button(text, w, h, opts = {}) {
  const tex = opts.tex || "btn_normal";
  const b = el("div", "btn hit");
  b.style.width = w + "px";
  b.style.height = h + "px";
  b.style.fontSize = (opts.font_size || 24) + "px";
  b.style.color = css_color(opts.color || CREAM);
  if (opts.title) b.style.fontFamily = "var(--font-title)";
  const url = Art.ui(tex);
  const m = opts.margin || 30;
  if (url) {
    b.style.borderImageSource = `url("${url}")`;
    b.style.borderImageSlice = `${m} fill`;
    b.style.borderWidth = `${Math.min(m * 0.6, h / 2.4)}px`;
  } else {
    b.classList.add("flat");
  }
  if (opts.pad_left != null && opts.pad_left >= 0) {
    b.style.justifyContent = "flex-start";
    b.style.paddingLeft = opts.pad_left + "px";
    b.style.textAlign = "left";
  }
  b.textContent = text;
  const sound = opts.sound === undefined ? "ui_click" : opts.sound;
  b.addEventListener("pointerenter", () => {
    if (!b.classList.contains("disabled")) A.sfx("ui_hover");
  });
  b.addEventListener("click", (ev) => {
    if (b.classList.contains("disabled")) return;
    if (sound) A.sfx(sound);
    if (opts.onclick) opts.onclick(ev);
  });
  return b;
}

export function set_enabled(b, on) {
  b.classList.toggle("disabled", !on);
  return b;
}

export function set_text(b, text) {
  b.textContent = text;
  return b;
}

/** a bar: trough picture under, fill picture clipped to a fraction. returns {el, set_value(frac, text)} */
export function bar(trough_name, fill_name, w, h, fallback = "#cc4d40") {
  const root = el("div", "bar");
  root.style.width = w + "px";
  root.style.height = h + "px";
  const tUrl = Art.ui(trough_name);
  const fUrl = Art.ui(fill_name);
  const tr = el("div", "trough", root);
  tr.style.width = "100%";
  if (tUrl) {
    tr.style.backgroundImage = `url("${tUrl}")`;
    tr.style.backgroundSize = "100% 100%";
  } else {
    tr.style.background = "#201c18";
    tr.style.border = "1px solid #5a4a30";
    tr.style.boxSizing = "border-box";
  }
  const fill = el("div", "fill", root);
  const inner = el("div", "", fill);
  inner.style.width = w + "px";
  inner.style.height = "100%";
  if (fUrl) {
    inner.style.backgroundImage = `url("${fUrl}")`;
    inner.style.backgroundSize = "100% 100%";
  } else {
    inner.style.background = css_color(fallback);
  }
  const txt = el("div", "txt", root);
  const api = {
    el: root,
    frac: 1,
    set_value(frac, text = "") {
      api.frac = Math.max(0, Math.min(1, frac));
      fill.style.width = api.frac * 100 + "%";
      txt.textContent = text;
    },
  };
  api.set_value(1, "");
  return api;
}

// ---- screens -------------------------------------------------------------------------------------------------------------
/** Base class of every screen: `root` is a div on the stage; destroy() removes it and runs the cleanups. */
export class Screen {
  constructor(main) {
    this.main = main;
    this.root = el("div", "screen");
    this._cleanups = [];
    this._timers = new Set();
  }
  /** override: build the screen (args from main.goto). May be async. */
  setup(main, args = {}) {}
  on_destroy(fn) {
    this._cleanups.push(fn);
  }
  /** setTimeout that is cancelled with the screen */
  after(ms, fn) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      fn();
    }, ms);
    this._timers.add(t);
    return t;
  }
  destroy() {
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    for (const f of this._cleanups.splice(0)) {
      try {
        f();
      } catch (e) {
        console.error(e);
      }
    }
    this.root.remove();
  }
}

/** a one-shot toast on a parent (fades after secs) */
export function toast(parent, text, secs = 3, x = 500, y = 640, width = 900, size = 24) {
  const p = panel("panel_dark", 30, "#121010f2");
  p.style.left = x + "px";
  p.style.top = y + "px";
  p.style.padding = "14px 22px";
  p.style.zIndex = "70";
  p.classList.add("toast");
  const l = wrap_label(text, size, "#fbeec7", width);
  l.style.position = "static";
  p.appendChild(l);
  parent.appendChild(p);
  p.style.transition = "opacity .5s";
  setTimeout(() => (p.style.opacity = "0"), Math.max(0, secs * 1000));
  setTimeout(() => p.remove(), secs * 1000 + 600);
  A.sfx("ui_toast");
  return p;
}

/** a tween of a number over ms with an easing; calls fn(v) every frame and resolves at the end */
export function tween(from, to, ms, fn, ease = (t) => t * t * (3 - 2 * t)) {
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(from + (to - from) * ease(t));
      if (t < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

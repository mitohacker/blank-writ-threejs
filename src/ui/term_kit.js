// Small helpers shared by the term-side modules (term screen, event / battle views, overlays, the card hand). They exist because the
// Godot Bar / outline / panel-flow behaviours are a little different from the lead's generic toolkit (ui.js):
//   - bar()      the Godot Bar: trough picture stretched, the fill drawn in an inset rect (the trough's frame stays visible), text with a
//                cream outline in dark ink
//   - outline()  text-shadow outline like a Godot `font_outline_color` + `outline_size`
//   - flow_panel()  a nine-patch panel whose children flow inside the border (like a Godot PanelContainer)
//   - make_modal()  the full-stage dim + block layer every overlay / dialog sits on

import { el, css_color, panel, label, wrap_label } from "./ui.js";
import { Art } from "./art.js";

/** a text-shadow string that draws an outline of `px` Godot outline units in `color` */
export function shadow_outline(color, px) {
  const c = css_color(color);
  const r = Math.max(1, Math.round(px * 0.4));
  const out = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(`${(Math.cos(a) * r).toFixed(1)}px ${(Math.sin(a) * r).toFixed(1)}px 0 ${c}`);
  }
  return out.join(",");
}

export function outline(e, color, px) {
  e.style.textShadow = shadow_outline(color, px);
  return e;
}

export function set_pos(e, x, y) {
  e.style.position = "absolute";
  e.style.left = x + "px";
  e.style.top = y + "px";
  return e;
}

/**
 * The Godot Bar: trough picture under (stretched over the whole bar), the fill picture in an inset rect clipped to `frac`, the value text
 * centred with a cream outline. returns {el, set_value(frac, text)}.
 */
export function bar(trough_name, fill_name, w, h, fallback = "#cc4d40", font_size = 18) {
  const root = el("div", "abs");
  root.style.width = w + "px";
  root.style.height = h + "px";
  const tUrl = Art.ui(trough_name);
  const fUrl = Art.ui(fill_name);
  const tr = el("div", "abs", root);
  tr.style.left = "0";
  tr.style.top = "0";
  tr.style.width = "100%";
  tr.style.height = "100%";
  if (tUrl) {
    tr.style.backgroundImage = `url("${tUrl}")`;
    tr.style.backgroundSize = "100% 100%";
  } else {
    tr.style.background = "rgba(26,26,26,.8)";
  }
  const ix = h * 0.35;
  const iy = h * 0.3;
  const iw = w - h * 0.7;
  const ih = h * 0.4;
  const clip = el("div", "abs", root);
  clip.style.left = ix + "px";
  clip.style.top = iy + "px";
  clip.style.height = ih + "px";
  clip.style.overflow = "hidden";
  const inner = el("div", "abs", clip);
  inner.style.left = "0";
  inner.style.top = "0";
  inner.style.width = iw + "px";
  inner.style.height = ih + "px";
  if (fUrl) {
    inner.style.backgroundImage = `url("${fUrl}")`;
    inner.style.backgroundSize = "100% 100%";
  } else {
    inner.style.background = css_color(fallback);
  }
  const txt = el("div", "abs", root);
  txt.style.left = "0";
  txt.style.top = "0";
  txt.style.width = "100%";
  txt.style.height = "100%";
  txt.style.display = "flex";
  txt.style.alignItems = "center";
  txt.style.justifyContent = "center";
  txt.style.fontSize = font_size + "px";
  txt.style.color = "#1a140f";
  txt.style.whiteSpace = "nowrap";
  txt.style.pointerEvents = "none";
  txt.style.textShadow = shadow_outline("#f7f0d9f2", 5);
  const api = {
    el: root,
    frac: 1,
    set_value(frac, text = "") {
      api.frac = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
      clip.style.width = Math.max(0, iw * api.frac) + "px";
      clip.style.display = iw * api.frac > 1 ? "block" : "none";
      txt.textContent = text;
    },
  };
  api.set_value(1, "");
  return api;
}

/**
 * A nine-patch panel whose children flow inside the border (a Godot PanelContainer). Returns {el, body}: put content in `body`
 * (a plain block); the panel is absolutely positioned (use at()).
 */
export function flow_panel(tex_name, margin, fallback, width) {
  const p = panel(tex_name, margin, fallback);
  p.style.width = width + "px";
  const body = el("div", "", p);
  body.style.position = "relative";
  body.style.pointerEvents = "none";
  // the nine-patch border is 0.6 * margin on every side; Godot's content margin is 0.5 * margin above and below
  body.style.margin = `${-Math.round(margin * 0.1)}px 0`;
  return { el: p, body };
}

/** a label that flows (static) inside a flow_panel body */
export function flow_label(text, size, color, width) {
  const l = label(text, size, color);
  l.style.position = "static";
  l.style.whiteSpace = "normal";
  l.style.width = width + "px";
  l.style.overflowWrap = "break-word";
  return l;
}

/**
 * The layer an overlay / dialog lives on: a full-stage block (clicks stop here) with a dim. Returns the root; add the board to it.
 */
export function make_modal(dim_color = "rgba(8,8,10,0.6)") {
  const root = el("div", "abs hit");
  root.style.left = "0";
  root.style.top = "0";
  root.style.width = "1920px";
  root.style.height = "1080px";
  const dim = el("div", "abs", root);
  dim.style.left = "0";
  dim.style.top = "0";
  dim.style.width = "100%";
  dim.style.height = "100%";
  dim.style.background = dim_color;
  return root;
}

/** the game's gold / bad colours for a result line: "+3 ..." good, "-2 ..." bad, else null */
export function sign_class(s) {
  if (/(^|\s)\+\d/.test(s) || s.startsWith("+")) return "gain";
  if (/(^|\s)[-−]\d/.test(s) || s.startsWith("-")) return "loss";
  return "";
}

/** the click / key helpers: remove at screen destroy */
export function on_window(type, fn, opts) {
  window.addEventListener(type, fn, opts);
  return () => window.removeEventListener(type, fn, opts);
}

/** the page's animations are shortened to nothing with ?fast=1 (tests) */
export function ms(main, n) {
  return main && main.args && "fast" in main.args ? Math.min(n, 1) : n;
}

/** a one-line label that keeps runs of spaces ("Qi Refining 2   Age 35") */
export function plabel(text, size, color, title = false, opts = {}) {
  const l = label(text, size, color, title, opts);
  l.style.whiteSpace = "pre";
  return l;
}

/** a wrapped label that keeps runs of spaces and line breaks */
export function pwrap(text, size, color, width, opts = {}) {
  const l = wrap_label(text, size, color, width, opts);
  l.style.whiteSpace = "pre-wrap";
  return l;
}

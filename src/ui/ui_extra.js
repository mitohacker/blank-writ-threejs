// Helpers shared by the menu-side screens (title, birth, wheel, registry, death, ending, settings): port of scripts/bw_ui_extra.gd.
// Text over paintings (outlined), boxes and rings, click wiring, round medallions, the five-roots pentagon, readable effect lines,
// realm / cause / truth / tier names, a tooltip for hover texts. Every helper tolerates a missing picture (a coloured stand-in is drawn).
// One language is shown at a time: every word goes through L.t / L.f / L.name_of.
//
// Positions and sizes are [x, y] / [w, h] arrays (a Godot Vector2); colours are 0..1 float arrays [r, g, b, a?] like Godot's Color
// (ui.js css_color turns them into css) or css strings.

import { Art } from "./art.js";
import * as U from "./ui.js";
import { L } from "../sim/loc.js";
import { sprintf } from "../sim/fmt.js";

// ---- colours -----------------------------------------------------------------------------------------------------------------
export const CREAM = [0.95, 0.9, 0.75];
export const BRIGHT = [1.0, 0.96, 0.84];
export const PAPER = [0.95, 0.91, 0.82];
export const PAPER_INK = [0.15, 0.11, 0.08];
export const PAPER_MUTED = [0.4, 0.31, 0.2];
export const SHADOW = [0.03, 0.04, 0.05, 0.92];
export const JADE_DARK = [0.1, 0.4, 0.24];
export const CINNABAR_DARK = [0.62, 0.13, 0.08];
export const VIOLET = [0.62, 0.4, 0.85];
export const GOLD = [0.86, 0.7, 0.3];            // Ui.GOLD as a float colour (U.GOLD is the css string)
export const CINNABAR = [0.72, 0.18, 0.12];
export const CLEAR = [0, 0, 0, 0];

/** The five roots in the generating cycle (metal makes water makes wood makes fire makes earth makes metal), clockwise from the top. */
export const ROOT_ORDER = ["metal", "water", "wood", "fire", "earth"];
export const STAT_COLORS = {
  body: [0.78, 0.32, 0.25], spirit: [0.35, 0.5, 0.85], insight: [0.6, 0.45, 0.8],
  speed: [0.4, 0.7, 0.55], fortune: [0.88, 0.7, 0.25], heart: [0.8, 0.4, 0.55],
};
/** Ui.ELEM_COLORS as floats */
export const ELEM = {
  metal: [0.85, 0.75, 0.35], wood: [0.35, 0.65, 0.4], water: [0.35, 0.55, 0.85], fire: [0.85, 0.35, 0.25], earth: [0.65, 0.5, 0.3], none: [0.6, 0.6, 0.6],
};

export const css = U.css_color;
export function darkened(c, amt) {
  return [c[0] * (1 - amt), c[1] * (1 - amt), c[2] * (1 - amt), ...(c.length > 3 ? [c[3]] : [])];
}
export function lightened(c, amt) {
  return [c[0] + (1 - c[0]) * amt, c[1] + (1 - c[1]) * amt, c[2] + (1 - c[2]) * amt, ...(c.length > 3 ? [c[3]] : [])];
}
export function with_alpha(c, a) {
  return [c[0], c[1], c[2], a];
}

/** [x, y] or {x, y} -> [x, y] */
export function xy(p) {
  return Array.isArray(p) ? p : [p.x, p.y];
}

// ---- stylesheet (own classes, injected once) --------------------------------------------------------------------------------------
let _css_done = false;
function ensure_css() {
  if (_css_done || typeof document === "undefined") return;
  _css_done = true;
  const s = document.createElement("style");
  s.id = "bw-menu-css";
  s.textContent = `
#stage .mx-clip { overflow: hidden; }
#stage .mx-wrap { line-height: 1.26; }
#stage .mx-hover { transition: filter .08s; }
#stage .mx-hover:hover { filter: brightness(1.07); }
#stage .mx-disc-hl { position: absolute; border-radius: 50%; background: rgba(255,255,255,.14); }
#stage .mx-tip { position: absolute; z-index: 80; pointer-events: none; box-sizing: border-box; padding: 10px 16px; border-radius: 8px;
  background: rgba(18,16,14,.97); border: 2px solid rgba(219,178,77,.75); color: #f2e6bf; font-size: 20px; line-height: 1.28;
  white-space: pre-wrap; box-shadow: 0 6px 18px rgba(0,0,0,.5); }
@keyframes mx-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
#stage .mx-pulse { animation: mx-pulse 1.85s ease-in-out infinite; }
#stage input.mx-range { -webkit-appearance: none; appearance: none; height: 14px; border-radius: 8px; background: #2e2823; border: 2px solid #80693c;
  outline: none; margin: 0; box-sizing: border-box; }
#stage input.mx-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 44px; height: 44px; border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #f5d870 0, #f5c75e 55%, #5a3b16 72%, #5a3b16 78%, transparent 80%); cursor: pointer; border: 0; }
#stage input.mx-range::-moz-range-thumb { width: 40px; height: 40px; border-radius: 50%; background: #f5c75e; border: 3px solid #5a3b16; cursor: pointer; }
`;
  document.head.appendChild(s);
}
ensure_css();

const PAINT_ORDER_OK = typeof CSS !== "undefined" && CSS.supports && CSS.supports("paint-order", "stroke fill");

/** a dark outline around the glyphs (Godot's outline_size: the stroke is centred on the glyph edge, so half of it shows) */
export function outline(l, w, color = SHADOW) {
  const c = css(color);
  if (PAINT_ORDER_OK) {
    l.style.webkitTextStroke = `${w}px ${c}`;
    l.style.paintOrder = "stroke fill";
    l.style.strokeLinejoin = "round";
  } else {
    const r = Math.max(1, w / 2);
    const o = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      o.push(`${(Math.cos(a) * r).toFixed(1)}px ${(Math.sin(a) * r).toFixed(1)}px 0 ${c}`);
    }
    l.style.textShadow = o.join(",");
  }
  return l;
}

// =================================================================================================================================
// text and boxes
// =================================================================================================================================
/** a one-line label (ui.js label) that keeps runs of spaces and line breaks the way Godot's Label does */
export function lab(text, size, color = CREAM, title = false, opts = {}) {
  const l = U.label(text, size, color, title, opts);
  if (/ {2}|\n/.test(String(text))) l.style.whiteSpace = "pre";
  return l;
}

/** A label with a dark outline: readable over a painting. */
export function over_art(text, size, color = CREAM, title = false) {
  const l = lab(text, size, color, title);
  return outline(l, Math.max(4, Math.trunc(size / 7)));
}

/** letter-spacing on a label (the body font with extra space between letters, for "BLANK WRIT") */
export function spaced(l, spacing) {
  l.style.letterSpacing = spacing + "px";
  return l;
}

export function place(e, pos, size = null) {
  const [x, y] = xy(pos);
  if (size) {
    const [w, h] = xy(size);
    U.at(e, x, y, w, h);
  } else U.at(e, x, y);
  return e;
}

export function text_at(parent, text, pos, size = 22, color = CREAM, title = false, width = 0, align = "left") {
  const l = lab(text, size, color, title, width > 0 ? { width, align } : {});
  place(l, pos);
  parent.appendChild(l);
  return l;
}

/** Wrapped text in a fixed width; `max_lines` > 0 trims with an ellipsis. */
export function wrapped_at(parent, text, pos, width, size = 22, color = CREAM, max_lines = 0, align = "left") {
  const l = U.wrap_label(text, size, color, width, { align });
  l.classList.add("mx-wrap");
  if (/ {2}|\n/.test(String(text))) l.style.whiteSpace = "pre-wrap";
  if (max_lines > 0) {
    l.style.display = "-webkit-box";
    l.style.webkitLineClamp = String(max_lines);
    l.style.webkitBoxOrient = "vertical";
    l.style.overflow = "hidden";
  }
  place(l, pos);
  parent.appendChild(l);
  return l;
}

/** one line that never exceeds its width (clipped) */
export function clip(l) {
  l.classList.add("mx-clip");
  return l;
}

export function text_width(text, size, title = false) {
  return U.text_width(text, size, title);
}

/** The largest font size <= `size` at which `text` stays inside `width` on one line (never below `min_size`). */
export function fit_size(text, size, width, title = false, min_size = 14) {
  return U.fit_size(text, size, width, title, min_size);
}

/** One line of text that shrinks to fit `width` (see fit_size), aligned inside that width. */
export function fit_at(parent, text, pos, size, color, title, width, align = "left", min_size = 14) {
  const l = text_at(parent, text, pos, fit_size(text, size, width, title, min_size), color, title, width, align);
  return clip(l);
}

/** A safe over-estimate of how many lines `text` takes wrapped to `width` at `size` (word wrap wastes some of every line). */
export function est_lines(text, size, width, title = false) {
  return Math.max(1, Math.ceil(text_width(text, size, title) / (width * 0.86)));
}

/** The first letter (or character) of a shown name: the mark on a medallion that has no picture. */
export function glyph(shown_name) {
  const a = Array.from(String(shown_name));
  return (a[0] || "").toUpperCase();
}

/** A box style (Godot's StyleBoxFlat): used by box() and ring_box(). */
export function flat(bg, border = CLEAR, border_w = 0, radius = 8) {
  return { bg, border, border_w, radius, shadow_color: null, shadow_size: 0 };
}

/** A plain box placed at `pos` / `size` (ignores the mouse). */
export function box(pos, size, st) {
  const b = U.el("div", "abs");
  b.style.boxSizing = "border-box";
  b.style.background = css(st.bg);
  b.style.borderRadius = st.radius + "px";
  // the border is an inset shadow so children are placed from the box's own corner, as in Godot (a css border would offset them)
  const sh = [];
  if (st.border_w > 0) sh.push(`inset 0 0 0 ${st.border_w}px ${css(st.border)}`);
  if (st.shadow_size > 0 && st.shadow_color) sh.push(`0 0 ${st.shadow_size}px ${Math.round(st.shadow_size / 4)}px ${css(st.shadow_color)}`);
  if (sh.length) b.style.boxShadow = sh.join(",");
  return place(b, pos, size);
}

/** A gold ring around a rectangle (selected cards and buttons). `glow` > 0 adds a soft shadow. */
export function ring_box(pos, size, color = GOLD, width = 5, radius = 14, glow = 10) {
  const st = flat(CLEAR, color, width, radius);
  if (glow > 0) {
    st.shadow_color = [color[0], color[1], color[2], 0.55];
    st.shadow_size = glow;
  }
  return box(pos, size, st);
}

/** The router's background, or (picture missing) a flat dark ground added to `screen` so the text stays readable. */
export function backdrop(screen_root, main, url, dim, fallback = [0.07, 0.08, 0.14]) {
  main.set_background(url || null, dim);
  if (!url) {
    const r = U.el("div", "abs");
    r.style.background = css(fallback);
    U.full_rect(r);
    screen_root.appendChild(r);
  }
}

const _crops = new Map();
/** The wheel, gate and ending paintings came out with a blank paper margin (68 x 58 px of 1920 x 1080): crop it so the picture runs
    to the screen edge. Async: resolves a (blob) url of the cropped picture, the same url when it cannot be cropped, null for null. */
export function crop_margin(url) {
  if (!url) return Promise.resolve(null);
  if (_crops.has(url)) return _crops.get(url);
  const p = (async () => {
    try {
      const im = await Art.image(url);
      if (!im) return url;
      const w = im.naturalWidth;
      const h = im.naturalHeight;
      const x = Math.round((w * 68) / 1920);
      const y = Math.round((h * 58) / 1080);
      const cv = document.createElement("canvas");
      cv.width = w - 2 * x;
      cv.height = h - 2 * y;
      cv.getContext("2d").drawImage(im, x, y, cv.width, cv.height, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.9));
      return blob ? URL.createObjectURL(blob) : url;
    } catch (e) {
      return url;
    }
  })();
  _crops.set(url, p);
  return p;
}

/** Wires a left click on any element. Returns the element. */
export function on_click(c, cb) {
  U.hit(c);
  c.style.cursor = "pointer";
  c.addEventListener("click", (ev) => {
    if (ev.button !== 0) return;
    cb(ev);
  });
  return c;
}

export function on_hover(c, enter, leave) {
  U.hit(c);
  c.addEventListener("pointerenter", () => enter && enter());
  c.addEventListener("pointerleave", () => leave && leave());
  return c;
}

/** a picture of exactly `size` (contain; `cover` crops instead). Missing picture -> an empty box of that size. */
export function pic(url, size, cover = false) {
  const [w, h] = xy(size);
  return U.tex_rect(url, w, h, cover);
}

export function cover_rect(url, size) {
  return pic(url, size, true);
}

export function clear_children(c) {
  return U.clear(c);
}

// =================================================================================================================================
// medallions
// =================================================================================================================================
/** A round medallion: the icon `icon_name` when the picture exists, else a coloured disc carrying `glyph_text`.
    opts: {ring: colour, ring_width, glyph_color} */
export function disc(d, fill, glyph_text, icon_name = "", glyph_size = 0, opts = {}) {
  const e = U.el("div", "abs");
  e.style.width = d + "px";
  e.style.height = d + "px";
  const url = icon_name ? Art.icon(icon_name) : null;
  if (url) {
    e.style.backgroundImage = `url("${url}")`;
    e.style.backgroundSize = "100% 100%";
    return e;
  }
  const rw = opts.ring_width ?? 3;
  const r = d / 2;
  const base = U.el("div", "abs", e);
  base.style.left = "0";
  base.style.top = "0";
  base.style.width = d + "px";
  base.style.height = d + "px";
  base.style.boxSizing = "border-box";
  base.style.borderRadius = "50%";
  base.style.background = css(fill);
  base.style.border = `${rw}px solid ${css(opts.ring || GOLD)}`;
  const hr = r * 0.42;
  const hl = U.el("div", "mx-disc-hl", e);
  hl.style.left = r - r * 0.22 - hr + "px";
  hl.style.top = r - r * 0.28 - hr + "px";
  hl.style.width = hr * 2 + "px";
  hl.style.height = hr * 2 + "px";
  if (glyph_text) {
    const gs = glyph_size > 0 ? glyph_size : Math.trunc(d * 0.5);
    const g = U.label(glyph_text, gs, opts.glyph_color || [1, 1, 1], true, { width: d, align: "center" });
    g.style.left = "0";
    g.style.top = "0";
    g.style.height = d + "px";
    g.style.lineHeight = d + "px";
    outline(g, 5, [0, 0, 0, 0.55]);
    e.appendChild(g);
  }
  return e;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function svg_el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

/** The five-roots pentagon: grid rings, the filled shape of the root levels, five medallions with their numbers.
    Returns {el, set_values(obj), values}; `el` is a w x h box to place. */
export function pentagon(D, size, radius) {
  const [w, h] = xy(size);
  const order = ROOT_ORDER.slice();
  const medal = 30;
  const vmax = 9;
  const root = U.el("div", "abs");
  root.style.width = w + "px";
  root.style.height = h + "px";
  const svg = svg_el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` }, root);
  svg.style.overflow = "visible";
  svg.style.display = "block";
  const cx = w / 2;
  const cy = h / 2;
  const vertex = (i, f) => {
    const a = -Math.PI * 0.5 + (Math.PI * 2 * i) / Math.max(1, order.length);
    return [cx + Math.cos(a) * radius * f, cy + Math.sin(a) * radius * f];
  };
  const pts = (arr) => arr.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const grid = css([0.38, 0.3, 0.2, 0.6]);
  for (let g = 0; g < 3; g++) {
    const f = (g + 1) / 3;
    const ring = [];
    for (let i = 0; i < order.length; i++) ring.push(vertex(i, f));
    svg_el("polygon", { points: pts(ring), fill: "none", stroke: grid, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  }
  for (let i = 0; i < order.length; i++) {
    const v = vertex(i, 1);
    svg_el("line", { x1: cx, y1: cy, x2: v[0], y2: v[1], stroke: css([0.38, 0.3, 0.2, 0.4]), "stroke-width": 1.5 }, svg);
  }
  const shape = svg_el("polygon", { fill: css([0.88, 0.66, 0.22, 0.5]), stroke: css([0.6, 0.4, 0.08]), "stroke-width": 3, "stroke-linejoin": "round" }, svg);
  const badges = {};
  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    const [px, py] = vertex(i, 1);
    const url = Art.icon("el_" + key);
    if (url) {
      svg_el("image", { href: url, x: px - medal, y: py - medal, width: medal * 2, height: medal * 2 }, svg);
    } else {
      const col = ELEM[key] || [0.6, 0.6, 0.6];
      svg_el("circle", { cx: px, cy: py, r: medal, fill: css(col) }, svg);
      svg_el("circle", { cx: px - medal * 0.22, cy: py - medal * 0.28, r: medal * 0.42, fill: css([1, 1, 1, 0.16]) }, svg);
      svg_el("circle", { cx: px, cy: py, r: medal - 1.5, fill: "none", stroke: css([0.3, 0.22, 0.1]), "stroke-width": 3 }, svg);
      const gs = Math.trunc(medal * 1.05);
      const t = svg_el("text", { x: px, y: py + gs * 0.34, "text-anchor": "middle", "font-size": gs, fill: "#fff", stroke: css([0, 0, 0, 0.5]), "stroke-width": 5,
        "paint-order": "stroke fill", style: "font-family:var(--font-title)" }, svg);
      t.textContent = glyph(root_name(D, key));
    }
    // the level, a small dark badge at the lower right of the medallion
    const bx = px + medal * 0.78;
    const by = py + medal * 0.78;
    svg_el("circle", { cx: bx, cy: by, r: 15, fill: css([0.1, 0.08, 0.06, 0.95]) }, svg);
    svg_el("circle", { cx: bx, cy: by, r: 14, fill: "none", stroke: css([0.86, 0.7, 0.3]), "stroke-width": 2 }, svg);
    const nt = svg_el("text", { x: bx, y: by + 7, "text-anchor": "middle", "font-size": 20, fill: css([1, 0.96, 0.84]), style: "font-family:var(--font-body)" }, svg);
    nt.textContent = "0";
    badges[key] = nt;
  }
  const api = {
    el: root,
    values: {},
    set_values(vals) {
      api.values = Object.assign({}, vals);
      const sh = order.map((k, i) => {
        const v = Number(api.values[k] || 0);
        return vertex(i, Math.max(0.1, Math.min(1.0, 0.1 + (0.9 * v) / vmax)));
      });
      shape.setAttribute("points", pts(sh));
      for (const k of order) badges[k].textContent = String(Math.trunc(Number(api.values[k] || 0)));
    },
  };
  api.set_values({});
  return api;
}

// =================================================================================================================================
// words
// =================================================================================================================================
function _sg(v) {
  if (Math.abs(v - Math.round(v)) < 0.001) return sprintf("%+d", Math.round(v));
  return sprintf("%+.1f", v);
}

function _pct(v) {
  return sprintf("%+d%%", Math.round(v * 100));
}

function _cap(k) {
  const s = String(k).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A stat's shown name (Body / 体魄). A table without stat names (stand-in content) falls back to the capitalised key. */
export function stat_name(D, k) {
  const sn = (D.rules && D.rules.stat_names) || {};
  if (k in sn) return L.stat_name(D, k);
  return L.t(_cap(k));
}

/** A root's shown name (Metal / 金). */
export function root_name(D, k) {
  const rn = (D.rules && D.rules.root_names) || {};
  if (k in rn) return L.root_name(D, k);
  switch (k) {
    case "metal": return L.t("Metal");
    case "wood": return L.t("Wood");
    case "water": return L.t("Water");
    case "fire": return L.t("Fire");
    case "earth": return L.t("Earth");
    default: return L.t(_cap(k));
  }
}

/** Shown names of ids from one content table (cards, techs, items); a lone id or an array of ids. */
function _names(table, v) {
  const ids = Array.isArray(v) ? v : [v];
  const out = ids.map((id) => {
    const e = (table && table[String(id)]) || null;
    return e && Object.keys(e).length ? L.name_of(e) : String(id);
  });
  return out.join(L.is_zh() ? "、" : ", ");
}

/** Plain-language lines for a Wheel node's `effect` (per rank) or a talent mapped onto the same keys. */
export function effect_lines(D, ef) {
  const out = [];
  for (const k of Object.keys(ef || {})) {
    const v = ef[k];
    switch (String(k)) {
      case "stat":
        if (v && typeof v === "object") for (const s of Object.keys(v)) out.push(sprintf("%s %s", _sg(Number(v[s])), stat_name(D, s)));
        break;
      case "root":
        if (v && typeof v === "object") for (const s of Object.keys(v)) out.push(L.f("%s %s root", [_sg(Number(v[s])), root_name(D, s)]));
        break;
      case "stone": out.push(L.f("%s starting spirit stones", [_sg(Number(v))])); break;
      case "life": out.push(L.f("%s terms of lifespan", [_sg(Number(v))])); break;
      case "ap": out.push(L.f("%s action point each term", [_sg(Number(v))])); break;
      case "hand": out.push(L.f("%s card in your hand", [_sg(Number(v))])); break;
      case "swap": out.push(L.f("%s swap each term", [_sg(Number(v))])); break;
      case "tier": out.push(L.f("Better card quality (%s)", [_sg(Number(v))])); break;
      case "cult": out.push(L.f("%s cultivation", [_pct(Number(v))])); break;
      case "hp_pct": out.push(L.f("%s maximum HP", [_pct(Number(v))])); break;
      case "card":
      case "cards": out.push(L.f("Starting card: %s", [_names(D.cards, v)])); break;
      case "tech":
      case "techs": out.push(L.f("Starting technique: %s", [_names(D.techs, v)])); break;
      case "item":
      case "items": out.push(L.f("Starting item: %s", [_names(D.items, v)])); break;
      case "revive": out.push(L.f("Rewind a lost fated battle (x%d)", [Math.trunc(Number(v))])); break;
      case "realm":
        if (Number(v) >= 1.0) out.push(L.t("Begin the life already in Qi Refining"));
        break;
      case "notice": out.push(L.f("%s Notice growth", [_pct(Number(v))])); break;
      case "imprint": out.push(L.f("%s imprints from every life", [_pct(Number(v))])); break;
      case "talent_slots": out.push(L.f("%s talent to choose from", [_sg(Number(v))])); break;
      case "reroll": out.push(L.f("%s free talent redraw", [_sg(Number(v))])); break;
      case "breakthrough": out.push(L.f("%s breakthrough chance", [_pct(Number(v))])); break;
      default: out.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
  }
  return out;
}

/** A talent's own keys (stat, root, life, stone, cards, techs, items, cult_mult, notice_rate, hp_pct) as readable lines. */
export function talent_lines(D, t) {
  const ef = {};
  for (const k of ["stat", "root", "life", "stone", "cards", "techs", "items", "hp_pct"]) if (k in t) ef[k] = t[k];
  if ("cult_mult" in t) ef.cult = t.cult_mult;
  if ("notice_rate" in t) ef.notice = t.notice_rate;
  return effect_lines(D, ef);
}

/** "Qi Refining 2" / "炼气二层" (the layer only where the realm has layers). */
export function realm_name(D, realm, layer) {
  const rs = (D.rules && D.rules.realms) || [];
  if (!rs.length) return L.f("Realm %d", [realm]);
  const r = D.realm(realm);
  if (Number((r && r.layers) ?? 1) > 1 && layer > 0) return L.realm_label(D, realm, layer);
  return L.realm_name(D, realm);
}

/** The line shown on the death screen for how a life ended. */
export function cause_line(cause) {
  switch (cause) {
    case "old_age": return L.t("Your years run out");
    case "slain": return L.t("Struck down");
    case "tribulation": return L.t("The tribulation takes you");
    case "struck": return L.t("Struck from the Registry");
    case "heart_demon": return L.t("The heart-demon wins");
    case "ending": return L.t("Your story is told");
    default: return L.t("Your life ends");
  }
}

/** The short word for the Lives table. */
export function cause_short(cause) {
  switch (cause) {
    case "old_age": return L.t("Old age");
    case "slain": return L.t("Slain");
    case "tribulation": return L.t("Tribulation");
    case "struck": return L.t("Struck off");
    case "heart_demon": return L.t("Heart-demon");
    case "ending": return L.t("Ending");
    default: return L.t("End");
  }
}

/** Name of a truth page or its id when the page is not in the data. */
export function truth_name(D, id) {
  const t = (D.truths && D.truths[id]) || null;
  if (!t || !Object.keys(t).length) return id;
  return L.name_of(t);
}

/** "Plain" / "Fine" / "Rare" / "Supreme" (tier 1-4). */
export function tier_name(tier) {
  switch (Math.max(1, Math.min(4, Math.trunc(tier)))) {
    case 1: return L.t("Plain");
    case 2: return L.t("Fine");
    case 3: return L.t("Rare");
    default: return L.t("Supreme");
  }
}

// =================================================================================================================================
// hover texts (Godot's tooltip_text) and small parts
// =================================================================================================================================
let _tip = null;
let _tip_timer = 0;
let _stage = null;

export function hide_tooltip() {
  if (_tip_timer) {
    clearTimeout(_tip_timer);
    _tip_timer = 0;
  }
  if (_tip) {
    _tip.remove();
    _tip = null;
  }
}

function _place_tip(ev) {
  if (!_tip || !_stage) return;
  const r = _stage.getBoundingClientRect();
  const k = r.width / 1920 || 1;
  let x = (ev.clientX - r.left) / k + 18;
  let y = (ev.clientY - r.top) / k + 24;
  const w = _tip.offsetWidth;
  const h = _tip.offsetHeight;
  if (x + w > 1900) x = Math.max(8, 1900 - w);
  if (y + h > 1070) y = Math.max(8, y - h - 44);
  _tip.style.left = x + "px";
  _tip.style.top = y + "px";
}

/** A hover text on `target` (text or a function returning text). Shown after a short delay, hidden on leave / click. */
export function tooltip(target, text) {
  const get = typeof text === "function" ? text : () => text;
  target.addEventListener("pointerenter", (ev) => {
    hide_tooltip();
    const first = ev;
    _tip_timer = setTimeout(() => {
      _tip_timer = 0;
      const t = get();
      if (!t || !target.isConnected) return;
      _stage = document.getElementById("stage");
      if (!_stage) return;
      _tip = U.el("div", "mx-tip");
      _tip.textContent = t;
      _tip.style.maxWidth = "560px";
      _stage.appendChild(_tip);
      _place_tip(first);
    }, 380);
  });
  target.addEventListener("pointermove", (ev) => {
    if (_tip) _place_tip(ev);
  });
  target.addEventListener("pointerleave", hide_tooltip);
  target.addEventListener("pointerdown", hide_tooltip);
  return target;
}

/** a thin horizontal rule */
export function rule(w, color = [0.45, 0.34, 0.18, 0.55], thick = 2) {
  const r = U.el("div", "abs");
  r.style.width = w + "px";
  r.style.height = thick + "px";
  r.style.background = css(color);
  return r;
}

/** a nine-patch from art/ui at 1:1 scale like Godot's StyleBoxTexture (ui.js panel() draws the corners at 60 %). `fallback` is a colour. */
export function nine(tex_name, margin, size, fallback = [0.1, 0.1, 0.1, 0.9]) {
  const [w, h] = xy(size);
  const p = U.el("div", "abs");
  p.style.width = w + "px";
  p.style.height = h + "px";
  p.style.boxSizing = "border-box";
  const url = Art.ui(tex_name);
  if (!url) {
    p.style.background = css(fallback);
    p.style.border = "2px solid " + U.GOLD;
    p.style.borderRadius = "8px";
  } else {
    p.style.borderStyle = "solid";
    p.style.borderWidth = margin + "px";
    p.style.borderImageSource = `url("${url}")`;
    p.style.borderImageSlice = `${margin} fill`;
  }
  return p;
}

/** counts a "+N" label up from 0 over ms (ease-out quad); safe if the label is gone */
export function count_up(label, to, ms, prefix = "+") {
  label.textContent = prefix + 0;
  if (to <= 0) return Promise.resolve();
  return U.tween(0, to, ms, (v) => {
    label.textContent = prefix + Math.round(v);
  }, (t) => 1 - (1 - t) * (1 - t));
}

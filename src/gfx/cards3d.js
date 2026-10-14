// The hand of cards, drawn in WebGL (three.js) in main.world.scene. Port of the card builder of scripts/bw_screen_term.gd (`_make_card`,
// `_build_hand`, `_hover`) with three.js meshes instead of Control nodes:
//
//   const hand = new CardHand(main, { host, on_hover(i, rect|null), on_click(i) });
//   await hand.set_cards(specs, { deal: true });     specs: see card_ops() below, built by the term screen
//   hand.set_enabled(false)        input off while the screen is busy
//   hand.set_swap_mode(true)       gold glow on the cards that may be swapped, the others dimmed
//   await hand.play_out(i)         the clicked card flies up and fades
//   hand.rect(i)                   rest rectangle {x, y, w, h} in design px (tooltips)
//   hand.client_center(i)          the card's centre in page (client) pixels (tests click there)
//   hand.texts()                   every string drawn on the faces (tests check the language)
//   hand.dispose()
//
// Each face is painted into a Canvas2D at 2x (art in the frame's window, the frame, category + tier chips, the name on the frame's bar,
// the rules text on the plate, the action bubble, the "cannot play" dim + reason) and uploaded as a CanvasTexture on a plane.
// Hovering lifts the card, tilts it toward the pointer (a CPU perspective warp of a subdivided plane: the world camera is orthographic)
// and raises it above its neighbours. Picking is a THREE.Raycaster against invisible planes on layer 1 at the cards' rest positions.
// With no WebGL (main.world.ok === false) the same faces are built from absolutely positioned divs, so the game stays playable.

import * as THREE from "three";
import { Art } from "../ui/art.js";
import { A } from "../audio.js";

export const CARD_W = 286;
export const CARD_H = 426;
const SS = 2;                 // texture supersampling
const LIFT = 16;              // design px a hovered card rises (as in Godot)
const PERSP = 1500;           // distance of the fake perspective for the tilt
const LINE_H_WRAP = 1.45;
const LINE_H_ONE = 1.25;

// ---- fonts and text measuring -------------------------------------------------------------------------------------------------
function family(title) {
  const cs = getComputedStyle(document.documentElement);
  return (cs.getPropertyValue(title ? "--font-title" : "--font-body") || "").trim() || "serif";
}

let _scratch = null;
function measure(text, size, title) {
  if (!_scratch) _scratch = document.createElement("canvas").getContext("2d");
  _scratch.font = `${size}px ${family(title)}`;
  return _scratch.measureText(text).width;
}

const CJK = "\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef\\u3000-\\u303f";
const TOKEN_RE = new RegExp(`[${CJK}]|[^\\s${CJK}]+\\s*|\\s+`, "g");
const NO_START = "，。、；：！？）」』》”’,.;:!?)]}…—%";

/** greedy word wrap (words for Latin, characters for CJK, closing punctuation never starts a line) */
export function wrap_lines(text, size, title, maxw) {
  const out = [];
  for (const para of String(text).split("\n")) {
    const tokens = para.match(TOKEN_RE) || [];
    let line = "";
    for (const tk of tokens) {
      const test = line + tk;
      if (line !== "" && measure(test.trimEnd(), size, title) > maxw) {
        if (NO_START.includes(tk[0])) {
          line = test;
          continue;
        }
        out.push(line.trimEnd());
        line = tk.trimStart();
      } else if (line === "" && measure(tk.trimEnd(), size, title) > maxw && tk.length > 1) {
        // a single word wider than the box: split it by characters
        let part = "";
        for (const ch of tk) {
          if (part !== "" && measure(part + ch, size, title) > maxw) {
            out.push(part);
            part = ch;
          } else part += ch;
        }
        line = part;
      } else line = test;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** fills op.lines / op.fs of a text op (shrinks a wrapped text to fit its line budget, a single line to fit its width) */
function resolve_text(op) {
  op.fs = op.size;
  op.lh = op.size * (op.wrap ? LINE_H_WRAP : LINE_H_ONE);
  if (!op.wrap) {
    op.lines = [op.text];
    if (op.fit_w) {
      const min = op.min_size || 9;
      let guard = 0;
      while (op.fs > min && measure(op.text, op.fs, op.title) > op.fit_w && guard++ < 60) op.fs -= 1;
    }
    op.lh = op.fs * LINE_H_ONE;
    return;
  }
  const min = op.min_size || Math.max(9, Math.floor(op.size * 0.78));
  let lines = [];
  let guard = 0;
  for (;;) {
    lines = wrap_lines(op.text, op.fs, op.title, op.w);
    if (lines.length <= op.max_lines || op.fs <= min || guard++ > 40) break;
    op.fs -= 1;
  }
  if (lines.length > op.max_lines) {
    lines = lines.slice(0, op.max_lines);
    let last = lines[lines.length - 1];
    while (last.length > 1 && measure(last + "…", op.fs, op.title) > op.w) last = last.slice(0, -1);
    lines[lines.length - 1] = last + "…";
  }
  op.lines = lines;
  op.lh = op.fs * LINE_H_WRAP;
}

// ---- the card face: a list of drawing ops ---------------------------------------------------------------------------------------
const rgba = (r, g, b, a = 1) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

function text_op(text, x, y, size, color, o = {}) {
  return { t: "text", text, x, y, w: o.w || 0, h: o.h || 0, size, color, title: !!o.title, align: o.align || "left", vmid: !!o.vmid, outline: o.outline || null,
    wrap: !!o.wrap, max_lines: o.max_lines || 1, fit_w: o.fit_w || 0, min_size: o.min_size || 0 };
}

/**
 * The drawing ops of a card face of w x h design px. `spec`:
 *   {id, name, zh, tier, ap, cat_label, tier_label, tier_col, tier_big, expires_label, text, cost_label, art_url, frame, frame_url, cat_color,
 *    ok, reason, breakthrough}
 * (strings are already translated; the term screen builds the spec from the run + data exactly as `_make_card` read them)
 */
export function card_ops(spec, w, h) {
  const k = w / CARD_W;
  const finfo = Art.frames()[spec.frame] || null;
  let fsize = [400, 646];
  let win = [0.15, 0.075, 0.7, 0.45];
  if (finfo) {
    fsize = finfo.size;
    const wr = finfo.window;
    win = [wr[0] / fsize[0], wr[1] / fsize[1], (wr[2] - wr[0]) / fsize[0], (wr[3] - wr[1]) / fsize[1]];
  }
  const wx = win[0] * w;
  const wy = win[1] * h;
  const ww = win[2] * w;
  const wh = win[3] * h;
  const ops = [];
  // art under the frame
  if (spec.art_url) ops.push({ t: "img", url: spec.art_url, x: wx, y: wy, w: ww, h: wh, cover: true, fallback: spec.cat_color });
  else {
    ops.push({ t: "rect", x: wx, y: wy, w: ww, h: wh, color: spec.cat_color || "#5a5a5a" });
    ops.push(text_op(String(spec.zh || "?").slice(0, 2), wx + ww * 0.2, wy + wh * 0.3, Math.floor(w * 0.26), "rgba(255,255,255,.7)", { title: true }));
  }
  if (spec.frame_url) ops.push({ t: "img", url: spec.frame_url, x: 0, y: 0, w, h, cover: false });
  else ops.push({ t: "border", x: 2, y: 2, w: w - 4, h: h - 4, color: spec.tier_css || "#9e9e99", width: 4 });
  const dark = { color: "rgba(0,0,0,.9)", px: 5 };
  // top chips: category and AP
  ops.push(text_op(spec.cat_label, wx + 8 * k, wy + 5 * k, Math.floor(17 * k) + 1, rgba(1, 0.96, 0.85), { outline: dark }));
  if (spec.tier_label) {
    const big = spec.tier_big;
    ops.push(text_op(spec.tier_label, wx + ww - 136 * k, wy + 5 * k, big ? Math.floor(30 * k) : Math.floor(17 * k) + 1, spec.tier_col, {
      title: true, w: 130 * k, align: "right", outline: { color: "rgba(0,0,0,.9)", px: 6 } }));
  }
  if (spec.expires_label) ops.push(text_op(spec.expires_label, wx + 8 * k, wy + wh - 50 * k, Math.floor(16 * k) + 1, rgba(1, 0.85, 0.5), { outline: dark }));
  // caption: the name on the frame's black bar, the rules on the cream plate (positions measured from the cut frame)
  const sx = w / fsize[0];
  const sy = h / fsize[1];
  let bar = { y: h * 0.6, h: h * 0.055 };
  let plate = { x: w * 0.1, y: h * 0.69, w: w * 0.8, h: h * 0.25 };
  if (finfo && finfo.bar) bar = { y: finfo.bar[0] * sy, h: (finfo.bar[1] - finfo.bar[0]) * sy };
  if (finfo && finfo.plate) {
    const pl = finfo.plate;
    plate = { x: pl[0] * sx, y: pl[1] * sy, w: (pl[2] - pl[0]) * sx, h: (pl[3] - pl[1]) * sy };
  }
  const nfs = Math.floor(Math.min(26 * k, bar.h * 0.95));
  ops.push(text_op(spec.name, 0, bar.y, nfs, rgba(0.98, 0.88, 0.58), { title: true, w, h: bar.h, align: "center", vmid: true, fit_w: w * 0.9, min_size: 10 }));
  const tw_w = plate.w - 24 * k;
  ops.push(text_op(spec.text || "", plate.x + 12 * k, plate.y + 6 * k, Math.floor(13 * k) + 1, rgba(0.18, 0.14, 0.1), {
    wrap: true, w: tw_w, h: Math.max(20, plate.h - 10 * k), max_lines: 5, min_size: Math.max(9, Math.floor(10.5 * k)) }));
  // the empty bubble at the lower left: the action points this card costs
  ops.push(text_op(String(spec.ap), w * 0.115 - 7 * k, h * 0.925 - 15 * k, Math.floor(22 * k), rgba(0.15, 0.1, 0.08), { title: true }));
  if (spec.cost_label) ops.push(text_op(spec.cost_label, wx + 8 * k, wy + wh - 24 * k, Math.floor(15 * k) + 1, rgba(1, 0.92, 0.6), { outline: { color: "rgba(0,0,0,.95)", px: 5 } }));
  if (!spec.ok && spec.reason) {
    ops.push(text_op(spec.reason, w * 0.1, wy + wh * 0.35, Math.floor(18 * k) + 1, rgba(1, 0.9, 0.7), {
      wrap: true, w: w * 0.8, h: wh * 0.5, max_lines: 4, align: "center", outline: { color: "#000", px: 6 }, min_size: 11 }));
  }
  for (const op of ops) if (op.t === "text") resolve_text(op);
  return ops;
}

// ---- Canvas2D painter ---------------------------------------------------------------------------------------------------------
function draw_ops(ctx, ops, w, h, images, dim) {
  ctx.clearRect(0, 0, w, h);
  for (const op of ops) {
    switch (op.t) {
      case "rect":
        ctx.fillStyle = op.color;
        ctx.fillRect(op.x, op.y, op.w, op.h);
        break;
      case "border":
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.strokeRect(op.x, op.y, op.w, op.h);
        break;
      case "img": {
        const im = images.get(op.url);
        if (!im) {
          if (op.fallback) {
            ctx.fillStyle = op.fallback;
            ctx.fillRect(op.x, op.y, op.w, op.h);
          }
          break;
        }
        if (op.cover) {
          const s = Math.max(op.w / im.width, op.h / im.height);
          const sw = op.w / s;
          const sh = op.h / s;
          ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, op.x, op.y, op.w, op.h);
        } else ctx.drawImage(im, op.x, op.y, op.w, op.h);
        break;
      }
      case "text": {
        ctx.font = `${op.fs}px ${family(op.title)}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = op.align;
        let y0 = op.y;
        if (op.vmid && op.h) y0 = op.y + (op.h - op.lh * op.lines.length) / 2;
        const ax = op.align === "center" ? op.x + op.w / 2 : op.align === "right" ? op.x + op.w : op.x;
        ctx.lineJoin = "round";
        for (let j = 0; j < op.lines.length; j++) {
          const cy = y0 + op.lh * j + op.lh / 2;
          if (op.outline) {
            ctx.lineWidth = op.outline.px * 0.8;
            ctx.strokeStyle = op.outline.color;
            ctx.strokeText(op.lines[j], ax, cy);
          }
          ctx.fillStyle = op.color;
          ctx.fillText(op.lines[j], ax, cy);
        }
        break;
      }
      default:
    }
  }
  if (dim) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }
}

// ---- DOM fallback face --------------------------------------------------------------------------------------------------------
function dom_face(ops, w, h, spec) {
  const root = document.createElement("div");
  root.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:visible`;
  for (const op of ops) {
    const d = document.createElement("div");
    d.style.position = "absolute";
    if (op.t === "rect") {
      d.style.cssText += `;left:${op.x}px;top:${op.y}px;width:${op.w}px;height:${op.h}px;background:${op.color}`;
    } else if (op.t === "border") {
      d.style.cssText += `;left:${op.x}px;top:${op.y}px;width:${op.w - op.width}px;height:${op.h - op.width}px;border:${op.width}px solid ${op.color}`;
    } else if (op.t === "img") {
      d.style.cssText += `;left:${op.x}px;top:${op.y}px;width:${op.w}px;height:${op.h}px;background:url("${op.url}") center/${op.cover ? "cover" : "100% 100%"} no-repeat`;
      if (op.fallback) d.style.backgroundColor = op.fallback;
    } else if (op.t === "text") {
      const r = Math.max(1, Math.round((op.outline ? op.outline.px : 0) * 0.4));
      const sh = op.outline
        ? [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, r], [-r, r], [r, -r]].map((o) => `${o[0]}px ${o[1]}px 0 ${op.outline.color}`).join(",")
        : "none";
      d.style.cssText += `;left:${op.x}px;top:${op.y}px;font-size:${op.fs}px;color:${op.color};text-align:${op.align};white-space:pre;line-height:${op.lh}px;` +
        `font-family:${family(op.title)};text-shadow:${sh}`;
      if (op.w) d.style.width = op.w + "px";
      if (op.vmid && op.h) {
        d.style.top = op.y + (op.h - op.lh * op.lines.length) / 2 + "px";
      }
      d.textContent = op.lines.join("\n");
    }
    root.appendChild(d);
  }
  if (!spec.ok) root.style.filter = "brightness(.55)";
  return root;
}

// ---- soft textures shared by every card -----------------------------------------------------------------------------------------
function shadow_texture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 192;
  const g = c.getContext("2d");
  g.filter = "blur(10px)";
  g.fillStyle = "rgba(0,0,0,.9)";
  const r = 14;
  const x = 20;
  const y = 20;
  const w = 88;
  const h = 152;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glow_texture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 192;
  const g = c.getContext("2d");
  g.filter = "blur(7px)";
  g.strokeStyle = "rgba(255,226,140,1)";
  g.lineWidth = 9;
  g.strokeRect(22, 22, 84, 148);
  g.filter = "blur(2px)";
  g.lineWidth = 3;
  g.strokeStyle = "rgba(255,244,200,1)";
  g.strokeRect(22, 22, 84, 148);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ease_out = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// ---- the hand -----------------------------------------------------------------------------------------------------------------
export class CardHand {
  constructor(main, opts = {}) {
    this.main = main;
    this.world = main.world;
    this.host = opts.host || null;
    this.on_hover = opts.on_hover || (() => {});
    this.on_click = opts.on_click || (() => {});
    this.cards = [];
    this.specs = [];
    this.hovered = -1;
    this.enabled = true;
    this.swap_mode = false;
    this.gl = !!(this.world && this.world.ok && this.world.renderer && this.world.scene);
    this.fast = !!(main.args && "fast" in main.args);
    this.ptr = { x: -9999, y: -9999 };
    this.client = { x: -9999, y: -9999 };
    this._token = 0;
    this._time = 0;
    this._disposed = false;
    this._unhook = null;
    this._listeners = [];
    if (this.gl) {
      this.group = new THREE.Group();
      this.world.scene.add(this.group);
      this.raycaster = new THREE.Raycaster();
      this.raycaster.layers.set(1);
      this._shadow_tex = shadow_texture();
      this._glow_tex = glow_texture();
      this._unhook = this.world.add_frame_hook((dt) => this._update(dt));
    }
    const listen = (target, type, fn, o) => {
      target.addEventListener(type, fn, o);
      this._listeners.push(() => target.removeEventListener(type, fn, o));
    };
    if (this.gl) {
      listen(window, "pointermove", (e) => this._on_move(e), { passive: true });
      listen(window, "pointerdown", (e) => this._on_down(e), { passive: true });
      listen(document.documentElement, "mouseleave", () => this._set_hover(-1), { passive: true });
    }
  }

  // ---- building ---------------------------------------------------------------------------------------------------------------
  async set_cards(specs, { deal = false } = {}) {
    const token = ++this._token;
    this._clear();
    this.specs = specs;
    const urls = new Set();
    for (const s of specs) {
      if (s.art_url) urls.add(s.art_url);
      if (s.frame_url) urls.add(s.frame_url);
    }
    const images = new Map();
    await Promise.all([...urls].map(async (u) => images.set(u, await Art.image(u))));
    if (token !== this._token || this._disposed) return;
    const n = specs.length;
    if (n === 0) return;
    const avail = 1590;
    const gap = 18;
    const w = Math.min(CARD_W, (avail - gap * (n - 1)) / n);
    const h = (w * CARD_H) / CARD_W;
    const total = w * n + gap * (n - 1);
    const x0 = (avail - total) / 2;
    for (let i = 0; i < n; i++) {
      const rect = { x: 300 + x0 + i * (w + gap), y: 150 + 40 + (CARD_H - h) / 2, w, h };
      const ops = card_ops(specs[i], w, h);
      const card = { i, spec: specs[i], rect, ops, lift: 0, rx: 0, ry: 0, leaving: -1, glow: 0, born: this._time, deal: deal ? i * 0.07 : -1, alpha: 1 };
      if (this.gl) this._make_gl_card(card, ops, images, w, h);
      else this._make_dom_card(card, ops, w, h);
      this.cards.push(card);
    }
    this._repick();
  }

  _make_gl_card(c, ops, images, w, h) {
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * SS);
    cv.height = Math.round(h * SS);
    const ctx = cv.getContext("2d");
    ctx.setTransform(SS, 0, 0, SS, 0, 0);
    draw_ops(ctx, ops, w, h, images, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(w, h, 4, 6);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10 + c.i;
    this.group.add(mesh);
    // the vertex positions without any tilt
    c.base = Float32Array.from(geo.attributes.position.array);
    c.geo = geo;
    c.mat = mat;
    c.tex = tex;
    c.mesh = mesh;
    // a soft shadow under the card
    const smat = new THREE.MeshBasicMaterial({ map: this._shadow_tex, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.45, h * 1.3), smat);
    shadow.renderOrder = 5;
    shadow.frustumCulled = false;
    this.group.add(shadow);
    c.shadow = shadow;
    // the gold glow of a card that matters (swap mode, breakthrough)
    const gmat = new THREE.MeshBasicMaterial({ map: this._glow_tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.45, h * 1.3), gmat);
    glow.renderOrder = 9;
    glow.frustumCulled = false;
    this.group.add(glow);
    c.glow_mesh = glow;
    // the invisible picking plane at the rest position (layer 1: the camera never draws it), a little taller so a lifted card stays hovered
    const pick = new THREE.Mesh(new THREE.PlaneGeometry(w, h + LIFT), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    pick.layers.set(1);
    pick.position.copy(this.world.pos(c.rect.x + w / 2, c.rect.y + h / 2 - LIFT / 2, 0));
    pick.userData.i = c.i;
    pick.updateMatrix();
    pick.matrixAutoUpdate = false;
    this.group.add(pick);
    pick.updateMatrixWorld(true);
    c.pick = pick;
    this._place(c, 0);
  }

  _make_dom_card(c, ops, w, h) {
    const el = document.createElement("div");
    el.className = "hit bw-card";
    el.dataset.card = String(c.i);
    el.style.cssText = `position:absolute;left:${c.rect.x}px;top:${c.rect.y}px;width:${w}px;height:${h}px;cursor:pointer;transition:transform .08s`;
    el.appendChild(dom_face(ops, w, h, c.spec));
    el.addEventListener("pointerenter", () => this._set_hover(c.i));
    el.addEventListener("pointerleave", () => this._set_hover(-1));
    el.addEventListener("click", () => {
      if (this.enabled) this.on_click(c.i);
    });
    (this.host || document.getElementById("stage")).appendChild(el);
    c.el = el;
  }

  _clear() {
    for (const c of this.cards) this._free(c);
    this.cards = [];
    this.hovered = -1;
  }

  _free(c) {
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.geo.dispose();
      c.mat.dispose();
      c.tex.dispose();
      this.group.remove(c.shadow);
      c.shadow.geometry.dispose();
      c.shadow.material.dispose();
      this.group.remove(c.glow_mesh);
      c.glow_mesh.geometry.dispose();
      c.glow_mesh.material.dispose();
      this.group.remove(c.pick);
      c.pick.geometry.dispose();
      c.pick.material.dispose();
    }
    if (c.el) c.el.remove();
  }

  dispose() {
    this._disposed = true;
    this._token++;
    this._clear();
    if (this._unhook) this._unhook();
    for (const f of this._listeners.splice(0)) f();
    if (this.gl) {
      this.world.scene.remove(this.group);
      this._shadow_tex.dispose();
      this._glow_tex.dispose();
    }
  }

  // ---- state ------------------------------------------------------------------------------------------------------------------
  set_enabled(on) {
    this.enabled = !!on;
    if (!on) this._set_hover(-1);
    else this._repick();
  }

  set_swap_mode(on) {
    this.swap_mode = !!on;
  }

  /** debug (?hover=<i>): hover that card as if the pointer were over it */
  force_hover(i) {
    const c = this.cards[i];
    if (!c) return;
    this.ptr.x = c.rect.x + c.rect.w * 0.68;
    this.ptr.y = c.rect.y + c.rect.h * 0.3;
    this._set_hover(i);
  }

  rect(i) {
    const c = this.cards[i];
    return c ? { ...c.rect } : null;
  }

  client_center(i) {
    const c = this.cards[i];
    if (!c) return null;
    const o = this.world.stage_origin || { x: 0, y: 0 };
    const s = this.world.scale || 1;
    return { x: o.x + (c.rect.x + c.rect.w / 2) * s, y: o.y + (c.rect.y + c.rect.h / 2) * s };
  }

  texts() {
    const out = [];
    for (const c of this.cards) for (const op of c.ops) if (op.t === "text") out.push(op.lines.join(" "));
    return out;
  }

  /** the clicked card flies up and fades; resolves when it is gone */
  play_out(i) {
    const c = this.cards[i];
    if (!c) return Promise.resolve();
    c.leaving = this._time;
    this._set_hover(-1);
    if (!this.gl) {
      if (c.el) {
        c.el.style.transition = "transform .3s, opacity .3s";
        c.el.style.transform = "translateY(-120px) scale(1.1)";
        c.el.style.opacity = "0";
        c.el.style.pointerEvents = "none";
      }
    }
    const ms = this.fast ? 1 : 320;
    return new Promise((res) => setTimeout(res, ms));
  }

  // ---- pointer ----------------------------------------------------------------------------------------------------------------
  _pick(cx, cy) {
    if (!this.gl || !this.cards.length) return -1;
    const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -((cy / innerHeight) * 2 - 1));
    this.world.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.world.camera);
    const picks = this.cards.filter((c) => c.pick && c.leaving < 0).map((c) => c.pick);
    const hits = this.raycaster.intersectObjects(picks, false);
    return hits.length ? hits[0].object.userData.i : -1;
  }

  _on_move(e) {
    this.client.x = e.clientX;
    this.client.y = e.clientY;
    const d = this.world.to_design(e.clientX, e.clientY);
    this.ptr.x = d.x;
    this.ptr.y = d.y;
    if (e.target !== this.world.canvas || !this.enabled) {
      this._set_hover(-1);
      return;
    }
    this._set_hover(this._pick(e.clientX, e.clientY));
  }

  _on_down(e) {
    if (e.button !== 0 || !this.enabled) return;
    if (e.target !== this.world.canvas) return;
    const d = this.world.to_design(e.clientX, e.clientY);
    this.ptr.x = d.x;
    this.ptr.y = d.y;
    const i = this._pick(e.clientX, e.clientY);
    this._set_hover(i);
    if (i >= 0) this.on_click(i);
  }

  _repick() {
    if (!this.gl || !this.enabled) return;
    const el = document.elementFromPoint(this.client.x, this.client.y);
    if (el === this.world.canvas) this._set_hover(this._pick(this.client.x, this.client.y));
  }

  _set_hover(i) {
    if (i === this.hovered) return;
    const was = this.hovered;
    this.hovered = i;
    if (!this.gl && was >= 0 && this.cards[was] && this.cards[was].el) this.cards[was].el.style.transform = "";
    if (i >= 0 && this.cards[i]) {
      A.sfx("card_hover");
      if (!this.gl && this.cards[i].el) this.cards[i].el.style.transform = `translateY(-${LIFT}px) scale(1.03)`;
      this.on_hover(i, { ...this.cards[i].rect });
    } else {
      this.on_hover(-1, null);
    }
  }

  // ---- per frame --------------------------------------------------------------------------------------------------------------
  _place(c, dt) {
    const r = c.rect;
    let cx = r.x + r.w / 2;
    let cy = r.y + r.h / 2 - LIFT * c.lift;
    let sc = 1 + 0.035 * c.lift;
    let rz = 0;
    let alpha = 1;
    // deal-in: from the pile near End Term
    if (c.deal >= 0) {
      const t = (this._time - c.born - c.deal) / 0.4;
      if (t < 1) {
        const e = ease_out(t);
        const sx = 1620;
        const sy = 860;
        cx = sx + (cx - sx) * e;
        cy = sy + (cy - sy) * e;
        sc *= 0.55 + 0.45 * e;
        rz = (c.i % 2 ? 1 : -1) * 0.35 * (1 - e);
        alpha = t <= 0 ? 0 : Math.min(1, t * 2.2);
      } else c.deal = -1;
    }
    // played: up and away
    if (c.leaving >= 0) {
      const t = Math.min(1, (this._time - c.leaving) / 0.3);
      cy -= 150 * ease_out(t);
      sc *= 1 + 0.14 * t;
      alpha = 1 - t;
    }
    c.alpha = alpha;
    c.mesh.position.copy(this.world.pos(cx, cy, 0));
    c.mesh.scale.setScalar(sc);
    c.mesh.rotation.z = rz;
    c.mesh.renderOrder = 10 + c.i + (c.lift > 0.05 ? 100 : 0) + (c.leaving >= 0 ? 200 : 0);
    // the modulate: dim when it cannot be played (or in swap mode when it cannot be swapped), the breakthrough pulse
    let shade = c.spec.ok ? 1 : 0.55;
    let glow = 0;
    if (this.swap_mode) {
      if (c.spec.swap_ok) glow = 0.55 + 0.35 * Math.sin(this._time * 5);
      else shade = Math.min(shade, 0.5);
    }
    if (c.spec.breakthrough) {
      const pulse = 0.5 + 0.5 * Math.sin(this._time * (Math.PI / 0.8));
      shade = 1 + 0.2 * pulse;
      glow = Math.max(glow, 0.35 + 0.4 * pulse);
    }
    const sel = this.swap_mode && c.spec.swap_ok && c.lift > 0.5;
    c.mat.color.setRGB(shade, shade * (c.spec.breakthrough ? 0.96 : 1), shade * (c.spec.breakthrough ? 0.82 : 1));
    c.mat.opacity = alpha;
    c.shadow.position.copy(this.world.pos(cx + 4, cy + 16 + 8 * c.lift, -1));
    c.shadow.scale.setScalar(sc);
    c.shadow.material.opacity = 0.42 * alpha * (0.85 + 0.3 * c.lift);
    c.glow_mesh.position.copy(this.world.pos(cx, cy, -0.5));
    c.glow_mesh.scale.setScalar(sc);
    c.glow_mesh.rotation.z = rz;
    c.glow_mesh.material.opacity = Math.min(1, (glow + (sel ? 0.4 : 0))) * alpha;
  }

  _warp(c) {
    const pos = c.geo.attributes.position;
    const cx = Math.cos(c.ry);
    const sx = Math.sin(c.ry);
    const cy = Math.cos(c.rx);
    const sy = Math.sin(c.rx);
    const base = c.base;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const y1 = y * cy;
      const z1 = y * sy;
      const x2 = x * cx + z1 * sx;
      const z2 = -x * sx + z1 * cx;
      const s = PERSP / (PERSP - z2);
      pos.setXYZ(i, x2 * s, y1 * s, z2);
    }
    pos.needsUpdate = true;
  }

  _update(dt) {
    if (this._disposed) return;
    this._time += dt;
    for (const c of this.cards) {
      const hov = this.hovered === c.i && this.enabled && c.leaving < 0 ? 1 : 0;
      c.lift += (hov - c.lift) * Math.min(1, dt * 18);
      if (Math.abs(hov - c.lift) < 0.002) c.lift = hov;
      // tilt toward the pointer (the point under it is pushed away)
      let trx = 0;
      let try_ = 0;
      if (hov) {
        const r = c.rect;
        const ux = Math.max(-1, Math.min(1, (this.ptr.x - (r.x + r.w / 2)) / (r.w / 2)));
        const uy = Math.max(-1, Math.min(1, -(this.ptr.y - (r.y + r.h / 2)) / (r.h / 2)));
        try_ = ux * 0.17;
        trx = -uy * 0.13;
      }
      const k = Math.min(1, dt * 14);
      const nrx = c.rx + (trx - c.rx) * k;
      const nry = c.ry + (try_ - c.ry) * k;
      const changed = Math.abs(nrx - c.rx) > 1e-4 || Math.abs(nry - c.ry) > 1e-4;
      c.rx = Math.abs(nrx) < 1e-4 && !hov ? 0 : nrx;
      c.ry = Math.abs(nry) < 1e-4 && !hov ? 0 : nry;
      if (changed || c.warped !== (c.rx === 0 && c.ry === 0)) {
        this._warp(c);
        c.warped = c.rx === 0 && c.ry === 0;
      }
      this._place(c, dt);
    }
  }
}

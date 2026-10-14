// The Wheel of Reincarnation (port of scripts/bw_screen_wheel.gd): the meta tree laid out as four arms round a hub. Nodes are bought with
// imprints between lives. Node pictures: lit = owned, dim = reachable, lock = locked; a reachable node you can pay for pulses.
// Hover reads, click selects, Buy buys. The ground, arms, rings and lines are one SVG on the stage; the nodes are DOM elements.

import { Screen, button, set_enabled, el, label, wrap_label, text_width, fit_size } from "../ui.js";
import { Art } from "../art.js";
import { A } from "../../audio.js";
import { L } from "../../sim/loc.js";
import { RNG } from "../../sim/rng.js";
import * as X from "../ui_extra.js";

const HUB = [700, 540];
const HUB_R = 56;
const RING0 = 90;
const R_LIMIT = 436;
const STEP_MAX = 72;
const ARM_HALF = 41;
const PANEL = { x: 1240, y: 88, w: 640, h: 742 };
const GOLD_F = [0.86, 0.7, 0.3];

/** branch -> arm: node colour, centre angle (degrees, screen space, clockwise from +x), tint. */
const ARMS = {
  body: { color: "red", centre: 225, tint: [0.85, 0.26, 0.2] },
  spirit: { color: "blue", centre: 315, tint: [0.25, 0.45, 0.9] },
  fortune: { color: "green", centre: 135, tint: [0.25, 0.7, 0.4] },
  dao: { color: "gold", centre: 45, tint: [0.9, 0.72, 0.22] },
};
const HIDDEN_FILTER = "hue-rotate(58deg) saturate(1.25) brightness(1.12)";
const rad = (deg) => (deg * Math.PI) / 180;

export default class WheelScreen extends Screen {
  async setup(main, args = {}) {
    this.main = main;
    this.D = main.D;
    this.meta = main.meta;
    this.on_destroy(X.hide_tooltip);
    this._nodes = {};      // id -> {el, halo, img, ring, glyph, badge, ...}
    this._pos = {};        // id -> [x, y] (centre)
    this._segments = [];   // [{a, b, from, to, violet, focus_only}]
    this._selected = "";
    this._node_size = 64;
    this._rim = 400;
    this._rings = [];
    this._arms = [];
    this._dust = [];
    const root = this.root;

    // the painting is cropped (it came out with a blank paper margin) before it goes to the WebGL layer
    main.set_background(await X.crop_margin(Art.bg("wheel")), 0.55);
    const ground = el("div", "abs");
    ground.style.background = X.css([0.03, 0.04, 0.13, 0.8]);
    ground.style.left = "0";
    ground.style.top = "0";
    ground.style.width = "1920px";
    ground.style.height = "1080px";
    root.appendChild(ground);

    this._svg = X.svg_el("svg", { width: 1920, height: 1080, viewBox: "0 0 1920 1080" });
    this._svg.style.position = "absolute";
    this._svg.style.left = "0";
    this._svg.style.top = "0";
    root.appendChild(this._svg);

    this._layout();
    this._draw_back();
    this._build_nodes();
    this._build_frame();
    this._build_info();
    this._refresh();
    this._show("");
  }

  /** The shown name of an arm (the medallion on the rim and the "... path" line). */
  _arm_name(br) {
    switch (br) {
      case "body": return L.t("Body");
      case "spirit": return L.t("Spirit");
      case "fortune": return L.t("Fortune");
      case "hidden": return L.t("Hidden");
      default: return L.t("Dao");
    }
  }

  // ---- layout ----------------------------------------------------------------------------------------------------------------
  _layout() {
    const D = this.D;
    const meta = this.meta;
    const wheel = D.wheel;
    const order = D.wheel_order || Object.keys(wheel);
    let max_tier = 1;
    const by_arm = {};   // arm -> {tier -> [ids]}
    const hidden_ids = [];
    for (const oid of order) {
      const id = String(oid);
      if (!(id in wheel)) continue;
      const n = wheel[id];
      let br = String(n.branch ?? "dao");
      if (br === "hidden") {
        if (meta.has_flag("t_wheel")) hidden_ids.push(id);
        continue;
      }
      if (!(br in ARMS)) br = "dao";
      const tier = Math.max(0, Math.trunc(n.tier ?? 1));
      max_tier = Math.max(max_tier, tier);
      if (!(br in by_arm)) by_arm[br] = {};
      const tiers = by_arm[br];
      if (!(tier in tiers)) tiers[tier] = [];
      tiers[tier].push(id);
    }

    const step = Math.min(STEP_MAX, (R_LIMIT - RING0) / max_tier);
    let min_gap = step;
    const arm_span = rad(ARM_HALF * 2 - 8);
    this._rings = [];
    for (let t = 1; t <= max_tier; t++) this._rings.push(RING0 + t * step);
    const angles = {};   // id -> degrees
    for (const br of Object.keys(by_arm)) {
      const arm = ARMS[br];
      const centre = arm.centre;
      const lo = centre - ARM_HALF + 4;
      const hi = centre + ARM_HALF - 4;
      const tiers2 = by_arm[br];
      const tier_keys = Object.keys(tiers2).map(Number).sort((a, b) => a - b);
      for (const tk of tier_keys) {
        const ids = tiers2[tk];
        const radius = RING0 + tk * step;
        const keyed = ids.map((sid, idx) => [this._parent_angle(sid, angles, centre), idx, sid]);
        keyed.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
        const cnt = keyed.length;
        if (cnt > 1) min_gap = Math.min(min_gap, (radius * arm_span) / cnt);
        for (let k = 0; k < cnt; k++) {
          let ang;
          if (cnt === 1) ang = Math.max(lo + 8, Math.min(hi - 8, keyed[0][0]));
          else ang = lo + ((hi - lo) * (k + 0.5)) / cnt;
          const sid2 = keyed[k][2];
          angles[sid2] = ang;
          this._pos[sid2] = [HUB[0] + Math.cos(rad(ang)) * radius, HUB[1] + Math.sin(rad(ang)) * radius];
        }
      }
    }
    this._node_size = Math.max(44, Math.min(74, min_gap * 0.92));

    // the hidden row: a column in the free corner at the left, by tier
    const tier_of = (id) => Math.trunc(wheel[id].tier ?? 1);
    hidden_ids.sort((a, b) => tier_of(a) - tier_of(b));
    const hn = hidden_ids.length;
    if (hn > 0) {
      const dy = Math.min(104, 520 / hn);
      for (let i = 0; i < hn; i++) this._pos[hidden_ids[i]] = [120, 300 + i * dy];
    }

    // rim and arm sectors
    this._rim = RING0 + max_tier * step + this._node_size * 0.5 + 12;
    this._arms = [];
    for (const br2 of Object.keys(ARMS)) {
      const a2 = ARMS[br2];
      const t = a2.tint;
      this._arms.push({ a0: a2.centre - 45, a1: a2.centre + 45, color: [t[0], t[1], t[2], 0.13] });
    }
    // gold dust, the same every time
    const rng = new RNG(20261013);
    this._dust = [];
    for (let i = 0; i < 70; i++) {
      const ang2 = rng.randf() * Math.PI * 2;
      const r = Math.sqrt(rng.randf()) * (this._rim + 10);
      this._dust.push([HUB[0] + Math.cos(ang2) * r, HUB[1] + Math.sin(ang2) * r]);
    }

    // lines: node to what it needs (the hub when it needs nothing)
    this._segments = [];
    for (const sid3 of Object.keys(this._pos)) {
      const n2 = wheel[sid3];
      const hidden = String(n2.branch ?? "") === "hidden";
      const reqs = n2.req || [];
      if (reqs.length === 0) {
        if (!hidden) this._segments.push({ a: HUB, b: this._pos[sid3], from: "", to: sid3, violet: false, focus_only: false });
        continue;
      }
      for (const r of reqs) {
        const rid = String(r);
        if (rid in this._pos) {
          const parent_branch = String((wheel[rid] || {}).branch ?? "");
          this._segments.push({ a: this._pos[rid], b: this._pos[sid3], from: rid, to: sid3, violet: hidden, focus_only: hidden && parent_branch !== "hidden" });
        }
      }
    }
  }

  /** Mean angle of the parents already placed in the same arm (so a child sits in line with what it needs). */
  _parent_angle(id, angles, fallback) {
    const n = this.D.wheel[id];
    let sum = 0;
    let cnt = 0;
    for (const r of n.req || []) {
      const rid = String(r);
      if (rid in angles) {
        sum += angles[rid];
        cnt += 1;
      }
    }
    return cnt > 0 ? sum / cnt : fallback;
  }

  // ---- the ground (svg) --------------------------------------------------------------------------------------------------------
  _draw_back() {
    const svg = this._svg;
    const S = X.svg_el;
    const c = X.css;
    const rim = this._rim;
    const [hx, hy] = HUB;
    S("circle", { cx: hx, cy: hy, r: rim + 16, fill: c([0.03, 0.04, 0.12, 0.93]) }, svg);
    for (const a of this._arms) {
      const pts = [`${hx},${hy}`];
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const ang = rad(a.a0 + ((a.a1 - a.a0) * i) / steps);
        pts.push(`${(hx + Math.cos(ang) * (rim + 14)).toFixed(1)},${(hy + Math.sin(ang) * (rim + 14)).toFixed(1)}`);
      }
      S("polygon", { points: pts.join(" "), fill: c(a.color) }, svg);
    }
    for (const rr of this._rings) S("circle", { cx: hx, cy: hy, r: rr, fill: "none", stroke: c([0.86, 0.7, 0.3, 0.16]), "stroke-width": 1.5 }, svg);
    for (let k = 0; k < 4; k++) {
      const d = [Math.cos(rad(90 * k)), Math.sin(rad(90 * k))];
      S("line", { x1: hx + d[0] * HUB_R, y1: hy + d[1] * HUB_R, x2: hx + d[0] * (rim + 14), y2: hy + d[1] * (rim + 14), stroke: c([0.86, 0.7, 0.3, 0.3]), "stroke-width": 2 }, svg);
    }
    S("circle", { cx: hx, cy: hy, r: rim + 16, fill: "none", stroke: c([0.86, 0.7, 0.3, 0.9]), "stroke-width": 3 }, svg);
    S("circle", { cx: hx, cy: hy, r: rim + 7, fill: "none", stroke: c([0.86, 0.7, 0.3, 0.35]), "stroke-width": 1.5 }, svg);
    for (const p of this._dust) S("circle", { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 1.7, fill: c([0.96, 0.82, 0.45, 0.5]) }, svg);
    this._seg_group = S("g", {}, svg);
    S("circle", { cx: hx, cy: hy, r: HUB_R, fill: c([0.05, 0.06, 0.18]), stroke: c(GOLD_F), "stroke-width": 4 }, svg);
    S("circle", { cx: hx, cy: hy, r: HUB_R - 8, fill: "none", stroke: c([0.86, 0.7, 0.3, 0.45]), "stroke-width": 1.5 }, svg);
  }

  // ---- nodes, frame, info -------------------------------------------------------------------------------------------------------
  _build_nodes() {
    const D = this.D;
    const meta = this.meta;
    const layer = el("div", "abs");
    layer.style.left = "0";
    layer.style.top = "0";
    layer.style.width = "1920px";
    layer.style.height = "1080px";
    this.root.appendChild(layer);
    this._layer = layer;
    const ids = Object.keys(this._pos);
    if (ids.length === 0) {
      X.text_at(layer, L.t("The Wheel is still blank."), [HUB[0] - 250, HUB[1] + 90], 34, X.CREAM, true, 500, "center");
      X.text_at(layer, L.t("No nodes have been written yet."), [HUB[0] - 250, HUB[1] + 140], 24, X.CREAM, false, 500, "center");
      return;
    }
    for (const sid of ids) {
      const n = D.wheel[sid];
      let br = String(n.branch ?? "dao");
      const hidden = br === "hidden";
      if (!hidden && !(br in ARMS)) br = "dao";
      const size = this._node_size;
      const e = el("div", "abs", layer);
      X.place(e, [this._pos[sid][0] - size / 2, this._pos[sid][1] - size / 2], [size, size]);
      e.dataset.node = sid;
      const color = hidden ? "blue" : ARMS[br].color;
      const nd = {
        id: sid, el: e, color, hidden,
        fallback: hidden ? X.VIOLET : ARMS[br].tint,
        max_rank: Math.max(1, Math.trunc(n.max ?? 1)),
        glyph_text: X.glyph(L.name_of(n)),
        state: "lock", rank: 0, buyable: false,
      };
      // parts, back to front: halo, picture (or stand-in disc), selection ring, glyph, rank badge
      nd.halo = el("div", "abs mx-pulse", e);
      const hs = size + 12;
      X.place(nd.halo, [-6, -6], [hs, hs]);
      Object.assign(nd.halo.style, {
        borderRadius: "50%", boxSizing: "border-box", background: X.css([1.0, 0.86, 0.45, 0.3]), border: `3px solid ${X.css([1.0, 0.9, 0.55, 0.9])}`, display: "none",
      });
      nd.img = el("div", "abs", e);
      nd.ring = el("div", "abs", e);
      const rs = size + 18;
      X.place(nd.ring, [-9, -9], [rs, rs]);
      Object.assign(nd.ring.style, { borderRadius: "50%", boxSizing: "border-box", border: `4px solid ${X.css([1.0, 0.96, 0.7])}`, display: "none" });
      nd.glyph = label(nd.glyph_text, Math.trunc((size / 2) * 0.95), [1, 0.97, 0.86], true, { width: size, align: "center" });
      Object.assign(nd.glyph.style, { left: "0", top: "0", height: size + "px", lineHeight: size + "px" });
      e.appendChild(nd.glyph);
      if (nd.max_rank > 1) {
        nd.badge = el("div", "abs", e);
        Object.assign(nd.badge.style, {
          background: X.css([0.03, 0.04, 0.1, 0.88]), fontSize: "20px", height: "26px", lineHeight: "26px", textAlign: "center", whiteSpace: "nowrap",
          fontFamily: "var(--font-body)", top: size - 5 + "px",
        });
      }
      X.on_click(e, () => this._select(sid));
      e.addEventListener("pointerenter", () => this._hover(sid));
      e.addEventListener("pointerleave", () => this._hover(""));
      this._nodes[sid] = nd;
    }
    // arm medallions on the rim
    for (const br2 of Object.keys(ARMS)) {
      const a = ARMS[br2];
      const dir = [Math.cos(rad(a.centre)), Math.sin(rad(a.centre))];
      const p = [HUB[0] + dir[0] * (this._rim + 18), HUB[1] + dir[1] * (this._rim + 18)];
      const arm_name = this._arm_name(br2);
      const md = X.place(X.disc(60, X.darkened(a.tint, 0.35), X.glyph(arm_name), "", 34), [p[0] - 30, p[1] - 30]);
      md.style.zIndex = "6";
      layer.appendChild(md);
      X.fit_at(layer, arm_name, [p[0] - 60, p[1] + 32], 20, X.CREAM, false, 120, "center").style.zIndex = "6";
    }
    const hub_name = L.t("Rebirth");
    X.fit_at(layer, hub_name, [HUB[0] - 52, HUB[1] - 24], 36, X.GOLD, true, 104, "center", 18);
    if (meta.has_flag("t_wheel") && this._has_hidden()) X.text_at(layer, L.t("Hidden row"), [40, 232], 22, X.VIOLET, false, 200);
  }

  _has_hidden() {
    return Object.keys(this._pos).some((id) => String((this.D.wheel[id] || {}).branch ?? "") === "hidden");
  }

  _build_frame() {
    const root = this.root;
    let coin = Art.icon("res_imprint");
    if (!coin) coin = Art.ui("imprint_coin");
    if (coin) root.appendChild(X.place(X.pic(coin, [42, 64]), [36, 14]));
    this._imprint_label = X.text_at(root, "0", [92, 12], 52, X.GOLD, true);
    X.text_at(root, L.t("imprints"), [94, 74], 20, X.CREAM);
    X.fit_at(root, L.t("The Wheel of Reincarnation"), [36, 118], 46, X.BRIGHT, true, 340, "left", 20);
    // legend, bottom left
    const legend = [["lit", L.t("Owned")], ["dim", L.t("Can be bought")], ["lock", L.t("Locked")]];
    for (let i = 0; i < legend.length; i++) {
      const y = 884 + i * 44;
      const tex = Art.ui(`node_gold_${legend[i][0]}`);
      if (tex) root.appendChild(X.place(X.pic(tex, [38, 38]), [40, y]));
      else root.appendChild(X.place(X.disc(34, X.CREAM, "", ""), [42, y + 2]));
      X.text_at(root, legend[i][1], [90, y + 6], 22, X.CREAM);
    }
    X.text_at(root, L.t("Click a node, then Buy."), [40, 1020], 20, [0.8, 0.74, 0.58]);

    const title = button(L.t("Title"), 180, 56, { font_size: 24, onclick: () => this._on_title() });
    X.place(title, [1700, 18]);
    root.appendChild(title);
    const reg = button(L.t("Registry"), 200, 56, { font_size: 24, onclick: () => this._on_registry() });
    X.place(reg, [1480, 18]);
    root.appendChild(reg);
    const go = button(L.t("Begin another life"), 640, 92, { font_size: 36, onclick: () => this._on_begin() });
    X.place(go, [PANEL.x, 944]);
    go.dataset.id = "begin";
    root.appendChild(go);
  }

  _build_info() {
    const root = this.root;
    root.appendChild(X.place(X.nine("panel_parchment", 60, [PANEL.w, PANEL.h], X.PAPER), [PANEL.x, PANEL.y]));
    this._info = el("div", "abs");
    X.place(this._info, [PANEL.x + 88, PANEL.y + 64], [PANEL.w - 88 - 62, PANEL.h - 64 - 56]);
    Object.assign(this._info.style, { display: "flex", flexDirection: "column", gap: "8px", overflow: "hidden" });
    root.appendChild(this._info);
    this._buy_btn = button(L.t("Choose a node"), PANEL.w, 84, { font_size: 26, onclick: () => this._on_buy() });
    X.place(this._buy_btn, [PANEL.x, PANEL.y + PANEL.h + 14]);
    this._buy_btn.dataset.id = "buy";
    root.appendChild(this._buy_btn);
  }

  // ---- state -----------------------------------------------------------------------------------------------------------------
  _apply_node(sid) {
    const nd = this._nodes[sid];
    const meta = this.meta;
    const rk = meta.rank(sid);
    const unlocked = meta.node_unlocked(sid);
    const cb = meta.can_buy(sid);
    const st = rk > 0 ? "lit" : unlocked ? "dim" : "lock";
    nd.rank = rk;
    nd.state = st;
    nd.buyable = !!cb.ok;
    const size = this._node_size;
    const url = Art.ui(`node_${nd.color}_${st}`);
    const img = nd.img;
    img.removeAttribute("style");
    if (url) {
      const s = size * (st === "lit" ? 1.14 : 1.0);
      X.place(img, [(size - s) / 2, (size - s) / 2], [s, s]);
      img.style.backgroundImage = `url("${url}")`;
      img.style.backgroundSize = "100% 100%";
      if (nd.hidden) img.style.filter = HIDDEN_FILTER;
    } else {
      let base = st !== "lock" ? nd.fallback : X.darkened(nd.fallback, 0.6);
      if (st === "dim") base = X.darkened(nd.fallback, 0.35);
      X.place(img, [2, 2], [size - 4, size - 4]);
      img.style.background = X.css(base);
      img.style.borderRadius = "50%";
      img.style.boxSizing = "border-box";
      img.style.border = `3px solid ${X.css(GOLD_F)}`;
    }
    nd.halo.style.display = nd.buyable ? "" : "none";
    nd.ring.style.display = sid === this._selected ? "" : "none";
    nd.glyph.style.display = st !== "lock" ? "" : "none";
    nd.glyph.style.opacity = st === "lit" ? "1" : "0.72";
    X.outline(nd.glyph, 6, [0, 0, 0, 0.6 * (st === "lit" ? 1 : 0.72)]);
    if (nd.badge) {
      const txt = `${rk}/${nd.max_rank}`;
      nd.badge.textContent = txt;
      const w = text_width(txt, 20) + 12;
      nd.badge.style.width = w + "px";
      nd.badge.style.left = size / 2 - w / 2 + "px";
      nd.badge.style.color = X.css(rk >= nd.max_rank ? [1.0, 0.9, 0.55] : [0.95, 0.92, 0.82]);
    }
    // the selected node is drawn above its neighbours (but under the arm names)
    nd.el.style.zIndex = sid === this._selected ? "3" : "";
  }

  _refresh() {
    this._imprint_label.textContent = String(Math.trunc(this.meta.imprints));
    for (const sid of Object.keys(this._nodes)) this._apply_node(sid);
    this._update_lines();
    this._update_buy();
  }

  _update_lines() {
    const g = this._seg_group;
    X.clear_children(g);
    const meta = this.meta;
    const segs = this._segments.map((s) => {
      const to_owned = meta.rank(s.to) > 0;
      const from_owned = s.from === "" || meta.rank(s.from) > 0;
      return {
        ...s,
        lit: to_owned && from_owned ? 2 : from_owned ? 1 : 0,
        hot: this._selected !== "" && (s.from === this._selected || s.to === this._selected),
      };
    });
    for (let pass = 0; pass < 2; pass++) {
      for (const s of segs) {
        if (s.hot !== (pass === 1)) continue;
        if (s.focus_only && !s.hot) continue;
        let col = [0.86, 0.7, 0.3, 0.3];
        let w = 1.5;
        if (s.violet) col = [0.7, 0.45, 0.9, 0.4];
        if (s.lit === 1) {
          col = [col[0], col[1], col[2], 0.62];
          w = 2;
        } else if (s.lit === 2) {
          col = [1.0, 0.86, 0.45, 0.95];
          w = 3;
        }
        if (s.hot) {
          col = [1.0, 0.97, 0.78, 1.0];
          w = 4;
        }
        X.svg_el("line", { x1: s.a[0].toFixed(1), y1: s.a[1].toFixed(1), x2: s.b[0].toFixed(1), y2: s.b[1].toFixed(1), stroke: X.css(col), "stroke-width": w,
          "stroke-linecap": "round" }, g);
      }
    }
  }

  _select(id) {
    const meta = this.meta;
    if (id !== "" && id in this.D.wheel) {
      const cb = meta.can_buy(id);
      if (!cb.ok && String(cb.reason ?? "") === "locked") A.sfx("wheel_lock");
    }
    this._selected = id;
    for (const k of Object.keys(this._nodes)) this._apply_node(k);
    this._update_lines();
    this._show(id);
    this._update_buy();
  }

  _hover(id) {
    this._show(id !== "" ? id : this._selected);
  }

  /** Why a node cannot be bought yet ("" when its place on the tree is open). */
  _lock_reason(id) {
    const meta = this.meta;
    const n = this.D.wheel[id] || {};
    const u = String(n.unlock ?? "");
    if (u !== "" && !meta.has_flag(u)) return L.f("needs the memory: %s", [X.truth_name(this.D, u)]);
    if (String(n.branch ?? "") === "hidden" && !meta.has_flag("t_wheel")) return L.t("a hidden row");
    for (const r of n.req || []) {
      if (meta.rank(String(r)) <= 0) {
        const rn = this.D.wheel[String(r)] || {};
        return L.f("needs %s", [this._node_name(rn, String(r))]);
      }
    }
    return "";
  }

  /** The shown name of a Wheel node (its id when the node is not in the data). */
  _node_name(n, fallback) {
    return Object.keys(n).length ? L.name_of(n) : fallback;
  }

  _update_buy() {
    const b = this._buy_btn;
    const meta = this.meta;
    if (this._selected === "" || !(this._selected in this.D.wheel)) {
      b.textContent = L.t("Choose a node to buy");
      set_enabled(b, false);
      return;
    }
    const n = this.D.wheel[this._selected];
    const nm = this._node_name(n, this._selected);
    const cb = meta.can_buy(this._selected);
    const cost = Math.trunc(meta.node_cost(this._selected));
    b.style.whiteSpace = "pre";
    if (cb.ok) {
      b.textContent = this._fit(L.f("Buy %s  (%d imprints)", [nm, cost]), L.f("Buy for %d imprints", [cost]));
      set_enabled(b, true);
      return;
    }
    set_enabled(b, false);
    switch (String(cb.reason ?? "")) {
      case "maxed":
        b.textContent = this._fit(L.f("%s: fully awakened", [nm]), L.t("Fully awakened"));
        break;
      case "locked": {
        const why = this._lock_reason(this._selected);
        b.textContent = this._fit(L.f("%s: %s", [nm, why]), L.f("Locked: %s", [why]));
        break;
      }
      case "imprints": {
        const more = cost - Math.trunc(meta.imprints);
        b.textContent = this._fit(L.f("%s: %d more imprints needed", [nm, more]), L.f("%d more imprints needed", [more]));
        break;
      }
      default:
        b.textContent = L.t("Cannot be bought");
    }
  }

  /** The long wording when it fits the button, else the short one. A Chinese character is as wide as two Latin letters. */
  _fit(full, short) {
    let w = 0;
    for (const ch of full) w += ch.codePointAt(0) >= 0x2e80 ? 2 : 1;
    return w <= 36 ? full : short;
  }

  // ---- the board ------------------------------------------------------------------------------------------------------------
  _line(text, size, color, title = false) {
    const l = X.lab(text, size, color, title);
    l.style.position = "static";
    l.style.flex = "none";
    this._info.appendChild(l);
    return l;
  }

  _para(text, size, color) {
    const l = wrap_label(text, size, color, PANEL.w - 150);
    l.style.position = "static";
    l.style.flex = "none";
    l.classList.add("mx-wrap");
    l.dataset.base = String(size);
    this._info.appendChild(l);
    return l;
  }

  _rule() {
    const r = X.rule(PANEL.w - 150);
    r.style.position = "static";
    r.style.flex = "none";
    this._info.appendChild(r);
    return r;
  }

  _show(id) {
    X.clear_children(this._info);
    const D = this.D;
    const meta = this.meta;
    const text_w = PANEL.w - 150;
    if (id === "" || !(id in D.wheel)) {
      this._line(L.t("The Wheel"), 40, X.PAPER_INK, true);
      this._rule();
      this._para(L.t("Every life you live pays imprints. Spend them here and the next life starts stronger."), 24, X.PAPER_INK);
      this._para(L.t("Hover a node to read it. Click it to select it, then press Buy."), 24, X.PAPER_INK);
      this._para(L.t("A node needs the ones it is joined to by a gold line. Glowing nodes can be bought now."), 24, X.PAPER_INK);
      if (!meta.has_flag("t_wheel")) this._para(L.t("Some of the Wheel is hidden until you remember how it was built."), 22, X.PAPER_MUTED);
      return;
    }
    const n = D.wheel[id];
    const rk = meta.rank(id);
    const mx = Math.max(1, Math.trunc(n.max ?? 1));
    const br = String(n.branch ?? "");
    const branch_name = this._arm_name(br === "hidden" ? "hidden" : br in ARMS ? br : "dao");
    const shown = this._node_name(n, id);
    this._line(shown, fit_size(shown, 46, text_w, true, 26), X.PAPER_INK, true);
    this._line(L.f("%s path     tier %d     rank %d of %d", [branch_name, Math.trunc(n.tier ?? 1), rk, mx]), 20, X.PAPER_MUTED);
    this._rule();
    const text = String(n.text ?? "");
    if (text !== "") this._para(L.t(text), 23, X.PAPER_INK);
    const lines = X.effect_lines(D, n.effect || {});
    if (lines.length) {
      this._line(mx > 1 ? L.t("Each rank gives") : L.t("Gives"), 20, X.CINNABAR_DARK);
      for (const l of lines) this._para("•  " + String(l), 23, X.JADE_DARK);
    }
    const reqs = n.req || [];
    const unlock = String(n.unlock ?? "");
    if (reqs.length || unlock !== "") {
      this._line(L.t("Needs"), 20, X.CINNABAR_DARK);
      for (const r of reqs) {
        const rid = String(r);
        const rn = D.wheel[rid] || {};
        const have = meta.rank(rid) > 0;
        this._para(`${this._node_name(rn, rid)}  ${have ? L.t("(owned)") : L.t("(not yet)")}`, 22, have ? X.JADE_DARK : X.CINNABAR_DARK);
      }
      if (unlock !== "") {
        const known = meta.has_flag(unlock);
        this._para(L.f("Memory: %s  %s", [X.truth_name(D, unlock), known ? L.t("(found)") : L.t("(not yet found)")]), 22, known ? X.JADE_DARK : X.CINNABAR_DARK);
      }
    }
    this._rule();
    if (rk >= mx) {
      this._line(L.t("Fully awakened."), 26, X.JADE_DARK);
    } else {
      const cost = Math.trunc(meta.node_cost(id));
      const enough = Math.trunc(meta.imprints) >= cost;
      const cost_line = rk > 0 ? L.f("Next rank costs %d imprints", [cost]) : L.f("Costs %d imprints", [cost]);
      this._line(cost_line, 26, enough ? X.PAPER_INK : X.CINNABAR_DARK);
      this._line(L.f("You have %d", [Math.trunc(meta.imprints)]), 22, X.PAPER_MUTED);
    }
    this._fit_info();
  }

  /** a long node text must not run off the parchment: step the paragraphs down a point at a time (bounded) */
  _fit_info() {
    const box = this._info;
    for (let i = 0; i < 7 && box.scrollHeight > box.clientHeight + 1; i++) {
      for (const p of box.querySelectorAll("[data-base]")) {
        p.style.fontSize = Math.max(15, parseFloat(p.style.fontSize) - 1) + "px";
      }
    }
  }

  // ---- actions ---------------------------------------------------------------------------------------------------------------
  _on_buy() {
    if (this._selected === "") return;
    if (this.meta.buy(this._selected)) {
      A.sfx("wheel_buy");
      this._refresh();
      this._show(this._selected);
    }
  }

  _on_begin() {
    this.main.goto("birth");
  }

  _on_registry() {
    this.main.goto("registry", { back: "wheel" });
  }

  _on_title() {
    if (this.main.run != null && this.main.run.dead) this.main.run = null;
    this.main.goto("title");
  }
}

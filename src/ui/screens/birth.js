// The pre-life screen, "Talents of Fate" (port of scripts/bw_screen_birth.gd): three talent cards, the five-roots pentagon, a name, a face,
// the origin row and a preview of what the pick yields. A throwaway Run is built for every change so the numbers are the real ones.

import { Screen, button, set_enabled, el, GOLD as GOLD_CSS } from "../ui.js";
import { Art } from "../art.js";
import { L } from "../../sim/loc.js";
import { Run } from "../../sim/run.js";
import { RNG } from "../../sim/rng.js";
import * as X from "../ui_extra.js";

const REDRAW_COST = 5;
const STRIP = { x: 170, y: 92, w: 1580, h: 384 };
const CARD_Y = 140;
const CARD_H = 316;
const B_Y = 490;
const ORIGIN_Y = 846;
const BTN_Y = 1004;
const DIM_LABEL = [0.8, 0.74, 0.58];

export default class BirthScreen extends Screen {
  async setup(main, args = {}) {
    this.main = main;
    this.D = main.D;
    this.meta = main.meta;
    this.on_destroy(X.hide_tooltip);
    this._talents = [];
    this._talent_idx = 0;
    this._gender = "m";
    this._card_rings = [];
    this._card_seals = [];
    this._gender_rings = {};
    this._origin_rings = {};
    this._stat_value = {};
    this._stat_delta = {};
    this._redraw_tip = "";
    const D = this.D;
    const meta = this.meta;
    const root = this.root;

    X.backdrop(root, main, Art.bg("village"), 0.35);
    root.appendChild(X.place(X.nine("panel_dark", 40, [1700, 1052], [0.04, 0.04, 0.05, 0.96]), [110, 14]));

    this._origins = meta.unlocked_origins().slice();
    const oi = this._origins.indexOf("orphan");
    if (oi >= 0) {
      this._origins.splice(oi, 1);
      this._origins.unshift("orphan");
    }
    this._origin_id = this._default_origin();
    const g = String(meta.last_gender);
    this._gender = g === "m" || g === "f" ? g : "m";
    this._load_draw();

    this._build_header();
    this._build_identity();
    this._build_roots();
    this._build_preview();
    this._build_origins();
    this._build_buttons();
    this._build_strip();
  }

  // ---- the talents drawn for this life ---------------------------------------------------------------------------------------
  _default_origin() {
    if (this._origins.includes("orphan") || this._origins.length === 0) return "orphan";
    return String(this._origins[0]);
  }

  /** The draw is kept in the profile so leaving and re-entering the screen is not a free redraw. */
  _load_draw() {
    const meta = this.meta;
    this._talents = [];
    const saved = meta.options.birth_draw;
    let ok = false;
    if (Array.isArray(saved) && saved.length > 0) {
      const pool = meta.unlocked_talents();
      const want = Math.min(3 + Math.trunc(meta.effect_sum("talent_slots")), pool.length);
      ok = saved.length === want;
      for (const t of saved) {
        if (!pool.includes(String(t))) {
          ok = false;
          break;
        }
        this._talents.push(String(t));
      }
      if (!ok) this._talents = [];
    }
    if (!ok) this._roll();
  }

  _roll() {
    const rng = new RNG();
    rng.randomize();
    const drawn = this.meta.draw_talents(rng);
    this._talents = drawn.map((t) => String(t));
    this.meta.options.birth_draw = this._talents.slice();
    this.meta.save();
  }

  _talent_id() {
    if (this._talent_idx >= 0 && this._talent_idx < this._talents.length) return String(this._talents[this._talent_idx]);
    return "";
  }

  /** The name a life gets when the box is left empty (Wuming / 无名). */
  _default_name() {
    return L.t("Wuming");
  }

  /** A saved name that is the default (in the shown language, or the English one) follows the language instead of staying "Wuming". */
  _is_default_name(nm) {
    return nm === "" || nm === this._default_name() || nm === "Wuming";
  }

  _free_redraws() {
    const total = Math.trunc(this.meta.effect_sum("reroll"));
    const used = Math.trunc(this.meta.options.birth_rerolls_used ?? 0);
    return Math.max(0, total - used);
  }

  // ---- building --------------------------------------------------------------------------------------------------------------
  _build_header() {
    const root = this.root;
    const t = X.over_art(L.t("Talents of Fate"), 54, X.GOLD, true);
    X.place(t, [0, 22]);
    t.style.width = "1920px";
    t.style.textAlign = "center";
    root.appendChild(t);
    let coin = Art.icon("res_imprint");
    if (!coin) coin = Art.ui("imprint_coin");
    if (coin) root.appendChild(X.place(X.pic(coin, [34, 52]), [1500, 26]));
    this._imprint_label = X.text_at(root, "", [1544, 32], 30, X.CREAM);
    this._update_imprints();
  }

  _update_imprints() {
    this._imprint_label.textContent = L.f("Imprints  %d", [Math.trunc(this.meta.imprints)]);
    this._imprint_label.style.whiteSpace = "pre";
  }

  _build_strip() {
    const root = this.root;
    root.appendChild(X.place(X.nine("panel_parchment", 64, [STRIP.w, STRIP.h], X.PAPER), [STRIP.x, STRIP.y]));
    const cap = X.text_at(root, L.t("Choose one. It colours this whole life."), [STRIP.x, STRIP.y + 16], 22, X.PAPER_MUTED, false, STRIP.w, "center");
    cap.style.zIndex = "1";
    this._card_layer = el("div", "abs");
    this._card_layer.style.left = "0";
    this._card_layer.style.top = "0";
    this._card_layer.style.width = "1920px";
    this._card_layer.style.height = "1080px";
    root.appendChild(this._card_layer);
    this._rebuild_cards();
  }

  _rebuild_cards() {
    X.clear_children(this._card_layer);
    this._card_rings = [];
    this._card_seals = [];
    const n = this._talents.length;
    if (n === 0) {
      X.wrapped_at(this._card_layer, L.t("No talents have been written yet. This life begins without one."), [STRIP.x + 120, 250], STRIP.w - 240, 28,
        X.PAPER_MUTED, 0, "center");
      this._refresh_preview();
      return;
    }
    const gap = 50;
    const cw = Math.min(400, (STRIP.w - 220 - (n - 1) * gap) / n);
    const total = cw * n + gap * (n - 1);
    const x0 = STRIP.x + (STRIP.w - total) * 0.5;
    for (let i = 0; i < n; i++) this._make_card(i, [x0 + i * (cw + gap), CARD_Y], cw);
    this._select_talent(0);
  }

  _make_card(i, pos, w) {
    const D = this.D;
    const tid = String(this._talents[i]);
    const t = D.talents[tid] || {};
    const tier = Math.max(1, Math.min(5, Math.trunc(t.tier ?? 1)));
    const col = tier_color_f(tier - 1);
    const ring = X.ring_box([pos[0] - 8, pos[1] - 8], [w + 16, CARD_H + 16], X.GOLD, 6, 18, 14);
    ring.style.display = "none";
    this._card_layer.appendChild(ring);
    this._card_rings.push(ring);
    const card = X.box(pos, [w, CARD_H], X.flat([0.98, 0.95, 0.88], col, 5, 14));
    card.style.overflow = "hidden";
    card.classList.add("mx-hover");
    card.dataset.talent = tid;
    card.dataset.idx = String(i);
    this._card_layer.appendChild(card);
    X.on_click(card, () => this._select_talent(i));
    const shown = Object.keys(t).length ? L.name_of(t) : tid;
    const em = X.disc(72, X.darkened(col, 0.2), X.glyph(shown), "tal_" + tid, 40);
    X.place(em, [(w - 72) * 0.5, 12]);
    card.appendChild(em);
    X.fit_at(card, shown, [0, 88], 38, X.PAPER_INK, true, w - 16, "center");
    // the sentence (smaller when it runs long: English is wider than the Chinese the card was drawn for), then the effect lines under it
    const tw = w - 36;
    const desc = L.t(String(t.text ?? ""));
    const ty = 138;
    let dsize = 20;
    while (dsize > 17 && X.est_lines(desc, dsize, tw) > 3) dsize -= 1;
    const flow = el("div", "abs", card);
    X.place(flow, [18, ty], [tw, CARD_H - 8 - ty]);
    flow.style.overflow = "hidden";
    const dl = X.wrapped_at(flow, desc, [0, 0], tw, dsize, X.PAPER_INK, 4, "center");
    dl.style.position = "static";
    const lines = X.talent_lines(D, t);
    if (lines.length) {
      const shown_lines = lines.slice(0, 3);
      const ll = X.wrapped_at(flow, shown_lines.join("\n"), [0, 0], tw, 19, X.JADE_DARK, 3, "center");
      ll.style.position = "static";
      ll.style.marginTop = "8px";
    }
    X.text_at(card, X.tier_name(tier), [14, 8], 20, X.darkened(col, 0.25));
    const seal_url = Art.ui("seal_normal");
    let seal;
    if (seal_url) seal = X.pic(seal_url, [54, 54]);
    else seal = X.disc(46, X.CINNABAR, X.glyph(L.t("Chosen")), "", 24);
    X.place(seal, [w - 66, 8]);
    seal.style.display = "none";
    card.appendChild(seal);
    this._card_seals.push(seal);
  }

  _select_talent(i) {
    this._talent_idx = Math.max(0, Math.min(Math.max(0, this._talents.length - 1), i));
    for (let k = 0; k < this._card_rings.length; k++) {
      const on = k === this._talent_idx;
      this._card_rings[k].style.display = on ? "" : "none";
      this._card_seals[k].style.display = on ? "" : "none";
    }
    this._refresh_preview();
  }

  _build_identity() {
    const root = this.root;
    const meta = this.meta;
    X.text_at(root, L.t("Name"), [180, B_Y + 2], 22, X.CREAM);
    const inp = el("input", "field");
    inp.type = "text";
    inp.maxLength = 12;
    const nm = String(meta.last_name ?? "").trim();
    inp.value = !this._is_default_name(nm) ? nm : this._default_name();
    inp.placeholder = this._default_name();
    inp.style.fontSize = "32px";
    inp.style.color = css_of(X.PAPER_INK);
    inp.style.background = css_of(X.PAPER);
    inp.style.border = `3px solid ${GOLD_CSS}`;
    inp.style.borderRadius = "8px";
    inp.style.padding = "8px 12px 8px 16px";
    inp.spellcheck = false;
    inp.autocomplete = "off";
    X.place(inp, [180, B_Y + 32], [400, 60]);
    inp.dataset.id = "name";
    inp.classList.add("hit");
    X.tooltip(inp, L.t("The name this life answers to. Up to 12 letters."));
    root.appendChild(inp);
    this._name_edit = inp;

    X.text_at(root, L.t("Appearance"), [180, B_Y + 106], 22, X.CREAM);
    const genders = [["m", L.t("He")], ["f", L.t("She")]];
    for (let gi = 0; gi < 2; gi++) {
      const key = genders[gi][0];
      const gname = genders[gi][1];
      const pos = [180 + gi * 205, B_Y + 140];
      const ring = X.ring_box([pos[0] - 6, pos[1] - 6], [192, 214], X.GOLD, 5, 14, 10);
      ring.style.display = key === this._gender ? "" : "none";
      root.appendChild(ring);
      this._gender_rings[key] = ring;
      const card = X.box(pos, [180, 202], X.flat([0.14, 0.12, 0.1], [0.55, 0.43, 0.2], 2, 10));
      card.classList.add("mx-hover");
      card.style.overflow = "hidden";
      card.dataset.gender = key;
      root.appendChild(card);
      X.on_click(card, () => this._pick_gender(key));
      const tex = Art.portrait("hero_" + key);
      if (tex) {
        card.appendChild(X.place(X.cover_rect(tex, [164, 146]), [8, 8]));
      } else {
        card.appendChild(X.place(X.disc(120, [0.3, 0.26, 0.2], X.glyph(gname), "", 66), [30, 14]));
      }
      X.text_at(card, gname, [0, 160], 24, X.CREAM, false, 180, "center");
    }
  }

  _pick_gender(key) {
    this._gender = key;
    for (const k in this._gender_rings) this._gender_rings[k].style.display = k === this._gender ? "" : "none";
    this._refresh_preview();
  }

  _build_roots() {
    const root = this.root;
    X.text_at(root, L.t("Five roots"), [620, B_Y + 2], 24, X.GOLD, false, 530, "center");
    this._pent = X.pentagon(this.D, [530, 316], 116);
    X.place(this._pent.el, [620, B_Y + 30]);
    X.tooltip(this._pent.el, L.t("Each point of a root adds 6% damage and 3% cultivation to techniques of that element.\nClockwise from the top: Metal, Water, Wood, Fire, Earth."));
    this._pent.el.classList.add("hit");
    root.appendChild(this._pent.el);
  }

  _build_preview() {
    const root = this.root;
    const D = this.D;
    const x0 = 1190;
    X.text_at(root, L.t("This life begins with"), [x0, B_Y + 2], 24, X.GOLD);
    let stats = (D.rules && D.rules.stats) || [];
    if (!stats.length) stats = ["body", "spirit", "insight", "speed", "fortune", "heart"];
    for (let i = 0; i < stats.length; i++) {
      const k = String(stats[i]);
      const cx = x0 + (i % 3) * 190;
      const cy = B_Y + 40 + Math.floor(i / 3) * 76;
      const stat_label = X.stat_name(D, k);
      root.appendChild(X.place(X.disc(46, X.STAT_COLORS[k] || [0.5, 0.5, 0.5], X.glyph(stat_label), "st_" + k, 26), [cx, cy + 6]));
      this._stat_value[k] = X.text_at(root, "5", [cx + 54, cy - 4], 34, X.BRIGHT);
      this._stat_delta[k] = X.text_at(root, "", [cx + 108, cy + 4], 20, [0.55, 0.85, 0.6]);
      X.fit_at(root, stat_label, [cx + 54, cy + 36], 20, DIM_LABEL, false, 130);
    }
    const ry = B_Y + 40 + 2 * 76 + 8;
    this._life_value = this._small_cell(x0, ry, L.t("Lifespan, terms"), "res_life");
    this._stone_value = this._small_cell(x0 + 190, ry, L.t("Spirit stones"), "res_stone");
    this._deck_value = this._small_cell(x0 + 380, ry, L.t("Cards in the deck"), "res_deck");
    this._derived_line = X.text_at(root, "", [x0, ry + 82], 22, DIM_LABEL);
  }

  _small_cell(x, y, caption, icon_name) {
    const root = this.root;
    root.appendChild(X.place(X.disc(46, [0.45, 0.38, 0.22], X.glyph(caption), icon_name, 26), [x, y + 6]));
    const v = X.text_at(root, "0", [x + 54, y - 4], 34, X.BRIGHT);
    X.fit_at(root, caption, [x + 54, y + 36], 20, DIM_LABEL, false, 130);
    return v;
  }

  _build_origins() {
    const root = this.root;
    const D = this.D;
    X.text_at(root, L.t("Origin"), [180, ORIGIN_Y + 30], 22, X.CREAM);
    const n = this._origins.length;
    const x0 = 272;
    const avail = 1480;
    const gap = 12;
    if (n > 0) {
      const bw = Math.min(270, (avail - (n - 1) * gap) / n);
      for (let i = 0; i < n; i++) {
        const oid = String(this._origins[i]);
        const o = D.origins[oid] || {};
        const pos = [x0 + i * (bw + gap), ORIGIN_Y];
        const ring = X.ring_box([pos[0] - 5, pos[1] - 5], [bw + 10, 94], X.GOLD, 4, 14, 8);
        ring.style.display = oid === this._origin_id ? "" : "none";
        root.appendChild(ring);
        this._origin_rings[oid] = ring;
        // a group at the button's corner: the button plus its name (the plate is narrower than the control: flourishes at both ends)
        const grp = el("div", "abs");
        X.place(grp, pos, [bw, 84]);
        grp.dataset.origin = oid;
        root.appendChild(grp);
        const b = button("", bw, 84, { font_size: 24, onclick: () => this._pick_origin(oid) });
        X.place(b, [0, 0]);
        grp.appendChild(b);
        const oname = Object.keys(o).length ? L.name_of(o) : oid;
        const plate = bw - 70;
        const osize = X.fit_size(oname, 28, plate, false, 22);
        if (X.text_width(oname, osize) <= plate) {
          const t = X.text_at(grp, oname, [35, (84 - osize * 1.4) * 0.5], osize, X.CREAM, false, plate, "center");
        } else {
          const two = X.wrapped_at(grp, oname, [35, 12], plate, 21, X.CREAM, 2, "center");
          two.style.height = "60px";
          two.style.display = "flex";
          two.style.alignItems = "center";
          two.style.justifyContent = "center";
        }
        b.addEventListener("pointerenter", () => this._show_origin(oid));
        b.addEventListener("pointerleave", () => this._show_origin(""));
      }
    }
    this._origin_title = X.text_at(root, "", [180, ORIGIN_Y + 98], 22, X.BRIGHT, false, 1570);
    X.clip(this._origin_title);
    this._origin_effects = X.text_at(root, "", [180, ORIGIN_Y + 124], 21, [0.6, 0.85, 0.65], false, 1570);
    X.clip(this._origin_effects);
    this._show_origin("");
  }

  _pick_origin(oid) {
    this._origin_id = oid;
    for (const k in this._origin_rings) this._origin_rings[k].style.display = k === this._origin_id ? "" : "none";
    this._show_origin("");
    this._refresh_preview();
  }

  /** `oid` = "" shows the chosen origin (when the mouse leaves a button). */
  _show_origin(oid) {
    const D = this.D;
    const id = oid !== "" ? oid : this._origin_id;
    if (this._origins.length === 0) {
      this._origin_title.textContent = L.t("No origins are written yet: the life begins as an orphan of the village.");
      this._origin_effects.textContent = "";
      return;
    }
    const o = D.origins[id] || {};
    const head = Object.keys(o).length ? L.name_of(o) : id;
    this._origin_title.textContent = L.f("%s:  %s", [head, L.t(String(o.text ?? ""))]);
    this._origin_title.style.whiteSpace = "pre";
    this._origin_title.style.fontSize = X.fit_size(this._origin_title.textContent, 22, 1570, false, 16) + "px";
    const lines = X.talent_lines(D, o);
    this._origin_effects.textContent = lines.join("   ");
    this._origin_effects.style.whiteSpace = "pre";
    this._origin_effects.style.fontSize = X.fit_size(this._origin_effects.textContent, 21, 1570, false, 16) + "px";
  }

  _build_buttons() {
    const root = this.root;
    const back_text = this.main.run == null ? L.t("Back to the title") : L.t("Back to the Wheel");
    const back = button(back_text, 300, 56, { font_size: 24, onclick: () => this._on_back() });
    X.place(back, [180, BTN_Y]);
    back.dataset.id = "back";
    root.appendChild(back);
    this._redraw_btn = button("", 560, 56, { font_size: 24, onclick: () => this._on_redraw() });
    X.place(this._redraw_btn, [520, BTN_Y]);
    this._redraw_btn.dataset.id = "redraw";
    X.tooltip(this._redraw_btn, () => this._redraw_tip);
    root.appendChild(this._redraw_btn);
    this._update_redraw_button();
    const go = button(L.t("Begin the life"), 440, 60, { font_size: 30, onclick: () => this._on_begin() });
    X.place(go, [1310, BTN_Y - 2]);
    go.dataset.id = "begin";
    root.appendChild(go);
  }

  _update_redraw_button() {
    const free = this._free_redraws();
    const pool_n = this.meta.unlocked_talents().length;
    const b = this._redraw_btn;
    const meta = this.meta;
    if (pool_n <= this._talents.length) {
      b.textContent = L.t("Redraw: no other talents to draw");
      set_enabled(b, false);
      this._redraw_tip = L.t("Every talent you have unlocked is already on the table.");
    } else if (free > 0) {
      b.textContent = L.f("Redraw talents  (free x%d)", [free]);
      set_enabled(b, true);
      this._redraw_tip = L.t("Draw three new talents. The Wheel gave you free redraws.");
    } else if (Math.trunc(meta.imprints) >= REDRAW_COST) {
      b.textContent = L.f("Redraw talents  (%d imprints)", [REDRAW_COST]);
      set_enabled(b, true);
      this._redraw_tip = L.f("Pay %d imprints to draw three new talents.", [REDRAW_COST]);
    } else {
      b.textContent = L.f("Redraw: needs %d imprints (you have %d)", [REDRAW_COST, Math.trunc(meta.imprints)]);
      set_enabled(b, false);
      this._redraw_tip = L.t("Die and live again to earn imprints.");
    }
    b.style.whiteSpace = "pre";
  }

  // ---- actions ---------------------------------------------------------------------------------------------------------------
  _refresh_preview() {
    const D = this.D;
    const run = new Run(D, this.meta, 1);
    run.begin(this._origin_id, this._talent_id(), "preview", this._gender);
    const base = Math.trunc((D.rules.start && D.rules.start.stat) ?? 5);
    const st = run.stats;
    for (const k in this._stat_value) {
      const v = Math.trunc(st[k] ?? base);
      const vl = this._stat_value[k];
      vl.textContent = String(v);
      const dv = v - base;
      const dl = this._stat_delta[k];
      dl.textContent = dv !== 0 ? (dv > 0 ? "+" : "") + dv : "";
      dl.style.left = parseFloat(vl.style.left) + X.text_width(String(v), 34) + 6 + "px";
      dl.style.color = css_of(dv > 0 ? [0.55, 0.85, 0.6] : [0.95, 0.55, 0.45]);
    }
    this._pent.set_values(run.roots);
    this._life_value.textContent = String(Math.trunc(run.life));
    this._stone_value.textContent = String(Math.trunc(run.stone));
    this._deck_value.textContent = String(run.deck.length);
    const d = run.derived();
    this._derived_line.textContent = L.f("HP %d    MP %d    Attack %d    Defense %d", [Math.trunc(d.max_hp ?? 0), Math.trunc(d.max_mp ?? 0),
      Math.trunc(d.atk ?? 0), Math.trunc(d.def ?? 0)]);
    this._derived_line.style.whiteSpace = "pre";
  }

  _on_redraw() {
    const meta = this.meta;
    const free = this._free_redraws();
    if (free > 0) meta.options.birth_rerolls_used = Math.trunc(meta.options.birth_rerolls_used ?? 0) + 1;
    else if (Math.trunc(meta.imprints) >= REDRAW_COST) meta.imprints = Math.trunc(meta.imprints) - REDRAW_COST;
    else return;
    this._roll();
    this._talent_idx = 0;
    this._rebuild_cards();
    this._update_imprints();
    this._update_redraw_button();
  }

  _on_back() {
    if (this.main.run == null) this.main.goto("title");
    else this.main.goto("wheel");
  }

  _on_begin() {
    let nm = this._name_edit.value.trim();
    if (nm === "") nm = this._default_name();
    delete this.meta.options.birth_draw;
    delete this.meta.options.birth_rerolls_used;
    this.main.new_life(this._origin_id, this._talent_id(), nm, this._gender);
  }
}

// ---- local helpers --------------------------------------------------------------------------------------------------------------
const TIER_F = [[0.62, 0.62, 0.6], [0.35, 0.65, 0.45], [0.3, 0.5, 0.8], [0.6, 0.35, 0.75], [0.9, 0.7, 0.2]];
function tier_color_f(t) {
  return TIER_F[Math.max(0, Math.min(TIER_F.length - 1, t))];
}
function css_of(c) {
  return X.css(c);
}

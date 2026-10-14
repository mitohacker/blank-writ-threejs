// The Registry in three tabs (port of scripts/bw_screen_registry.gd): the truth pages (found ones in full, empty lines with a hint where
// to look), the endings, and the lives. A truth's page is a paragraph, so each page gets a wide strip; tabs keep the text readable.

import { Screen, button, el } from "../ui.js";
import { Art } from "../art.js";
import { L } from "../../sim/loc.js";
import * as X from "../ui_extra.js";

const AREA = { x: 50, y: 156, w: 1820, h: 900 };
const PAGE_BG = [0.94, 0.9, 0.8];
const PAGE_BORDER = [0.52, 0.4, 0.2];
const EMPTY_BG = [0.09, 0.08, 0.07, 0.88];
const EMPTY_BORDER = [0.34, 0.29, 0.22];
const GREY = [0.62, 0.59, 0.52];
const TABS = ["truths", "endings", "lives"];

export default class RegistryScreen extends Screen {
  async setup(main, args = {}) {
    this.main = main;
    this.D = main.D;
    this.meta = main.meta;
    this.on_destroy(X.hide_tooltip);
    this._back_to = String(args.back ?? "");
    this._tab = String(args.tab ?? "truths");
    this._tab_buttons = {};
    this._tab_rings = {};
    const root = this.root;
    X.backdrop(root, main, Art.bg("registry"), 0.3, [0.1, 0.1, 0.12]);
    root.appendChild(X.box([30, 14], [1860, 1052], X.flat([0.02, 0.02, 0.03, 0.66], [0.86, 0.7, 0.3, 0.55], 2, 12)));
    X.text_at(root, L.t("The Registry"), [60, 22], 52, X.GOLD, true);

    const back = button(this._back_text(), 300, 58, { font_size: 24, onclick: () => this._on_back() });
    X.place(back, [1560, 24]);
    back.dataset.id = "back";
    root.appendChild(back);

    let x = 640;
    for (const id of TABS) {
      const ring = X.ring_box([x - 5, 28], [250, 66], X.GOLD, 4, 14, 8);
      ring.style.display = id === this._tab ? "" : "none";
      root.appendChild(ring);
      this._tab_rings[id] = ring;
      const b = button(this._tab_title(id), 240, 58, { font_size: 26, onclick: () => this._show_tab(id) });
      X.place(b, [x, 32]);
      X.tooltip(b, this._tab_tip(id));
      b.dataset.tab = id;
      root.appendChild(b);
      this._tab_buttons[id] = b;
      x += 262;
    }

    this._content = el("div", "abs");
    this._content.style.left = "0";
    this._content.style.top = "0";
    this._content.style.width = "1920px";
    this._content.style.height = "1080px";
    root.appendChild(this._content);
    this._show_tab(this._tab);
  }

  _tab_title(id) {
    switch (id) {
      case "endings": return L.t("Endings");
      case "lives": return L.t("Lives");
      default: return L.t("Truths");
    }
  }

  _tab_tip(id) {
    switch (id) {
      case "endings": return L.t("Show the endings.");
      case "lives": return L.t("Show the lives you have lived.");
      default: return L.t("Show the truth pages.");
    }
  }

  _back_text() {
    switch (this._back_dest()) {
      case "wheel": return L.t("Back to the Wheel");
      case "term": return L.t("Back to the life");
      default: return L.t("Back to the title");
    }
  }

  _back_dest() {
    if (this._back_to !== "") return this._back_to;
    if (this.main.run == null || this.main.run.dead) return "title";
    return "term";
  }

  _on_back() {
    this.main.goto(this._back_dest());
  }

  _ending_reached(id) {
    return (this.meta.endings || []).includes(id) || this.meta.has_flag(id);
  }

  _show_tab(id) {
    this._tab = id;
    for (const k of Object.keys(this._tab_rings)) this._tab_rings[k].style.display = k === id ? "" : "none";
    X.hide_tooltip();
    X.clear_children(this._content);
    switch (id) {
      case "endings": this._build_endings(); break;
      case "lives": this._build_lives(); break;
      default: this._build_truths();
    }
  }

  _empty_note(text) {
    X.text_at(this._content, text, [AREA.x + 20, AREA.y + 30], 28, X.CREAM);
  }

  // ---- truths: two columns of wide strips ---------------------------------------------------------------------------------------
  _build_truths() {
    const D = this.D;
    const C = this._content;
    const ids = Object.keys(D.truths || {});
    let found = 0;
    for (const tid of ids) if (this.meta.has_flag(tid)) found += 1;
    X.text_at(C, L.f("Pages of the writ you were never given: %d of %d found.", [found, ids.length]), [AREA.x, 104], 24, X.CREAM);
    if (ids.length === 0) {
      this._empty_note(L.t("No truth pages have been written yet."));
      return;
    }
    const gap = 12;
    const cols = 2;
    const rows = Math.ceil(ids.length / cols);
    const w = (AREA.w - gap) / cols;
    const h = Math.min(142, (AREA.h - (rows - 1) * 8) / rows);
    for (let i = 0; i < ids.length; i++) {
      const tid = String(ids[i]);
      const t = D.truths[tid];
      const pos = [AREA.x + (i % cols) * (w + gap), AREA.y + Math.floor(i / cols) * (h + 8)];
      const known = this.meta.has_flag(tid);
      const strip = X.box(pos, [w, h], known ? X.flat(PAGE_BG, PAGE_BORDER, 2, 6) : X.flat(EMPTY_BG, EMPTY_BORDER, 2, 6));
      strip.style.overflow = "hidden";
      strip.dataset.truth = tid;
      strip.dataset.known = known ? "1" : "0";
      C.appendChild(strip);
      const inner_x = 100;
      if (known) {
        const seal_url = Art.ui("seal_normal");
        if (seal_url) strip.appendChild(X.place(X.pic(seal_url, [72, 72]), [14, 14]));
        else strip.appendChild(X.place(X.disc(68, X.CINNABAR, X.glyph(L.t("Page")), "", 30), [14, 14]));
        X.fit_at(strip, L.name_of(t), [inner_x, 6], 32, X.PAPER_INK, true, w - inner_x - 16, "left", 18);
        X.wrapped_at(strip, L.t(String(t.page ?? "")), [inner_x, 50], w - inner_x - 16, 20, X.PAPER_INK, 3);
      } else {
        strip.appendChild(X.place(X.disc(68, [0, 0, 0, 0], "", "", 0, { ring: EMPTY_BORDER }), [14, 14]));
        X.text_at(strip, L.t("an empty line"), [inner_x, 8], 28, GREY);
        const where = String(t.where ?? "");
        if (where !== "") X.wrapped_at(strip, L.f("Where to look: %s", [L.t(where)]), [inner_x, 54], w - inner_x - 16, 20, [0.52, 0.49, 0.43], 3);
      }
    }
  }

  // ---- endings: wide cards ---------------------------------------------------------------------------------------------------
  _build_endings() {
    const D = this.D;
    const C = this._content;
    const ids = Object.keys(D.endings || {});
    let reached = 0;
    for (const eid of ids) if (this._ending_reached(String(eid))) reached += 1;
    X.text_at(C, L.f("Endings reached: %d of %d. Some are hidden until the way to them is open.", [reached, ids.length]), [AREA.x, 104], 24, X.CREAM);
    if (ids.length === 0) {
      this._empty_note(L.t("No endings have been written yet."));
      return;
    }
    const n = Math.min(ids.length, 6);
    const gap = 10;
    const h = Math.min(168, (AREA.h - (n - 1) * gap) / n);
    for (let i = 0; i < n; i++) {
      const eid = String(ids[i]);
      const e = D.endings[eid];
      const pos = [AREA.x, AREA.y + i * (h + gap)];
      const ok = this._ending_reached(eid);
      const card = X.box(pos, [AREA.w, h], ok ? X.flat(PAGE_BG, PAGE_BORDER, 2, 6) : X.flat(EMPTY_BG, EMPTY_BORDER, 2, 6));
      card.style.overflow = "hidden";
      card.dataset.ending = eid;
      card.dataset.known = ok ? "1" : "0";
      C.appendChild(card);
      const tw = (h - 16) * 1.7;
      const th_pos = [8, 8];
      const th_size = [tw, h - 16];
      if (ok) {
        const url = Art.ending(eid);
        if (url) card.appendChild(X.place(X.cover_rect(url, th_size), th_pos));
        else card.appendChild(this._thumb_fallback(th_pos, th_size, X.glyph(L.name_of(e)), [0.55, 0.4, 0.18]));
        X.fit_at(card, L.name_of(e), [tw + 30, 8], 44, X.PAPER_INK, true, AREA.w - tw - 60, "left", 24);
        X.wrapped_at(card, L.t(String(e.text ?? "")), [tw + 30, 70], AREA.w - tw - 60, 24, X.PAPER_INK, 3);
      } else {
        card.appendChild(this._thumb_fallback(th_pos, th_size, "?", [0.16, 0.14, 0.12]));
        X.text_at(card, L.t("Not yet reached"), [tw + 30, 14], 38, GREY, true);
        X.text_at(card, L.t("An ending you have not written."), [tw + 30, 74], 24, [0.52, 0.49, 0.43]);
      }
    }
  }

  _thumb_fallback(pos, size, glyph, fill) {
    const p = X.box(pos, size, X.flat(fill, [0.4, 0.32, 0.18], 2, 4));
    const l = X.lab(glyph, Math.trunc(size[1] * 0.6), [0.85, 0.78, 0.6], true, { width: size[0], align: "center" });
    l.style.left = "0";
    l.style.top = "0";
    l.style.height = size[1] + "px";
    l.style.lineHeight = size[1] + "px";
    p.appendChild(l);
    return p;
  }

  // ---- lives: a summary line and the last ten ------------------------------------------------------------------------------------
  _build_lives() {
    const D = this.D;
    const meta = this.meta;
    const C = this._content;
    const best = Math.trunc(meta.lives) > 0 ? X.realm_name(D, Math.trunc(meta.best_realm), Math.trunc(meta.best_layer)) : L.t("none yet");
    X.text_at(C, L.f("Lives lived %d      Terms lived in all %d      Best realm  %s      Imprints in hand %d",
      [Math.trunc(meta.lives), Math.trunc(meta.total_terms), best, Math.trunc(meta.imprints)]), [AREA.x, 104], 26, X.CREAM);
    const hist = meta.history || [];
    if (hist.length === 0) {
      this._empty_note(L.t("No lives lived yet. The first one is waiting."));
      return;
    }
    const cols = [[L.t("Life"), 0, 100, 0], [L.t("Realm reached"), 120, 640, 0], [L.t("Terms"), 780, 150, 2], [L.t("How it ended"), 970, 560, 0],
      [L.t("Imprints"), 1560, 220, 2]];
    const hy = AREA.y + 4;
    for (const c of cols) X.text_at(C, c[0], [AREA.x + c[1], hy], 24, X.GOLD, false, c[2], c[3] === 2 ? "right" : "left");
    const recent = [];
    const start = Math.max(0, hist.length - 10);
    for (let i = hist.length - 1; i >= start; i--) recent.push(hist[i]);
    const row_h = 56;
    for (let r = 0; r < recent.length; r++) {
      const rec = recent[r];
      const ry = hy + 44 + r * row_h;
      if (r % 2 === 0) C.appendChild(X.box([AREA.x - 10, ry - 6], [AREA.w + 20, row_h - 2], X.flat([1, 1, 1, 0.07], [0, 0, 0, 0], 0, 4)));
      const cause = String(rec.cause ?? "");
      let how = X.cause_short(cause);
      const eid = String(rec.ending ?? "");
      if (cause === "ending" && eid !== "") {
        const ed = D.endings[eid] || {};
        how = L.f("Ending: %s", [Object.keys(ed).length ? L.name_of(ed) : eid]);
      }
      const cells = [String(Math.trunc(rec.life ?? 0)), X.realm_name(D, Math.trunc(rec.realm ?? 0), Math.trunc(rec.layer ?? 1)),
        String(Math.trunc(rec.terms ?? 0)), how, "+" + Math.trunc(rec.imprints ?? 0)];
      for (let ci = 0; ci < cols.length; ci++) {
        const cd = cols[ci];
        const lab = X.text_at(C, String(cells[ci]), [AREA.x + cd[1], ry], 28, X.CREAM, false, cd[2], cd[3] === 2 ? "right" : "left");
        X.clip(lab);
      }
    }
  }
}

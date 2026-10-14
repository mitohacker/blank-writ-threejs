// The story dialog (port of scripts/bw_event_view.gd): a parchment board over the place's painting. Shows run.current (art, portrait,
// title, text, choices), then the results of the pick (deltas and any battles), and keeps going while the run has another event (a chain
// or the next in the queue).
//
//   const v = new EventView(main, parent_el);  await v.open();      // resolves when no event is left (or the life ended)

import { el, at, add, tex_rect, panel, button, set_enabled, fit_size } from "./ui.js";
import { Art } from "./art.js";
import { A } from "../audio.js";
import { L } from "../sim/loc.js";
import { sprintf } from "../sim/fmt.js";
import { BattleView } from "./battle_view.js";
import { make_modal, sign_class, on_window, plabel as label, pwrap as wrap_label } from "./term_kit.js";

const INK = "#1a1410";

function cur_empty(run) {
  return !run.current || Object.keys(run.current).length === 0;
}

export class EventView {
  constructor(main, parent) {
    this.main = main;
    this.parent = parent;
    this.root = make_modal("rgba(8,8,10,0.62)");
    this.root.dataset.bw = "event";
    this._panel = null;
    this._busy = false;
    this._winter = false;
    this._gone = false;
    this._cont = null;
    this.done = new Promise((res) => (this._resolve = res));
    this._off = null;
  }

  /** the dialog; resolves when the run has no event on screen any more */
  open() {
    this.parent.appendChild(this.root);
    this._off = on_window("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && this._cont && !e.repeat) {
        e.preventDefault();
        this._cont();
      }
    });
    this._show_current();
    return this.done;
  }

  /** the screen is going away: drop the dialog (and a battle window inside it) without anyone continuing */
  abort() {
    if (this.bv && this.bv.abort) this.bv.abort();
    this._end();
  }

  _end() {
    if (this._gone) return;
    this._gone = true;
    if (this._off) this._off();
    this.root.remove();
    this._resolve();
  }

  _clear() {
    if (this._panel) this._panel.remove();
    this._panel = null;
    this._cont = null;
  }

  _new_panel() {
    const p = el("div", "abs");
    at(p, 0, 0, 1920, 1080);
    p.style.pointerEvents = "none";
    this.root.appendChild(p);
    this._panel = p;
    return p;
  }

  // ---- the event --------------------------------------------------------------------------------------------------------------
  _show_current() {
    this._clear();
    const { main } = this;
    const run = main.run;
    if (cur_empty(run)) {
      this._end();
      return;
    }
    const e = run.current.event;
    const place = String(e.art || run.place);
    main.set_background(Art.bg(place), 0.45);
    this._winter = String(e.id || "").startsWith("a1_winter");
    A.sfx("event_open");
    if (main.world && main.world.set_mood) main.world.set_mood(this._winter ? "winter" : place === "netherworld" ? "dark" : "calm");
    this._place_music();
    const P = this._new_panel();
    const W = 1500;
    const H = 900;
    const ox = (1920 - W) / 2;
    const oy = 90;
    const board = panel("panel_parchment", 64, "#ede3c7");
    add(P, at(board, ox, oy, W, H));
    const portrait = String(e.portrait || "");
    const pt = portrait !== "" ? Art.portrait(portrait) : null;
    let text_x = ox + 70;
    let text_w = W - 140;
    if (portrait !== "") {
      const pf = panel("slot_frame", 20, "#1a1a1a");
      add(P, at(pf, ox + 56, oy + 70, 330, 440));
      if (pt) add(P, at(tex_rect(pt, 298, 408, true), ox + 72, oy + 86));
      else add(P, at(label(L.cast_name(portrait), 30, "#e6d9b3"), ox + 110, oy + 260));
      add(P, at(label(L.cast_name(portrait), 24, "#40332a"), ox + 70, oy + 520));
      text_x = ox + 420;
      text_w = W - 490;
    }
    const title_text = L.t(String(e.title || ""));
    const ts = fit_size(title_text, 54, text_w, true, 34);
    const title = add(P, at(label(title_text, ts, "#1a140f", true), text_x, oy + 40));
    title.dataset.role = "title";
    const body_text = L.t(String(e.text || ""));
    const choices = run.current.choices || [];
    // body font: shrink a very long text until the choices still fit the board
    const bh = 54;
    const gap = 8;
    const block = bh + 26 + gap;
    const total = choices.length * block;
    let fs = 24;
    const body = wrap_label(body_text, fs, "#292119", text_w);
    body.style.whiteSpace = "pre-line";
    body.style.lineHeight = "1.4";
    at(body, text_x, oy + 118, text_w);
    add(P, body);
    const bottom_limit = oy + H - 56;
    let guard = 0;
    while (guard++ < 8 && fs > 18 && oy + 118 + body.offsetHeight + 14 + total > bottom_limit) {
      fs -= 1;
      body.style.fontSize = fs + "px";
    }
    const text_bottom = oy + 118 + body.offsetHeight;
    let start_y = Math.max(text_bottom + 14, bottom_limit - total);
    if (portrait !== "") start_y = Math.max(start_y, oy + 330);
    for (const c of choices) {
      const locked = !!c.locked;
      const bw = text_w;
      const lab = String(c.label);
      const size = fit_size(lab, 23, bw - 64 - 40, false, 15);
      const b = button(lab, bw, bh, { font_size: size, color: "#f2e6bf", pad_left: 46, sound: "choice", onclick: () => this._pick(Number(c.i)) });
      b.dataset.role = "choice";
      b.dataset.i = String(c.i);
      b.style.whiteSpace = "nowrap";
      const y = start_y + Number(c.i) * block;
      at(b, text_x, y);
      if (locked) set_enabled(b, false);
      add(P, b);
      let side = "";
      if (locked) side = sprintf(L.t("locked — %s"), String(c.reason));
      else if (String(c.cost) !== "") side = sprintf(L.t("costs %s"), String(c.cost));
      else if (String(c.hint || "") !== "") side = String(c.hint);
      if (side !== "") {
        const sz = fit_size(side, 18, text_w - 28, false, 13);
        const sl = add(P, at(label(side, sz, locked ? "#9e3824" : "#59471f"), text_x + 28, y + bh + 1));
        sl.dataset.role = "hint";
      }
    }
  }

  /** The place's music (the winter chapter has its own), also called again when a battle hands the stage back. */
  _place_music() {
    A.music_for_place(String(this.main.run.place), this._winter);
  }

  /** A few of the sounds the outcome earned, a beat apart (a gain, a hurt, a coin ...). */
  _outcome_sounds(out) {
    let n = 0;
    for (const id of out.sfx || []) {
      if (n >= 3) break;
      const delay = 120 * n;
      if (delay === 0) A.sfx(String(id));
      else setTimeout(() => A.sfx(String(id)), delay);
      n++;
    }
  }

  async _pick(ci) {
    if (this._busy || this._gone) return;
    this._busy = true;
    const run = this.main.run;
    const out = run.choose(ci);
    await this._results(out);
    this._busy = false;
    if (this._gone) return;
    if (run.dead) {
      this._end();
      return;
    }
    this._show_current();
  }

  // ---- what came of it --------------------------------------------------------------------------------------------------------
  async _results(out) {
    const { main } = this;
    const run = main.run;
    // battles first, then the list of what changed
    for (const b of out.battles || []) {
      this._clear();
      const bv = new BattleView(main, this.root);
      this.bv = bv;
      await bv.show_battle(b, run.place);
      this.bv = null;
      if (this._gone) return;
    }
    this._place_music();
    this._clear();
    this._outcome_sounds(out);
    const lines = out.lines || [];
    const P = this._new_panel();
    const W = 1100;
    const H = 700;
    const ox = (1920 - W) / 2;
    const oy = 190;
    add(P, at(panel("panel_parchment", 64, "#ede3c7"), ox, oy, W, H));
    add(P, at(label(L.t("What came of it"), 46, "#1a140f", true), ox + 70, oy + 40));
    const shown = lines.slice(0, 14);
    // the lines flow in a scrolling column between the title and the Continue button
    const col = el("div", "scroll");
    at(col, ox + 80, oy + 120, W - 160, H - 250);
    col.style.pointerEvents = "auto";
    add(P, col);
    col.classList.add("hit");
    if (shown.length === 0) {
      const l0 = label(L.t("Nothing changes. The day goes on."), 24, "#4d4033");
      l0.style.position = "static";
      col.appendChild(l0);
    }
    for (const s of shown) {
      const cls = sign_class(String(s));
      const color = cls === "gain" ? "#1f6638" : cls === "loss" ? "#a62e1f" : "#261f17";
      const l = wrap_label(String(s), 24, color, W - 190);
      l.style.position = "static";
      l.style.lineHeight = "1.3";
      l.style.marginBottom = "10px";
      col.appendChild(l);
    }
    const cont = button(L.t("Continue"), 280, 66, { font_size: 28, color: "#f2e6bf", sound: "ui_confirm" });
    cont.dataset.role = "continue";
    add(P, at(cont, ox + W / 2 - 140, oy + H - 110));
    await new Promise((res) => {
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        this._cont = null;
        res();
      };
      this._cont = go;
      cont.addEventListener("click", go);
    });
  }
}

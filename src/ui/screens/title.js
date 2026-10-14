// The title screen (port of scripts/bw_screen_title.gd): the key art, the game's name, and a column of lacquer buttons.
// New Life never asks anything (it replaces a saved life).

import { Screen, button } from "../ui.js";
import { Art } from "../art.js";
import { L } from "../../sim/loc.js";
import * as X from "../ui_extra.js";

/** The key art already carries the brush-written 无字命 at the top left. Set true if a picture without it is ever used. */
const DRAW_ZH_TITLE = false;

const COL_X = 1420;
const COL_W = 420;
const BTN_H = 76;
const BTN_GAP = 12;

export default class TitleScreen extends Screen {
  async setup(main, args = {}) {
    this.main = main;
    this.on_destroy(X.hide_tooltip);
    if (main.run != null && main.run.dead) main.run = null; // a finished life is only kept while the Wheel / Birth screens may still need it
    X.backdrop(this.root, main, Art.title(), 0.0, [0.12, 0.17, 0.16]);
    const root = this.root;

    let y = 196;
    if (DRAW_ZH_TITLE) {
      const zh = X.over_art(L.t("BLANK WRIT"), 150, [0.93, 0.89, 0.8], true);
      X.place(zh, [80, 60]);
      root.appendChild(zh);
    }
    const zh_title = L.is_zh();
    const name_label = X.over_art(L.t("BLANK WRIT"), zh_title ? 88 : 52, X.BRIGHT, zh_title);
    if (!zh_title) X.spaced(name_label, 6);
    X.place(name_label, [COL_X - 10, y]);
    name_label.style.width = COL_W + 20 + "px";
    name_label.style.textAlign = "center";
    root.appendChild(name_label);
    y += zh_title ? 112 : 82;

    const tag_text = L.t("A life with no writ in the Registry");
    const tag = X.over_art(tag_text, X.fit_size(tag_text, 26, COL_W - 8, false, 18), X.CREAM);
    X.place(tag, [COL_X, y]);
    tag.style.width = COL_W + "px";
    tag.style.textAlign = "center";
    root.appendChild(tag);
    y += 66;

    const has_save = main.has_saved_run();
    this._menu_button("new", L.t("New Life"), y, L.t("Begin a new life: choose a talent, an origin and a name."), () => this._on_new());
    y += BTN_H + BTN_GAP;
    if (has_save) {
      this._menu_button("continue", L.t("Continue"), y, this._save_summary(), () => this._on_continue());
      y += BTN_H + BTN_GAP;
    }
    this._menu_button("wheel", L.t("The Wheel"), y, L.t("Spend imprints on the Wheel of Reincarnation."), () => main.goto("wheel"));
    y += BTN_H + BTN_GAP;
    this._menu_button("registry", L.t("Registry"), y, L.t("The truths you have found and the endings you have reached."), () => main.goto("registry"));
    y += BTN_H + BTN_GAP;
    this._menu_button("settings", L.t("Settings"), y, L.t("Language and sound."), () => main.goto("settings"));
    y += BTN_H + BTN_GAP;
    // no Quit button in the browser build: closing the tab is quitting (the Wheel is saved as you go)
    if (has_save) {
      const note = X.over_art(L.t("New Life replaces the saved life."), 22, X.CREAM);
      X.place(note, [COL_X, y - 4]);
      note.style.width = COL_W + "px";
      note.style.textAlign = "center";
      root.appendChild(note);
    }

    // the line at the foot: lives, imprints, best realm
    const line = this._stats_line();
    root.appendChild(X.box([520, 1000], [880, 56], X.flat([0.05, 0.07, 0.07, 0.62], [0.86, 0.7, 0.3, 0.55], 2, 28)));
    const t = X.text_at(root, line, [520, 1000], 24, X.CREAM, false, 880, "center");
    t.style.height = "56px";
    t.style.lineHeight = "56px";
    this.stats_label = t;
  }

  _menu_button(key, text, y, tip, cb) {
    const b = button(text, COL_W, BTN_H, { font_size: 34, onclick: cb });
    X.place(b, [COL_X, y]);
    X.tooltip(b, tip);
    b.dataset.id = key;
    this.root.appendChild(b);
    return b;
  }

  _stats_line() {
    const m = this.main.meta;
    const lives = Math.trunc(m.lives);
    if (lives <= 0) return L.f("No lives lived yet.   Imprints %d", [Math.trunc(m.imprints)]);
    const best = X.realm_name(this.main.D, Math.trunc(m.best_realm), Math.trunc(m.best_layer));
    return L.f("Lives lived %d     Imprints %d     Best realm  %s", [lives, Math.trunc(m.imprints), best]);
  }

  /** "Wuming, term 9, Qi Refining 2" read from the saved run, for the Continue tooltip. */
  _save_summary() {
    let txt = L.t("Resume the life you left.");
    const d = this.main.saved_run_dict();
    if (d && typeof d === "object") {
      txt = L.f("Resume %s: term %d, %s.", [
        String(d.name ?? L.t("Wuming")),
        Math.trunc(d.term ?? 1),
        X.realm_name(this.main.D, Math.trunc(d.realm ?? 0), Math.trunc(d.layer ?? 1)),
      ]);
    }
    return txt;
  }

  _on_new() {
    this.main.goto("birth");
  }

  _on_continue() {
    if (!this.main.continue_run()) this.main.goto("birth");
  }
}

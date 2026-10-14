// The end of a life (port of scripts/bw_screen_death.gd): the cause, the record of the life, the imprints paid (counted up), and the way
// into the Wheel.

import { Screen, button, el } from "../ui.js";
import { Art } from "../art.js";
import { L } from "../../sim/loc.js";
import * as X from "../ui_extra.js";

const PANEL = { x: 540, y: 322, w: 840, h: 610 };

export default class DeathScreen extends Screen {
  async setup(main, args = {}) {
    this.main = main;
    this.on_destroy(X.hide_tooltip);
    const root = this.root;
    main.set_background(await X.crop_margin(Art.bg("wheel")), 0.45);
    const shade = el("div", "abs");
    shade.style.background = X.css([0.02, 0.02, 0.06, 0.35]);
    shade.style.left = "0";
    shade.style.top = "0";
    shade.style.width = "1920px";
    shade.style.height = "1080px";
    root.appendChild(shade);

    const run = main.run;
    let cause = "old_age";
    let rec = {};
    if (run != null) {
      cause = String(run.death_cause ?? "") !== "" ? String(run.death_cause) : "old_age";
      rec = run.finished_record || {};
    }

    const title = X.over_art(L.t("Life's End"), 150, X.BRIGHT, true);
    X.place(title, [0, 14]);
    title.style.width = "1920px";
    title.style.textAlign = "center";
    root.appendChild(title);
    const line = X.over_art(X.cause_line(cause), 54, X.GOLD, true);
    X.place(line, [0, 226]);
    line.style.width = "1920px";
    line.style.textAlign = "center";
    root.appendChild(line);

    root.appendChild(X.place(X.nine("panel_parchment", 64, [PANEL.w, PANEL.h], X.PAPER), [PANEL.x, PANEL.y]));

    let paid = 0;
    if (run == null) {
      X.text_at(root, L.t("There is no life to read."), [PANEL.x + 80, PANEL.y + 200], 32, X.PAPER_INK, true);
    } else {
      paid = Math.trunc(rec.imprints ?? 0);
      this._build_record(run, rec);
    }
    this._build_pay(paid);

    const go = button(L.t("Into the Wheel"), 460, 96, { font_size: 36, onclick: () => main.goto("wheel") });
    X.place(go, [730, 952]);
    X.tooltip(go, L.t("Spend the imprints on the Wheel, then live again."));
    go.dataset.id = "wheel";
    root.appendChild(go);
  }

  _row(y, label, value, size = 30) {
    const x = PANEL.x + 80;
    X.text_at(this.root, label, [x, PANEL.y + y + 6], 22, X.PAPER_MUTED);
    X.text_at(this.root, value, [x + 250, PANEL.y + y], size, X.PAPER_INK, false, PANEL.w - 160 - 250);
  }

  _build_record(run, rec) {
    const D = this.main.D;
    const root = this.root;
    const realm = Math.trunc(rec.realm ?? run.realm);
    const layer = Math.trunc(rec.layer ?? run.layer);
    const terms = Math.trunc(rec.terms ?? run.term);
    this._row(56, L.t("Realm reached"), X.realm_name(D, realm, layer));
    this._row(108, L.t("Terms lived"), L.f("%d     (year %d, age %d)", [terms, Math.trunc(run.year), Math.trunc(run.age)]));
    this._row(160, L.t("Foes defeated"), String(Math.trunc(run.kills)));
    const truths = rec.truths ?? run.truths_found ?? [];
    const x = PANEL.x + 80;
    const y = PANEL.y + 214;
    X.text_at(root, L.t("Pages found"), [x, y + 6], 22, X.PAPER_MUTED);
    if (truths.length === 0) {
      X.text_at(root, L.t("None this life"), [x + 250, y], 26, X.PAPER_MUTED);
      return;
    }
    const shown = Math.min(truths.length, 4);
    const right = PANEL.x + PANEL.w - 76;
    for (let i = 0; i < shown; i++) {
      const tr = D.truths[String(truths[i])] || {};
      const ly = y + 44 + i * 36;
      const shown_name = Object.keys(tr).length ? L.name_of(tr) : String(truths[i]);
      X.fit_at(root, shown_name, [x + 14, ly], 28, X.PAPER_INK, true, right - x - 14, "left", 18);
    }
    if (truths.length > shown) {
      X.text_at(root, L.f("and %d more", [truths.length - shown]), [x + 14, y + 44 + shown * 36], 22, X.PAPER_MUTED);
    }
  }

  _build_pay(paid) {
    const root = this.root;
    const y = PANEL.y + 422;
    const rule = X.rule(PANEL.w - 160);
    X.place(rule, [PANEL.x + 80, y - 8]);
    root.appendChild(rule);
    let coin = Art.icon("res_imprint");
    if (!coin) coin = Art.ui("imprint_coin");
    if (coin) root.appendChild(X.place(X.pic(coin, [56, 86]), [PANEL.x + 84, y + 8]));
    X.text_at(root, L.t("Imprints paid"), [PANEL.x + 170, y + 6], 24, X.PAPER_MUTED);
    this._count_label = X.text_at(root, "+0", [PANEL.x + 168, y + 30], 72, X.CINNABAR_DARK, true);
    this._count_label.dataset.paid = String(paid);
    X.text_at(root, L.f("In hand now: %d", [Math.trunc(this.main.meta.imprints)]), [PANEL.x + 440, y + 62], 26, X.PAPER_INK, false,
      PANEL.w - 440 - 80, "right");
    if (paid > 0) X.count_up(this._count_label, paid, Math.max(600, Math.min(1600, 500 + paid * 20)));
  }
}

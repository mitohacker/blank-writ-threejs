// An ending (port of scripts/bw_screen_ending.gd): the painting full-bleed, a dark lower third with the ending's name and text on a
// parchment strip, the imprints paid.

import { Screen, button, el } from "../ui.js";
import { Art } from "../art.js";
import { L } from "../../sim/loc.js";
import * as X from "../ui_extra.js";

const STRIP = { x: 200, y: 510, w: 1520, h: 424 };

export default class EndingScreen extends Screen {
  async setup(main, args = {}) {
    this.main = main;
    this.on_destroy(X.hide_tooltip);
    const root = this.root;
    const run = main.run;
    let eid = "";
    let paid = 0;
    if (run != null) {
      eid = String(run.ending_id ?? "");
      const rec = run.finished_record || {};
      paid = Math.trunc(rec.imprints ?? 0);
    }
    const e = main.D.endings[eid] || {};
    let url = eid !== "" ? Art.ending(eid) : null;
    if (!url) url = Art.bg("gate");
    url = await X.crop_margin(url);
    X.backdrop(root, main, url, 0.0, [0.06, 0.06, 0.08]);

    // a dark lower third so the strip sits on something quiet
    const shade = el("div", "abs");
    X.place(shade, [0, 400], [1920, 680]);
    shade.style.background = "linear-gradient(to bottom, rgba(5,5,8,0) 0%, rgba(5,5,8,0.92) 62%, rgba(5,5,8,0.92) 100%)";
    root.appendChild(shade);

    root.appendChild(X.place(X.nine("panel_parchment", 64, [STRIP.w, STRIP.h], X.PAPER), [STRIP.x, STRIP.y]));

    const x = STRIP.x + 90;
    const w = STRIP.w - 180;
    this._count_label = null;
    if (run == null || eid === "") {
      X.text_at(root, L.t("The story ends"), [x, STRIP.y + 70], 60, X.PAPER_INK, true);
      X.wrapped_at(root, L.t("No ending was recorded for this life."), [x, STRIP.y + 170], w, 28, X.PAPER_MUTED);
    } else {
      X.fit_at(root, Object.keys(e).length ? L.name_of(e) : eid, [x, STRIP.y + 50], 68, X.PAPER_INK, true, w - 440, "left", 36);
      X.wrapped_at(root, L.t(String(e.text ?? "")), [x, STRIP.y + 150], w, 26, X.PAPER_INK, 6);
      // the imprints this ending paid, at the right of the name
      X.text_at(root, L.t("Imprints paid"), [STRIP.x + STRIP.w - 420, STRIP.y + 54], 22, X.PAPER_MUTED, false, 330, "right");
      this._count_label = X.text_at(root, "+0", [STRIP.x + STRIP.w - 420, STRIP.y + 76], 60, X.CINNABAR_DARK, true, 330, "right");
      this._count_label.dataset.paid = String(paid);
      if (paid > 0) X.count_up(this._count_label, paid, Math.max(800, Math.min(2000, 600 + paid * 10)));
    }

    const go = button(L.t("Into the Wheel"), 460, 96, { font_size: 36, onclick: () => main.goto("wheel") });
    X.place(go, [730, 956]);
    X.tooltip(go, L.t("Spend the imprints on the Wheel, then live again."));
    go.dataset.id = "wheel";
    root.appendChild(go);
  }
}

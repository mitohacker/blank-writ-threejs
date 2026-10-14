// Modal panels over the term screen (port of scripts/bw_overlays.gd): bag, techniques, journal, menu, shop, library.
//
//   const o = Overlays.bag(main, term);    // -> Overlay {root, closed: Promise, destroy()}
// Each overlay closes itself through `term.overlay_closed()` (its Close button) or by destroy(); `closed` resolves when it is gone.
// `term` is the term screen: overlay_closed(), _refresh(), _finish(); the overlays never touch anything else of it.

import { el, at, add, tex_rect, panel, button, set_enabled, tier_color } from "./ui.js";
import { Art } from "./art.js";
import { A } from "../audio.js";
import { L } from "../sim/loc.js";
import { sprintf } from "../sim/fmt.js";
import { make_modal, plabel as label, pwrap as wrap_label } from "./term_kit.js";

const PARCH_TEXT = "#f2e6bf";
const INK = "#1f170f";

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const int = (v, d = 0) => Math.trunc(num(v, d));

class Overlay {
  constructor() {
    this.root = null;
    this.alive = true;
    this.closed = new Promise((res) => (this._resolve = res));
  }
  destroy() {
    if (!this.alive) return;
    this.alive = false;
    if (this.root) this.root.remove();
    this._resolve();
  }
}

/** a parchment-panel button with a sound of its own (the default click otherwise) */
function btn(text, w, h, font_size, sound = "ui_click", onclick = null) {
  return button(text, w, h, { font_size, color: PARCH_TEXT, sound, onclick });
}

/** the shared board: dim, parchment, title, Close. returns {o: Overlay, root, origin} */
function modal(title, w, h, term, kind) {
  A.sfx("ui_open");
  const o = new Overlay();
  const root = make_modal("rgba(8,8,10,0.6)");
  root.dataset.bw = "overlay";
  root.dataset.kind = kind;
  o.root = root;
  const origin = { x: (1920 - w) / 2, y: (1080 - h) / 2 };
  add(root, at(panel("panel_parchment", 64, "#ede3c7"), origin.x, origin.y, w, h));
  add(root, at(label(title, 46, "#1a140f", true), origin.x + 70, origin.y + 34));
  const close = btn(L.t("Close"), 150, 56, 22, "ui_back", () => term.overlay_closed());
  close.dataset.role = "close";
  add(root, at(close, origin.x + w - 220, origin.y + 30));
  return { o, root, origin };
}

function slot_name(slot) {
  return L.t(String(slot).charAt(0).toUpperCase() + String(slot).slice(1));
}

/** an item row: icon (or a tier-coloured square), "name  xN", a line of its text */
function row_item(run, id, count, w) {
  const it = run.D.item(id) || {};
  const row = el("div", "");
  row.style.position = "relative";
  row.style.width = w + "px";
  row.style.height = "64px";
  const ic = Art.icon("it_" + id);
  if (ic) add(row, at(tex_rect(ic, 56, 56), 0, 4));
  else {
    const box = el("div", "abs", row);
    at(box, 2, 6, 52, 52);
    box.style.background = tier_color(int(it.q, 1) - 1);
    box.style.filter = "brightness(.8)";
  }
  add(row, at(label(`${L.name_of(it)}  x${count}`, 22, "#1f170f"), 68, 2));
  add(row, at(label(L.t(String(it.text || "")).slice(0, 70), 16, "#59473a"), 68, 34));
  return row;
}

function scroll_box(x, y, w, h) {
  const s = el("div", "scroll hit");
  at(s, x, y, w, h);
  return s;
}

function line_row(child_w, h) {
  const r = el("div", "");
  r.style.position = "relative";
  r.style.width = child_w + "px";
  r.style.height = h + "px";
  r.style.marginBottom = "6px";
  return r;
}

export const Overlays = {
  // ---- bag ----------------------------------------------------------------------------------------------------------------
  bag(main, term) {
    const run = main.run;
    const { o, root, origin } = modal(L.t("Bag"), 1300, 820, term, "bag");
    const slots = ["weapon", "armor", "charm", "ring"];
    let x = 70;
    for (const s of slots) {
      const iid = String(run.equip[s] || "");
      const txt = `${slot_name(s)}: ${iid !== "" ? L.name_of(run.D.item(iid)) : "—"}`;
      add(root, at(label(txt, 20, "#33261a"), origin.x + x, origin.y + 100));
      x += 300;
    }
    const out_lbl = wrap_label("", 20, "#1a6633", 1100);
    add(root, at(out_lbl, origin.x + 70, origin.y + 730));
    const sc = scroll_box(origin.x + 70, origin.y + 140, 1160, 570);
    add(root, sc);
    const fill = () => {
      sc.textContent = "";
      const ids = Object.keys(run.bag).sort();
      // materials first: they are not items, so they were missing from the bag altogether
      {
        const h = label(L.t("Materials"), 24, "#33261a");
        h.style.position = "static";
        h.style.fontWeight = "700";
        h.style.marginBottom = "4px";
        sc.appendChild(h);
        const r = line_row(1160, 60);
        let mx = 0;
        for (const k of ["herb", "ore", "core"]) {
          const ic = Art.icon("res_" + k);
          if (ic) add(r, at(tex_rect(ic, 48, 48), mx, 6));
          add(r, at(label(`${L.t(k)}  x${int((run.mats || {})[k] || 0)}`, 24, "#1f170f"), mx + 58, 14));
          mx += 380;
        }
        sc.appendChild(r);
        const hint = label(L.t("Materials: herbs, ore and cores are spent by craft and venture cards."), 17, "#59472f");
        hint.style.position = "static";
        hint.style.marginBottom = "14px";
        sc.appendChild(hint);
        const h2 = label(L.t("Items"), 24, "#33261a");
        h2.style.position = "static";
        h2.style.fontWeight = "700";
        h2.style.marginBottom = "4px";
        sc.appendChild(h2);
      }
      if (ids.length === 0) {
        const l = label(L.t("No items yet. Wander, hunt, trade."), 22, "#4d4033");
        l.style.position = "static";
        sc.appendChild(l);
      }
      for (const id of ids) {
        const it = run.D.item(id) || {};
        const r = line_row(1160, 64);
        add(r, row_item(run, id, int(run.bag[id]), 760));
        const kind = String(it.kind || "");
        const use = it.use;
        let b = null;
        if (use && String(use.when || "anytime") !== "battle") {
          b = btn(L.t("Use"), 120, 50, 20, "item_get", () => {
            const rr = run.use_item(id);
            out_lbl.textContent = (rr.lines || []).join(", ");
            main.save_run();
            fill();
            term._refresh();
          });
        } else if (kind === "artifact") {
          b = btn(L.t("Equip"), 120, 50, 20, "equip", () => {
            run.equip[String(it.slot || "")] = id;
            out_lbl.textContent = sprintf(L.t("Equipped %s."), L.name_of(it));
            main.save_run();
            fill();
            term._refresh();
          });
        } else if (kind === "manual") {
          b = btn(L.t("Study"), 120, 50, 20, "ui_page", () => {
            const te = it.teaches || {};
            if (te.tech !== undefined) run.learn_tech(String(te.tech));
            if (te.card !== undefined) run.deck.push(String(te.card));
            if (te.method !== undefined) run.method = String(te.method);
            run.take_item(id, 1);
            out_lbl.textContent = sprintf(L.t("You study %s."), L.name_of(it));
            main.save_run();
            fill();
            term._refresh();
          });
        }
        if (b) {
          b.dataset.role = "item-action";
          add(r, at(b, 772, 7));
        }
        sc.appendChild(r);
      }
    };
    fill();
    return o;
  },

  // ---- techniques -----------------------------------------------------------------------------------------------------------
  techniques(main, term) {
    const run = main.run;
    const D = run.D;
    const { o, root, origin } = modal(L.t("Techniques"), 1300, 820, term, "tech");
    const meth = (D.methods || {})[run.method] || {};
    add(root, at(label(sprintf(L.t("Method: %s  (cultivation x%.2f)"), L.name_of(meth), num(meth.cult_mult, 1.0)), 24, "#261a12"), origin.x + 70, origin.y + 100));
    add(root, at(wrap_label(sprintf(L.t("In battle your skills are used in this order, as mana and cooldowns allow. Slots: %d."), run.slots()), 20, "#4d3d2e", 1100), origin.x + 70, origin.y + 140));
    const list = scroll_box(origin.x + 70, origin.y + 200, 1160, 560);
    add(root, list);
    const fill = () => {
      list.textContent = "";
      const order = [];
      for (const t of run.loadout) order.push(t);
      for (const t of run.techs) if (!order.includes(t)) order.push(t);
      if (order.length === 0) {
        const l = wrap_label(L.t("You know no battle techniques yet. Find manuals, join a path, visit a library."), 24, "#4d4033", 1100);
        l.style.position = "static";
        list.appendChild(l);
      }
      for (const tid of order) {
        const t = D.tech(String(tid)) || {};
        const equipped = run.loadout.includes(tid);
        const row = line_row(1160, 58);
        const numtxt = equipped ? `${run.loadout.indexOf(tid) + 1}.` : " – ";
        add(row, at(label(numtxt, 24, "#802e1a"), 0, 12));
        const ic = Art.icon("sk_" + tid);
        if (ic) add(row, at(tex_rect(ic, 52, 52), 50, 3));
        const txt = sprintf(L.t("%s  [%s · %d MP · cd %d · x%.1f]"), L.name_of(t), L.elem_name(String(t.elem || "none")), int(t.mp, 0), int(t.cd, 0), num(t.mult, 1.0));
        add(row, at(label(txt, 21, equipped ? "#1f170f" : "#665947"), 112, 14));
        const up = btn(L.t("Up"), 120, 46, 18, "card_swap", () => {
          const idx = run.loadout.indexOf(tid);
          if (idx > 0) {
            run.loadout.splice(idx, 1);
            run.loadout.splice(idx - 1, 0, tid);
          }
          main.save_run();
          fill();
        });
        add(row, at(up, 760, 6));
        const tg = btn(equipped ? L.t("Remove") : L.t("Equip"), 150, 46, 18, "equip", () => {
          const idx = run.loadout.indexOf(tid);
          if (idx >= 0) run.loadout.splice(idx, 1);
          else if (run.loadout.length < run.slots()) run.loadout.push(tid);
          main.save_run();
          fill();
        });
        add(row, at(tg, 890, 6));
        list.appendChild(row);
      }
    };
    fill();
    return o;
  },

  // ---- journal --------------------------------------------------------------------------------------------------------------
  journal(main, term) {
    const run = main.run;
    const { o, root, origin } = modal(L.t("Journal"), 1300, 820, term, "journal");
    add(root, at(label(L.t("Bonds"), 28, "#1f170f", true), origin.x + 70, origin.y + 100));
    let y = 150;
    let any = false;
    for (const k of Object.keys(run.rel || {})) {
      const v = int(run.rel[k]);
      if (v === 0) continue;
      any = true;
      const hearts = v > 0 ? "♥".repeat(Math.max(0, v)) : "✕".repeat(-v);
      add(root, at(label(`${L.cast_name(String(k))}  ${hearts}`, 24, "#331f14"), origin.x + 70, origin.y + y));
      y += 36;
    }
    if (!any) add(root, at(label(L.t("No one yet."), 22, "#66543f"), origin.x + 70, origin.y + y));
    add(root, at(label(L.t("Recent"), 28, "#1f170f", true), origin.x + 560, origin.y + 100));
    const rt = scroll_box(origin.x + 560, origin.y + 150, 680, 590);
    rt.style.fontSize = "20px";
    rt.style.color = "#261f17";
    rt.style.lineHeight = "28px";
    const log = (run.log_all || []).slice(Math.max(0, (run.log_all || []).length - 30));
    for (const s of log) {
      const d = document.createElement("div");
      d.textContent = String(s);
      rt.appendChild(d);
    }
    add(root, rt);
    rt.scrollTop = rt.scrollHeight;
    add(root, at(label(sprintf(L.t("Pages found this life: %d   Kills: %d   Deck: %d cards"), run.truths_found.length, run.kills, run.deck.length), 20, "#4d3d2e"), origin.x + 70, origin.y + 750));
    return o;
  },

  // ---- pause menu -----------------------------------------------------------------------------------------------------------
  menu(main, term) {
    const { o, root, origin } = modal(L.t("Paused"), 700, 720, term, "menu");
    let y = 130;
    const items = [
      [L.t("Resume"), "resume"],
      [L.t("Registry"), "registry"],
      [L.t("Settings"), "settings"],
      [L.t("Save and return to title"), "title"],
      [L.t("Abandon this life"), "abandon"],
    ];
    for (const [text, which] of items) {
      const b = btn(text, 420, 70, 26, "ui_click", () => menu_pick(which, main, term));
      b.dataset.role = "menu-" + which;
      add(root, at(b, origin.x + 140, origin.y + y));
      y += 90;
    }
    add(root, at(wrap_label(L.t("Abandoning ends this life now: you will still be paid imprints for what you did."), 18, "#59473a", 440), origin.x + 130, origin.y + y + 10));
    return o;
  },

  // ---- shop -----------------------------------------------------------------------------------------------------------------
  shop(main, term) {
    const run = main.run;
    const { o, root, origin } = modal(L.t("Market"), 1300, 820, term, "shop");
    const stones = add(root, at(label(sprintf(L.t("Stones: %d"), run.stone), 26, "#1f170f"), origin.x + 70, origin.y + 100));
    const list = scroll_box(origin.x + 70, origin.y + 150, 1160, 590);
    add(root, list);
    const fill = () => {
      list.textContent = "";
      stones.textContent = sprintf(L.t("Stones: %d"), run.stone);
      for (const s of run.shop) {
        const id = String(s.id);
        const r = line_row(1160, 64);
        add(r, row_item(run, id, 1, 760));
        const price = int(s.price);
        const b = btn(sprintf(L.t("Buy  %d"), price), 170, 50, 20, "coin", () => {
          run.buy(id);
          fill();
        });
        b.dataset.role = "buy";
        set_enabled(b, run.stone >= price);
        add(r, at(b, 780, 7));
        list.appendChild(r);
      }
      const sep = label(L.t("Sell from your bag (a third of the price):"), 20, "#4d3d2e");
      sep.style.position = "static";
      sep.style.display = "block";
      sep.style.margin = "10px 0";
      list.appendChild(sep);
      let n = 0;
      for (const id2 of Object.keys(run.bag)) {
        const it = run.D.item(id2) || {};
        if (int(it.price, 0) <= 0 || (String(it.kind || "") === "artifact" && String(run.equip[String(it.slot || "")] || "") === id2)) continue;
        n++;
        if (n > 5) break;
        const r2 = line_row(1160, 64);
        add(r2, row_item(run, id2, int(run.bag[id2]), 760));
        const sb = btn(sprintf(L.t("Sell  +%d"), Math.trunc(int(it.price, 0) / 3)), 170, 50, 20, "coin", () => {
          run.sell(id2);
          fill();
        });
        sb.dataset.role = "sell";
        add(r2, at(sb, 780, 7));
        list.appendChild(r2);
      }
    };
    fill();
    return o;
  },

  // ---- library --------------------------------------------------------------------------------------------------------------
  library(main, term) {
    const run = main.run;
    const { o, root, origin } = modal(L.t("Library"), 1100, 600, term, "library");
    add(root, at(label(L.t("Choose one scroll to study."), 24, "#33261a"), origin.x + 70, origin.y + 100));
    let y = 160;
    for (let i = 0; i < run.pending_learn.length; i++) {
      const p = run.pending_learn[i];
      const t = run.D.tech(String(p.id)) || {};
      const text = sprintf(L.t("%s   (%s, x%.1f, %d MP)"), L.name_of(t), L.elem_name(String(t.elem || "none")), num(t.mult, 1.0), int(t.mp, 0));
      const idx = i;
      const b = btn(text, 900, 80, 24, "ui_page", () => {
        run.take_learn(idx);
        term.overlay_closed();
      });
      b.dataset.role = "scroll";
      add(root, at(b, origin.x + 100, origin.y + y));
      y += 100;
    }
    return o;
  },
};

function menu_pick(which, main, term) {
  if (which === "resume") term.overlay_closed();
  else if (which === "registry") {
    main.save_run();
    main.goto("registry");
  } else if (which === "settings") {
    main.save_run();
    main.goto("settings", { back: "term" });
  } else if (which === "title") {
    main.save_run();
    main.goto("title");
  } else if (which === "abandon") {
    main.run.abandon();
    main.save_run();
    term._finish();
  }
}

export default Overlays;

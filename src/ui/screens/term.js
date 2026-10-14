// The main screen of a life (port of scripts/bw_screen_term.gd): the term's hand of action cards, the character, the calendar, End Term.
// Events and battles open as dialogs over it. The hand is drawn in WebGL by src/gfx/cards3d.js; everything else is DOM on the stage.
//
//   main.goto("term", {demo?})      needs main.run (a Run in progress); main.args may carry the debug flags
//     ?event=<id>   opens that event          ?battle=<enemy id>   opens that fight
//     ?panel=bag|tech|journal|menu|shop|library   opens that overlay      ?hover=<hand index>   hovers that card (tooltip)
//   window.__bw.screen exposes: run, hand (CardHand), state(), and the busy flag for the browser tests.

import { Screen, el, at, add, tex_rect, panel, button, set_enabled, toast, fit_size, tier_color, GOLD, ELEM_COLORS, CAT_COLORS } from "../ui.js";
import { Art } from "../art.js";
import { A } from "../../audio.js";
import { L } from "../../sim/loc.js";
import { Txt } from "../../sim/text.js";
import { sprintf } from "../../sim/fmt.js";
import { CardHand } from "../../gfx/cards3d.js";
import { EventView } from "../event_view.js";
import { BattleView } from "../battle_view.js";
import { Overlays } from "../overlays.js";
import { bar, outline, on_window, plabel as label, pwrap as wrap_label } from "../term_kit.js";

const CARD_W = 286;
const TIER_COLS = ["#ccccc7", "#73d98c", "#73a6ff", "#ffd14d"];
const FRAMES = ["card_grey", "card_green", "card_blue", "card_gold"];

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const int = (v, d = 0) => Math.trunc(num(v, d));
const roundi = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function cur_empty(run) {
  return !run.current || Object.keys(run.current).length === 0;
}

export default class TermScreen extends Screen {
  async setup(main, args = {}) {
    this.main = main;
    this.run = main.run;
    this.D = main.D;
    this.args = args;
    this._lbl = {};
    this._bars = {};
    this._roots_lbl = [];
    this._stats_lbl = {};
    this._ap_icons = [];
    this._result_lines = [];
    this._busy = false;
    this._swap_mode = false;
    this._deal_term = -1;
    this._tip = null;
    this._tip_index = -1;
    this._overlay = null;
    this._overlay_kind = "";
    this.ev = null;
    this.bv = null;
    this._gone = false;
    this._build();
    this.hand = new CardHand(main, {
      host: this.hand_layer,
      on_hover: (i, rect) => this._hover(i, rect),
      on_click: (i) => this._card_input(i),
    });
    this.on_destroy(() => this.hand.dispose());
    this.on_destroy(
      on_window("keydown", (e) => {
        if (e.key === "Escape" && !e.repeat) {
          e.preventDefault();
          this._escape();
        }
      }),
    );
    await this._refresh();
    const a = main.args || {};
    if ("hover" in a) this.after(0, () => this._debug_view(String(a.hover)));
    else if ("panel" in a) this.after(0, () => this._debug_view(String(a.panel)));
    if ("event" in a) {
      // screenshots: ?event=<event id> opens that event
      this.run.current = {};
      this.run._open_event(String(a.event), { lines: [], battles: [], tier_mult: 1.0, scaled: false });
      this.after(0, () => this._resume_event());
    } else if ("battle" in a) {
      this.after(0, () => this._debug_battle(String(a.battle)));
    } else if (cur_empty(this.run)) {
      this._first_hint();
    } else {
      this.after(0, () => this._resume_event());
    }
  }

  destroy() {
    this._gone = true;
    if (this.ev) this.ev.abort();
    if (this.bv) this.bv.abort();
    if (this._overlay) this._overlay.destroy();
    super.destroy();
  }

  /** a summary for the tests and tools */
  state() {
    return {
      busy: this._busy,
      event: !!this.ev,
      battle: !!this.bv,
      overlay: this._overlay_kind || "",
      cards: this.hand ? this.hand.cards.length : 0,
      hand: this.run.hand.length,
      ap: this.run.ap,
      dead: !!this.run.dead,
      swap: this._swap_mode,
    };
  }

  // ---- first hint and debug flags ---------------------------------------------------------------------------------------------
  _first_hint() {
    const o = this.main.meta.options;
    const seen = o.hints_seen || (o.hints_seen = {});
    if (seen.term) return;
    seen.term = true;
    this.main.meta.save();
    this._toast(L.t("Each term you have a few ACTIONS. Click a card to play it, then End Term. Lifespan is counted in terms."), 7.0);
  }

  _debug_view(what) {
    if (/^-?\d+$/.test(what)) {
      const i = parseInt(what, 10);
      if (i >= 0 && i < this.hand.cards.length) this.hand.force_hover(i);
    } else if (what === "shop") {
      this.run._open_shop({ lines: [], battles: [], tier_mult: 1.0, scaled: false });
      this._overlay_open(Overlays.shop(this.main, this), "shop");
    } else if (what === "library") {
      this.run._open_library({ lines: [], battles: [], tier_mult: 1.0, scaled: false });
      this._overlay_open(Overlays.library(this.main, this), "library");
    } else if (what === "menu") {
      this._open_menu();
    } else {
      this._open_panel(what);
    }
  }

  _debug_battle(enemy_id) {
    // screenshots / manual checks: ?battle=<enemy id> opens that fight straight away
    const ctx = { lines: [], battles: [], tier_mult: 1.0, scaled: false };
    this.run.current = {};
    this.run.apply_fx([{ op: "battle", enemy: enemy_id }], ctx);
    this._busy = true;
    this.hand.set_enabled(false);
    this._present({ lines: ctx.lines, battles: ctx.battles, died: this.run.dead, event: false }).then(() => {
      this._busy = false;
      this.main.save_run();
      return this._refresh();
    });
  }

  _resume_event() {
    this._busy = true;
    this.hand.set_enabled(false);
    this._present({ lines: [], battles: [], died: false, event: true }).then(() => {
      if (this._gone) return;
      this._busy = false;
      this.main.save_run();
      return this._refresh();
    });
  }

  // ---- layout -----------------------------------------------------------------------------------------------------------------
  _ap_url(lit) {
    return Art.ui(lit ? "ap_lit" : "ap_dim") || Art.ui(lit ? "lotus_lit" : "lotus_dim");
  }

  _build() {
    const { main, run, D, root } = this;
    main.set_background(Art.bg(run.place), 0.12);
    // top bar
    const top = panel("panel_dark", 36, "#121010eb");
    at(top, 0, 0, 1920, 138);
    top.style.opacity = "0.96";
    add(root, top);
    const ring_url = Art.portrait("hero_" + run.gender);
    if (ring_url) {
      // the head: a square cut from the top of the portrait (5 % in from the left, 90 % wide)
      const pr = el("div", "img");
      at(pr, 26, 14, 112, 112);
      pr.style.backgroundImage = `url("${ring_url}")`;
      pr.style.backgroundRepeat = "no-repeat";
      pr.style.backgroundSize = `${112 / 0.9}px auto`;
      pr.style.backgroundPosition = `${(-0.05 * 112) / 0.9}px 0`;
      add(root, pr);
    }
    const ring = Art.ui("ring_portrait");
    if (ring) add(root, at(tex_rect(ring, 150, 150), 7, -2));
    this._lbl.name = add(root, at(label("", 30, "#faedc7", true), 176, 6));
    this._lbl.realm = add(root, at(label("", 22, GOLD), 176, 46));
    this._bars.hp = bar("trough_a", "fill_green", 370, 30, "#4db366");
    add(root, at(this._bars.hp.el, 176, 76));
    this._bars.mp = bar("trough_b", "fill_blue", 370, 24, "#4d80d9");
    add(root, at(this._bars.mp.el, 176, 104));
    this._bars.cult = bar("trough_c", "fill_amber", 440, 30, "#d9a633");
    add(root, at(this._bars.cult.el, 560, 76));
    add(root, at(label(L.t("Cultivation"), 18, "#d9ccA6"), 566, 50));
    // roots
    add(root, at(label(L.t("Roots"), 18, "#d9ccA6"), 1030, 8));
    const rkeys = D.rules.roots || ["metal", "wood", "water", "fire", "earth"];
    for (let i = 0; i < rkeys.length; i++) {
      const k = String(rkeys[i]);
      const x = 1030 + i * 66;
      const ic = Art.icon("el_" + k);
      if (ic) add(root, at(tex_rect(ic, 48, 48), x, 38));
      else {
        const dot = el("div", "abs");
        at(dot, x, 40, 44, 44);
        dot.style.background = ELEM_COLORS[k] || "#808080";
        add(root, dot);
        const zh = (D.rules.root_names && D.rules.root_names[k] && D.rules.root_names[k].zh) || "?";
        add(root, at(label(zh, 26, "#1a1a1a"), x + 8, 42));
      }
      const nl = add(root, at(label("0", 22, "#fff2cc"), x + 18, 88));
      this._roots_lbl.push(nl);
    }
    // stats: 3 x 2
    const skeys = D.rules.stats || [];
    for (let i = 0; i < skeys.length; i++) {
      const k = String(skeys[i]);
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 1372 + col * 136;
      const y = 14 + row * 56;
      const ic2 = Art.icon("st_" + k);
      if (ic2) add(root, at(tex_rect(ic2, 40, 40), x, y + 4));
      const sl = add(root, at(label("", 20, "#f5ebcc"), x + 44, y + 6));
      this._stats_lbl[k] = sl;
    }
    // menu (the currencies live in the bottom bar)
    const menu_btn = button(L.t("Menu"), 104, 52, { font_size: 20, onclick: () => this._open_menu() });
    menu_btn.dataset.role = "menu";
    add(root, at(menu_btn, 1806, 38));
    // calendar strip (left)
    const cal = panel("panel_parchment", 54, "#ede3c7");
    add(root, at(cal, 14, 152, 262, 470));
    const ink2 = "#4d3d2e";
    this._lbl.year = add(root, at(label("", 52, "#1f170f", true), 48, 176));
    this._lbl.termline = add(root, at(label("", 22, ink2), 50, 246));
    add(root, at(label(L.t("Lifespan"), 20, ink2), 50, 288));
    this._bars.life = bar("trough_d", "fill_red", 190, 26, "#cc4d40");
    add(root, at(this._bars.life.el, 46, 314));
    add(root, at(label(L.t("Notice"), 20, ink2), 50, 352));
    this._bars.notice = bar("trough_a", "fill_amber", 190, 26, "#d99933");
    add(root, at(this._bars.notice.el, 46, 378));
    this._lbl.corrupt_t = add(root, at(label(L.t("Corruption"), 20, ink2), 50, 416));
    this._bars.corrupt = bar("trough_b", "fill_red", 190, 26, "#802659");
    add(root, at(this._bars.corrupt.el, 46, 442));
    add(root, at(label(L.t("Actions this term"), 20, ink2), 50, 490));
    for (let i = 0; i < 4; i++) {
      const lot = tex_rect(this._ap_url(true), 54, 56);
      add(root, at(lot, 40 + i * 56, 524));
      this._ap_icons.push(lot);
    }
    // hand area (the cards are WebGL; the DOM fallback puts its cards in this layer)
    this.hand_layer = el("div", "abs");
    at(this.hand_layer, 0, 0, 1920, 1080);
    this.hand_layer.style.pointerEvents = "none";
    add(root, this.hand_layer);
    this._hint = add(root, at(label("", 24, "#1f170f"), 300, 736));
    outline(this._hint, "#f7f0d9f2", 8);
    // result strip
    const rp = panel("panel_dark", 30, "#0d0d0fcc");
    add(root, at(rp, 300, 778, 1210, 150));
    this._result = el("div", "abs");
    at(this._result, 322, 790, 1170, 128);
    this._result.style.overflow = "hidden";
    this._result.style.fontSize = "19px";
    this._result.style.color = "#ebe0bf";
    this._result.style.lineHeight = "25px";
    this._result.style.pointerEvents = "none";
    add(root, this._result);
    // bottom bar
    const bot = panel("panel_dark", 36, "#121010eb");
    add(root, at(bot, 0, 944, 1920, 136));
    let x = 30;
    const items = [[L.t("Techniques"), "tech"], [L.t("Bag"), "bag"], [L.t("Registry"), "registry"], [L.t("Journal"), "journal"]];
    for (const [text, which] of items) {
      const nb = button(text, 250, 68, { font_size: 24, onclick: () => this._open_panel(which) });
      nb.dataset.role = "open-" + which;
      add(root, at(nb, x, 974));
      x += 266;
    }
    const sic = Art.icon("res_stone");
    if (sic) add(root, at(tex_rect(sic, 44, 44), 1096, 986));
    this._lbl.stone = add(root, at(label("", 26, "#e6ebff"), 1146, 988));
    const iic = Art.icon("res_imprint");
    if (iic) add(root, at(tex_rect(iic, 44, 44), 1220, 986));
    this._lbl.imprints = add(root, at(label("", 26, "#ffd1b3"), 1270, 988));
    add(root, at(label(L.t("stones"), 15, "#b3b3bf"), 1146, 1022));
    add(root, at(label(L.t("imprints"), 15, "#ccb3a6"), 1270, 1022));
    this._swap_btn = button(L.t("Swap a card"), 250, 68, { font_size: 24, onclick: () => this._toggle_swap() });
    this._swap_btn.dataset.role = "swap";
    add(root, at(this._swap_btn, 1340, 974));
    this._end_btn = button(L.t("End Term"), 300, 80, { tex: "btn_hover", font_size: 28, color: "#ffeb99", sound: "ui_confirm", onclick: () => this._on_end_term() });
    this._end_btn.dataset.role = "end-term";
    add(root, at(this._end_btn, 1590, 966));
    // dialogs and overlays live above everything else on this screen
    this.modal_layer = el("div", "abs");
    at(this.modal_layer, 0, 0, 1920, 1080);
    this.modal_layer.style.pointerEvents = "none";
    this.modal_layer.style.zIndex = "40";
    add(root, this.modal_layer);
  }

  // ---- refresh ----------------------------------------------------------------------------------------------------------------
  async _refresh() {
    const { run, D, main } = this;
    if (this._gone) return;
    const d = run.derived();
    this._lbl.name.textContent = String(run.hero_name);
    this._lbl.realm.textContent = sprintf(L.t("%s   Age %d"), run.realm_label(), run.age);
    this._bars.hp.set_value(run.hp / Math.max(1, num(d.max_hp)), sprintf(L.t("HP %d / %d"), int(run.hp), int(d.max_hp)));
    this._bars.mp.set_value(run.mp / Math.max(1, num(d.max_mp)), sprintf(L.t("MP %d / %d"), int(run.mp), int(d.max_mp)));
    const need = run.need();
    if (run.realm >= 5 && run.layer >= 3) this._bars.cult.set_value(1, L.t("Peak of the road"));
    else if (run.breakthrough_ready()) this._bars.cult.set_value(1, L.t("READY — play Breakthrough"));
    else this._bars.cult.set_value(run.cult / Math.max(1, need), `${int(run.cult)} / ${int(need)}`);
    const rkeys = D.rules.roots || [];
    for (let i = 0; i < this._roots_lbl.length; i++) this._roots_lbl[i].textContent = String(int((run.roots || {})[rkeys[i]] || 0));
    for (const k of Object.keys(this._stats_lbl)) {
      const v = run.stat_total(k);
      this._stats_lbl[k].textContent = `${L.stat_name(D, k)} ${int(roundi(v))}`;
    }
    this._lbl.stone.textContent = String(run.stone);
    this._lbl.imprints.textContent = String(main.meta.imprints);
    this._lbl.year.textContent = sprintf(L.t("Year %d"), run.year + 1);
    const tline = sprintf(L.t("Term %d   %s"), run.term, L.place_name(String(run.place)));
    this._lbl.termline.textContent = tline;
    this._lbl.termline.style.fontSize = fit_size(tline, 22, 214, false, 13) + "px";
    const life_total = Math.max(int(run.life), 1) + int(run.term);
    this._bars.life.set_value(int(run.life) / Math.max(life_total, 1), sprintf(L.t("%d terms"), run.life));
    this._bars.notice.set_value(int(run.notice) / 100, `${run.notice} / 100`);
    const corrupt = run.corrupt > 0;
    this._bars.corrupt.el.style.display = corrupt ? "" : "none";
    this._lbl.corrupt_t.style.display = corrupt ? "" : "none";
    if (corrupt) this._bars.corrupt.set_value(int(run.corrupt) / 100, `${run.corrupt} / 100`);
    const apm = run.ap_max();
    for (let i = 0; i < this._ap_icons.length; i++) {
      const ic = this._ap_icons[i];
      ic.style.display = i < apm ? "" : "none";
      const url = this._ap_url(i < run.ap);
      ic.style.backgroundImage = url ? `url("${url}")` : "none";
    }
    this._swap_btn.textContent = sprintf(L.t("Swap a card (%d)"), run.swaps_left);
    set_enabled(this._swap_btn, run.swaps_left > 0 && !this._busy);
    set_enabled(this._end_btn, !this._busy);
    this._swap_btn.classList.toggle("on", this._swap_mode);
    if (run.ap > 0) this._hint.textContent = sprintf(L.t("%d actions left — click a card to play it. Hover for details."), run.ap);
    else this._hint.textContent = L.t("No actions left — press End Term. Time passes; fate draws an event.");
    if (this._swap_mode) this._hint.textContent = L.t("Swap: click the card you want to put back.");
    main.set_background(Art.bg(run.place), 0.12);
    if (main.world && main.world.set_mood) main.world.set_mood(String(run.place) === "netherworld" ? "dark" : "calm");
    A.music_for_place(String(run.place));
    await this._build_hand();
    this._deal_sound();
  }

  async _build_hand() {
    this._hide_tip();
    const deal = this.run.term !== this._deal_term && this.run.hand.length > 0;
    const specs = this.run.hand.map((h, i) => this._card_spec(i));
    this.hand.set_swap_mode(this._swap_mode);
    this.hand.set_enabled(!this._busy);
    await this.hand.set_cards(specs, { deal });
    this.hand.set_swap_mode(this._swap_mode);
  }

  /** The hand is dealt once per term: a rustle, and a chime when a rare or supreme card is in it. */
  _deal_sound() {
    const run = this.run;
    if (run.term === this._deal_term || run.hand.length === 0) return;
    this._deal_term = run.term;
    A.sfx("card_deal");
    let top = 0;
    for (const h of run.hand) top = Math.max(top, int(h.tier));
    if (top >= 3) A.sfx("tier_supreme");
    else if (top >= 2) A.sfx("tier_rare");
  }

  _frame_for(h, c) {
    if (String(c.id || "") === "breakthrough") return "card_gold";
    if (String(c.cat || "") === "chance" || int(h.expires, -1) >= 0) return "card_purple";
    return FRAMES[clamp(int(h.tier), 0, 3)];
  }

  _card_text(c, tier) {
    const run = this.run;
    if (String(c.id || "") === "breakthrough") {
      let t = sprintf(L.t("Chance %d%%."), roundi(run.breakthrough_chance() * 100));
      if (run.bt_fails > 0) t += " " + sprintf(L.t("(+%d%% from past failures)"), roundi(Math.min(0.3, 0.1 * run.bt_fails) * 100));
      if (run.tribulation_ahead()) t += " " + L.t("Then the tribulation: ready your pills.");
      return t;
    }
    const lines = Txt.fx_lines(run, c.fx || [], c.scale === false ? 1.0 : run.tier_mult(tier));
    let s = String(c.text || "");
    if (s === "" && lines.length > 0) s = lines.join(", ");
    return s;
  }

  /** everything the hand needs to draw one card (see card_ops in cards3d.js) */
  _card_spec(i) {
    const { run, D } = this;
    const h = run.hand[i];
    const c = D.card(String(h.id));
    const ok = run.can_play(i);
    const id = String(c.id || h.id);
    const tier = int(h.tier);
    const fname = this._frame_for(h, c);
    const ap = int(c.ap, 1);
    const expires = int(h.expires, -1);
    const cost = c.cost || {};
    let tier_label = "";
    if (tier > 0 && id !== "breakthrough") tier_label = L.is_zh() ? Txt.tier_zh(tier) : Txt.tier_name(tier);
    let expires_label = "";
    if (expires >= 0) expires_label = expires <= 1 ? L.t("last chance") : sprintf(L.t("%d terms left"), expires);
    const text = this._card_text(c, tier);
    return {
      i,
      id,
      name: L.name_of(c),
      zh: String(c.zh || "?"),
      tier,
      ap,
      cat: String(c.cat || ""),
      cat_label: `${Txt.cat_name(String(c.cat || ""))}  ${"◈".repeat(ap)}`,
      tier_label,
      tier_col: TIER_COLS[clamp(tier, 0, 3)],
      tier_big: L.is_zh(),
      tier_css: tier_color(tier),
      expires_label,
      text: id === "breakthrough" ? text : L.t(text),
      cost_label: Object.keys(cost).length > 0 ? sprintf(L.t("Cost: %s"), run.cost_text(cost)) : "",
      art_url: Art.card(id),
      frame: fname,
      frame_url: Art.ui(fname),
      cat_color: shade_css(CAT_COLORS[String(c.cat || "")] || "#808080", 0.65),
      ok: !!ok.ok,
      reason: String(ok.reason || ""),
      breakthrough: id === "breakthrough",
      swap_ok: expires < 0 && id !== "breakthrough",
    };
  }

  // ---- hover tooltip ----------------------------------------------------------------------------------------------------------
  _hover(i, rect) {
    if (this._busy) return;
    if (i >= 0 && rect) this._show_tip(i, rect);
    else this._hide_tip();
  }

  _show_tip(i, rect) {
    this._hide_tip();
    const { run, D } = this;
    if (i >= run.hand.length) return;
    const h = run.hand[i];
    const c = D.card(String(h.id));
    const tier = int(h.tier);
    const mult = c.scale === false ? 1.0 : num(run.tier_mult(tier));
    const W = 420;
    const p = panel("panel_parchment", 40, "#ede3c7");
    p.style.width = W + "px";
    p.classList.add("tooltip");
    p.style.zIndex = "75";
    const lines = [];
    lines.push(L.name_of(c));
    lines.push(sprintf(L.t("%s · %d actions · %s"), Txt.cat_name(String(c.cat || "")), int(c.ap, 1), Txt.tier_name(tier)));
    const text = String(c.text || "");
    if (text !== "") lines.push(L.t(text));
    for (const l of Txt.fx_lines(run, c.fx || [], mult)) lines.push("• " + String(l));
    if (mult > 1.0) lines.push(sprintf(L.t("Quality x%.1f"), mult));
    const cost = c.cost || {};
    if (Object.keys(cost).length > 0) lines.push(sprintf(L.t("Cost: %s"), run.cost_text(cost)));
    const ok = run.can_play(i);
    if (!ok.ok) lines.push(sprintf(L.t("Can't play: %s"), String(ok.reason)));
    const body = el("div", "", p);
    body.style.padding = "0 10px";
    body.style.margin = "-4px 0";
    for (let j = 0; j < lines.length; j++) {
      const l = wrap_label(String(lines[j]), j === 0 ? 24 : 19, "#1f170f", W - 90);
      l.style.position = "static";
      l.style.marginBottom = "4px";
      body.appendChild(l);
    }
    add(this.root, p);
    this._tip = p;
    this._tip_index = i;
    // beside the card: above when it fits, else below (the Godot rule)
    const gp = { x: rect.x, y: rect.y };
    const x = clamp(gp.x + rect.w * 0.5 - W * 0.5, 290, 1920 - W - 10);
    let y = Math.max(150, gp.y - 8 - 250);
    const th = p.offsetHeight || 200;
    if (y + 260 > gp.y) y = gp.y > 430 ? gp.y - th - 10 : gp.y + rect.h + 10;
    p.style.left = x + "px";
    p.style.top = y + "px";
  }

  _hide_tip() {
    if (this._tip) this._tip.remove();
    this._tip = null;
    this._tip_index = -1;
  }

  // ---- input ------------------------------------------------------------------------------------------------------------------
  _card_input(i) {
    if (this._busy) return;
    const run = this.run;
    if (this._swap_mode) {
      const h = run.hand[i];
      if (!h || int(h.expires, -1) >= 0 || String(h.id) === "breakthrough") {
        A.sfx("ui_deny");
        return;
      }
      this._swap_mode = false;
      this._hide_tip();
      A.sfx("card_swap");
      const out = run.swap(i);
      this._log(out.lines || []);
      this.main.save_run();
      this._refresh();
      return;
    }
    this._hide_tip();
    const ok = run.can_play(i);
    if (!ok.ok) {
      A.sfx("ui_deny");
      this._toast(String(ok.reason), 2.0);
      return;
    }
    this._play(i);
  }

  async _play(i) {
    if (this._busy) return;
    this._busy = true;
    this.hand.set_enabled(false);
    const { run, D } = this;
    const played = D.card(String(run.hand[i].id));
    if (String(played.id || "") === "breakthrough") A.sfx("card_breakthrough");
    else A.card_category(String(played.cat || ""));
    const out = run.play(i);
    await this.hand.play_out(i);
    if (this._gone) return;
    await this._present(out);
    if (this._gone) return;
    this._busy = false;
    this.main.save_run();
    await this._refresh();
  }

  _toggle_swap() {
    if (this._busy || this.run.swaps_left <= 0) return;
    this._swap_mode = !this._swap_mode;
    this._hide_tip();
    this._refresh();
  }

  async _on_end_term() {
    if (this._busy) return;
    this._busy = true;
    this.hand.set_enabled(false);
    this._hide_tip();
    this._swap_mode = false;
    A.sfx("turn_end");
    const out = this.run.end_term();
    await this._present(out);
    if (this._gone) return;
    A.sfx("turn_new");
    this._busy = false;
    this.main.save_run();
    await this._refresh();
  }

  /** Shows what happened: battles, then events (a chain may run several), then the death / ending screen if the life ended. */
  async _present(out) {
    const { run, main } = this;
    this._log(out.lines || []);
    this._outcome_sounds(out);
    for (const b of out.battles || []) {
      const bv = new BattleView(main, this.modal_layer);
      this.bv = bv;
      await bv.show_battle(b, run.place);
      this.bv = null;
      if (this._gone) return;
    }
    if (run.dead) {
      this._finish();
      return;
    }
    if (!cur_empty(run)) {
      const ev = new EventView(main, this.modal_layer);
      this.ev = ev;
      await ev.open();
      this.ev = null;
      if (this._gone) return;
      this._log([]);
      if (run.dead) {
        this._finish();
        return;
      }
    }
    // an opened shop / library waits for the player
    if (run.shop.length > 0) {
      A.sfx("shop_open");
      await this._shop();
      if (this._gone) return;
    }
    if (run.pending_learn.length > 0) {
      await this._library();
      if (this._gone) return;
    }
    main.set_background(Art.bg(run.place), 0.12);
  }

  /** The run names the sounds an outcome earned (a gain, a hurt, a coin ...); a few of them, a beat apart. */
  _outcome_sounds(out) {
    const ids = out.sfx || [];
    let n = 0;
    for (const id of ids) {
      if (n >= 3) break;
      const delay = 120 * n;
      if (delay === 0) A.sfx(String(id));
      else this.after(delay, () => A.sfx(String(id)));
      n++;
    }
  }

  _finish() {
    this.main.save_run();
    if (this.run.ending_id !== "") this.main.goto("ending");
    else this.main.goto("death");
  }

  /** a toast under the dialogs (the toolkit's sits above everything) */
  _toast(text, secs) {
    const t = toast(this.root, text, secs);
    t.style.zIndex = "30";
    return t;
  }

  // ---- the result strip -------------------------------------------------------------------------------------------------------
  _log(lines) {
    for (const l of lines) this._result_lines.push(String(l));
    if (this._result_lines.length > 40) this._result_lines = this._result_lines.slice(-40);
    const shown = this._result_lines.slice(-6);
    const good = ["+"];
    for (const f of ["Got %s", "REALM: %s +%d lifespan", "Layer up: %s", "Victory over %s"]) good.push(L.t(f).split("%")[0]);
    const bad = ["-"];
    for (const f of ["Defeated by %s. You crawl away wounded.", "Your life ends: %s", "You fall to %s."]) bad.push(L.t(f).split("%")[0]);
    this._result.textContent = "";
    for (const s of shown) {
      let col = "#e8dfc4";
      if (starts_any(s, good)) col = "#a8e0a0";
      else if (starts_any(s, bad)) col = "#f0a090";
      const d = document.createElement("div");
      d.textContent = s;
      d.style.color = col;
      d.style.whiteSpace = "nowrap";
      this._result.appendChild(d);
    }
    this._result.scrollTop = this._result.scrollHeight;
  }

  // ---- panels and overlays ----------------------------------------------------------------------------------------------------
  _open_panel(which) {
    if (this._busy) return;
    switch (which) {
      case "registry":
        this.main.save_run();
        this.main.goto("registry");
        break;
      case "bag":
        this._overlay_open(Overlays.bag(this.main, this), "bag");
        break;
      case "tech":
        this._overlay_open(Overlays.techniques(this.main, this), "tech");
        break;
      case "journal":
        this._overlay_open(Overlays.journal(this.main, this), "journal");
        break;
      default:
    }
  }

  _overlay_open(o, kind = "") {
    if (this._overlay) this._overlay.destroy();
    this._overlay = o;
    this._overlay_kind = kind;
    this.modal_layer.appendChild(o.root);
    this._hide_tip();
    this.hand.set_enabled(false);
    o.closed.then(() => {
      if (this._overlay === o) {
        this._overlay = null;
        this._overlay_kind = "";
      }
    });
  }

  /** called by an overlay's Close button (and Resume) */
  overlay_closed() {
    if (this._overlay) this._overlay.destroy();
    this._overlay = null;
    this._overlay_kind = "";
    if (!this._busy) this.hand.set_enabled(true);
    this._refresh();
  }

  _open_menu() {
    if (this._busy) return;
    this._overlay_open(Overlays.menu(this.main, this), "menu");
  }

  _escape() {
    if (this._gone) return;
    if (this._overlay) {
      if (this._overlay_kind === "library") return;
      this.overlay_closed();
      return;
    }
    this._open_menu();
  }

  async _shop() {
    const o = Overlays.shop(this.main, this);
    this._overlay_open(o, "shop");
    await o.closed;
  }

  async _library() {
    const o = Overlays.library(this.main, this);
    this._overlay_open(o, "library");
    await o.closed;
  }
}

function starts_any(s, prefixes) {
  for (const p of prefixes) if (p !== "" && s.startsWith(p)) return true;
  return false;
}

/** a css colour darkened by a factor (Godot's Color.darkened is a multiply of the channels by 1 - amount) */
function shade_css(hex, f) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return hex;
  const c = [1, 2, 3].map((k) => Math.round(parseInt(m[k], 16) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

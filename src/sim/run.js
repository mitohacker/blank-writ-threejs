// One life (port of scripts/bw_run.gd). Pure logic: state, hand and action points, the effect interpreter, events, battles, realms, death.
// The UI and the bots drive it through: begin / play / swap / end_term / choose / use_item / buy / sell.
//
// Everything returns an Outcome object: {lines: [String], battles: [battle result], sfx: [String], died: bool, ending: String,
// event: bool (an event dialog is now pending)}.
//
// Differences from the GDScript (additions only): to_dict() also carries "rng" (the generator's state) and "current" (the id of the
// event on screen, rebuilt by from_dict), so a saved life resumes exactly; current_is_empty() stands for run.current.is_empty().

import { Battle } from "./battle.js";
import { L } from "./loc.js";
import { RNG } from "./rng.js";
import { sprintf } from "./fmt.js";
import { clampf, clampi, deep_copy, float, get, godot_sort_custom, has, int, is_dict, is_empty, roundi, str } from "./util.js";

export class Run {
  constructor(data, profile, seed_value = 0) {
    this.D = data;
    this.meta = profile;
    this.rng = new RNG();

    // identity
    this.hero_name = "Wuming";
    this.gender = "m";
    this.origin = "orphan";
    this.talent = "";
    this.sect = "none";
    this.place = "village";

    // time
    this.term = 0;
    this.year = 0;
    this.age = 10;
    this.life = 14;

    // progress
    this.realm = 0;
    this.layer = 1;
    this.cult = 0.0;
    this.stats = {};
    this.roots = {};
    this.hp = 100.0;
    this.mp = 40.0;
    this.stone = 0;
    this.mats = { herb: 0, ore: 0, core: 0 };
    this.notice = 0;
    this.corrupt = 0;
    this.rel = {};
    this.flags = {};
    this.kills = 0;
    this.truths_found = [];
    this.new_truths = []; // pages found for the first time ever (these pay imprints)

    // cards
    this.deck = [];
    this.draw_pile = [];
    this.discard = [];
    this.hand = []; // [{id, tier, expires(-1 = no)}]
    this.offers = []; // [{card, expires}]
    this.ap = 2;
    this.ap_bonus = 0; // extra AP this term
    this.swaps_left = 1;

    // inventory / build
    this.bag = {};
    this.equip = { weapon: "", armor: "", charm: "", ring: "" };
    this.techs = []; // learned technique ids
    this.loadout = []; // ordered, used in battle
    this.method = "breath_basic";
    this.rewinds = 0;
    this.bt_fails = 0; // failed breakthroughs since the last success: each adds a pity bonus to the next try

    // story
    this.seen = {};
    this.queued = []; // [{id, due}]
    this.pending_events = [];
    this.current = {}; // the event on screen: {id, event, choices:[...], results, battles}
    this._term_end_flow = false;
    this._chain_depth = 0;
    this._last_flag_fail = false; // the last req_failures() had an unmet run flag (the UI may then show the choice's own hint)
    this.shop = []; // open shop offers [{id, price}]
    this.pending_learn = []; // library choices [{kind, id}]

    // end
    this.dead = false;
    this.death_cause = "";
    this.ending_id = "";
    this.finished_record = {};
    this.log_all = [];

    if (seed_value === 0) this.rng.randomize();
    else this.rng.seed = seed_value;
  }

  /** run.current.is_empty() */
  current_is_empty() {
    return is_empty(this.current);
  }

  // =======================================================================================================================
  // set-up
  // =======================================================================================================================
  begin(origin_id, talent_id, name_value, gender_value = "m") {
    const D = this.D;
    const meta = this.meta;
    const S = get(D.rules, "start", {});
    const o = get(D.origins, origin_id, {});
    const t = get(D.talents, talent_id, {});
    this.hero_name = name_value;
    this.gender = gender_value;
    this.origin = origin_id;
    this.talent = talent_id;
    this.stats = {};
    for (const k of get(D.rules, "stats", [])) this.stats[k] = int(get(S, "stat", 5));
    this.roots = {};
    for (const k of get(D.rules, "roots", [])) this.roots[k] = 0;
    Run._add_dict(this.stats, get(o, "stat", {}));
    Run._add_dict(this.stats, get(t, "stat", {}));
    Run._add_dict(this.stats, meta.effect_dict("stat"));
    Run._add_dict(this.roots, get(o, "root", {}));
    Run._add_dict(this.roots, get(t, "root", {}));
    Run._add_dict(this.roots, meta.effect_dict("root"));
    this.life = int(get(D.realm(0), "life", 14)) + int(get(o, "life", 0)) + int(get(t, "life", 0)) + int(meta.effect_sum("life"));
    this.stone = int(get(S, "stone", 20)) + int(get(o, "stone", 0)) + int(get(t, "stone", 0)) + int(meta.effect_sum("stone"));
    this.place = str(get(o, "place", "village"));
    this.age = 10;
    this.year = 0;
    this.term = 0;
    this.realm = 0;
    this.layer = 1;
    this.cult = 0.0;
    this.flags = {};
    this.flags["origin_" + origin_id] = true;
    for (const f of get(t, "flags", [])) this.flags[str(f)] = true;
    for (const f of get(o, "flags", [])) this.flags[str(f)] = true;
    this.rel = {};
    const orel = get(o, "rel", {});
    for (const k of Object.keys(orel)) this.rel[k] = int(orel[k]);
    // deck
    this.deck = [];
    for (const cid of Object.keys(D.cards)) {
      const c = D.cards[cid];
      if (get(c, "starter", false) === true) {
        const n = int(get(c, "copies", 1));
        for (let i = 0; i < n; i++) this.deck.push(cid);
      }
    }
    const want = int(get(get(D.rules, "run", {}), "start_hand_cards", 10));
    let guard = 0;
    while (this.deck.length < want && has(D.cards, "meditate") && guard++ < 1000) this.deck.push("meditate");
    for (const cid of get(o, "cards", [])) this.deck.push(str(cid));
    for (const cid of get(t, "cards", [])) this.deck.push(str(cid));
    for (const cid of meta.effect_list("cards")) this.deck.push(str(cid));
    this.deck = this.deck.filter((c) => has(D.cards, str(c)));
    // inventory / techniques
    this.bag = {};
    this.equip = { weapon: "", armor: "", charm: "", ring: "" };
    this.techs = [];
    this.loadout = [];
    this.method = "breath_basic";
    for (const iid of get(o, "items", [])) this.give_item(str(iid), 1, []);
    for (const iid of get(t, "items", [])) this.give_item(str(iid), 1, []);
    for (const iid of meta.effect_list("items")) this.give_item(str(iid), 1, []);
    for (const tid of get(t, "techs", [])) this.learn_tech(str(tid));
    for (const tid of meta.effect_list("techs")) this.learn_tech(str(tid));
    this.rewinds = int(meta.effect_sum("revive"));
    this.bt_fails = 0;
    this.mats = { herb: 0, ore: 0, core: 0 };
    this.notice = 0;
    this.corrupt = 0;
    this.kills = 0;
    this.truths_found = [];
    this.new_truths = [];
    this.seen = {};
    this.queued = [];
    this.pending_events = [];
    this.current = {};
    this.offers = [];
    this.hand = [];
    this.draw_pile = [];
    this.discard = [];
    this.dead = false;
    this.death_cause = "";
    this.ending_id = "";
    // the Wheel's "start in Qi Refining"
    if (int(meta.effect_sum("realm")) >= 1) this._enter_realm(1, [], true);
    const d = this.derived();
    this.hp = float(d.max_hp);
    this.mp = float(d.max_mp);
    this._start_term([]);
    // the life's first scene (the origin's intro) is on screen before any card is played
    const ctx = { lines: [], battles: [], tier_mult: 1.0, scaled: false };
    this._fate_draw(ctx, true);
    this._next_pending(ctx);
  }

  static _add_dict(dst, src) {
    for (const k of Object.keys(src)) dst[k] = int(get(dst, k, 0)) + roundi(float(src[k]));
  }

  // =======================================================================================================================
  // derived numbers
  // =======================================================================================================================
  gear_total() {
    const g = {};
    for (const slot of Object.keys(this.equip)) {
      const iid = str(this.equip[slot]);
      if (iid === "") continue;
      const st = get(this.D.item(iid), "stats", {});
      for (const k of Object.keys(st)) g[k] = float(get(g, k, 0.0)) + float(st[k]);
    }
    return g;
  }

  stat_total(k) {
    let v = float(get(this.stats, k, 0)) + float(get(this.gear_total(), k, 0.0));
    const m = get(this.D.methods, this.method, {});
    v += float(get(get(m, "stat", {}), k, 0));
    return v;
  }

  derived() {
    const D = this.D;
    const S = get(D.rules, "start", {});
    const r = D.realm(this.realm);
    const power = float(get(r, "power", 1.0));
    const g = this.gear_total();
    const t = get(D.talents, this.talent, {});
    const m = get(D.methods, this.method, {});
    const body = this.stat_total("body");
    const spirit = this.stat_total("spirit");
    const hp_pct = float(get(t, "hp_pct", 0.0)) + float(get(m, "hp_pct", 0.0));
    const d = {};
    d.max_hp = ((float(get(S, "hp_base", 40)) + body * float(get(S, "hp_per_body", 12))) * power + float(get(g, "hp", 0.0))) * (1.0 + hp_pct);
    d.max_mp = (float(get(S, "mp_base", 20)) + spirit * float(get(S, "mp_per_spirit", 8))) * power + float(get(g, "mp", 0.0));
    d.atk = (float(get(S, "atk_base", 6)) + (body + spirit) * float(get(S, "atk_per", 1.2))) * power + float(get(g, "atk", 0.0));
    d.def = (float(get(S, "def_base", 2)) + body * float(get(S, "def_per_body", 1.5))) * power + float(get(g, "def", 0.0));
    d.spd = float(get(S, "spd_base", 8)) + this.stat_total("speed") * float(get(S, "spd_per", 1.2)) + float(get(g, "spd", 0.0)) + float(this.realm) * 1.5;
    d.crit = float(get(S, "crit_base", 0.05)) + this.stat_total("fortune") * float(get(S, "crit_per_fortune", 0.004)) + float(get(g, "crit", 0.0));
    d.cdmg = float(get(S, "cdmg", 1.5)) + float(get(g, "cdmg", 0.0));
    d.dodge = Math.min(float(get(S, "dodge_cap", 0.4)), this.stat_total("speed") * float(get(S, "dodge_per_speed", 0.008)));
    return d;
  }

  max_hp() {
    return float(this.derived().max_hp);
  }

  max_mp() {
    return float(this.derived().max_mp);
  }

  ap_max() {
    return int(get(this.D.realm(this.realm), "ap", 2)) + int(this.meta.effect_sum("ap")) + this.ap_bonus;
  }

  hand_size() {
    return int(get(get(this.D.rules, "start", {}), "hand", 5)) + int(this.meta.effect_sum("hand"));
  }

  slots() {
    return int(get(this.D.realm(this.realm), "slots", 3));
  }

  years_per_term() {
    return int(get(this.D.realm(this.realm), "years", 1));
  }

  cult_factor() {
    const S = get(this.D.rules, "start", {});
    const m = get(this.D.methods, this.method, {});
    let f = 1.0 + this.stat_total("insight") * float(get(S, "cult_per_insight", 0.06));
    f *= float(get(m, "cult_mult", 1.0));
    const me = str(get(m, "elem", "none"));
    if (me !== "none") f *= 1.0 + float(get(this.roots, me, 0)) * float(get(S, "root_cult", 0.03));
    f *= 1.0 + this.meta.effect_sum("cult") + float(get(get(this.D.talents, this.talent, {}), "cult_mult", 0.0));
    return f;
  }

  gain_scale() {
    return float(get(this.D.realm(this.realm), "gain", 1.0));
  }

  stone_scale() {
    const a = get(this.D.rules, "stone_scale", [1, 1, 2, 4, 8, 16, 16]);
    return float(a[clampi(this.realm, 0, a.length - 1)]);
  }

  layers_of(r) {
    return Math.max(1, int(get(this.D.realm(r), "layers", 1)));
  }

  need_for(r, l) {
    const lm = get(this.D.rules, "layer_mult", [1.0, 1.5, 2.0]);
    return float(get(this.D.realm(r), "need", 0)) * float(lm[clampi(l - 1, 0, lm.length - 1)]);
  }

  need() {
    return this.need_for(this.realm, this.layer);
  }

  breakthrough_ready() {
    return this.realm >= 1 && this.realm <= 4 && this.layer >= this.layers_of(this.realm) && this.cult >= this.need() - 0.001;
  }

  realm_label() {
    return L.realm_label(this.D, this.realm, this.layer);
  }

  notice_rate() {
    const t = get(this.D.talents, this.talent, {});
    return Math.max(0.2, 1.0 + this.meta.effect_sum("notice") + float(get(t, "notice_rate", 0.0)) + float(get(this.gear_total(), "notice", 0.0)));
  }

  // =======================================================================================================================
  // items
  // =======================================================================================================================
  item_count(id) {
    return int(get(this.bag, id, 0));
  }

  bag_size() {
    let n = 0;
    for (const k of Object.keys(this.bag)) n += int(this.bag[k]);
    return n;
  }

  give_item(id, n, lines) {
    if (!has(this.D.items, id)) return;
    this.bag[id] = int(get(this.bag, id, 0)) + n;
    const it = this.D.items[id];
    if (str(get(it, "kind", "")) === "artifact") {
      const slot = str(get(it, "slot", ""));
      const cursed = float(get(get(it, "stats", {}), "corrupt", 0)) > 0.0;
      if (slot !== "" && has(this.equip, slot) && !cursed) {
        const cur = str(this.equip[slot]);
        if (cur === "" || int(get(this.D.item(cur), "q", 1)) < int(get(it, "q", 1))) {
          this.equip[slot] = id;
          lines.push(sprintf(L.t("Equipped %s"), L.name_of(it)));
        }
      }
    }
    lines.push(sprintf(L.t("Got %s"), L.name_of(it)));
  }

  take_item(id, n = 1) {
    if (this.item_count(id) < n) return false;
    this.bag[id] = this.item_count(id) - n;
    if (this.bag[id] <= 0) {
      delete this.bag[id];
      for (const slot of Object.keys(this.equip)) {
        if (this.equip[slot] === id) this.equip[slot] = "";
      }
    }
    return true;
  }

  use_item(id) {
    const out = this._new_outcome();
    const it = this.D.item(id);
    const u = get(it, "use", {});
    if (is_empty(u) || this.item_count(id) <= 0 || str(get(u, "when", "anytime")) === "battle") {
      out.lines.push(L.t("That cannot be used now."));
      return out;
    }
    this.take_item(id, 1);
    const ctx = { lines: out.lines, battles: out.battles, sfx: out.sfx, tier_mult: 1.0, scaled: false };
    out.lines.push(sprintf(L.t("Used %s"), L.name_of(it)));
    this.apply_fx(get(u, "fx", []), ctx);
    this._post_action(ctx);
    this._open_chained(ctx);
    this._finalize(out);
    return out;
  }

  learn_tech(id) {
    if (!has(this.D.techs, id) || this.techs.includes(id)) return;
    this.techs.push(id);
    if (this.loadout.length < this.slots()) this.loadout.push(id);
  }

  // =======================================================================================================================
  // conditions
  // =======================================================================================================================
  has_flag(f) {
    return has(this.flags, f) || this.meta.has_flag(f);
  }

  check_req(req) {
    return this.req_failures(req).length === 0;
  }

  /** The list of unmet conditions as short phrases (empty = all met). Drives the "locked" reasons. */
  req_failures(req) {
    const D = this.D;
    this._last_flag_fail = false;
    const out = [];
    if (!is_dict(req)) return out;
    const r = req;
    for (const k of Object.keys(r)) {
      const v = r[k];
      switch (k) {
        case "realm_min":
          if (this.realm < int(v)) out.push(sprintf(L.t("Realm %s"), L.realm_name(D, int(v))));
          break;
        case "realm_max":
          if (this.realm > int(v)) out.push(L.t("Realm too high"));
          break;
        case "layer_min":
          if (this.layer < int(v)) out.push(sprintf(L.t("Layer %d"), int(v)));
          break;
        case "term_min":
          if (this.term < int(v)) out.push(L.t("Not yet"));
          break;
        case "term_max":
          if (this.term > int(v)) out.push(L.t("Too late"));
          break;
        case "life_min":
          if (this.meta.lives + 1 < int(v)) out.push(L.t("A later life"));
          break;
        case "life_max":
          if (this.meta.lives + 1 > int(v)) out.push(L.t("An earlier life"));
          break;
        case "stats":
          for (const s of Object.keys(v)) {
            if (this.stat_total(str(s)) < float(v[s])) out.push(sprintf(L.t("%s %d"), L.stat_name(D, str(s)), int(v[s])));
          }
          break;
        case "roots":
          for (const s of Object.keys(v)) {
            if (int(get(this.roots, s, 0)) < int(v[s])) out.push(sprintf(L.t("%s root %d"), L.root_name(D, str(s)), int(v[s])));
          }
          break;
        case "flags":
          for (const f of v) {
            if (!this.has_flag(str(f))) {
              this._last_flag_fail = true;
              out.push(sprintf(L.t("Needs: %s"), L.t(this._flag_label(str(f)))));
            }
          }
          break;
        case "not_flags":
          for (const f of v) {
            if (this.has_flag(str(f))) out.push(L.t("Closed"));
          }
          break;
        case "meta":
          for (const f of v) {
            if (!this.meta.has_flag(str(f))) out.push(L.t("A memory you lack"));
          }
          break;
        case "not_meta":
          for (const f of v) {
            if (this.meta.has_flag(str(f))) out.push(L.t("Closed"));
          }
          break;
        case "origin":
          if (!Run._in(this.origin, v)) out.push(L.t("Another origin"));
          break;
        case "sect":
          if (!Run._in(this.sect, v)) out.push(L.t("Another path"));
          break;
        case "place":
          if (!Run._in(this.place, v)) out.push(L.t("Elsewhere"));
          break;
        case "items":
          for (const i of v) {
            if (this.item_count(str(i)) <= 0) out.push(sprintf(L.t("Needs %s"), L.name_of(D.item(str(i)))));
          }
          break;
        case "cards":
          for (const c of v) {
            if (!this.deck.includes(str(c))) out.push(sprintf(L.t("Needs card %s"), L.name_of(D.card(str(c)))));
          }
          break;
        case "techs":
          for (const t of v) {
            if (!this.techs.includes(str(t))) out.push(sprintf(L.t("Needs %s"), L.name_of(D.tech(str(t)))));
          }
          break;
        case "rel":
          for (const c of Object.keys(v)) {
            if (int(get(this.rel, c, 0)) < int(v[c])) out.push(sprintf("%s %d", L.cast_name(str(c)), int(v[c])));
          }
          break;
        case "rel_lt":
          for (const c of Object.keys(v)) {
            if (int(get(this.rel, c, 0)) >= int(v[c])) out.push(L.t("Too close"));
          }
          break;
        case "notice_min":
          if (this.notice < int(v)) out.push(L.t("Not noticed"));
          break;
        case "notice_max":
          if (this.notice > int(v)) out.push(L.t("Too noticed"));
          break;
        case "corrupt_min":
          if (this.corrupt < int(v)) out.push(sprintf(L.t("Corruption %d"), int(v)));
          break;
        case "corrupt_max":
          if (this.corrupt > int(v)) out.push(L.t("Too corrupt"));
          break;
        case "stone_min":
          if (this.stone < int(v)) out.push(sprintf(L.t("%d stones"), int(v)));
          break;
        case "mats":
          for (const m of Object.keys(v)) {
            if (int(get(this.mats, m, 0)) < int(v[m])) out.push(sprintf("%d %s", int(v[m]), L.t(str(m))));
          }
          break;
        case "any": {
          let ok = false;
          for (const sub of v) {
            if (this.check_req(sub)) {
              ok = true;
              break;
            }
          }
          if (!ok) out.push(L.t("None of the ways open"));
          break;
        }
        default:
      }
    }
    return out;
  }

  /** GDScript `x in v` for an Array (membership) or a Dictionary (key) */
  static _in(x, v) {
    if (Array.isArray(v)) return v.includes(x);
    if (is_dict(v)) return has(v, x);
    return false;
  }

  _flag_label(f) {
    const m = get(this.D.rules, "flag_labels", {});
    if (has(m, f)) return str(m[f]);
    return f.split("_").join(" ");
  }

  _can_pay(cost) {
    for (const k of Object.keys(cost)) {
      const v = cost[k];
      switch (k) {
        case "stone":
          if (this.stone < int(v)) return sprintf(L.t("%d stones"), int(v));
          break;
        case "herb":
        case "ore":
        case "core":
          if (int(get(this.mats, k, 0)) < int(v)) return sprintf("%d %s", int(v), L.t(str(k)));
          break;
        case "hp":
          if (this.hp <= float(v)) return L.t("too weak");
          break;
        case "item":
          if (this.item_count(str(v)) <= 0) return L.name_of(this.D.item(str(v)));
          break;
        default:
      }
    }
    return "";
  }

  _pay(cost, lines) {
    for (const k of Object.keys(cost)) {
      const v = cost[k];
      switch (k) {
        case "stone":
          this.stone -= int(v);
          lines.push(sprintf(L.t("-%d stones"), int(v)));
          break;
        case "herb":
        case "ore":
        case "core":
          this.mats[k] = int(get(this.mats, k, 0)) - int(v);
          lines.push(sprintf("-%d %s", int(v), L.t(str(k))));
          break;
        case "hp":
          this.hp = Math.max(1.0, this.hp - float(v));
          lines.push(sprintf(L.t("-%d HP"), int(v)));
          break;
        case "item":
          this.take_item(str(v), 1);
          lines.push(sprintf(L.t("Spent %s"), L.name_of(this.D.item(str(v)))));
          break;
        default:
      }
    }
  }

  cost_text(cost) {
    const parts = [];
    for (const k of Object.keys(cost)) {
      if (k === "item") parts.push(L.name_of(this.D.item(str(cost[k]))));
      else parts.push(sprintf("%d %s", int(cost[k]), L.t(str(k))));
    }
    return parts.join(", ");
  }

  // =======================================================================================================================
  // outcomes
  // =======================================================================================================================
  _new_outcome() {
    return { lines: [], battles: [], sfx: [], died: false, ending: "", event: false };
  }

  _finalize(out) {
    out.died = this.dead;
    out.ending = this.ending_id;
    out.event = !is_empty(this.current);
    for (const l of out.lines) this.log_all.push(l);
    if (this.log_all.length > 200) this.log_all = this.log_all.slice(this.log_all.length - 200);
  }

  _log(ctx, line) {
    ctx.lines.push(line);
  }

  /** A sound the UI plays for this outcome (ids from assets/audio/audio.json), each at most once. */
  _snd(ctx, id) {
    if (has(ctx, "sfx") && !ctx.sfx.includes(id)) ctx.sfx.push(id);
  }

  // =======================================================================================================================
  // hand and cards
  // =======================================================================================================================
  roll_tier() {
    const T = get(this.D.rules, "tiers", {});
    const odds = get(T, "odds", [60, 28, 10, 2]).slice();
    const shift = this.stat_total("fortune") * float(get(T, "fortune_shift", 0.8)) + float(this.meta.effect_sum("tier")) * 8.0;
    const take = Math.min(shift, float(odds[0]) - 5.0);
    odds[0] = float(odds[0]) - take;
    odds[1] = float(odds[1]) + take * 0.55;
    odds[2] = float(odds[2]) + take * 0.3;
    odds[3] = float(odds[3]) + take * 0.15;
    let total = 0.0;
    for (const o of odds) total += float(o);
    let r = this.rng.randf() * total;
    for (let i = 0; i < odds.length; i++) {
      r -= float(odds[i]);
      if (r <= 0.0) return i;
    }
    return 0;
  }

  tier_mult(t) {
    const a = get(get(this.D.rules, "tiers", {}), "mult", [1.0, 1.4, 1.9, 2.8]);
    return float(a[clampi(t, 0, a.length - 1)]);
  }

  _draw_one() {
    if (this.draw_pile.length === 0) {
      this.draw_pile = this.discard.slice();
      this.discard = [];
      this._shuffle(this.draw_pile);
    }
    if (this.draw_pile.length === 0) return "";
    return str(this.draw_pile.pop());
  }

  _shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.rng.randi_range(0, i);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }

  _start_term(lines) {
    const D = this.D;
    this.term += 1;
    this.ap_bonus = 0;
    this.ap = this.ap_max();
    this.swaps_left = int(get(get(D.rules, "start", {}), "swap", 1)) + int(this.meta.effect_sum("swap"));
    // unspent hand goes to the discard
    for (const h of this.hand) {
      if (str(h.id) !== "breakthrough" && int(get(h, "expires", -1)) < 0) this.discard.push(h.id);
    }
    this.hand = [];
    if (this.draw_pile.length === 0 && this.discard.length === 0) {
      this.draw_pile = this.deck.slice();
      this._shuffle(this.draw_pile);
    }
    const n = this.hand_size();
    let tries = 0;
    while (this.hand.length < n && tries < n * 6) {
      tries += 1;
      const cid = this._draw_one();
      if (cid === "") break;
      const c = D.card(cid);
      if (!this.check_req(get(c, "req", {}))) {
        this.discard.push(cid);
        continue;
      }
      this.hand.push({ id: cid, tier: this.roll_tier(), expires: -1 });
    }
    // chance offers ride on top of the drawn hand
    const keep = [];
    for (const o of this.offers) {
      this.hand.push({ id: o.card, tier: 0, expires: int(o.expires) });
      o.expires = int(o.expires) - 1;
      if (int(o.expires) > 0) keep.push(o);
    }
    this.offers = keep;
    if (this.breakthrough_ready() && has(D.cards, "breakthrough")) {
      this.hand.push({ id: "breakthrough", tier: 0, expires: -1 });
      lines.push(L.t("The way forward opens: Breakthrough"));
    }
  }

  card_in_hand(i) {
    if (i < 0 || i >= this.hand.length) return {};
    return this.D.card(str(this.hand[i].id));
  }

  can_play(i) {
    if (this.dead || !is_empty(this.current)) return { ok: false, reason: L.t("Resolve the event first") };
    const c = this.card_in_hand(i);
    if (is_empty(c)) return { ok: false, reason: L.t("No card") };
    if (this.ap < int(get(c, "ap", 1))) return { ok: false, reason: L.t("Not enough actions") };
    const f = this.req_failures(get(c, "req", {}));
    if (f.length > 0) return { ok: false, reason: str(f[0]) };
    const pay = this._can_pay(get(c, "cost", {}));
    if (pay !== "") return { ok: false, reason: sprintf(L.t("Needs %s"), pay) };
    return { ok: true, reason: "" };
  }

  play(i) {
    const out = this._new_outcome();
    const ok = this.can_play(i);
    if (!ok.ok) {
      out.lines.push(str(ok.reason));
      return out;
    }
    const h = this.hand[i];
    const c = this.D.card(str(h.id));
    const ctx = {
      lines: out.lines, battles: out.battles, sfx: out.sfx, tier_mult: this.tier_mult(int(h.tier)),
      scaled: get(c, "scale", true) === true, card: str(get(c, "id", "")),
    };
    this.ap -= int(get(c, "ap", 1));
    this._pay(get(c, "cost", {}), out.lines);
    const cid = str(c.id);
    this.hand.splice(i, 1);
    if (int(get(h, "expires", -1)) < 0 && cid !== "breakthrough") {
      this.discard.push(cid);
    } else if (int(get(h, "expires", -1)) >= 0) {
      for (let k = 0; k < this.offers.length; k++) {
        if (str(this.offers[k].card) === cid) {
          this.offers.splice(k, 1);
          break;
        }
      }
    }
    out.lines.push(L.name_of(c));
    // cards with engine behaviour of their own
    switch (cid) {
      case "breakthrough":
        this._breakthrough(ctx);
        break;
      case "market":
        this._open_shop(ctx);
        this.apply_fx(get(c, "fx", []), ctx);
        break;
      case "library":
        this._open_library(ctx);
        this.apply_fx(get(c, "fx", []), ctx);
        break;
      default:
        this.apply_fx(get(c, "fx", []), ctx);
    }
    this._post_action(ctx);
    this._open_chained(ctx);
    this._finalize(out);
    return out;
  }

  _open_chained(ctx) {
    const chained = str(get(ctx, "chain", ""));
    ctx.chain = "";
    if (chained !== "" && !this.dead && is_empty(this.current)) this._open_event(chained, ctx);
  }

  swap(i) {
    const out = this._new_outcome();
    if (this.swaps_left <= 0 || i < 0 || i >= this.hand.length || int(get(this.hand[i], "expires", -1)) >= 0 || str(this.hand[i].id) === "breakthrough") {
      return out;
    }
    this.swaps_left -= 1;
    const old = str(this.hand[i].id);
    this.discard.push(old);
    let tries = 0;
    while (tries < 8) {
      tries += 1;
      const cid = this._draw_one();
      if (cid === "") break;
      if (this.check_req(get(this.D.card(cid), "req", {}))) {
        this.hand[i] = { id: cid, tier: this.roll_tier(), expires: -1 };
        out.lines.push(sprintf(L.t("Swapped %s for %s"), L.name_of(this.D.card(old)), L.name_of(this.D.card(cid))));
        return out;
      }
      this.discard.push(cid);
    }
    return out;
  }

  _post_action(ctx) {
    this._check_layers(ctx);
    this._clamp_vitals();
    if (!this.dead && this.notice >= int(get(get(this.D.rules, "notice", {}), "hunt", 100))) this._hunted(ctx);
  }

  _clamp_vitals() {
    this.hp = clampf(this.hp, this.dead ? 0.0 : 1.0, this.max_hp());
    this.mp = clampf(this.mp, 0.0, this.max_mp());
    this.notice = clampi(this.notice, 0, 100);
    this.corrupt = clampi(this.corrupt, 0, 100);
    if (this.corrupt >= 30) this.flags.corrupt_30 = true;
    if (this.corrupt >= 70) this.flags.corrupt_70 = true;
    if (this.notice >= 40) this.flags.inspector_40 = true;
    if (this.notice >= 70) this.flags.inspector_70 = true;
  }

  // =======================================================================================================================
  // the term's end
  // =======================================================================================================================
  end_term() {
    const out = this._new_outcome();
    if (this.dead || !is_empty(this.current)) return out;
    const D = this.D;
    const ctx = { lines: out.lines, battles: out.battles, sfx: out.sfx, tier_mult: 1.0, scaled: false };
    // upkeep
    const m = get(D.methods, this.method, {});
    const passive = float(get(m, "passive_cult", 0.0));
    if (passive > 0.0) this._gain_cult(passive * this.gain_scale(), ctx);
    const d = this.derived();
    this.hp = Math.min(float(d.max_hp), this.hp + float(d.max_hp) * 0.05);
    this.mp = float(d.max_mp);
    this.notice = Math.max(0, this.notice - int(get(get(D.rules, "notice", {}), "decay_per_term", 1)));
    const curse = roundi(float(get(this.gear_total(), "corrupt", 0.0)));
    if (curse > 0) {
      this.corrupt = clampi(this.corrupt + curse, 0, 100);
      this._log(ctx, sprintf(L.t("Your cursed gear whispers: corruption +%d"), curse));
      if (this.corrupt >= 100) this._die("heart_demon", ctx);
    }
    this.life -= 1;
    this.year += this.years_per_term();
    this.age += this.years_per_term();
    this._check_layers(ctx);
    this._clamp_vitals();
    if (this.life <= 0) {
      this._die("old_age", ctx);
      this._finalize(out);
      return out;
    }
    if (this.life <= 2) this._log(ctx, sprintf(L.t("Your lifespan is nearly spent (%d terms left)."), this.life));
    if (this.notice >= int(get(get(D.rules, "notice", {}), "hunt", 100))) {
      this._hunted(ctx);
      if (this.dead) {
        this._finalize(out);
        return out;
      }
    }
    this._fate_draw(ctx);
    this._term_end_flow = true;
    if (!this._next_pending(ctx)) {
      this._term_end_flow = false;
      this._start_term(out.lines);
    }
    this._finalize(out);
    return out;
  }

  _hunted(ctx) {
    this.flags.hunted = true;
    // a Golden Core cultivator meets the Magistrate in the story (a3_hunt); before that the clerks simply close in
    if (this.realm >= 3 && has(this.D.events, "a3_hunt") && !has(this.seen, "a3_hunt")) {
      this.notice = 80;
      return;
    }
    const chance = 0.3 + this.stat_total("speed") * 0.02 + this.stat_total("insight") * 0.01;
    this._log(ctx, L.t("The Registry's list has your name. Clerks close in."));
    if (this.rng.randf() < chance) {
      this._log(ctx, L.t("You slip the net, but hiding costs you years."));
      this.notice = 60;
      this.life = Math.max(1, this.life - 2);
    } else {
      this._die("struck", ctx);
    }
  }

  _fate_draw(ctx, story_only = false) {
    const D = this.D;
    // 1. queued story events that are due
    godot_sort_custom(this.queued, (a, b) => int(a.due) < int(b.due));
    for (let qi = 0; qi < this.queued.length; qi++) {
      const q = this.queued[qi];
      if (int(q.due) <= this.term && has(D.events, str(q.id))) {
        this.queued.splice(qi, 1);
        this.pending_events.push(str(q.id));
        return;
      }
    }
    // 2. the best eligible story event
    for (const id of D.story_ids) {
      const e = D.events[id];
      if (has(this.seen, id) && get(e, "repeat", false) !== true) continue;
      if (get(e, "once_ever", false) === true && this.meta.has_flag("seen_" + id)) continue;
      if (this.check_req(get(e, "req", {}))) {
        this.pending_events.push(id);
        return;
      }
    }
    // 3. a random event (and sometimes a second)
    if (story_only) return;
    let picks = 1;
    if (this.rng.randf() < float(get(get(D.rules, "story", {}), "second_event_chance", 0.25))) picks = 2;
    for (let p = 0; p < picks; p++) {
      const id = this._pick_random();
      if (id !== "" && !this.pending_events.includes(id)) this.pending_events.push(id);
    }
  }

  _pick_random() {
    const D = this.D;
    const pool = [];
    let total = 0.0;
    for (const id of D.random_ids) {
      const e = D.events[id];
      if (get(e, "once", false) === true && has(this.seen, id)) continue;
      if (get(e, "once_ever", false) === true && this.meta.has_flag("seen_" + id)) continue;
      if (!this.check_req(get(e, "req", {}))) continue;
      if (has(e, "chance") && this.rng.randf() > float(e.chance)) continue;
      const w = float(get(e, "weight", 1.0));
      pool.push([id, w]);
      total += w;
    }
    if (pool.length === 0) return "";
    let r = this.rng.randf() * total;
    for (const p of pool) {
      r -= float(p[1]);
      if (r <= 0.0) return str(p[0]);
    }
    return str(pool[pool.length - 1][0]);
  }

  /** Shows the next pending event. Returns true when an event dialog is now current. */
  _next_pending(ctx) {
    let guard = 0;
    while (this.pending_events.length > 0 && guard++ < 1000) {
      const id = str(this.pending_events.shift());
      if (this._open_event(id, ctx)) return true;
    }
    return false;
  }

  _open_event(id, ctx) {
    if (!has(this.D.events, id)) return false;
    const e = this.D.events[id];
    this.seen[id] = true;
    if (get(e, "once_ever", false) === true) this.meta.set_flag("seen_" + id);
    const choices = [];
    const ch = get(e, "choices", []);
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      const fails = this.req_failures(get(c, "req", {}));
      const flag_gate = this._last_flag_fail;
      const pay = this._can_pay(get(c, "cost", {}));
      const locked = fails.length > 0 || pay !== "";
      let reason = "";
      if (fails.length > 0) {
        reason = fails.join(", ");
        if (flag_gate && str(get(c, "hint", "")) !== "") reason = L.t(str(c.hint));
      } else if (pay !== "") {
        reason = sprintf(L.t("Needs %s"), pay);
      }
      choices.push({
        i,
        label: L.t(str(get(c, "label", "..."))),
        hint: L.t(str(get(c, "hint", ""))),
        locked,
        reason,
        cost: this.cost_text(get(c, "cost", {})),
      });
    }
    this.current = { id, event: e, choices, results: [], battles: [] };
    return true;
  }

  choose(ci) {
    const out = this._new_outcome();
    if (is_empty(this.current)) return out;
    const e = this.current.event;
    const choices = this.current.choices;
    if (ci < 0 || ci >= choices.length || choices[ci].locked === true) {
      out.lines.push(L.t("That way is closed."));
      out.event = true;
      return out;
    }
    const c = e.choices[ci];
    const ctx = { lines: out.lines, battles: out.battles, sfx: out.sfx, tier_mult: 1.0, scaled: false, chain: "" };
    this.current = {};
    this._pay(get(c, "cost", {}), out.lines);
    this.apply_fx(get(c, "fx", []), ctx);
    if (has(c, "after")) out.lines.push(L.t(str(c.after)));
    this._post_action(ctx);
    if (this.dead) {
      this._finalize(out);
      return out;
    }
    // chained event, then the rest of the pending queue, then (if this was a term end) the next term
    const chained = str(get(ctx, "chain", ""));
    if (chained !== "" && this._chain_depth < 8) {
      this._chain_depth += 1;
      if (this._open_event(chained, ctx)) {
        this._finalize(out);
        return out;
      }
    }
    this._chain_depth = 0;
    if (this._next_pending(ctx)) {
      this._finalize(out);
      return out;
    }
    if (this._term_end_flow) {
      this._term_end_flow = false;
      this._start_term(out.lines);
    }
    this._finalize(out);
    return out;
  }

  // =======================================================================================================================
  // the effect interpreter
  // =======================================================================================================================
  apply_fx(fx, ctx) {
    if (!Array.isArray(fx)) return;
    for (const o of fx) {
      if (this.dead) return;
      if (!is_dict(o)) continue;
      this._apply_op(o, ctx);
    }
  }

  _scaled(v, ctx) {
    return v * (get(ctx, "scaled", false) === true ? float(get(ctx, "tier_mult", 1.0)) : 1.0);
  }

  _apply_op(o, ctx) {
    const D = this.D;
    const op = str(get(o, "op", ""));
    switch (op) {
      case "stat": {
        const k = str(get(o, "k", ""));
        let v = roundi(this._scaled(float(get(o, "v", 0)), ctx));
        if (v === 0 && float(get(o, "v", 0)) !== 0.0) v = float(get(o, "v", 0)) > 0 ? 1 : -1;
        this.stats[k] = Math.max(1, int(get(this.stats, k, 5)) + v);
        if (v > 0) this._snd(ctx, "stat_up");
        this._log(ctx, sprintf(L.t("%s %+d"), L.stat_name(D, k), v));
        break;
      }
      case "root": {
        const k = str(get(o, "k", ""));
        this.roots[k] = clampi(int(get(this.roots, k, 0)) + int(get(o, "v", 0)), 0, 9);
        if (int(get(o, "v", 0)) > 0) this._snd(ctx, "stat_up");
        this._log(ctx, sprintf(L.t("%s root %+d"), L.root_name(D, k), int(get(o, "v", 0))));
        break;
      }
      case "cult": {
        let v = float(get(o, "v", 0)) * this.gain_scale();
        if (str(get(o, "scale", "")) === "insight") v *= this.cult_factor();
        v = this._scaled(v, ctx);
        this._gain_cult(v, ctx);
        break;
      }
      case "hp": {
        let v = float(get(o, "v", 0)) * float(get(D.realm(this.realm), "power", 1.0));
        v = v > 0 ? this._scaled(v, ctx) : v;
        this.hp = clampf(this.hp + v, 1.0, this.max_hp());
        if (v < 0.0) this._snd(ctx, "hurt");
        this._log(ctx, sprintf(L.t("%+d HP"), roundi(v)));
        break;
      }
      case "mp": {
        const v = this._scaled(float(get(o, "v", 0)) * float(get(D.realm(this.realm), "power", 1.0)), ctx);
        this.mp = clampf(this.mp + v, 0.0, this.max_mp());
        break;
      }
      case "hp_pct": {
        const v = float(get(o, "v", 0));
        this.hp = clampf(this.hp + this.max_hp() * v, 1.0, this.max_hp());
        if (v < -0.04) this._snd(ctx, "hurt");
        this._log(ctx, sprintf(L.t("%+d%% HP"), roundi(v * 100.0)));
        break;
      }
      case "mp_pct":
        this.mp = clampf(this.mp + this.max_mp() * float(get(o, "v", 0)), 0.0, this.max_mp());
        break;
      case "life": {
        const v = int(get(o, "v", 0));
        this.life += v;
        this._log(ctx, Math.abs(v) === 1 ? sprintf(L.t("Lifespan %+d term"), v) : sprintf(L.t("Lifespan %+d terms"), v));
        if (this.life <= 0) this._die("old_age", ctx);
        break;
      }
      case "stone": {
        let v = float(get(o, "v", 0));
        if (get(o, "raw", false) !== true) v *= this.stone_scale();
        v = this._scaled(v, ctx);
        this.stone = Math.max(0, this.stone + roundi(v));
        if (v > 0.0) this._snd(ctx, "coin");
        this._log(ctx, sprintf(L.t("%+d stones"), roundi(v)));
        break;
      }
      case "mat": {
        const k = str(get(o, "k", "herb"));
        const v = roundi(this._scaled(float(get(o, "v", 0)), ctx));
        this.mats[k] = Math.max(0, int(get(this.mats, k, 0)) + v);
        this._log(ctx, sprintf("%+d %s", v, L.t(str(k))));
        break;
      }
      case "item":
        this.give_item(str(get(o, "id", "")), int(get(o, "n", 1)), ctx.lines);
        this._snd(ctx, "item_get");
        break;
      case "unitem":
        this.take_item(str(get(o, "id", "")), int(get(o, "n", 1)));
        break;
      case "card": {
        const cid = str(get(o, "id", ""));
        if (has(D.cards, cid)) {
          this.deck.push(cid);
          this._log(ctx, sprintf(L.t("New card: %s"), L.name_of(D.cards[cid])));
        }
        break;
      }
      case "uncard": {
        const idx = this.deck.indexOf(str(get(o, "id", "")));
        if (idx >= 0) this.deck.splice(idx, 1);
        break;
      }
      case "upgrade": {
        const cid = str(get(o, "id", ""));
        const up = str(get(D.card(cid), "upgrades_to", ""));
        const idx = this.deck.indexOf(cid);
        if (idx >= 0 && up !== "" && has(D.cards, up)) {
          this.deck[idx] = up;
          this._log(ctx, sprintf(L.t("%s grows into %s"), L.name_of(D.card(cid)), L.name_of(D.card(up))));
        }
        break;
      }
      case "offer": {
        const cid = str(get(o, "card", ""));
        if (has(D.cards, cid)) {
          this.offers.push({ card: cid, expires: int(get(o, "expires", get(get(D.rules, "story", {}), "offer_expires", 2))) });
          this._log(ctx, sprintf(L.t("An opportunity: %s"), L.name_of(D.cards[cid])));
        }
        break;
      }
      case "tech": {
        const tid = str(get(o, "id", ""));
        if (has(D.techs, tid) && !this.techs.includes(tid)) {
          this.learn_tech(tid);
          this._log(ctx, sprintf(L.t("Learned %s"), L.name_of(D.techs[tid])));
        }
        break;
      }
      case "method": {
        const mid = str(get(o, "id", ""));
        if (has(D.methods, mid)) {
          this.method = mid;
          this._log(ctx, sprintf(L.t("Method: %s"), L.name_of(D.methods[mid])));
        }
        break;
      }
      case "flag":
        this.flags[str(get(o, "k", ""))] = true;
        break;
      case "unflag":
        delete this.flags[str(get(o, "k", ""))];
        break;
      case "meta":
        this.meta.set_flag(str(get(o, "k", "")));
        break;
      case "truth": {
        const tid = str(get(o, "id", ""));
        if (!this.meta.has_flag(tid) || !this.truths_found.includes(tid)) {
          if (!this.truths_found.includes(tid)) this.truths_found.push(tid);
          const fresh = !this.meta.has_flag(tid);
          if (fresh && !this.new_truths.includes(tid)) {
            this.new_truths.push(tid);
            this._snd(ctx, "truth");
          }
          this.meta.set_flag(tid);
          this.flags[tid] = true;
          const tr = get(D.truths, tid, {});
          if (fresh) this._log(ctx, sprintf(L.t("A torn page of the writ: %s"), L.name_of(tr)));
        }
        break;
      }
      case "rel": {
        const k = str(get(o, "k", ""));
        this.rel[k] = clampi(int(get(this.rel, k, 0)) + int(get(o, "v", 0)), -5, 10);
        if (int(get(o, "v", 0)) > 0) this._snd(ctx, "bond");
        this._log(ctx, sprintf("%s %+d", L.cast_name(k), int(get(o, "v", 0))));
        break;
      }
      case "notice": {
        let v = float(get(o, "v", 0));
        if (v > 0) v *= this.notice_rate();
        this.notice = clampi(this.notice + roundi(v), 0, 100);
        if (v >= 4.0) this._snd(ctx, "notice");
        if (Math.abs(v) >= 1.0) this._log(ctx, sprintf(L.t("Notice %+d"), roundi(v)));
        break;
      }
      case "corrupt":
        this.corrupt = clampi(this.corrupt + int(get(o, "v", 0)), 0, 100);
        this._log(ctx, sprintf(L.t("Corruption %+d"), int(get(o, "v", 0))));
        if (this.corrupt >= 100) this._die("heart_demon", ctx);
        break;
      case "place":
        this.place = str(get(o, "k", this.place));
        break;
      case "sect":
        this.sect = str(get(o, "id", "none"));
        this.flags["sect_" + this.sect] = true;
        this._log(ctx, sprintf(L.t("You join a path: %s"), L.t(str(get(get(this.D.rules, "flag_labels", {}), "sect_" + this.sect, this.sect)))));
        break;
      case "ap":
        this.ap += int(get(o, "v", 0));
        if (this.ap < 0) this.ap = 0;
        break;
      case "battle":
        this._battle(o, ctx);
        break;
      case "roll": {
        const stat = str(get(o, "stat", "insight"));
        const sv = stat !== "luck" ? this.stat_total(stat) : this.stat_total("fortune");
        const chance = clampf(50.0 + (sv - float(get(o, "dc", 5))) * 6.0, 5.0, 95.0);
        const r = this.rng.randf() * 100.0;
        if (r <= chance / 5.0 && has(o, "crit")) {
          this._log(ctx, L.t("A perfect result."));
          this.apply_fx(get(o, "crit", []), ctx);
        } else if (r <= chance) {
          this.apply_fx(get(o, "pass", []), ctx);
        } else {
          this.apply_fx(get(o, "fail", []), ctx);
        }
        break;
      }
      case "rand": {
        const opts = get(o, "opts", []);
        let total = 0.0;
        for (const op2 of opts) total += float(get(op2, "w", 1));
        let r2 = this.rng.randf() * total;
        for (const op2 of opts) {
          r2 -= float(get(op2, "w", 1));
          if (r2 <= 0.0) {
            this.apply_fx(get(op2, "fx", []), ctx);
            break;
          }
        }
        break;
      }
      case "if":
        if (this.check_req(get(o, "req", {}))) this.apply_fx(get(o, "then", []), ctx);
        else this.apply_fx(get(o, "else", []), ctx);
        break;
      case "event":
        ctx.chain = str(get(o, "id", ""));
        break;
      case "queue":
        this.queued.push({ id: str(get(o, "id", "")), due: this.term + Math.max(0, int(get(o, "delay", 1))) });
        break;
      case "text":
        this._log(ctx, L.t(str(get(o, "t", ""))));
        break;
      case "die":
        this._die(str(get(o, "cause", "slain")), ctx);
        break;
      case "ending":
        this.ending_id = str(get(o, "id", ""));
        this._snd(ctx, "ending");
        this._log(ctx, sprintf(L.t("ENDING: %s"), L.name_of(get(D.endings, this.ending_id, {}))));
        this._die("ending", ctx);
        break;
      default:
    }
  }

  // =======================================================================================================================
  // cultivation, realms
  // =======================================================================================================================
  _gain_cult(v, ctx) {
    if (v <= 0.0) return;
    this.cult += v;
    this._snd(ctx, "gain");
    this._log(ctx, sprintf(L.t("+%d cultivation"), roundi(v)));
    this._check_layers(ctx);
  }

  _check_layers(ctx) {
    let guard = 0;
    while (guard < 12) {
      guard += 1;
      const n = this.need();
      if (n <= 0.0) return;
      if (this.cult + 0.001 < n) return;
      if (this.realm === 0) {
        this.cult -= n;
        this._enter_realm(1, ctx.lines, false);
        this._snd(ctx, "realm_up");
        continue;
      }
      if (this.layer < this.layers_of(this.realm)) {
        this.cult -= n;
        this.layer += 1;
        this._snd(ctx, "layer_up");
        this._log(ctx, sprintf(L.t("Layer up: %s"), this.realm_label()));
        const d = this.derived();
        this.hp = Math.min(float(d.max_hp), this.hp + float(d.max_hp) * 0.2);
        continue;
      }
      this.cult = n; // full; waiting for the Breakthrough card
      return;
    }
  }

  _enter_realm(r, lines, silent) {
    const D = this.D;
    const rd = D.realm(r);
    this.realm = r;
    this.layer = 1;
    this.cult = 0.0;
    this.life += int(get(rd, "life", 0));
    const gains = get(D.rules, "realm_stat_gain", { body: 2, spirit: 2, insight: 1, speed: 1, heart: 1 });
    for (const k of Object.keys(gains)) this.stats[k] = int(get(this.stats, k, 5)) + int(gains[k]);
    const d = this.derived();
    this.hp = float(d.max_hp);
    this.mp = float(d.max_mp);
    let guard = 0;
    while (this.loadout.length < this.slots() && this.loadout.length < this.techs.length && guard++ < 100) {
      let added = false;
      for (const t of this.techs) {
        if (!this.loadout.includes(t)) {
          this.loadout.push(t);
          added = true;
          break;
        }
      }
      if (!added) break;
    }
    if (!silent) lines.push(sprintf(L.t("REALM: %s +%d lifespan"), L.name_of(rd), int(get(rd, "life", 0))));
    if (r >= 2) this.flags["act_" + r] = true;
  }

  breakthrough_chance() {
    const B = get(this.D.rules, "breakthrough", {});
    let chance = float(get(B, "base", 0.4)) + this.stat_total("insight") * float(get(B, "per_insight", 0.012)) + this.stat_total("heart") * float(get(B, "per_heart", 0.008));
    if (has(this.flags, "bt_pill")) chance += 0.2;
    chance += float(this.meta.effect_sum("breakthrough"));
    chance += Math.min(0.3, 0.1 * float(this.bt_fails));
    return clampf(chance, float(get(B, "min", 0.15)), float(get(B, "max", 0.95)));
  }

  tribulation_ahead() {
    return get(this.D.realm(this.realm + 1), "tribulation", false) === true;
  }

  _breakthrough(ctx) {
    const D = this.D;
    if (!this.breakthrough_ready()) {
      this._log(ctx, L.t("Not ready."));
      return;
    }
    const B = get(D.rules, "breakthrough", {});
    const chance = this.breakthrough_chance();
    if (has(this.flags, "bt_pill")) delete this.flags.bt_pill;
    this._log(ctx, sprintf(L.t("Breakthrough: %d%% chance"), roundi(chance * 100.0)));
    if (this.rng.randf() <= chance) {
      this.bt_fails = 0;
      const nxt = this.realm + 1;
      this._enter_realm(nxt, ctx.lines, false);
      this._snd(ctx, "realm_up");
      delete this.flags.breakthrough_failed;
      if (get(D.realm(nxt), "tribulation", false) === true) {
        let tid = "tribulation_core";
        if (nxt === 4) tid = "tribulation_nascent";
        else if (nxt >= 5) tid = "tribulation_spirit";
        if (has(D.enemies, tid)) {
          this._log(ctx, L.t("The sky darkens: tribulation."));
          this._battle({ enemy: tid, lethal: true, scale: 1.0, tribulation: true }, ctx);
          if (!this.dead) this.flags.tribulation_passed = true;
        }
      }
    } else {
      this.flags.breakthrough_failed = true;
      this._snd(ctx, "bt_fail");
      this.bt_fails += 1;
      this.hp = Math.max(1.0, this.max_hp() * float(get(B, "fail_hp_pct", 0.3)));
      this.cult = this.need() * (1.0 - float(get(B, "fail_cult_loss", 0.25)));
      this._log(ctx, L.t("The breakthrough fails. You are wounded and lose ground."));
      if (this.rng.randf() < float(get(B, "demon_chance", 0.2))) {
        this._log(ctx, L.t("A heart-demon rises in the dark."));
        this._snd(ctx, "heart_demon");
        this._heart_demon(ctx);
      }
    }
  }

  _heart_demon(ctx) {
    const d = this.derived();
    const shadow = {
      name: "heart_demon", zh: "心魔", en: "Heart-demon", hp: float(d.max_hp) * 0.8, hp_max: float(d.max_hp) * 0.8,
      mp: float(d.max_mp) * 0.5, mp_max: float(d.max_mp) * 0.5, atk: float(d.atk) * 0.8, def: float(d.def) * 0.8,
      spd: float(d.spd), crit: 0.05, cdmg: 1.5, dodge: 0.0, elem: "none", skills: [], art: "en_ghost",
    };
    const pu = this._player_unit();
    const enemy_u = Battle.make_unit("heart_demon", "e", shadow);
    const res = Battle.simulate(pu, enemy_u, this.rng, this.D.rules, []);
    res.enemy_id = "heart_demon";
    res.enemy_name = L.t("Heart-demon");
    res.enemy_en = "Heart-demon";
    res.enemy_zh = "心魔";
    res.enemy_art = "en_heart_demon";
    ctx.battles.push(res);
    this.hp = Math.max(1.0, float(res.p_hp));
    if (res.win !== true) {
      if (!this._try_rewind(ctx)) this._die("heart_demon", ctx);
    } else {
      this.heart_gain(ctx);
    }
  }

  heart_gain(ctx) {
    this.stats.heart = int(get(this.stats, "heart", 5)) + 1;
    this._log(ctx, L.t("You face the demon and your heart steadies. Dao-heart +1"));
  }

  // =======================================================================================================================
  // battle
  // =======================================================================================================================
  _player_unit() {
    const d = this.derived();
    const sk = [];
    for (const tid of this.loadout) {
      const t = this.D.tech(str(tid));
      if (!is_empty(t)) sk.push(t);
    }
    return Battle.make_unit("hero", "p", {
      zh: this.hero_name, en: this.hero_name, hp: this.hp, hp_max: d.max_hp, mp: this.mp, mp_max: d.max_mp, atk: d.atk,
      def: d.def, spd: d.spd, crit: d.crit, cdmg: d.cdmg, dodge: d.dodge, elem: this._main_elem(), roots: this.roots, skills: sk,
      art: "hero_" + this.gender,
    });
  }

  _main_elem() {
    let best = "none";
    let bv = 0;
    for (const k of Object.keys(this.roots)) {
      if (int(this.roots[k]) > bv) {
        bv = int(this.roots[k]);
        best = str(k);
      }
    }
    return best;
  }

  enemy_unit(eid, scale = 1.0) {
    const D = this.D;
    const e = D.enemy(eid);
    const EB = get(D.rules, "enemy_base", {});
    const t = clampi(int(get(e, "tier", 1)) - 1, 0, 5);
    const hp_v = float(EB.hp[t]) * float(get(e, "hp", 1.0)) * scale;
    const mp_v = float(get(EB, "mp", [20, 40, 90, 200, 450, 1000])[t]);
    const sk = [];
    for (const tid of get(e, "skills", [])) {
      const td = D.tech(str(tid));
      if (!is_empty(td)) sk.push(td);
    }
    return Battle.make_unit(eid, "e", {
      zh: get(e, "zh", eid), en: get(e, "en", eid), hp: hp_v, hp_max: hp_v, mp: mp_v, mp_max: mp_v,
      atk: float(EB.atk[t]) * float(get(e, "atk", 1.0)) * Math.sqrt(scale), def: float(EB.def[t]) * float(get(e, "def", 1.0)),
      spd: float(EB.spd[t]) * float(get(e, "spd", 1.0)), crit: 0.05, cdmg: 1.5, dodge: 0.03 * float(t), elem: get(e, "elem", "none"),
      roots: {}, skills: sk, art: get(e, "art", "en_" + eid),
    });
  }

  _prebattle(lines) {
    const pre = [];
    const T = get(this.D.rules, "talismans", {});
    let used = 0;
    for (const iid of Object.keys(this.bag)) {
      if (used >= int(get(get(this.D.rules, "battle", {}), "pills", 2))) break;
      const it = this.D.item(str(iid));
      if (str(get(it, "kind", "")) !== "talisman") continue;
      const spec = get(it, "battle", get(T, iid, {}));
      if (is_empty(spec) || get(spec, "escape", false) === true) continue;
      if (this.take_item(str(iid), 1)) {
        pre.push(deep_copy(spec));
        lines.push(sprintf(L.t("Used %s"), L.name_of(it)));
        used += 1;
      }
    }
    return pre;
  }

  _battle(o, ctx) {
    const D = this.D;
    const eid = str(get(o, "enemy", ""));
    if (!has(D.enemies, eid)) return;
    const scale = float(get(o, "scale", 1.0));
    const lethal = get(o, "lethal", false) === true;
    // healing pill when hurt
    if (this.hp < this.max_hp() * 0.5) {
      for (const iid of Object.keys(this.bag)) {
        const it = D.item(str(iid));
        if (str(get(it, "kind", "")) === "pill") {
          let healed = false;
          for (const fo of get(get(it, "use", {}), "fx", [])) {
            if (["hp", "hp_pct"].includes(str(get(fo, "op", ""))) && float(get(fo, "v", 0)) > 0) healed = true;
          }
          if (healed && this.take_item(str(iid), 1)) {
            this.apply_fx(it.use.fx, ctx);
            this._log(ctx, sprintf(L.t("Drank %s"), L.name_of(it)));
            break;
          }
        }
      }
    }
    const pu = this._player_unit();
    const eu = this.enemy_unit(eid, scale);
    const pre = this._prebattle(ctx.lines);
    const start_hp = this.hp;
    const res = Battle.simulate(pu, eu, this.rng, D.rules, pre);
    res.p_start = start_hp;
    res.enemy_id = eid;
    res.enemy_name = L.name_of(eu);
    res.enemy_en = eu.en;
    res.enemy_zh = eu.zh;
    res.enemy_art = eu.art;
    res.lethal = lethal;
    ctx.battles.push(res);
    this.hp = Math.max(1.0, float(res.p_hp));
    this.mp = float(res.p_mp);
    const win = res.win === true;
    if (win) {
      this.kills += 1;
      this._log(ctx, sprintf(L.t("Victory over %s"), L.name_of(eu)));
      this._loot(eid, ctx);
      const e = D.enemy(eid);
      if (int(get(e, "notice", 0)) !== 0) this._apply_op({ op: "notice", v: int(e.notice) }, ctx);
      this.apply_fx(get(o, "win", []), ctx);
    } else if (lethal && this._try_rewind(ctx)) {
      this._battle(o, ctx);
    } else if (lethal) {
      this._log(ctx, sprintf(L.t("You fall to %s."), L.name_of(eu)));
      this.apply_fx(get(o, "lose", []), ctx);
      if (!this.dead) this._die(str(get(o, "cause", get(o, "tribulation", false) === true ? "tribulation" : "slain")), ctx);
    } else {
      this.hp = Math.max(1.0, this.max_hp() * float(get(get(D.rules, "breakthrough", {}), "fail_hp_pct", 0.3)));
      this._log(ctx, sprintf(L.t("Defeated by %s. You crawl away wounded."), L.name_of(eu)));
      this.apply_fx(get(o, "lose", []), ctx);
    }
  }

  _try_rewind(ctx) {
    if (this.rewinds <= 0) return false;
    this.rewinds -= 1;
    this.flags.rewound = true;
    const d = this.derived();
    this.hp = float(d.max_hp);
    this.mp = float(d.max_mp);
    this._log(ctx, L.t("Rewind: you undo the moment of your fall."));
    return true;
  }

  _loot(eid, ctx) {
    const e = this.D.enemy(eid);
    const loot = get(e, "loot", {});
    if (has(loot, "stone")) {
      const a = loot.stone;
      const v = this.rng.randi_range(int(a[0]), int(a[Math.max(0, a.length - 1)]));
      const scaled = roundi(float(v) * this.stone_scale());
      if (scaled > 0) {
        this.stone += scaled;
        this._log(ctx, sprintf(L.t("+%d stones"), scaled));
      }
    }
    const lm = get(loot, "mats", {});
    for (const k of Object.keys(lm)) {
      const a2 = lm[k];
      const v2 = this.rng.randi_range(int(a2[0]), int(a2[Math.max(0, a2.length - 1)]));
      if (v2 > 0) {
        this.mats[k] = int(get(this.mats, k, 0)) + v2;
        this._log(ctx, sprintf("+%d %s", v2, L.t(str(k))));
      }
    }
    for (const it of get(loot, "items", [])) {
      if (this.rng.randf() < float(get(it, "p", 0.1))) {
        this.give_item(str(get(it, "id", "")), 1, ctx.lines);
        this._snd(ctx, "item_get");
      }
    }
  }

  // =======================================================================================================================
  // shop and library
  // =======================================================================================================================
  _open_shop(ctx) {
    this.shop = [];
    const pool = [];
    for (const id of Object.keys(this.D.items)) {
      const it = this.D.items[id];
      const q = int(get(it, "q", 1));
      if (["pill", "talisman", "material"].includes(str(get(it, "kind", ""))) && q <= this.realm + 1 && int(get(it, "price", 0)) > 0) pool.push(id);
    }
    this._shuffle(pool);
    const n = Math.min(6, pool.length);
    for (let i = 0; i < n; i++) this.shop.push({ id: pool[i], price: int(get(this.D.item(pool[i]), "price", 20)) });
    this._log(ctx, sprintf(L.t("The market is busy: %d wares."), this.shop.length));
  }

  buy(id) {
    for (let i = 0; i < this.shop.length; i++) {
      const s = this.shop[i];
      if (s.id === id && this.stone >= int(s.price)) {
        this.stone -= int(s.price);
        this.give_item(id, 1, []);
        this.shop.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  sell(id) {
    const it = this.D.item(id);
    if (this.item_count(id) <= 0 || int(get(it, "price", 0)) <= 0) return 0;
    this.take_item(id, 1);
    const v = Math.trunc(int(get(it, "price", 0)) / 3);
    this.stone += v;
    return v;
  }

  _open_library(ctx) {
    this.pending_learn = [];
    const pool = [];
    for (const tid of Object.keys(this.D.techs)) {
      if (this.techs.includes(tid)) continue;
      const t = this.D.techs[tid];
      if (this.check_req(get(t, "req", {}))) {
        const el = str(get(t, "elem", "none"));
        if (el === "none" || int(get(this.roots, el, 0)) >= 1 || this.rng.randf() < 0.25) pool.push({ kind: "tech", id: tid });
      }
    }
    this._shuffle(pool);
    const n = Math.min(3, pool.length);
    for (let i = 0; i < n; i++) this.pending_learn.push(pool[i]);
    if (this.pending_learn.length === 0) this._log(ctx, L.t("The shelves hold nothing new for you."));
    else this._log(ctx, L.t("Three scrolls catch your eye."));
  }

  take_learn(i) {
    if (i < 0 || i >= this.pending_learn.length) return false;
    const p = this.pending_learn[i];
    if (p.kind === "tech") this.learn_tech(str(p.id));
    this.pending_learn = [];
    return true;
  }

  // =======================================================================================================================
  // death
  // =======================================================================================================================
  _die(cause, ctx) {
    if (this.dead) return;
    this.dead = true;
    this._snd(ctx, "death");
    this.death_cause = cause;
    this.current = {};
    this.pending_events = [];
    this._term_end_flow = false;
    this._log(ctx, sprintf(L.t("Your life ends: %s"), cause));
    this.finished_record = this.meta.finish_life(this);
  }

  abandon() {
    if (this.dead) return;
    const ctx = { lines: [], battles: [], tier_mult: 1.0, scaled: false };
    this._die("old_age", ctx);
  }

  // =======================================================================================================================
  // save / load of a run in progress
  // =======================================================================================================================
  to_dict() {
    return deep_copy({
      v: 1, name: this.hero_name, gender: this.gender, origin: this.origin, talent: this.talent, sect: this.sect, place: this.place,
      term: this.term, year: this.year, age: this.age, life: this.life, realm: this.realm, layer: this.layer, cult: this.cult,
      stats: this.stats, roots: this.roots, hp: this.hp, mp: this.mp, stone: this.stone, mats: this.mats, notice: this.notice,
      corrupt: this.corrupt, rel: this.rel, flags: this.flags, kills: this.kills, truths: this.truths_found, new_truths: this.new_truths,
      deck: this.deck, draw: this.draw_pile, discard: this.discard, hand: this.hand, offers: this.offers, ap: this.ap,
      ap_bonus: this.ap_bonus, swaps: this.swaps_left, bag: this.bag, equip: this.equip, techs: this.techs, loadout: this.loadout,
      method: this.method, rewinds: this.rewinds, bt_fails: this.bt_fails, seen: this.seen, queued: this.queued,
      pending: this.pending_events, term_end: this._term_end_flow,
      // additions of the port: the generator's state and the event on screen
      rng: this.rng.state, current: is_empty(this.current) ? "" : str(this.current.id),
    });
  }

  from_dict(d) {
    this.hero_name = str(get(d, "name", "Wuming"));
    this.gender = str(get(d, "gender", "m"));
    this.origin = str(get(d, "origin", "orphan"));
    this.talent = str(get(d, "talent", ""));
    this.sect = str(get(d, "sect", "none"));
    this.place = str(get(d, "place", "village"));
    this.term = int(get(d, "term", 1));
    this.year = int(get(d, "year", 0));
    this.age = int(get(d, "age", 10));
    this.life = int(get(d, "life", 14));
    this.realm = int(get(d, "realm", 0));
    this.layer = int(get(d, "layer", 1));
    this.cult = float(get(d, "cult", 0.0));
    this.stats = get(d, "stats", {});
    this.roots = get(d, "roots", {});
    this.hp = float(get(d, "hp", 50));
    this.mp = float(get(d, "mp", 20));
    this.stone = int(get(d, "stone", 0));
    this.mats = get(d, "mats", { herb: 0, ore: 0, core: 0 });
    this.notice = int(get(d, "notice", 0));
    this.corrupt = int(get(d, "corrupt", 0));
    this.rel = get(d, "rel", {});
    this.flags = get(d, "flags", {});
    this.kills = int(get(d, "kills", 0));
    this.truths_found = get(d, "truths", []);
    this.new_truths = get(d, "new_truths", []);
    this.deck = get(d, "deck", []);
    this.draw_pile = get(d, "draw", []);
    this.discard = get(d, "discard", []);
    this.hand = get(d, "hand", []);
    this.offers = get(d, "offers", []);
    this.ap = int(get(d, "ap", 2));
    this.ap_bonus = int(get(d, "ap_bonus", 0));
    this.swaps_left = int(get(d, "swaps", 1));
    this.bag = get(d, "bag", {});
    this.equip = get(d, "equip", {});
    this.techs = get(d, "techs", []);
    this.loadout = get(d, "loadout", []);
    this.method = str(get(d, "method", "breath_basic"));
    this.rewinds = int(get(d, "rewinds", 0));
    this.bt_fails = int(get(d, "bt_fails", 0));
    this.seen = get(d, "seen", {});
    this.queued = get(d, "queued", []);
    this.pending_events = get(d, "pending", []);
    this._term_end_flow = get(d, "term_end", false) === true;
    // additions of the port
    if (has(d, "rng")) this.rng.state = Number(d.rng);
    this.current = {};
    const cur = str(get(d, "current", ""));
    if (cur !== "" && has(this.D.events, cur)) this._open_event(cur, { lines: [], battles: [], tier_mult: 1.0, scaled: false });
  }
}

export default Run;

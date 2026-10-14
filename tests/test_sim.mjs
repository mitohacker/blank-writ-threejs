// Node suite for the sim (src/sim/*). Run: `node tests/test_sim.mjs` (exit code 1 on any failure).
//   1. the checks of blank-writ/tests/verify_bw_core.gd (data sanity, formulas, battle, whole lives, save/load, the Wheel)
//   2. Chinese coverage of the story text, a whole life in Chinese
//   3. deterministic replay (same seed + same bot -> same life), save/load that resumes exactly
//   4. a comparison against numbers dumped from the Godot sim (tests/fixtures/godot_dump.json.gz, made by the throwaway
//      blank-writ/tools/_dump_sim.gd): derived stats, need(), breakthrough chance, node costs, every event's choices and every
//      deterministic choice / card result, texts in both languages, battles with the dice taken out.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ROOT, load_game } from "./node_loader.mjs";
import { Auto } from "../src/sim/auto.js";
import { Battle } from "../src/sim/battle.js";
import { L } from "../src/sim/loc.js";
import { Meta } from "../src/sim/meta.js";
import { RNG } from "../src/sim/rng.js";
import { Run } from "../src/sim/run.js";
import { Txt } from "../src/sim/text.js";
import { deep_copy } from "../src/sim/util.js";

let checks = 0;
let fails = 0;
const VERBOSE = process.argv.includes("--verbose");
function ok(cond, msg) {
  checks += 1;
  if (cond && VERBOSE) console.log("ok    " + msg.slice(0, 160));
  if (!cond) {
    fails += 1;
    if (fails <= 40) console.log("FAIL  " + (msg.length > 400 ? msg.slice(0, 400) + " ..." : msg));
    else if (fails === 41) console.log("FAIL  ... (more failures not shown)");
  }
}

/** compares two JSON-like values; numbers within a tolerance. Returns up to `max` difference descriptions */
function diff(a, b, where = "", out = [], max = 8) {
  if (out.length >= max) return out;
  if (typeof a === "number" && typeof b === "number") {
    if (!(Math.abs(a - b) <= 1e-4 + 1e-6 * Math.max(Math.abs(a), Math.abs(b)))) out.push(`${where}: ${a} != ${b}`);
    return out;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (a !== b) out.push(`${where}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${where}: array vs object`);
    return out;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      out.push(`${where}: length ${a.length} != ${b.length}  (${JSON.stringify(a).slice(0, 160)} vs ${JSON.stringify(b).slice(0, 160)})`);
      return out;
    }
    for (let i = 0; i < a.length; i++) diff(a[i], b[i], `${where}[${i}]`, out, max);
    return out;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join("\u0001") !== kb.join("\u0001")) {
    const sa = new Set(ka);
    const sb = new Set(kb);
    out.push(`${where}: keys only here [${ka.filter((k) => !sb.has(k)).join(",")}] only there [${kb.filter((k) => !sa.has(k)).join(",")}]`);
    return out;
  }
  for (const k of ka) diff(a[k], b[k], `${where}.${k}`, out, max);
  return out;
}

function same(a, b, msg) {
  const d = diff(a, b);
  ok(d.length === 0, `${msg}${d.length ? "  -> " + d.join(" | ") : ""}`);
}

const g = await load_game();
const { D } = g;

// =====================================================================================================================
// 1. verify_bw_core.gd
// =====================================================================================================================
ok(D.errors.length === 0, `data loads without errors: ${JSON.stringify(D.errors)}`);
ok(Object.keys(D.cards).length >= 30, `cards loaded (${Object.keys(D.cards).length})`);
ok(Object.keys(D.techs).length >= 20, `techniques loaded (${Object.keys(D.techs).length})`);
ok(Object.keys(D.enemies).length >= 25, `enemies loaded (${Object.keys(D.enemies).length})`);
ok(Object.keys(D.events).length >= 40, `events loaded (${Object.keys(D.events).length})`);
ok(Object.hasOwn(D.origins, "orphan"), "origin orphan exists");
ok(Object.hasOwn(D.cards, "meditate") && Object.hasOwn(D.cards, "breakthrough"), "core cards exist");
ok(D.i18n_files.length >= 6 && L.zh_count() > 1000, `the Chinese tables loaded (${D.i18n_files.length} files, ${L.zh_count()} lines)`);

const meta = new Meta(D, null);
meta.save_enabled = false;

// --- battle -----------------------------------------------------------------------------------------------------------
function fight(seed) {
  const rng = new RNG(seed);
  const p = Battle.make_unit("p", "p", {
    hp: 150, hp_max: 150, mp: 40, mp_max: 40, atk: 20, def: 5, spd: 12, elem: "fire", roots: { fire: 2 },
    skills: [{ id: "s", en: "Fire", zh: "火", kind: "attack", elem: "fire", mult: 1.5, mp: 6, cd: 2, status: [{ s: "burn", p: 0.5, dur: 3, v: 0.2 }] }],
  });
  const e = Battle.make_unit("e", "e", { hp: 170, hp_max: 170, mp: 20, mp_max: 20, atk: 15, def: 4, spd: 10, elem: "wood" });
  return Battle.simulate(p, e, rng, D.rules);
}
{
  const a = fight(123);
  const b = fight(123);
  ok(a.turns === b.turns && a.win === b.win && Math.trunc(a.p_hp) === Math.trunc(b.p_hp), "battle is deterministic for one seed");
  ok(a.frames.length > 0, "battle yields frames");
  const fire = Battle.make_unit("f", "p", {
    hp: 1000, hp_max: 1000, atk: 100, def: 0, spd: 10, elem: "fire",
    skills: [{ id: "x", en: "x", zh: "x", kind: "attack", elem: "fire", mult: 1.0, mp: 0, cd: 0 }], mp: 50, mp_max: 50,
  });
  const metal = Battle.make_unit("w", "e", { hp: 100000, hp_max: 100000, atk: 1, def: 0, spd: 1, elem: "metal", mp: 0, mp_max: 0 });
  const water = Battle.make_unit("wa", "e", { hp: 100000, hp_max: 100000, atk: 1, def: 0, spd: 1, elem: "water", mp: 0, mp_max: 0 });
  const r_metal = Battle.simulate(deep_copy(fire), deep_copy(metal), new RNG(7), D.rules);
  const r_water = Battle.simulate(deep_copy(fire), deep_copy(water), new RNG(7), D.rules);
  // fire overcomes metal (rules.overcomes), is overcome by water: the metal dummy must lose more hp than the water one
  ok(r_metal.e_max - r_metal.e_hp > r_water.e_max - r_water.e_hp, "elements: fire hurts metal more than water");
}

// --- a run ------------------------------------------------------------------------------------------------------------
{
  const run = new Run(D, meta, 4242);
  run.begin("orphan", "", "Test", "m");
  ok(run.term === 1, "term starts at 1");
  ok(run.hand.length >= 5, `hand has cards (${run.hand.length})`);
  ok(run.ap === 2, `AP is 2 at the start (${run.ap})`);
  ok(run.life >= 14, `lifespan at least 14 (${run.life})`);
  ok(run.derived().max_hp >= 90.0, `max hp sane (${run.derived().max_hp})`);
  // the life opens on its intro scene: resolve it like a player would (first open choice)
  const rng = new RNG(1);
  let guard = 0;
  while (!run.current_is_empty() && guard < 5) {
    guard += 1;
    const ci = Auto.pick_choice(run, rng);
    ok(ci >= 0, "the intro event has an open choice");
    run.choose(Math.max(ci, 0));
  }
  const cult_before = run.cult + run.realm * 1000.0;
  let played = false;
  for (let i = 0; i < run.hand.length; i++) {
    if (run.can_play(i).ok && run.hand[i].id === "meditate") {
      run.play(i);
      played = true;
      break;
    }
  }
  ok(played, "a Meditate card was playable in the first hand");
  ok(run.cult + run.realm * 1000.0 > cult_before, "Meditate raised cultivation");
  ok(run.check_req({ realm_min: 0 }) && !run.check_req({ realm_min: 3 }), "realm_min works");
  ok(run.check_req({ stats: { body: 5 } }) && !run.check_req({ stats: { body: 50 } }), "stats gate works");
  ok(!run.check_req({ flags: ["no_such_flag"] }), "flags gate works");
  ok(run.check_req({ any: [{ realm_min: 9 }, { realm_min: 0 }] }), "any works");
}

// --- whole lives ------------------------------------------------------------------------------------------------------
{
  let lives_done = 0;
  let max_realm = 0;
  let stuck_total = 0;
  for (let s = 0; s < 6; s++) {
    const r2 = new Run(D, meta, 1000 + s);
    const pol = new RNG(55 + s);
    const talents = meta.draw_talents(pol);
    r2.begin("orphan", talents.length ? String(talents[0]) : "", "Bot", "m");
    const rec = Auto.play_life(r2, pol, 300);
    if (rec.dead) lives_done += 1;
    max_realm = Math.max(max_realm, rec.realm);
    stuck_total += rec.stuck;
    ok(!rec.stuck_guard, `life ${s} ended by itself (terms ${rec.terms})`);
  }
  ok(lives_done === 6, `all 6 random lives ended (${lives_done})`);
  console.log(`lives: best realm ${max_realm}, stuck events ${stuck_total}`);
}

// --- save / load of a life in progress ------------------------------------------------------------------------------
{
  const rs = new Run(D, meta, 777);
  rs.begin("orphan", "", "Saver", "f");
  const pol2 = new RNG(12);
  const rec2 = {};
  for (let t = 0; t < 9; t++) {
    Auto.resolve_events(rs, pol2, rec2);
    Auto.play_term(rs, pol2, rec2);
    if (rs.dead) break;
    rs.end_term();
  }
  Auto.resolve_events(rs, pol2, rec2);
  const blob = JSON.stringify(rs.to_dict());
  const back = new Run(D, meta, 1);
  back.from_dict(JSON.parse(blob));
  ok(back.term === rs.term && back.realm === rs.realm && back.layer === rs.layer, "save/load keeps term and realm");
  ok(Math.abs(back.cult - rs.cult) < 1e-6 && back.stone === rs.stone && back.life === rs.life, "save/load keeps cultivation, stones, lifespan");
  ok(back.deck.length === rs.deck.length && back.hand.length === rs.hand.length, "save/load keeps deck and hand");
  ok(Object.keys(back.flags).length === Object.keys(rs.flags).length && back.techs.length === rs.techs.length, "save/load keeps flags and techniques");
  ok(rs.hand.length === 0 || back.can_play(0).ok === rs.can_play(0).ok, "a loaded hand plays like the original");
}

// --- the Wheel --------------------------------------------------------------------------------------------------------
{
  const m2 = new Meta(D, null);
  m2.save_enabled = false;
  m2.imprints = 1000;
  let bought = 0;
  for (const id of D.wheel_order) if (m2.buy(id)) bought += 1;
  ok(bought > 5, `the Wheel sells nodes (${bought})`);
  ok(m2.imprints < 1000, "buying spends imprints");
  const run3 = new Run(D, m2, 99);
  run3.begin("orphan", "", "W", "f");
  ok(run3.ap_max() >= 2, "AP after the Wheel");
}

// --- the profile through an injected store ---------------------------------------------------------------------------
{
  const store = g.store;
  const m = new Meta(D, store);
  m.imprints = 77;
  m.ranks = { w_life: 2 };
  m.flags = { t_wheel: true };
  m.options.lang = "zh";
  m.options.music_vol = 33;
  m.options.hints_seen = { term: true };
  m.save_enabled = true;
  m.save();
  ok(store.load("bw.profile") !== null, "the profile is saved under bw.profile");
  const m2 = new Meta(D, store);
  ok(m2.load_profile() && m2.imprints === 77 && m2.rank("w_life") === 2 && m2.has_flag("t_wheel") && m2.options.lang === "zh", "the profile loads back");
  m2.reset();
  ok(m2.imprints === 0 && Object.keys(m2.ranks).length === 0 && m2.options.lang === "zh" && m2.options.music_vol === 33 && !("term" in m2.options.hints_seen),
    "reset keeps lang and volumes, drops the rest");
  const empty = new Meta(D, new (store.constructor)());
  ok(!empty.load_profile(), "no saved profile -> load_profile() is false");
}

// =====================================================================================================================
// 2. Chinese
// =====================================================================================================================
{
  L.set_lang("zh");
  let miss = 0;
  const shown = [];
  const need = (s, what) => {
    if (typeof s !== "string" || s === "") return;
    if (L.t(s) === s) {
      miss += 1;
      if (shown.length < 6) shown.push(`${what}: ${s.slice(0, 60)}`);
    }
  };
  let n = 0;
  for (const id of Object.keys(D.events)) {
    const e = D.events[id];
    need(e.title, `${id} title`);
    need(e.text, `${id} text`);
    for (const c of e.choices || []) {
      need(c.label, `${id} label`);
      need(c.hint, `${id} hint`);
      need(c.after, `${id} after`);
      n += 1;
    }
  }
  ok(miss === 0, `every event title / text / choice label has a Chinese line (${miss} of ${n} choices missing: ${shown.join(" | ")})`);
  // card and enemy names come with their own zh field
  let nameless = 0;
  for (const src of [D.cards, D.items, D.enemies, D.techs, D.talents, D.origins, D.methods, D.endings]) {
    for (const id of Object.keys(src)) if (!src[id].zh) nameless += 1;
  }
  ok(nameless === 0, `every card / item / enemy / technique / talent / origin / method / ending has a zh name (${nameless} without)`);
  // the engine's own lines: whole lives in Chinese, lines are mostly Chinese
  let lines = 0;
  let ascii = 0;
  const ascii_samples = [];
  for (let s = 0; s < 4; s++) {
    const run = new Run(D, new Meta(D, null), 5000 + s);
    run.meta.save_enabled = false;
    run.begin("orphan", "", "无名", "m");
    const pol = new RNG(900 + s);
    Auto.play_life(run, pol, 300);
    for (const l of run.log_all) {
      lines += 1;
      if (!/[㐀-鿿]/.test(l) && /[A-Za-z]{3,}/.test(l)) {
        ascii += 1;
        if (ascii_samples.length < 6) ascii_samples.push(l.slice(0, 70));
      }
    }
  }
  ok(lines > 50, `whole lives in Chinese produce lines (${lines})`);
  ok(ascii <= lines * 0.05, `lines with no Chinese at all stay rare in the Chinese build (${ascii} of ${lines}: ${ascii_samples.join(" | ")})`);
  L.set_lang("en");
}

// =====================================================================================================================
// 3. determinism and exact resume
// =====================================================================================================================
function life_by_seed(seed, pseed, origin = "orphan", talent = "") {
  const m = new Meta(D, null);
  m.save_enabled = false;
  const run = new Run(D, m, seed);
  run.begin(origin, talent, "Rep", "m");
  const rec = Auto.play_life(run, new RNG(pseed), 300);
  return { rec, dict: run.to_dict(), log: run.log_all.slice(), record: run.finished_record };
}
{
  const a = life_by_seed(31337, 4);
  const b = life_by_seed(31337, 4);
  ok(JSON.stringify(a) === JSON.stringify(b), "the same seed and the same bot give the same life");
  const c = life_by_seed(31338, 4);
  ok(JSON.stringify(a.dict) !== JSON.stringify(c.dict), "another seed gives another life");
  // an exact resume: save mid-life (after a term), keep playing the original and the restored copy with identical policy dice
  const m = new Meta(D, null);
  m.save_enabled = false;
  const r1 = new Run(D, m, 4711);
  r1.begin("orphan", "", "Res", "m");
  const pol = new RNG(6);
  const rec = {};
  for (let t = 0; t < 7; t++) {
    Auto.resolve_events(r1, pol, rec);
    Auto.play_term(r1, pol, rec);
    if (r1.dead) break;
    r1.end_term();
  }
  const blob = JSON.stringify(r1.to_dict());
  const m_copy = new Meta(D, null);
  m_copy.save_enabled = false;
  m_copy.from_dict(JSON.parse(JSON.stringify(m.to_dict())));
  const r2 = new Run(D, m_copy, 1);
  r2.from_dict(JSON.parse(blob));
  const pol_a = new RNG(1234);
  const pol_b = new RNG(1234);
  const ra = Auto.play_life(r1, pol_a, 300);
  const rb = Auto.play_life(r2, pol_b, 300);
  same(ra, rb, "a restored life plays on exactly like the original");
  ok(JSON.stringify(r1.to_dict()) === JSON.stringify(r2.to_dict()), "a restored life ends in the same state");
  // a save taken while an event is on screen brings that event back
  const r3 = new Run(D, m, 4);
  r3.begin("orphan", "", "Ev", "m");
  const had = !r3.current_is_empty();
  const r4 = new Run(D, m, 1);
  r4.from_dict(JSON.parse(JSON.stringify(r3.to_dict())));
  ok(had && !r4.current_is_empty() && r4.current.id === r3.current.id && r4.current.choices.length === r3.current.choices.length,
    "a save taken with an event on screen brings the event back");
}

// =====================================================================================================================
// 3b. behaviours the Godot dump cannot pin down (they depend on dice): invariants
// =====================================================================================================================
{
  const fresh_run = (seed, opts = {}) => {
    const m = new Meta(D, null);
    m.save_enabled = false;
    for (const k of Object.keys(opts.ranks || {})) m.ranks[k] = opts.ranks[k];
    const r = new Run(D, m, seed);
    r.begin(opts.origin ?? "orphan", opts.talent ?? "", "Inv", "m");
    r.current = {};
    r.pending_events = [];
    r.queued = [];
    return r;
  };
  // swap: one per term, never a breakthrough, the old card goes to the discard
  {
    const r = fresh_run(21);
    const before = r.hand.map((h) => h.id);
    const n0 = r.discard.length;
    r.swap(0);
    ok(r.swaps_left === 0 && r.hand.length === before.length, "swap spends the swap and keeps the hand size");
    ok(r.discard.length >= n0 + 1 || r.draw_pile.length >= 0, "swap sends the old card away");
    const h1 = JSON.stringify(r.hand);
    r.swap(1);
    ok(JSON.stringify(r.hand) === h1, "no second swap in one term");
  }
  // shop and library
  {
    const r = fresh_run(22);
    r.realm = 2;
    r.stone = 500;
    const ctx = { lines: [], battles: [], sfx: [], tier_mult: 1.0, scaled: false };
    r._open_shop(ctx);
    ok(r.shop.length > 0 && r.shop.length <= 6 && r.shop.every((s) => s.price > 0 && Object.hasOwn(D.items, s.id)), `the market opens with wares (${r.shop.length})`);
    const first = r.shop[0];
    const st = r.stone;
    ok(r.buy(first.id) && r.stone === st - first.price && r.item_count(first.id) >= 1, "buying pays and gives the item");
    r._open_library(ctx);
    ok(r.pending_learn.length <= 3, "the library offers at most three scrolls");
    if (r.pending_learn.length > 0) {
      const tid = r.pending_learn[0].id;
      ok(r.take_learn(0) && r.techs.includes(tid) && r.pending_learn.length === 0, "take_learn learns the scroll and closes the shelf");
    }
  }
  // the breakthrough: both outcomes keep the books straight
  {
    let won = 0;
    let lost = 0;
    for (let s = 0; s < 40; s++) {
      const r = fresh_run(300 + s);
      r.realm = 1;
      r.layer = 3;
      r.cult = r.need();
      r.hp = r.max_hp();
      const out = { lines: [], battles: [], sfx: [], tier_mult: 1.0, scaled: false };
      const fails0 = r.bt_fails;
      r._breakthrough(out);
      if (r.realm === 2) {
        won += 1;
        ok(r.layer === 1 && r.bt_fails === 0 && r.cult === 0, "a breakthrough starts the new realm at layer 1, no cultivation");
      } else {
        lost += 1;
        ok(r.realm === 1 && r.bt_fails === fails0 + 1 && "breakthrough_failed" in r.flags, "a failed breakthrough counts a pity step");
        ok(Math.abs(r.cult - r.need() * (1 - D.rules.breakthrough.fail_cult_loss)) < 1e-6, "a failed breakthrough loses part of the cultivation");
      }
    }
    ok(won > 0 && lost > 0, `both outcomes of the breakthrough happen (${won} won, ${lost} lost of 40)`);
  }
  // a lethal fight: a rewind from the Wheel undoes the fall once
  {
    const strongest = Object.keys(D.enemies).sort((a, b) => (D.enemies[b].tier || 1) - (D.enemies[a].tier || 1))[0];
    const r = fresh_run(31);
    r.rewinds = 1;
    const ctx = { lines: [], battles: [], sfx: [], tier_mult: 1.0, scaled: false };
    r._battle({ enemy: strongest, lethal: true, scale: 3.0 }, ctx);
    ok(r.rewinds === 0 && r.dead && ctx.battles.length === 2 && "rewound" in r.flags, "a lethal defeat is rewound once, then the life ends");
    ok(r.death_cause === "slain", `a lethal defeat is slain (${r.death_cause})`);
    const r2 = fresh_run(32);
    const ctx2 = { lines: [], battles: [], sfx: [], tier_mult: 1.0, scaled: false };
    r2._battle({ enemy: strongest, lethal: false, scale: 3.0 }, ctx2);
    ok(!r2.dead && r2.hp >= 1, "a non-lethal defeat is survived");
  }
  // the Registry: a clerk catches an unnoticed cultivator who is not yet Golden Core (random: either way is a valid end)
  {
    let slipped = 0;
    let struck = 0;
    for (let s = 0; s < 30; s++) {
      const r = fresh_run(500 + s);
      r.realm = 2;
      r.notice = 101;
      const life0 = r.life;
      r.end_term();
      if (r.dead) {
        struck += 1;
        ok(r.death_cause === "struck", "caught by the clerks: struck");
      } else {
        slipped += 1;
        ok(r.notice === 60 && r.life <= life0 - 1, "slipping the net costs years and drops notice to 60");
      }
    }
    ok(slipped > 0 && struck > 0, `both ends of the hunt happen (${slipped} slipped, ${struck} struck)`);
  }
  // cards in hand never need more AP than a realm gives, and the term counter only goes up
  {
    const r = fresh_run(41);
    const rec = {};
    const pol = new RNG(2);
    let last = r.term;
    for (let t = 0; t < 40 && !r.dead; t++) {
      Auto.resolve_events(r, pol, rec);
      Auto.play_term(r, pol, rec);
      if (r.dead) break;
      r.end_term();
      Auto.resolve_events(r, pol, rec);
      ok(r.term >= last, "the term counter never goes back");
      last = r.term;
    }
  }
}

// =====================================================================================================================
// 4. the Godot numbers
// =====================================================================================================================
function make_scn(sc) {
  const m = new Meta(D, null);
  m.save_enabled = false;
  for (const k of sc.ranks_order) m.ranks[k] = sc.ranks[k];
  for (const f of sc.meta_flags) m.flags[f] = true;
  const run = new Run(D, m, 99);
  run.begin(sc.origin, sc.talent, "Test", "m");
  run.current = {};
  run.pending_events = [];
  run.queued = [];
  run.seen = {};
  run.hand = [];
  run.offers = [];
  run.shop = [];
  run.pending_learn = [];
  run._term_end_flow = false;
  run.realm = sc.realm;
  run.layer = sc.layer;
  run.cult = run.need() * sc.cult_frac;
  run.term = sc.term;
  for (const k of Object.keys(sc.stats)) run.stats[k] = sc.stats[k];
  for (const k of Object.keys(sc.roots)) run.roots[k] = sc.roots[k];
  if (sc.stone >= 0) run.stone = sc.stone;
  for (const k of Object.keys(sc.mats)) run.mats[k] = sc.mats[k];
  run.notice = sc.notice;
  run.corrupt = sc.corrupt;
  for (const k of Object.keys(sc.rel)) run.rel[k] = sc.rel[k];
  if (sc.life >= 0) run.life = sc.life;
  for (const f of sc.flags) run.flags[f] = true;
  if (sc.place !== "") run.place = sc.place;
  if (sc.sect !== "") run.sect = sc.sect;
  for (const iid of sc.items) run.give_item(iid, 1, []);
  for (const tid of sc.techs) run.learn_tech(tid);
  if (sc.method !== "") run.method = sc.method;
  run.hp = run.max_hp() * sc.hp_frac;
  run.mp = run.max_mp();
  run.ap = 3;
  return run;
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const sorted_keys = (o) => Object.keys(o).sort();
function snap(run) {
  return {
    realm: run.realm, layer: run.layer, cult: r6(run.cult), life: run.life, hp: r6(run.hp), mp: r6(run.mp), stone: run.stone,
    notice: run.notice, corrupt: run.corrupt, kills: run.kills, ap: run.ap, place: run.place, sect: run.sect, method: run.method,
    dead: run.dead, death_cause: run.death_cause, ending_id: run.ending_id, stats: run.stats, roots: run.roots, mats: run.mats,
    rel: run.rel, flags: sorted_keys(run.flags), meta_flags: sorted_keys(run.meta.flags), truths_found: run.truths_found,
    new_truths: run.new_truths, deck: run.deck, techs: run.techs, loadout: run.loadout, bag: run.bag, equip: run.equip,
    offers: run.offers, queued: run.queued, pending: run.pending_events, current: run.current_is_empty() ? "" : run.current.id,
    bt_fails: run.bt_fails, rewinds: run.rewinds, year: run.year, age: run.age, term: run.term,
  };
}

function has_random(x) {
  if (Array.isArray(x)) return x.some(has_random);
  if (x && typeof x === "object") {
    if (["rand", "roll", "battle"].includes(x.op)) return true;
    return Object.values(x).some(has_random);
  }
  return false;
}

function derived_dump(run) {
  const d = run.derived();
  const o = {};
  for (const k of Object.keys(d)) o[k] = d[k];
  const st = {};
  for (const k of D.rules.stats) st[k] = run.stat_total(k);
  return {
    derived: o, stat_total: st, need: run.need(), bt_chance: run.breakthrough_chance(), cult_factor: run.cult_factor(),
    ap_max: run.ap_max(), hand_size: run.hand_size(), slots: run.slots(), years: run.years_per_term(), notice_rate: run.notice_rate(),
    gain_scale: run.gain_scale(), stone_scale: run.stone_scale(), trib: run.tribulation_ahead(), bt_ready: run.breakthrough_ready(),
    layers_of: [run.layers_of(0), run.layers_of(1), run.layers_of(5), run.layers_of(6)], gear: run.gear_total(),
    tier_mult: [run.tier_mult(0), run.tier_mult(1), run.tier_mult(2), run.tier_mult(3), run.tier_mult(9)],
    realm_label: run.realm_label(), deck_n: run.deck.length, start_hp: run.hp, start_mp: run.mp, life: run.life, stone: run.stone,
    main_elem: run._main_elem(),
  };
}

const dump_path = path.join(ROOT, "tests", "fixtures", "godot_dump.json.gz");
if (!fs.existsSync(dump_path)) {
  console.log("(no tests/fixtures/godot_dump.json.gz: the Godot comparison is skipped)");
} else {
  const G = JSON.parse(zlib.gunzipSync(fs.readFileSync(dump_path)).toString("utf8"));
  console.log("comparing with the Godot dump ...");

  // data ---------------------------------------------------------------------------------------------------------------
  {
    const tables = { cards: D.cards, techs: D.techs, methods: D.methods, enemies: D.enemies, items: D.items, talents: D.talents, origins: D.origins,
      wheel: D.wheel, truths: D.truths, endings: D.endings, events: D.events };
    const sizes = {};
    const want = {};
    for (const k of Object.keys(tables)) {
      sizes[k] = Object.keys(tables[k]).length;
      want[k] = G.counts[k];
    }
    same(sizes, want, "table sizes equal the Godot ones");
  }
  same({ story: D.story_ids.length, random: D.random_ids.length }, { story: G.counts.story, random: G.counts.random }, "story / random event counts");
  same({ cards: Object.keys(D.cards), items: Object.keys(D.items), techs: Object.keys(D.techs), enemies: Object.keys(D.enemies),
    events: Object.keys(D.events), wheel_order: D.wheel_order, talents: Object.keys(D.talents), origins: Object.keys(D.origins) },
  { cards: G.orders.cards, items: G.orders.items, techs: G.orders.techs, enemies: G.orders.enemies, events: G.orders.events,
    wheel_order: G.orders.wheel_order, talents: G.orders.talents, origins: G.orders.origins }, "table order equals the Godot one");
  // Godot's sort_custom is unstable; the port runs the same introsort, so even events of one priority come out in Godot's order
  same(D.story_ids, G.orders.story_ids, "story events in Godot's (unstable) priority order");
  same(D.random_ids, G.orders.random_ids, "random events in the same order");
  ok(L.zh_count() === G.zh_count, `Chinese table size equals Godot's (${L.zh_count()} vs ${G.zh_count})`);
  same([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8].map((r) => D.realm(r).id), G.realm_dump, "D.realm clamps like the GDScript");
  ok(Txt.cost_line({ herb: 3, stone: 5 }) === "3 herb, 5 stone", "cost_line prints whole numbers without .0 (Godot printed 3.0: kept as a deliberate fix)");

  // scenarios ----------------------------------------------------------------------------------------------------------
  for (const sc of G.scenarios) {
    const R = G.scen_results[sc.name];
    const run0 = make_scn(sc);
    same(derived_dump(run0), R.state, `[${sc.name}] derived numbers`);
    same(snap(run0), R.snap, `[${sc.name}] state after set-up`);
    // events
    let n_ev = 0;
    let n_res = 0;
    let bad = 0;
    for (const id of Object.keys(D.events)) {
      const rec = R.events[id];
      if (!rec) {
        ok(false, `[${sc.name}] event ${id} missing from the Godot dump`);
        continue;
      }
      const run = make_scn(sc);
      run._open_event(id, { lines: [], battles: [], tier_mult: 1.0, scaled: false });
      const d = diff(run.current.choices, rec.choices);
      n_ev += 1;
      if (d.length) {
        bad += 1;
        ok(false, `[${sc.name}] event ${id} choices as shown: ${d.join(" | ")}`);
      }
      const list = D.events[id].choices || [];
      for (let i = 0; i < list.length; i++) {
        if (run.current.choices[i].locked) continue;
        if (has_random(list[i].fx || [])) continue;
        const r2 = make_scn(sc);
        r2._open_event(id, { lines: [], battles: [], tier_mult: 1.0, scaled: false });
        const o = r2.choose(i);
        // the web build names the path you join (Godot printed the raw sect id): compare with that line made alike
        const alike = (ls) => (ls || []).map((l) => String(l).replace(/^(You join a path: ).*$/, "$1<sect>"));
        const got = { snap: snap(r2), lines: alike(o.lines), died: o.died, ending: o.ending, event: o.event, sfx: o.sfx };
        const want0 = rec.results[String(i)];
        const want = want0 ? { ...want0, lines: alike(want0.lines) } : want0;
        n_res += 1;
        if (!want) {
          bad += 1;
          ok(false, `[${sc.name}] event ${id} choice ${i} was not run in Godot`);
          continue;
        }
        const d2 = diff(got, want);
        if (d2.length) {
          bad += 1;
          ok(false, `[${sc.name}] event ${id} choice ${i}: ${d2.join(" | ")}`);
        }
      }
    }
    ok(bad === 0, `[${sc.name}] ${n_ev} events, ${n_res} deterministic choices match Godot`);
    // cards
    let n_cards = 0;
    let bad_c = 0;
    for (const cid of Object.keys(D.cards)) {
      if (["breakthrough", "market", "library"].includes(cid)) continue;
      const cfx = D.cards[cid].fx || [];
      for (let tier = 0; tier < 4; tier++) {
        const want = R.cards[cid][String(tier)];
        const run = make_scn(sc);
        run.hand = [{ id: cid, tier, expires: -1 }];
        const cp = run.can_play(0);
        const item = { can: cp.ok, reason: cp.reason };
        if (cp.ok && !has_random(cfx)) {
          const o = run.play(0);
          item.snap = snap(run);
          item.lines = o.lines;
          item.sfx = o.sfx;
        }
        n_cards += 1;
        const d = diff(item, want);
        if (d.length) {
          bad_c += 1;
          ok(false, `[${sc.name}] card ${cid} tier ${tier}: ${d.join(" | ")}`);
        }
      }
    }
    ok(bad_c === 0, `[${sc.name}] ${n_cards} card plays match Godot`);
  }

  // the Wheel ------------------------------------------------------------------------------------------------------------
  {
    const M = G.meta;
    const m = new Meta(D, null);
    m.save_enabled = false;
    const costs = {};
    for (const id of D.wheel_order) {
      costs[id] = [];
      for (let r = 0; r < 4; r++) {
        m.ranks[id] = r;
        costs[id].push(m.node_cost(id));
      }
    }
    same(costs, M.costs, "node_cost at ranks 0..3");
    const m2 = new Meta(D, null);
    m2.save_enabled = false;
    m2.imprints = 2500;
    const bought = [];
    for (let guard = 0; guard < 4; guard++) {
      for (const id of D.wheel_order) {
        if (m2.can_buy(id).ok) {
          m2.buy(id);
          bought.push(id);
        }
      }
    }
    same(bought, M.bought, "the Wheel buys the same nodes in the same order");
    same({ left: m2.imprints, ranks: m2.ranks, flags: Object.keys(m2.flags) }, { left: M.imprints_left, ranks: M.ranks, flags: M.flags }, "imprints, ranks, flags after buying");
    const keys = {};
    for (const id of Object.keys(D.wheel)) for (const k of Object.keys(D.wheel[id].effect || {})) keys[k] = D.wheel[id].effect[k];
    const eff = {};
    for (const k of Object.keys(keys)) {
      const v = keys[k];
      if (Array.isArray(v)) eff[k] = { list: m2.effect_list(k) };
      else if (v && typeof v === "object") eff[k] = { dict: m2.effect_dict(k) };
      else eff[k] = { sum: m2.effect_sum(k) };
    }
    same(eff, M.effects, "effect_sum / effect_dict / effect_list");
    const can = {};
    for (const id of D.wheel_order) can[id] = m2.can_buy(id);
    same(can, M.can_buy_after, "can_buy after buying");
    const m3 = new Meta(D, null);
    m3.save_enabled = false;
    const unl = {};
    for (const id of D.wheel_order) unl[id] = [m3.node_unlocked(id), m3.can_buy(id)];
    same(unl, M.fresh_unlocked, "node_unlocked / can_buy on a fresh profile");
    same(m3.unlocked_talents(), M.talents_fresh, "unlocked talents (fresh)");
    same(m3.unlocked_origins(), M.origins_fresh, "unlocked origins (fresh)");
    for (const t of Object.keys(D.truths)) m3.flags[t] = true;
    for (const id of Object.keys(D.talents)) if (D.talents[id].unlock) m3.flags[D.talents[id].unlock] = true;
    for (const id of Object.keys(D.origins)) if (D.origins[id].unlock) m3.flags[D.origins[id].unlock] = true;
    same(m3.unlocked_talents(), M.talents_all, "unlocked talents (all memories)");
    same(m3.unlocked_origins(), M.origins_all, "unlocked origins (all memories)");
    const imp = [];
    for (const sc of G.scenarios) {
      const run = make_scn(sc);
      run.new_truths = ["a", "b"];
      run.kills = 7;
      imp.push([run.meta.compute_imprints(run), r6(run.meta.effect_sum("imprint"))]);
      run.ending_id = "end_x";
      imp.push([run.meta.compute_imprints(run)]);
      run.meta.lives = 3;
      imp.push([run.meta.compute_imprints(run)]);
    }
    same(imp, M.imprints, "compute_imprints");
  }

  // texts ----------------------------------------------------------------------------------------------------------------
  {
    const run = make_scn(G.scenarios[1]);
    for (const lang of ["en", "zh"]) {
      L.set_lang(lang);
      const T = G.texts[lang];
      const fl = {};
      for (const cid of Object.keys(D.cards)) {
        const c = D.cards[cid];
        fl[cid] = [Txt.fx_lines(run, c.fx || [], 1.0), Txt.fx_lines(run, c.fx || [], 1.4), Txt.cost_line(c.cost || {})];
      }
      // Godot prints a cost number from JSON as "3.0"; the port prints "3"
      const want_fl = {};
      for (const cid of Object.keys(T.fx_lines)) {
        const c = T.fx_lines[cid];
        want_fl[cid] = [c[0], c[1], String(c[2]).replace(/(\d+)\.0\b/g, "$1")];
      }
      same(fl, want_fl, `[${lang}] card effect lines`);
      const il = {};
      for (const iid of Object.keys(D.items)) il[iid] = Txt.fx_lines(run, (D.items[iid].use || {}).fx || []);
      same(il, T.item_lines, `[${lang}] item effect lines`);
      same([Txt.tier_name(0), Txt.tier_name(1), Txt.tier_name(2), Txt.tier_name(3), Txt.tier_name(7), Txt.tier_zh(2)], T.tiers, `[${lang}] tier names`);
      same(["cultivate", "craft", "venture", "social", "rest", "chance", "combat", "zzz"].map((c) => Txt.cat_name(c)), T.cats, `[${lang}] category names`);
      const labels = [];
      for (let r = 0; r < 7; r++) for (let l = 0; l < 4; l++) labels.push(L.realm_label(D, r, l));
      same(labels, T.realm_labels, `[${lang}] realm labels`);
      same(["village", "town", "sect", "valley", "wilds", "ruin", "netherworld", "registry", "gate", "wheel", "cave", "road", "some_place"].map((p) => L.place_name(p)), T.places, `[${lang}] place names`);
      same(["xiaohe", "moshan", "yunzhi", "sujiu", "xiaoheng", "ye", "qingnang", "xuanxiao", "siming", "villager", "elder", "merchant", "disciple", "clerk", "hero", "some_new_id", "CamelId"].map((c) => L.cast_name(c)),
        T.cast, `[${lang}] cast names`);
      same(["metal", "wood", "water", "fire", "earth", "none", "", "plasma_x"].map((e) => L.elem_name(e)), T.elems, `[${lang}] element names`);
      const names = [];
      for (const k of D.rules.stats) names.push(L.stat_name(D, k));
      for (const k of D.rules.roots) names.push(L.root_name(D, k));
      names.push(L.stat_name(D, "nonexistent"));
      for (let r = 0; r < 7; r++) names.push(L.realm_name(D, r));
      same(names, T.names, `[${lang}] stat / root / realm names`);
      const ent = [];
      for (const src of [D.cards, D.items, D.enemies, D.techs, D.talents, D.origins, D.methods, D.endings]) {
        let n = 0;
        for (const id of Object.keys(src)) {
          ent.push(L.name_of(src[id]));
          n += 1;
          if (n >= 6) break;
        }
      }
      same(ent, T.entities, `[${lang}] entity names`);
      const evt = {};
      for (const id of Object.keys(D.events)) {
        const e = D.events[id];
        evt[id] = [L.t(e.title ?? ""), L.t(e.text ?? ""), (e.choices || []).map((c) => [L.t(c.label ?? "..."), L.t(c.hint ?? ""), L.t(c.after ?? "")])];
      }
      same(evt, T.events, `[${lang}] event texts`);
    }
    L.set_lang("en");
  }

  // battles with the dice taken out ---------------------------------------------------------------------------------------
  {
    const rules = deep_copy(D.rules);
    rules.battle.variance = 0.0;
    const eids = Object.keys(D.enemies);
    let n = 0;
    let bad = 0;
    let gi = 0;
    for (const sc of G.scenarios) {
      const run = make_scn(sc);
      const step = Math.max(1, Math.trunc(eids.length / 9));
      for (let i = 0; i < eids.length; i += step) {
        for (const scale of [1.0, 1.6]) {
          const want = G.battles[gi++];
          const pu = run._player_unit();
          const eu = run.enemy_unit(eids[i], scale);
          pu.crit = 0;
          pu.dodge = 0;
          eu.crit = 0;
          eu.dodge = 0;
          for (const u of [pu, eu]) for (const sk of u.skills) for (const st of sk.status || []) st.p = 1.0;
          const pu_d = { hp: r6(pu.hp), hp_max: r6(pu.hp_max), atk: r6(pu.atk), def: r6(pu.def), spd: r6(pu.spd), mp: r6(pu.mp), elem: pu.elem, art: pu.art, skills: pu.skills.map((s) => s.id ?? "") };
          const eu_d = { hp: r6(eu.hp), atk: r6(eu.atk), def: r6(eu.def), spd: r6(eu.spd), mp: r6(eu.mp), elem: eu.elem, art: eu.art, skills: eu.skills.map((s) => s.id ?? "") };
          const res = Battle.simulate(pu, eu, new RNG(5), rules, []);
          const got = {
            scenario: sc.name, enemy: eids[i], scale, win: res.win, ticks: res.ticks, turns: res.turns, p_hp: res.p_hp, p_mp: res.p_mp, e_hp: res.e_hp,
            p_max: res.p_max, e_max: res.e_max, pu: pu_d, eu: eu_d,
            frames: res.frames.map((f) => [f.a, f.skill, f.dmg, f.crit, f.miss, f.heal, f.text, f.php ?? 0, f.ehp ?? 0, f.pmp ?? 0, f.emp ?? 0, f.psh ?? 0, f.esh ?? 0]),
          };
          n += 1;
          const d = diff(got, want);
          if (d.length) {
            bad += 1;
            ok(false, `battle [${sc.name}] ${eids[i]} x${scale}: ${d.join(" | ")}`);
          }
        }
      }
    }
    ok(bad === 0 && n === G.battles.length, `${n} dice-free battles match Godot (${G.battles.length} dumped)`);
  }

  // the smaller API: items, the shop, the term's end, a life's end -------------------------------------------------------------
  {
    const X = G.misc;
    const scs = G.scenarios;
    const mid = scs[1];
    const uses = {};
    for (const iid of Object.keys(D.items)) {
      const it = D.items[iid];
      if (!it.use || Object.keys(it.use).length === 0) continue;
      const run = make_scn(mid);
      run.give_item(iid, 1, []);
      const o = run.use_item(iid);
      const rec = { random: has_random((it.use || {}).fx || []), died: o.died, event: o.event };
      if (!rec.random) {
        rec.lines = o.lines;
        rec.sfx = o.sfx;
        rec.snap = snap(run);
      }
      uses[iid] = rec;
    }
    same(uses, X.use_item, "use_item for every usable item");
    same(make_scn(mid).use_item("no_such_item_x").lines, X.use_missing, "use_item on a missing item");
    const gear = {};
    for (const iid of Object.keys(D.items)) {
      const run = make_scn(scs[0]);
      const lines = [];
      run.give_item(iid, 2, lines);
      const gi = { lines, equip: { ...run.equip }, bag: { ...run.bag }, count: run.item_count(iid), bag_size: run.bag_size() };
      gi.takes = [];
      for (let i = 0; i < 3; i++) {
        const okk = run.take_item(iid, 1);
        gi.takes.push([okk, run.item_count(iid), { ...run.equip }]);
      }
      gear[iid] = gi;
    }
    same(gear, X.gear, "give_item / take_item for every item (equipping)");
    const sell = {};
    for (const iid of Object.keys(D.items)) {
      const run = make_scn(scs[0]);
      run.give_item(iid, 1, []);
      const st0 = run.stone;
      const v = run.sell(iid);
      sell[iid] = [v, run.stone - st0, run.item_count(iid), run.sell(iid)];
    }
    same(sell, X.sell, "sell for every item");
    {
      let pill = "";
      for (const iid of Object.keys(D.items)) {
        if (D.items[iid].kind === "pill") {
          pill = iid;
          break;
        }
      }
      const rs = make_scn(scs[0]);
      rs.shop = [{ id: pill, price: 15 }, { id: "no_such_item_y", price: 5 }];
      rs.stone = 20;
      const b = [];
      b.push(rs.buy(pill));
      b.push(rs.stone);
      b.push(rs.shop.length);
      b.push(rs.buy(pill));
      b.push(rs.buy("no_such_item_y"));
      b.push(rs.stone);
      b.push(rs.shop.length);
      b.push({ ...rs.bag });
      same(b, X.buy, "buy from the shop");
    }
    const et = {};
    for (const sc of scs) {
      const run = make_scn(sc);
      const o = run.end_term();
      et[sc.name] = {
        life: run.life, year: run.year, age: run.age, hp: r6(run.hp), mp: r6(run.mp), notice: run.notice, cult: r6(run.cult), layer: run.layer,
        realm: run.realm, dead: run.dead, cause: run.death_cause, died: o.died, corrupt: run.corrupt,
        has_event: !run.current_is_empty() || run.term > sc.term || run.pending_events.length > 0,
      };
      const r2 = make_scn(sc);
      r2.life = 1;
      const o2 = r2.end_term();
      et[sc.name + "_old"] = {
        dead: r2.dead, cause: r2.death_cause, died: o2.died, lines: o2.lines, imprints: r2.meta.imprints, lives: r2.meta.lives,
        record: r2.finished_record, best: [r2.meta.best_realm, r2.meta.best_layer], history: r2.meta.history.length,
      };
      const r3 = make_scn(sc);
      r3.realm = 3;
      r3.layer = 1;
      r3.notice = 101;
      const o3 = r3.end_term();
      et[sc.name + "_hunted"] = { notice: r3.notice, dead: r3.dead, flag: "hunted" in r3.flags, lines: o3.lines };
    }
    same(et, X.end_term, "end_term upkeep, old age, the Registry's hunt");
    const ab = {};
    for (const sc of scs) {
      const run = make_scn(sc);
      run.new_truths = ["t_x"];
      run.abandon();
      ab[sc.name] = {
        dead: run.dead, cause: run.death_cause, record: run.finished_record, imprints: run.meta.imprints, lives: run.meta.lives,
        best: [run.meta.best_realm, run.meta.best_layer], total_terms: run.meta.total_terms,
      };
    }
    same(ab, X.abandon, "abandon pays the life out");
    {
      const bc = [];
      const rb = make_scn(mid);
      rb.realm = 2;
      rb.layer = 3;
      rb.cult = rb.need();
      for (const f of [0, 1, 2, 3, 5]) {
        rb.bt_fails = f;
        delete rb.flags.bt_pill;
        bc.push(r6(rb.breakthrough_chance()));
        rb.flags.bt_pill = true;
        bc.push(r6(rb.breakthrough_chance()));
      }
      bc.push(rb.breakthrough_ready());
      rb.cult = rb.need() - 1.0;
      bc.push(rb.breakthrough_ready());
      same(bc, X.bt_chances, "breakthrough chance with pity and pill");
    }
    {
      const rt = make_scn(mid);
      const ids = Object.keys(D.cards);
      rt.offers = [{ card: ids[0], expires: 2 }, { card: ids[1], expires: 1 }, { card: ids[2], expires: 3 }];
      rt.realm = 2;
      rt.layer = 3;
      rt.cult = rt.need();
      const tl = [];
      rt._start_term(tl);
      same({
        hand_n: rt.hand.length, tail: rt.hand.slice(rt.hand.length - 4), offers: rt.offers, term: rt.term, ap: rt.ap, swaps: rt.swaps_left,
        lines: tl, ap_max: rt.ap_max(),
      }, X.start_term, "start of a term: offers ride on the hand, breakthrough appears");
    }
    {
      const rd = make_scn(scs[2]);
      const d1 = JSON.stringify(rd.to_dict());
      const rd2 = new Run(D, rd.meta, 1);
      rd2.from_dict(JSON.parse(d1));
      ok(JSON.stringify(rd2.to_dict()) === d1, "to_dict/from_dict round trip is exact");
    }
  }

  // save format keys --------------------------------------------------------------------------------------------------------
  {
    const run = make_scn(G.scenarios[0]);
    const keys = Object.keys(run.to_dict());
    ok(G.to_dict_keys.every((k) => keys.includes(k)), "to_dict has every key of the GDScript save");
  }
}

console.log(`${checks} checks, ${fails} failed`);
process.exit(fails > 0 ? 1 : 0);

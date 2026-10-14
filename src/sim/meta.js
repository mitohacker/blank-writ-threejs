// The persistent profile: imprints, the Wheel (meta tree) ranks, memories (truths / met_* / end_* flags), lives lived
// (port of scripts/bw_meta.gd). Pure data + save/load through an injected store; the run reads Wheel effects through effect_*.
//
//   const meta = new Meta(D, store)     store = {load(key) -> string|null, save(key, text), remove(key)} (or null: nothing is kept)
//   meta.load_profile() -> bool         meta.save()           meta.reset()           meta.save_enabled = false
//   Meta.PROFILE_KEY = "bw.profile"     Meta.RUN_KEY = "bw.run"   (the run itself is saved by the router)

import { clampf, deep_copy, get, has, int, float, is_dict, roundi, str, trim_prefix } from "./util.js";

const PROFILE_KEY = "bw.profile";
const RUN_KEY = "bw.run";

export class Meta {
  static PROFILE_KEY = PROFILE_KEY;
  static RUN_KEY = RUN_KEY;
  // names the GDScript calls PROFILE_PATH / RUN_PATH
  static PROFILE_PATH = PROFILE_KEY;
  static RUN_PATH = RUN_KEY;

  constructor(data = null, store = null) {
    this.D = data;
    this.store = store;
    this.imprints = 0;
    this.ranks = {}; // wheel node id -> rank
    this.flags = {}; // persistent flags (truths t_*, met_*, tal_*, w_*, end_*, seen_*)
    this.lives = 0;
    this.best_realm = 0;
    this.best_layer = 0;
    this.total_terms = 0;
    this.endings = [];
    this.last_name = "Wuming";
    this.last_gender = "m";
    this.options = { hints_seen: {}, speed: 1 };
    this.history = []; // one record per life: {life, realm, layer, terms, cause, imprints, truths, ending, sect, origin}
    this.save_enabled = true;
  }

  // ---- flags ---------------------------------------------------------------------------------------------------------
  has_flag(f) {
    return has(this.flags, f);
  }

  set_flag(f) {
    this.flags[f] = true;
  }

  // ---- the Wheel -----------------------------------------------------------------------------------------------------
  rank(id) {
    return int(get(this.ranks, id, 0));
  }

  node_cost(id) {
    const n = get(this.D.wheel, id, {});
    if (Object.keys(n).length === 0) return 0;
    const r = this.rank(id);
    const base = int(get(n, "cost", 10));
    // later ranks of a multi-rank node cost more: x1, x2, x4 ...
    return roundi(base * Math.pow(2.0, r));
  }

  node_unlocked(id) {
    const n = get(this.D.wheel, id, {});
    if (Object.keys(n).length === 0) return false;
    const unlock = str(get(n, "unlock", ""));
    if (unlock !== "" && !this.has_flag(unlock)) return false;
    if (str(get(n, "branch", "")) === "hidden" && !this.has_flag("t_wheel")) return false;
    for (const r of get(n, "req", [])) {
      if (this.rank(str(r)) <= 0) return false;
    }
    return true;
  }

  can_buy(id) {
    const n = get(this.D.wheel, id, {});
    if (Object.keys(n).length === 0) return { ok: false, reason: "unknown" };
    if (this.rank(id) >= int(get(n, "max", 1))) return { ok: false, reason: "maxed" };
    if (!this.node_unlocked(id)) return { ok: false, reason: "locked" };
    if (this.imprints < this.node_cost(id)) return { ok: false, reason: "imprints" };
    return { ok: true, reason: "" };
  }

  buy(id) {
    if (!this.can_buy(id).ok) return false;
    this.imprints -= this.node_cost(id);
    this.ranks[id] = this.rank(id) + 1;
    this.flags["w_" + trim_prefix(id, "w_")] = true;
    this.save();
    return true;
  }

  /** Sum of a numeric effect over all bought ranks. */
  effect_sum(key) {
    let total = 0.0;
    for (const id of Object.keys(this.ranks)) {
      const n = get(this.D.wheel, id, {});
      const ef = get(n, "effect", {});
      if (has(ef, key)) total += float(ef[key]) * float(this.ranks[id]);
    }
    return total;
  }

  effect_dict(key) {
    const out = {};
    for (const id of Object.keys(this.ranks)) {
      const ef = get(get(this.D.wheel, id, {}), "effect", {});
      if (has(ef, key) && is_dict(ef[key])) {
        for (const k of Object.keys(ef[key])) out[k] = float(get(out, k, 0.0)) + float(ef[key][k]) * float(this.ranks[id]);
      }
    }
    return out;
  }

  effect_list(key) {
    const out = [];
    for (const id of Object.keys(this.ranks)) {
      const ef = get(get(this.D.wheel, id, {}), "effect", {});
      if (has(ef, key) && Array.isArray(ef[key])) {
        const n = int(this.ranks[id]);
        for (let i = 0; i < n; i++) for (const x of ef[key]) out.push(x);
      }
    }
    return out;
  }

  // ---- what a new life may be ----------------------------------------------------------------------------------------
  unlocked_talents() {
    const out = [];
    for (const id of Object.keys(this.D.talents)) {
      const u = str(get(this.D.talents[id], "unlock", ""));
      if (u === "" || this.has_flag(u)) out.push(id);
    }
    out.sort();
    return out;
  }

  unlocked_origins() {
    const out = [];
    for (const id of Object.keys(this.D.origins)) {
      const u = str(get(this.D.origins[id], "unlock", ""));
      if (u === "" || this.has_flag(u)) out.push(id);
    }
    out.sort();
    return out;
  }

  /** Three talents to pick from (more with the Wheel's talent_slots). */
  draw_talents(rng) {
    const pool = this.unlocked_talents();
    const n = 3 + int(this.effect_sum("talent_slots"));
    const out = [];
    let guard = 0;
    while (out.length < n && pool.length > 0 && guard++ < 1000) {
      const i = rng.randi_range(0, pool.length - 1);
      out.push(pool[i]);
      pool.splice(i, 1);
    }
    return out;
  }

  // ---- paying out a life ---------------------------------------------------------------------------------------------
  compute_imprints(run) {
    const R = get(this.D.rules, "imprints", {});
    let v =
      float(run.realm) * float(get(R, "realm", 8)) +
      float(run.layer) * float(get(R, "layer", 3)) +
      float(run.term) * float(get(R, "term", 0.5)) +
      float(run.new_truths.length) * float(get(R, "truth", 10)) +
      float(run.kills) * float(get(R, "kill", 0.3));
    if (run.ending_id !== "") v += float(get(R, "ending", 50));
    v *= 1.0 + this.effect_sum("imprint");
    const floor_v = this.lives === 0 ? float(get(R, "min_first", 20)) : 8.0;
    return roundi(Math.max(v, floor_v));
  }

  finish_life(run) {
    const pay = this.compute_imprints(run);
    this.imprints += pay;
    this.lives += 1;
    this.total_terms += run.term;
    if (run.realm > this.best_realm || (run.realm === this.best_realm && run.layer > this.best_layer)) {
      this.best_realm = run.realm;
      this.best_layer = run.layer;
    }
    if (run.ending_id !== "" && !this.endings.includes(run.ending_id)) this.endings.push(run.ending_id);
    const rec = {
      life: this.lives,
      realm: run.realm,
      layer: run.layer,
      terms: run.term,
      cause: run.death_cause,
      imprints: pay,
      truths: run.truths_found.slice(),
      ending: run.ending_id,
      sect: run.sect,
      origin: run.origin,
    };
    this.history.push(rec);
    if (this.history.length > 60) this.history.shift();
    this.save();
    return rec;
  }

  // ---- save / load ---------------------------------------------------------------------------------------------------
  to_dict() {
    return deep_copy({
      v: 1,
      imprints: this.imprints,
      ranks: this.ranks,
      flags: this.flags,
      lives: this.lives,
      best_realm: this.best_realm,
      best_layer: this.best_layer,
      total_terms: this.total_terms,
      endings: this.endings,
      last_name: this.last_name,
      last_gender: this.last_gender,
      options: this.options,
      history: this.history,
    });
  }

  from_dict(d) {
    this.imprints = int(get(d, "imprints", 0));
    this.ranks = get(d, "ranks", {});
    this.flags = get(d, "flags", {});
    this.lives = int(get(d, "lives", 0));
    this.best_realm = int(get(d, "best_realm", 0));
    this.best_layer = int(get(d, "best_layer", 0));
    this.total_terms = int(get(d, "total_terms", 0));
    this.endings = get(d, "endings", []);
    this.last_name = str(get(d, "last_name", "Wuming"));
    this.last_gender = str(get(d, "last_gender", "m"));
    this.options = get(d, "options", { hints_seen: {}, speed: 1 });
    this.history = get(d, "history", []);
    for (const k of Object.keys(this.ranks)) this.ranks[k] = int(this.ranks[k]);
  }

  save() {
    if (!this.save_enabled || !this.store) return;
    try {
      this.store.save(PROFILE_KEY, JSON.stringify(this.to_dict()));
    } catch (e) {
      /* a full or blocked store only loses the save */
    }
  }

  load_profile() {
    if (!this.store) return false;
    let text = null;
    try {
      text = this.store.load(PROFILE_KEY);
    } catch (e) {
      return false;
    }
    if (!text) return false;
    let v = null;
    try {
      v = JSON.parse(text);
    } catch (e) {
      return false;
    }
    if (is_dict(v)) {
      this.from_dict(v);
      return true;
    }
    return false;
  }

  reset() {
    this.imprints = 0;
    this.ranks = {};
    this.flags = {};
    this.lives = 0;
    this.best_realm = 0;
    this.best_layer = 0;
    this.total_terms = 0;
    this.endings = [];
    this.history = [];
    const keep = {};
    for (const k of ["lang", "music_vol", "sfx_vol", "muted"]) {
      if (has(this.options, k)) keep[k] = this.options[k];
    }
    this.options = { hints_seen: {}, speed: 1 };
    Object.assign(this.options, keep);
  }
}

export default Meta;

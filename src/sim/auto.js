// A greedy policy that plays whole lives without a UI: used by the tests, the career bot, the demo screens and the in-game
// "Auto term" aid (port of scripts/bw_auto.gd). All static.

import { float, get, has, int, is_dict, is_empty, str } from "./util.js";

export class Auto {
  static score_fx(run, fx, depth = 0) {
    if (!Array.isArray(fx) || depth > 4) return 0.0;
    let s = 0.0;
    for (const o of fx) {
      if (!is_dict(o)) continue;
      switch (str(get(o, "op", ""))) {
        case "cult":
          s += float(get(o, "v", 0)) * 0.6;
          break;
        case "stat":
          s += float(get(o, "v", 0)) * 14.0;
          break;
        case "root":
          s += float(get(o, "v", 0)) * 18.0;
          break;
        case "hp":
          s += float(get(o, "v", 0)) * 0.15;
          break;
        case "hp_pct":
          s += float(get(o, "v", 0)) * 25.0;
          break;
        case "life":
          s += float(get(o, "v", 0)) * 14.0;
          break;
        case "stone":
          s += float(get(o, "v", 0)) * 0.25;
          break;
        case "mat":
          s += float(get(o, "v", 0)) * 1.2;
          break;
        case "item":
          s += 9.0;
          break;
        case "card":
          s += 11.0;
          break;
        case "tech":
          s += 14.0;
          break;
        case "method":
          s += 8.0;
          break;
        case "truth":
          s += 25.0;
          break;
        case "rel":
          s += float(get(o, "v", 0)) * 4.0;
          break;
        case "notice":
          s -= float(get(o, "v", 0)) * 0.6;
          break;
        case "corrupt":
          s -= float(get(o, "v", 0)) * (1.5 + float(run.corrupt) * 0.08);
          break;
        case "die":
          s -= 1000.0;
          break;
        case "ending":
          s += 40.0;
          break;
        case "battle": {
          const eu = run.D.enemy(str(get(o, "enemy", "")));
          const risk = float(int(get(eu, "tier", 1))) - float(run.realm) - 0.5;
          s += -6.0 - risk * 6.0 + 0.6 * Auto.score_fx(run, get(o, "win", []), depth + 1) + 0.4 * Auto.score_fx(run, get(o, "lose", []), depth + 1);
          if (get(o, "lethal", false) === true) s -= 8.0 + risk * 10.0;
          break;
        }
        case "roll":
          s += 0.55 * Auto.score_fx(run, get(o, "pass", []), depth + 1) + 0.45 * Auto.score_fx(run, get(o, "fail", []), depth + 1);
          break;
        case "rand": {
          let tw = 0.0;
          let sum = 0.0;
          const opts = get(o, "opts", []);
          for (const op2 of opts) tw += float(get(op2, "w", 1));
          for (const op2 of opts) sum += float(get(op2, "w", 1)) * Auto.score_fx(run, get(op2, "fx", []), depth + 1);
          if (tw > 0.0) s += sum / tw;
          break;
        }
        case "if":
          if (run.check_req(get(o, "req", {}))) s += Auto.score_fx(run, get(o, "then", []), depth + 1);
          else s += Auto.score_fx(run, get(o, "else", []), depth + 1);
          break;
        case "queue":
        case "event":
          s += 2.0;
          break;
        default:
      }
    }
    return s;
  }

  static pick_choice(run, rng) {
    const cur = run.current;
    if (is_empty(cur)) return -1;
    const ev = cur.event;
    let best = -1;
    let best_s = -1.0e9;
    for (const c of cur.choices) {
      if (c.locked === true) continue;
      const src = ev.choices[int(c.i)];
      let sc = Auto.score_fx(run, get(src, "fx", [])) + rng.randf() * 3.0;
      // memory-gated options are usually the better ones
      if (has(src, "req") && (has(src.req, "meta") || has(src.req, "rel"))) sc += 6.0;
      if (sc > best_s) {
        best_s = sc;
        best = int(c.i);
      }
    }
    return best;
  }

  static card_score(run, i) {
    const h = run.hand[i];
    const c = run.D.card(str(h.id));
    const id = str(get(c, "id", ""));
    const cat = str(get(c, "cat", ""));
    const tier_bonus = float(int(get(h, "tier", 0))) * 3.0;
    const hp_frac = run.hp / Math.max(1.0, run.max_hp());
    if (id === "breakthrough") return 1000.0;
    if (cat === "chance") return 70.0 + tier_bonus;
    if ((cat === "rest" || id === "heal") && hp_frac < 0.45) return 90.0;
    if (id === "hide" && run.notice >= 60) return 85.0;
    if (id === "forbidden_rite" && run.corrupt > 15) return -50.0;
    let s = Auto.score_fx(run, get(c, "fx", []));
    if (cat === "cultivate") s += 30.0;
    if (cat === "craft") s += 6.0;
    if (cat === "rest") s -= 8.0 - (1.0 - hp_frac) * 30.0;
    if (cat === "venture" && hp_frac < 0.5) s -= 20.0;
    if (id === "hide" || id === "fast") s -= 10.0;
    return s + tier_bonus - float(int(get(c, "ap", 1)) - 1) * 4.0;
  }

  static resolve_events(run, rng, record) {
    let guard = 0;
    while (!run.dead && !is_empty(run.current) && guard < 40) {
      guard += 1;
      const ci = Auto.pick_choice(run, rng);
      if (ci < 0) {
        // everything is locked: take the first anyway is impossible; pick the cheapest open way out
        record.stuck = int(get(record, "stuck", 0)) + 1;
        run.current = {};
        return;
      }
      record.events = int(get(record, "events", 0)) + 1;
      run.choose(ci);
    }
  }

  static play_term(run, rng, record) {
    let guard = 0;
    while (!run.dead && run.ap > 0 && guard < 10) {
      guard += 1;
      let best = -1;
      let best_s = -1.0e9;
      for (let i = 0; i < run.hand.length; i++) {
        if (!run.can_play(i).ok) continue;
        const sc = Auto.card_score(run, i);
        if (sc > best_s) {
          best_s = sc;
          best = i;
        }
      }
      if (best < 0) break;
      const out = run.play(best);
      record.cards = int(get(record, "cards", 0)) + 1;
      if (out.battles.length > 0) record.battles = int(get(record, "battles", 0)) + out.battles.length;
      Auto.resolve_events(run, rng, record);
      if (run.pending_learn.length > 0) run.take_learn(0);
      if (run.shop.length > 0) {
        // buy the cheapest healing / cultivation pill we can afford, once
        for (const s of run.shop.slice()) {
          if (run.stone >= int(s.price) * 2) {
            run.buy(str(s.id));
            break;
          }
        }
        run.shop = [];
      }
    }
  }

  /** Plays one life to its end. `max_terms` is a safety net. Returns the record. */
  static play_life(run, rng, max_terms = 400) {
    const rec = { cards: 0, events: 0, battles: 0, stuck: 0 };
    let guard = 0;
    Auto.resolve_events(run, rng, rec);
    while (!run.dead && guard < max_terms) {
      guard += 1;
      Auto.play_term(run, rng, rec);
      if (run.dead) break;
      const out = run.end_term();
      if (out.battles.length > 0) rec.battles = int(get(rec, "battles", 0)) + out.battles.length;
      Auto.resolve_events(run, rng, rec);
    }
    rec.terms = run.term;
    rec.realm = run.realm;
    rec.layer = run.layer;
    rec.dead = run.dead;
    rec.cause = run.death_cause;
    rec.ending = run.ending_id;
    rec.truths = run.truths_found.length;
    rec.stuck_guard = guard >= max_terms;
    rec.seen = Object.keys(run.seen);
    return rec;
  }
}

export default Auto;

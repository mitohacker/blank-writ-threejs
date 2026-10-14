// Deterministic auto-battle (port of scripts/bw_battle.gd). Pure logic: units are plain objects, the result carries the frame list
// the battle view replays. All static.
//
// unit: {name, zh, en, side, hp, hp_max, mp, mp_max, atk, def, spd, crit, cdmg, dodge, elem, roots{elem:level},
//        skills[{id, zh, en, elem, kind, mult, mp, cd, hits, target, status[], cd_left}], st{name:{dur,v,src}}, shield, gauge, art}
// frame: {a (0 player, 1 enemy), skill, zh, dmg, crit, miss, heal, text[], elem?, kind?, php, ehp, pmp, emp, psh, esh}
// result: {win, ticks, turns, frames, p_hp, p_mp, e_hp, p_max, e_max}

import { L } from "./loc.js";
import { sprintf } from "./fmt.js";
import { deep_copy, float, get, has, int, roundi, str } from "./util.js";

const SELF_STATUS = ["shield", "regen", "atk_up", "def_up", "spd_up"];

export class Battle {
  static SELF_STATUS = SELF_STATUS;

  static make_unit(name, side, s) {
    const u = {
      name,
      zh: get(s, "zh", name),
      en: get(s, "en", name),
      side,
      hp: float(get(s, "hp", 50.0)),
      hp_max: float(get(s, "hp_max", get(s, "hp", 50.0))),
      mp: float(get(s, "mp", 20.0)),
      mp_max: float(get(s, "mp_max", get(s, "mp", 20.0))),
      atk: float(get(s, "atk", 10.0)),
      def: float(get(s, "def", 2.0)),
      spd: float(get(s, "spd", 10.0)),
      crit: float(get(s, "crit", 0.05)),
      cdmg: float(get(s, "cdmg", 1.5)),
      dodge: float(get(s, "dodge", 0.0)),
      elem: str(get(s, "elem", "none")),
      roots: get(s, "roots", {}),
      skills: [],
      st: {},
      shield: 0.0,
      gauge: 0.0,
      art: get(s, "art", ""),
    };
    for (const sk of get(s, "skills", [])) {
      const d = deep_copy(sk);
      d.cd_left = 0;
      u.skills.push(d);
    }
    return u;
  }

  /** effective atk / def / spd after statuses */
  static _eff(u, key, R) {
    let v = float(u[key]);
    const st = u.st;
    const up = float(get(R, "buff_up", 1.3));
    if (key === "atk") {
      if (has(st, "weak")) v *= float(get(R, "weak", 0.75));
      if (has(st, "atk_up")) v *= up;
    } else if (key === "def") {
      if (has(st, "broken")) v *= float(get(R, "broken", 0.75));
      if (has(st, "def_up")) v *= up;
    } else if (key === "spd") {
      if (has(st, "slow")) v *= float(get(R, "slow", 0.6));
      if (has(st, "spd_up")) v *= up;
    }
    return v;
  }

  static _elem_mult(R, over, atk_elem, def_elem) {
    if (atk_elem === "none" || def_elem === "none") return 1.0;
    if (str(get(over, atk_elem, "")) === def_elem) return float(get(R, "weak_mult", 1.25));
    if (str(get(over, def_elem, "")) === atk_elem) return float(get(R, "resist_mult", 0.8));
    return 1.0;
  }

  static _hit(src, dst, mult, elem, rng, R, over, root_dmg) {
    const out = { dmg: 0, crit: false, miss: false };
    if (rng.randf() < float(dst.dodge)) {
      out.miss = true;
      return out;
    }
    const atk = Battle._eff(src, "atk", R);
    let raw = atk * mult * Battle._elem_mult(R, over, elem, str(dst.elem));
    if (elem !== "none") raw *= 1.0 + float(get(src.roots, elem, 0)) * root_dmg;
    raw *= 1.0 + (rng.randf() * 2.0 - 1.0) * float(get(R, "variance", 0.1));
    const df = Battle._eff(dst, "def", R) * float(get(R, "def_factor", 0.6));
    let dmg = Math.max(raw * float(get(R, "min_dmg_frac", 0.1)), raw - df);
    if (rng.randf() < float(src.crit)) {
      out.crit = true;
      dmg *= float(src.cdmg);
    }
    out.dmg = roundi(Math.max(1.0, dmg));
    return out;
  }

  /** shield absorbs first; returns hp actually lost */
  static _damage(dst, dmg) {
    let d = float(dmg);
    if (float(dst.shield) > 0.0) {
      const ab = Math.min(float(dst.shield), d);
      dst.shield = float(dst.shield) - ab;
      d -= ab;
    }
    dst.hp = Math.max(0.0, float(dst.hp) - d);
    return roundi(d);
  }

  static _apply_status(target, entry, src, rng, text) {
    if (rng.randf() > float(get(entry, "p", 1.0))) return;
    const s = str(get(entry, "s", ""));
    if (s === "") return;
    const dur = int(get(entry, "dur", 2));
    const v = float(get(entry, "v", 0.15));
    if (s === "shield") {
      target.shield = float(target.shield) + float(src.hp_max) * 0.15 * Math.max(v, 0.5);
      text.push(sprintf(L.t("%s gains a ward"), L.name_of(target)));
      return;
    }
    target.st[s] = { dur, v, src: float(src.atk) };
    text.push(sprintf(L.t("%s: %s"), L.name_of(target), L.t(s)));
  }

  static _pick_skill(u, foe) {
    const skills = u.skills;
    for (let i = 0; i < skills.length; i++) {
      const sk = skills[i];
      if (int(sk.cd_left) > 0 || float(u.mp) < float(get(sk, "mp", 0))) continue;
      switch (str(get(sk, "kind", "attack"))) {
        case "heal":
          if (float(u.hp) > float(u.hp_max) * 0.7) continue;
          break;
        case "shield":
          if (float(u.shield) > 0.0) continue;
          break;
        case "buff": {
          let skip = false;
          for (const e of get(sk, "status", [])) {
            if (has(u.st, str(get(e, "s", "")))) skip = true;
          }
          if (skip) continue;
          break;
        }
        case "debuff": {
          let skip = false;
          for (const e of get(sk, "status", [])) {
            if (has(foe.st, str(get(e, "s", "")))) skip = true;
          }
          if (skip) continue;
          break;
        }
        default:
      }
      return i;
    }
    return -1;
  }

  /** start of the unit's turn. Returns true when the unit loses the turn (stun) or died of damage over time. */
  static _tick_statuses(u, R, text) {
    const st = u.st;
    const dot_scale = float(get(R, "dot_scale", 3.0));
    for (const s of ["burn", "poison"]) {
      if (has(st, s)) {
        const e = st[s];
        const dmg = roundi(float(e.src) * float(e.v) * dot_scale);
        if (s === "poison") u.hp = Math.max(0.0, float(u.hp) - dmg);
        else Battle._damage(u, dmg);
        text.push(sprintf(L.t("%s takes %d from %s"), L.name_of(u), dmg, L.t(s)));
      }
    }
    if (has(st, "regen")) {
      const h = float(u.hp_max) * float(get(R, "regen", 0.08));
      u.hp = Math.min(float(u.hp_max), float(u.hp) + h);
    }
    const skip = has(st, "stun");
    for (const k of Object.keys(st)) {
      st[k].dur = int(st[k].dur) - 1;
      if (int(st[k].dur) <= 0) delete st[k];
    }
    return skip;
  }

  static _act(u, foe, rng, R, over, root_dmg) {
    const fr = { a: u.side === "p" ? 0 : 1, skill: "Strike", zh: L.zh("普攻"), dmg: 0, crit: false, miss: false, heal: 0, text: [] };
    const text = fr.text;
    const lost = Battle._tick_statuses(u, R, text);
    if (float(u.hp) <= 0.0) {
      fr.skill = "(falls)";
      return fr;
    }
    if (lost) {
      fr.skill = "(stunned)";
      return fr;
    }
    const idx = Battle._pick_skill(u, foe);
    let mult = float(get(R, "basic_mult", 1.0));
    let elem = "none";
    let kind = "attack";
    let hits = 1;
    let sk = {};
    if (idx >= 0) {
      sk = u.skills[idx];
      mult = float(get(sk, "mult", 1.0));
      elem = str(get(sk, "elem", "none"));
      kind = str(get(sk, "kind", "attack"));
      hits = Math.max(1, int(get(sk, "hits", 1)));
      u.mp = float(u.mp) - float(get(sk, "mp", 0));
      sk.cd_left = int(get(sk, "cd", 1)) + 1;
      fr.skill = str(get(sk, "en", get(sk, "id", "")));
      fr.zh = str(get(sk, "zh", ""));
      fr.elem = elem;
      fr.kind = kind;
    }
    for (const s of u.skills) {
      if (int(s.cd_left) > 0) s.cd_left = int(s.cd_left) - 1;
    }
    if (idx >= 0) u.skills[idx].cd_left = int(get(sk, "cd", 1));
    switch (kind) {
      case "heal": {
        const h = (float(u.hp_max) * 0.12 + float(u.atk) * 0.5) * mult;
        u.hp = Math.min(float(u.hp_max), float(u.hp) + h);
        fr.heal = roundi(h);
        for (const e of get(sk, "status", [])) Battle._apply_status(u, e, u, rng, text);
        break;
      }
      case "shield": {
        const sh = float(u.hp_max) * 0.15 * mult;
        u.shield = float(u.shield) + sh;
        text.push(sprintf(L.t("%s gains a shield (%d)"), L.name_of(u), int(sh)));
        for (const e of get(sk, "status", [])) Battle._apply_status(u, e, u, rng, text);
        break;
      }
      case "buff":
        for (const e of get(sk, "status", [])) Battle._apply_status(u, e, u, rng, text);
        break;
      default: {
        let total = 0;
        for (let h = 0; h < hits; h++) {
          const r = Battle._hit(u, foe, mult * (kind === "debuff" ? 0.5 : 1.0), elem, rng, R, over, root_dmg);
          if (r.miss) {
            fr.miss = true;
            continue;
          }
          total += Battle._damage(foe, int(r.dmg));
          if (r.crit) fr.crit = true;
        }
        fr.dmg = total;
        if (total > 0 || !fr.miss) {
          for (const e of get(sk, "status", [])) {
            const tgt = SELF_STATUS.includes(str(get(e, "s", ""))) ? u : foe;
            Battle._apply_status(tgt, e, u, rng, text);
          }
        }
      }
    }
    u.mp = Math.min(float(u.mp_max), float(u.mp) + float(u.mp_max) * float(get(R, "mp_regen", 0.03)));
    return fr;
  }

  /** Runs the whole fight. `pre` = [{dmg: mult, status: s, shield: f, heal: f}] one-shot talisman effects applied before tick 0. */
  static simulate(player, enemy, rng, rules, pre = []) {
    const R = get(rules, "battle", {});
    const over = get(rules, "overcomes", {});
    const root_dmg = float(get(get(rules, "start", {}), "root_dmg", 0.06));
    const frames = [];
    const pre_text = [];
    for (const p of pre) {
      if (has(p, "dmg")) {
        const r = Battle._hit(player, enemy, float(p.dmg), str(get(p, "elem", "none")), rng, R, over, root_dmg);
        Battle._damage(enemy, int(r.dmg));
        pre_text.push(sprintf(L.t("Talisman: %d damage"), int(r.dmg)));
      }
      if (has(p, "status")) Battle._apply_status(enemy, { s: p.status, dur: 3, v: 0.25 }, player, rng, pre_text);
      if (has(p, "shield")) {
        player.shield = float(player.shield) + float(player.hp_max) * float(p.shield);
        pre_text.push(L.t("Talisman: ward"));
      }
      if (has(p, "heal")) player.hp = Math.min(float(player.hp_max), float(player.hp) + float(player.hp_max) * float(p.heal));
    }
    if (pre_text.length > 0) {
      frames.push({
        a: 0, skill: "Talisman", zh: L.zh("符"), dmg: 0, crit: false, miss: false, heal: 0, text: pre_text,
        php: int(player.hp), ehp: int(enemy.hp), pmp: int(player.mp), emp: int(enemy.mp),
      });
    }
    const gauge = float(get(R, "gauge", 100));
    let ticks = 0;
    const max_ticks = int(get(R, "max_ticks", 4000));
    let turns = 0;
    while (float(player.hp) > 0.0 && float(enemy.hp) > 0.0 && ticks < max_ticks) {
      ticks += 1;
      player.gauge = float(player.gauge) + Battle._eff(player, "spd", R);
      enemy.gauge = float(enemy.gauge) + Battle._eff(enemy, "spd", R);
      let guard = 0;
      while ((float(player.gauge) >= gauge || float(enemy.gauge) >= gauge) && guard < 4) {
        guard += 1;
        let u;
        let f;
        if (float(player.gauge) >= float(enemy.gauge)) {
          u = player;
          f = enemy;
        } else {
          u = enemy;
          f = player;
        }
        u.gauge = float(u.gauge) - gauge;
        const fr = Battle._act(u, f, rng, R, over, root_dmg);
        turns += 1;
        fr.php = int(player.hp);
        fr.ehp = int(enemy.hp);
        fr.pmp = int(player.mp);
        fr.emp = int(enemy.mp);
        fr.psh = int(player.shield);
        fr.esh = int(enemy.shield);
        frames.push(fr);
        if (float(player.hp) <= 0.0 || float(enemy.hp) <= 0.0) break;
      }
      if (float(player.hp) <= 0.0 || float(enemy.hp) <= 0.0) break;
    }
    let win = float(enemy.hp) <= 0.0 && float(player.hp) > 0.0;
    if (ticks >= max_ticks && !win && float(player.hp) > 0.0) {
      win = float(player.hp) / float(player.hp_max) > float(enemy.hp) / float(enemy.hp_max);
    }
    return {
      win, ticks, turns, frames,
      p_hp: float(player.hp), p_mp: float(player.mp), e_hp: float(enemy.hp), p_max: float(player.hp_max), e_max: float(enemy.hp_max),
    };
  }
}

export default Battle;

// Plain-language descriptions of effect lists (card tooltips, item text) with the numbers the run would actually get
// (port of scripts/bw_text.gd). All static.

import { L } from "./loc.js";
import { sprintf } from "./fmt.js";
import { clampi, float, get, has, int, is_dict, roundi, str } from "./util.js";

export class Txt {
  static fx_lines(run, fx, mult = 1.0, depth = 0) {
    const out = [];
    if (!Array.isArray(fx) || depth > 3) return out;
    const D = run.D;
    for (const o of fx) {
      if (!is_dict(o)) continue;
      const op = str(get(o, "op", ""));
      switch (op) {
        case "cult": {
          let v = float(get(o, "v", 0)) * run.gain_scale() * mult;
          if (str(get(o, "scale", "")) === "insight") v *= run.cult_factor();
          out.push(sprintf(L.t("+%d cultivation"), roundi(v)));
          break;
        }
        case "stat":
          out.push(sprintf("%s %+d", L.stat_name(D, str(get(o, "k", ""))), roundi(float(get(o, "v", 0)) * mult)));
          break;
        case "root":
          out.push(sprintf(L.t("%s root %+d"), L.root_name(D, str(get(o, "k", ""))), int(get(o, "v", 0))));
          break;
        case "hp":
          out.push(
            sprintf(
              L.t("%+d HP"),
              roundi(float(get(o, "v", 0)) * float(get(D.realm(run.realm), "power", 1.0)) * (float(get(o, "v", 0)) > 0 ? mult : 1.0)),
            ),
          );
          break;
        case "hp_pct":
          out.push(sprintf(L.t("%+d%% HP"), roundi(float(get(o, "v", 0)) * 100.0)));
          break;
        case "mp":
        case "mp_pct":
          out.push(L.t("restores mana"));
          break;
        case "life":
          out.push(sprintf(L.t("Lifespan %+d term(s)"), int(get(o, "v", 0))));
          break;
        case "stone":
          out.push(sprintf(L.t("%+d stones"), roundi(float(get(o, "v", 0)) * run.stone_scale() * mult)));
          break;
        case "mat":
          out.push(sprintf("%+d %s", roundi(float(get(o, "v", 0)) * mult), L.t(str(get(o, "k", "")))));
          break;
        case "item":
          out.push(sprintf(L.t("Get %s"), L.name_of(D.item(str(get(o, "id", ""))))));
          break;
        case "card":
          out.push(sprintf(L.t("New card: %s"), L.name_of(D.card(str(get(o, "id", ""))))));
          break;
        case "tech":
          out.push(sprintf(L.t("Learn %s"), L.name_of(D.tech(str(get(o, "id", ""))))));
          break;
        case "notice":
          out.push(sprintf(L.t("Notice %+d"), int(get(o, "v", 0))));
          break;
        case "corrupt":
          out.push(sprintf(L.t("Corruption %+d"), int(get(o, "v", 0))));
          break;
        case "rel":
          out.push(sprintf("%s %+d", L.cast_name(str(get(o, "k", ""))), int(get(o, "v", 0))));
          break;
        case "battle":
          out.push(sprintf(L.t("Fight: %s"), L.name_of(D.enemy(str(get(o, "enemy", ""))))));
          break;
        case "roll":
          out.push(sprintf(L.t("A test of %s"), L.stat_name(D, str(get(o, "stat", "")))));
          break;
        case "rand":
          out.push(L.t("Chance decides"));
          break;
        case "if":
          for (const l of Txt.fx_lines(run, get(o, "then", []), mult, depth + 1)) out.push(l);
          break;
        case "event":
          out.push(L.t("Something happens"));
          break;
        case "offer":
          out.push(L.t("Opens an opportunity"));
          break;
        case "ap":
          out.push(sprintf(L.t("%+d action"), int(get(o, "v", 0))));
          break;
        case "truth":
          out.push(L.t("A page of the writ"));
          break;
        default:
      }
    }
    return out;
  }

  /** "3 herb, 20 stone": the value as GDScript's str() prints it (a whole number from the JSON data has no ".0" here) */
  static cost_line(c) {
    const parts = [];
    for (const k of Object.keys(c || {})) {
      if (k === "item") continue;
      parts.push(sprintf("%s %s", str(c[k]), L.t(k)));
    }
    return parts.join(", ");
  }

  static tier_zh(t) {
    return L.zh(["普", "良", "精", "绝"][clampi(t, 0, 3)]);
  }

  /** The tier word in the shown language (a single glyph in Chinese, the quality name in English). */
  static tier_name(t) {
    if (L.is_zh()) return L.zh(["普通", "优良", "精品", "绝品"][clampi(t, 0, 3)]);
    return [L.t("Plain"), L.t("Fine"), L.t("Rare"), L.t("Supreme")][clampi(t, 0, 3)];
  }

  static tier_en(t) {
    return Txt.tier_name(t);
  }

  static cat_name(cat) {
    const zh = { cultivate: "修炼", craft: "炼制", venture: "历练", social: "交游", rest: "休养", chance: "机缘", combat: "斗法" };
    const en = { cultivate: "Cultivate", craft: "Craft", venture: "Venture", social: "Social", rest: "Rest", chance: "Chance", combat: "Combat" };
    const m = L.is_zh() ? zh : en;
    return has(m, cat) ? (L.is_zh() ? L.zh(m[cat]) : m[cat]) : cat;
  }

  /** Kept for old callers. */
  static cat_zh(cat) {
    return Txt.cat_name(cat);
  }
}

export default Txt;

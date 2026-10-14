// Localization (port of scripts/bw_loc.gd): ONE language is shown at a time (Settings picks it). Every string the player reads goes
// through L.t(english).
//
//   L.t("Bag")                       -> "Bag" / "背包"
//   L.f("%d terms left", [n])        -> translate the format first, then fill it in
//   L.name_of(entity)                -> entity.zh in Chinese, entity.en otherwise (cards, items, enemies, techniques, talents ...)
//   L.stat_name(D, "body") / L.root_name(D, "fire") / L.realm_name(D, 2) / L.place_name("village")
//
// The Chinese table is {English string: Chinese string}, merged from every data/i18n/zh*.json (zh_content_*.json for the story and
// rules text, zh_ui*.json for the interface). A string with no entry is shown in English, so a missing line never breaks a screen.
// The tables are loaded once: `await L.load(fetch_json, D.i18n_files)` in the browser, `L.load_tables([obj, ...])` in Node.

import { sprintf } from "./fmt.js";
import { capitalize, clampi, get, has, str } from "./util.js";

const LANGS = ["en", "zh"];
const NATIVE_NAMES = { en: "English", zh: "中文" };

const CAST = {
  xiaohe: ["Xiao He", "小禾"],
  moshan: ["Mo Shan", "墨山"],
  yunzhi: ["Yun Zhi", "云织"],
  sujiu: ["Su Jiu", "苏九"],
  xiaoheng: ["Xiao Heng", "萧衡"],
  ye: ["Ye Wujin", "夜无烬"],
  qingnang: ["Granny Qingnang", "青囊婆婆"],
  xuanxiao: ["Master Xuanxiao", "玄霄真人"],
  siming: ["The Magistrate", "司命"],
  villager: ["A villager", "村民"],
  elder: ["An elder", "长者"],
  merchant: ["A merchant", "行商"],
  disciple: ["A disciple", "弟子"],
  clerk: ["A clerk of the Registry", "司命使"],
  hero: ["You", "你"],
};

const ELEM_ZH = { metal: "金", wood: "木", water: "水", fire: "火", earth: "土", none: "无", "": "无" };
const ELEM_EN = { metal: "Metal", wood: "Wood", water: "Water", fire: "Fire", earth: "Earth", none: "Neutral", "": "Neutral" };

const PLACE_ZH = {
  village: "青石村",
  town: "落星镇",
  sect: "青霄山",
  valley: "百草谷",
  wilds: "万妖林",
  ruin: "断天遗府",
  netherworld: "九幽殿",
  registry: "司命殿",
  gate: "天门",
  wheel: "轮回盘",
  cave: "洞府",
  road: "山路",
};
const PLACE_EN = {
  village: "Blue-stone Village",
  town: "Fallen-Star Town",
  sect: "Azure Sky Mountain",
  valley: "Hundred-Herb Valley",
  wilds: "The Wilds",
  ruin: "Sky-Severed Ruin",
  netherworld: "Nine-Netherworld Hall",
  registry: "Hall of the Registry",
  gate: "Heaven's Gate",
  wheel: "The Wheel",
  cave: "Cave dwelling",
  road: "The road",
};

export class L {
  static LANGS = LANGS;
  static NATIVE_NAMES = NATIVE_NAMES;
  static CAST = CAST;
  static lang = "en";
  static _zh = new Map();
  static _loaded = false;
  static _fetch = null;
  static _files = [];

  static set_lang(l) {
    L.lang = LANGS.includes(l) ? l : "en";
  }

  static is_zh() {
    return L.lang === "zh";
  }

  /** merges the Chinese tables (an array of {english: chinese} objects); later files win */
  static load_tables(tables) {
    L._zh = new Map();
    for (const v of tables) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const k of Object.keys(v)) L._zh.set(k, String(v[k]));
      }
    }
    L._loaded = true;
  }

  /** browser: fetches every file (paths relative to the site root, "data/i18n/zh_ui.json") and merges them in name order */
  static async load(fetch_json, files) {
    L._fetch = fetch_json;
    L._files = [...(files || [])].sort();
    // fetched at once, merged in name order (later files win)
    const tables = await Promise.all(
      L._files.map(async (f) => {
        try {
          return await fetch_json(f);
        } catch (e) {
          return null; // a missing table only means more English
        }
      }),
    );
    L.load_tables(tables);
  }

  static async reload() {
    L._loaded = false;
    if (L._fetch) await L.load(L._fetch, L._files);
  }

  /** How many English strings have a Chinese line (for tests / the settings screen). */
  static zh_count() {
    return L._zh.size;
  }

  static has_zh(en) {
    return L._zh.has(en);
  }

  static t(en) {
    if (L.lang === "en" || en === "" || en === null || en === undefined) return en;
    const z = L._zh.get(en);
    return z === undefined ? en : z;
  }

  /** translate the format, then fill it in: L.f("%d terms left", [n]) */
  static f(en, args) {
    return sprintf(L.t(en), Array.isArray(args) ? args : [args]);
  }

  /** The shown name of a data entity: {en: "...", zh: "..."}. */
  static name_of(e) {
    if (e === null || e === undefined) return "";
    if (L.lang === "zh" && str(get(e, "zh", "")) !== "") return String(e.zh);
    return str(get(e, "en", get(e, "zh", get(e, "id", ""))));
  }

  /** The shown name of a cast member / portrait id (xiaohe, moshan, clerk ...). */
  static cast_name(id) {
    id = str(id);
    const pair = has(CAST, id) ? CAST[id] : [capitalize(id), capitalize(id)];
    return L.lang === "zh" ? pair[1] : pair[0];
  }

  static stat_name(D, key) {
    return L.name_of(get(get(D.rules, "stat_names", {}), key, { en: key }));
  }

  static root_name(D, key) {
    return L.name_of(get(get(D.rules, "root_names", {}), key, { en: key }));
  }

  static realm_name(D, r) {
    return L.name_of(D.realm(r));
  }

  static elem_name(e) {
    e = str(e);
    const m = L.lang === "zh" ? ELEM_ZH : ELEM_EN;
    return has(m, e) ? m[e] : capitalize(e);
  }

  static place_name(place) {
    place = str(place);
    const m = L.lang === "zh" ? PLACE_ZH : PLACE_EN;
    return has(m, place) ? m[place] : capitalize(place);
  }

  /** "Qi Refining 3" / "炼气三层": realm name and layer. */
  static realm_label(D, realm, layer) {
    const n = L.realm_name(D, realm);
    if (realm === 0) return n;
    if (L.lang === "zh") return sprintf("%s%s层", n, ["", "一", "二", "三"][clampi(layer, 0, 3)]);
    return sprintf("%s %d", n, layer);
  }
}

export default L;

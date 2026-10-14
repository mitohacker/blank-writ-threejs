// Localization (port of scripts/bw_loc.gd): ONE language is shown at a time (Settings picks it). Every string the player reads goes
// through L.t(english).
//
//   L.t("Bag")                       -> "Bag" / "背包" (简体) / "背包" (繁體)
//   L.f("%d terms left", [n])        -> translate the format first, then fill it in
//   L.name_of(entity)                -> entity.zh in Chinese, entity.en otherwise (cards, items, enemies, techniques, talents ...)
//   L.stat_name(D, "body") / L.root_name(D, "fire") / L.realm_name(D, 2) / L.place_name("village")
//
// Three languages: "zh-Hant" (繁體, the default of the game), "zh-Hans" (简体) and "en". The Chinese table is {English string: Chinese
// string}, merged from every data/i18n/zh*.json (Simplified; zh_content_*.json for the story and rules text, zh_ui*.json for the
// interface) and, for Traditional, from the same names under data/i18n/hant/ (converted ahead of time by tools/build_hant.py). A string
// with no entry is shown in English, so a missing line never breaks a screen. Names live in the data's `zh` fields: BWData.set_script(hant)
// rewrites them for the script on show.
//   browser: `L.setup(fetch_json, D)` then `await L.use("zh-Hant")`;  Node: `L.load_tables([obj, ...])` (Simplified) and
//   `L.load_tables_hant([...])`, then `L.set_lang(...)`.

import { sprintf } from "./fmt.js";
import { capitalize, clampi, get, has, str } from "./util.js";
import { convert as hant } from "./hant.js";

const LANGS = ["zh-Hant", "zh-Hans", "en"];
const NATIVE_NAMES = { "zh-Hant": "繁體中文", "zh-Hans": "简体中文", en: "English" };
export const DEFAULT_LANG = "zh-Hant";

/** any spelling of a language -> one of LANGS; a bare "zh" means `bare_zh` ("zh-Hans" is what the first release saved), "" = unknown */
export function normalize_lang(l, bare_zh = "zh-Hans") {
  const s = String(l || "").trim().toLowerCase().replace("_", "-");
  if (s === "en" || s.startsWith("en-")) return "en";
  if (["zh-hant", "tc", "trad", "zh-tw", "zh-hk", "zh-mo", "cht"].includes(s)) return "zh-Hant";
  if (["zh-hans", "sc", "simp", "zh-cn", "zh-sg", "chs"].includes(s)) return "zh-Hans";
  if (s === "zh" || s.startsWith("zh-")) return bare_zh;
  return "";
}

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
  static _zh = new Map();          // Simplified: {English: 简体}
  static _hant = new Map();        // Traditional: {English: 繁體}
  static _loaded = false;
  static _loaded_hant = false;
  static _fetch = null;
  static _files = [];
  static _files_hant = [];
  static _D = null;

  /** "en" | "zh-Hant" | "zh-Hans"; a bare "zh" means Simplified here (the first release's saves and the Node tests) */
  static set_lang(l) {
    L.lang = normalize_lang(l, "zh-Hans") || "en";
    if (L._D) L._D.set_script(L.lang === "zh-Hant");
  }

  /** a Chinese language (either script) */
  static is_zh() {
    return L.lang === "zh-Hant" || L.lang === "zh-Hans";
  }

  static is_hant() {
    return L.lang === "zh-Hant";
  }

  /** a string written in Simplified in the code, in the script on show */
  static zh(s) {
    return L.lang === "zh-Hant" ? hant(s) : s;
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

  /** the Traditional tables (same keys) */
  static load_tables_hant(tables) {
    L._hant = new Map();
    for (const v of tables) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const k of Object.keys(v)) L._hant.set(k, String(v[k]));
      }
    }
    L._loaded_hant = true;
  }

  /** browser: remembers where the tables are (D.i18n_files / D.i18n_hant_files) and links the data so names follow the script */
  static setup(fetch_json, D) {
    L._fetch = fetch_json;
    L._files = [...(D.i18n_files || [])].sort();
    L._files_hant = [...(D.i18n_hant_files || [])].sort();
    L._loaded = false;
    L._loaded_hant = false;
    L.link(D);
  }

  /** the data whose names follow the language (setup() does this; Node tests call it themselves) */
  static link(D) {
    L._D = D;
    if (D) D.set_script(L.lang === "zh-Hant");
  }

  /** switches the language, fetching the tables of its script when they are not loaded yet */
  static async use(l) {
    const n = normalize_lang(l, "zh-Hans") || "en";
    if (n === "zh-Hant" && !L._loaded_hant && L._fetch) await L._fetch_tables(L._files_hant, true);
    if (n === "zh-Hans" && !L._loaded && L._fetch) await L._fetch_tables(L._files, false);
    L.set_lang(n);
    return L.lang;
  }

  static async _fetch_tables(files, is_hant) {
    const tables = await Promise.all(
      files.map(async (f) => {
        try {
          return await L._fetch(f);
        } catch (e) {
          return null; // a missing table only means more English
        }
      }),
    );
    if (is_hant) L.load_tables_hant(tables);
    else L.load_tables(tables);
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
    L._loaded_hant = false;
    if (L._fetch) await L.use(L.lang);
  }

  /** How many English strings have a Chinese line (for tests / the settings screen). */
  static zh_count() {
    return L.lang === "zh-Hant" ? L._hant.size : L._zh.size;
  }

  static has_zh(en) {
    return L.lang === "zh-Hant" ? L._hant.has(en) : L._zh.has(en);
  }

  static t(en) {
    if (L.lang === "en" || en === "" || en === null || en === undefined) return en;
    if (L.lang === "zh-Hant") {
      const h = L._hant.get(en);
      if (h !== undefined) return h;
      const z0 = L._zh.get(en); // a Simplified line that has no converted twin yet: convert it on the fly
      return z0 === undefined ? en : hant(z0);
    }
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
    if (L.is_zh() && str(get(e, "zh", "")) !== "") return String(e.zh);
    return str(get(e, "en", get(e, "zh", get(e, "id", ""))));
  }

  /** The shown name of a cast member / portrait id (xiaohe, moshan, clerk ...). */
  static cast_name(id) {
    id = str(id);
    const pair = has(CAST, id) ? CAST[id] : [capitalize(id), capitalize(id)];
    return L.is_zh() ? L.zh(pair[1]) : pair[0];
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
    const m = L.is_zh() ? ELEM_ZH : ELEM_EN;
    return has(m, e) ? (L.is_zh() ? L.zh(m[e]) : m[e]) : capitalize(e);
  }

  static place_name(place) {
    place = str(place);
    const m = L.is_zh() ? PLACE_ZH : PLACE_EN;
    return has(m, place) ? (L.is_zh() ? L.zh(m[place]) : m[place]) : capitalize(place);
  }

  /** "Qi Refining 3" / "炼气三层": realm name and layer. */
  static realm_label(D, realm, layer) {
    const n = L.realm_name(D, realm);
    if (realm === 0) return n;
    if (L.is_zh()) return sprintf("%s%s", n, L.zh(["", "一", "二", "三"][clampi(layer, 0, 3)] + "层"));
    return sprintf("%s %d", n, layer);
  }
}

export default L;

// The three languages (zh-Hant default, zh-Hans, en) in the sim: the Traditional tables cover every Simplified line and hold no
// Simplified-only character, names follow the script, whole lives in Traditional say Traditional. Run: node tests/test_hant.mjs
import { load_game, make_run } from "./node_loader.mjs";
import { L, normalize_lang, DEFAULT_LANG } from "../src/sim/loc.js";
import { convert, has_simplified } from "../src/sim/hant.js";
import { DST } from "../src/sim/hant_data.js";
import { Auto } from "../src/sim/auto.js";
import { RNG } from "../src/sim/rng.js";
import { Txt } from "../src/sim/text.js";

let checks = 0;
let fails = 0;
const ok = (c, m) => {
  checks++;
  if (!c) {
    fails++;
    console.log("FAIL ", m);
  }
};

// characters that are valid Traditional too (a Simplified-only check must not flag them): those that appear on the DST side
// plus characters that are the same in both scripts for some words (里 the unit, 斗 the measure, 托盘, 岩, 干, 伙, 准, 辟谷, 台, 夸, 几案, 划)
const valid_trad = new Set([...Array.from(DST), ...Array.from("里斗托岩干伙准辟台夸几划后松只发")]);
const simp_left = (s) => Array.from(String(s)).filter((ch) => has_simplified(ch) && !valid_trad.has(ch));

const g = await load_game({ lang: "zh-Hans" });
const D = g.D;

// -- the language names ---------------------------------------------------------------------------------------------------------
ok(DEFAULT_LANG === "zh-Hant", "the default language is Traditional Chinese");
ok(JSON.stringify(L.LANGS) === JSON.stringify(["zh-Hant", "zh-Hans", "en"]), `three languages, Traditional first (${L.LANGS})`);
ok(normalize_lang("zh") === "zh-Hans" && normalize_lang("zh", "zh-Hant") === "zh-Hant", "a bare zh is Simplified for saves, Traditional when asked");
ok(normalize_lang("zh-TW") === "zh-Hant" && normalize_lang("zh-HK") === "zh-Hant" && normalize_lang("zh-CN") === "zh-Hans" && normalize_lang("en-US") === "en", "regional codes map to the scripts");
ok(normalize_lang("fr") === "", "an unknown language is unknown");

// -- tables ---------------------------------------------------------------------------------------------------------------------
const hans_keys = Array.from(L._zh.keys());
ok(hans_keys.length > 2800, `Simplified table has ${hans_keys.length} lines`);
ok(L._hant.size === L._zh.size, `Traditional table has as many lines (${L._hant.size} / ${L._zh.size})`);
let missing = 0;
let leftover = [];
let same = 0;
for (const k of hans_keys) {
  const h = L._hant.get(k);
  if (h === undefined) {
    missing++;
    continue;
  }
  const bad = simp_left(h);
  if (bad.length) leftover.push(`${bad.join("")} in ${h.slice(0, 30)}`);
  if (h === L._zh.get(k)) same++;
  // placeholders survive
  const ph = (s) => (s.match(/%[+\-]?\d*(\.\d+)?[dsf]|%%|\[\/?[a-z]+(=[^\]]*)?\]/g) || []).join("|");
  if (ph(h) !== ph(L._zh.get(k))) leftover.push(`placeholders differ: ${k.slice(0, 40)}`);
}
ok(missing === 0, `every Simplified line has a Traditional one (${missing} missing)`);
ok(leftover.length === 0, `no Simplified-only characters or lost placeholders in the Traditional tables (${leftover.length}: ${leftover.slice(0, 4).join(" | ")})`);
ok(same < 400, `most lines really differ between the scripts (${same} identical)`);

// -- L.t in each language ----------------------------------------------------------------------------------------------------------
L.set_lang("zh-Hans");
ok(L.t("Bag") === "背包" && L.t("Settings") === "设置", `Simplified UI words (${L.t("Bag")} ${L.t("Settings")})`);
L.set_lang("zh-Hant");
ok(L.t("Bag") === "背包" && L.t("Settings") === "設定" && L.t("Menu") === "選單", `Traditional UI words (${L.t("Bag")} ${L.t("Settings")} ${L.t("Menu")})`);
ok(L.t("Cultivation") === "修為" && L.t("Roots") === "靈根" && L.t("Techniques") === "功法", "Traditional words: 修為 靈根 功法");
ok(L.t("no such string anywhere") === "no such string anywhere", "unknown strings stay English");
ok(L.is_zh() && L.is_hant(), "is_zh / is_hant in Traditional");
L.set_lang("en");
ok(L.t("Bag") === "Bag" && !L.is_zh(), "English is the identity");

// -- names follow the script -----------------------------------------------------------------------------------------------------
const first = Object.values(D.cards).find((c) => c.zh && simp_left(convert(c.zh)).length === 0 && convert(c.zh) !== c.zh);
L.set_lang("zh-Hans");
const simp_name = first.zh;
L.set_lang("zh-Hant");
ok(first.zh === convert(simp_name) && first.zh !== simp_name, `a card's name is converted (${simp_name} -> ${first.zh})`);
let name_left = [];
for (const coll of [D.cards, D.items, D.enemies, D.techs, D.talents, D.origins, D.methods, D.truths, D.endings, D.wheel]) {
  for (const e of Object.values(coll)) if (e.zh) name_left.push(...simp_left(e.zh).map((c) => `${c} in ${e.zh}`));
}
for (const r of D.rules.realms || []) if (r.zh) name_left.push(...simp_left(r.zh));
for (const v of Object.values(D.rules.stat_names || {})) if (v.zh) name_left.push(...simp_left(v.zh));
ok(name_left.length === 0, `no Simplified-only characters in any name in Traditional (${name_left.slice(0, 5).join(", ")})`);
L.set_lang("zh-Hans");
ok(first.zh === simp_name, "switching back restores the Simplified name");
L.set_lang("zh-Hant");
ok(L.cast_name("yunzhi") === "雲織" && L.place_name("wilds") === "萬妖林" && L.elem_name("none") === "無", "cast, place and element names in Traditional");
ok(Txt.cat_name("combat") === "鬥法" && Txt.tier_name(3) === "絕品" && Txt.tier_zh(1) === "良", `tier / category words (${Txt.cat_name("combat")} ${Txt.tier_name(3)})`);
ok(L.realm_label(D, 2, 3).endsWith("三層"), `realm label in Traditional (${L.realm_label(D, 2, 3)})`);

// -- whole lives in Traditional ---------------------------------------------------------------------------------------------------
let lines = 0;
let ascii = 0;
let simp = [];
for (const seed of [3, 4, 5]) {
  const run = make_run(seed, { game: g });
  const pol = new RNG(seed + 100);
  const rec = {};
  for (let t = 0; t < 40 && !run.dead; t++) {
    const outs = [];
    Auto.resolve_events(run, pol, rec);
    Auto.play_term(run, pol, rec);
    if (run.dead) break;
    run.end_term();
    Auto.resolve_events(run, pol, rec);
  }
  for (const l of run.log_all) {
    lines++;
    const s = String(l);
    if (!/[一-鿿]/.test(s)) ascii++;
    const bad = simp_left(s);
    if (bad.length) simp.push(`${bad.join("")} in ${s.slice(0, 40)}`);
  }
}
ok(lines > 100, `lives in Traditional write lines (${lines})`);
ok(ascii <= lines * 0.05, `almost every line has Chinese (${ascii} / ${lines} without)`);
ok(simp.length === 0, `no Simplified-only characters in the lines of a life in Traditional (${simp.length}: ${simp.slice(0, 4).join(" | ")})`);

console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);

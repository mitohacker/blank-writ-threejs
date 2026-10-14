// Traditional Chinese is the default: a visitor with no saved choice (and an English browser) gets 繁體; Settings offers 繁體中文 / 简体中文 /
// English and remembers the pick; every key screen in Traditional shows only Traditional characters.
//   timeout 200 node tests/browser/test_hant_ui.mjs

import { open_game, shot, close, sleep } from "./launch.mjs";
import { DST } from "../../src/sim/hant_data.js";
import { SRC } from "../../src/sim/hant_data.js";

const AMBIGUOUS = "里斗托岩干伙准辟台夸几划后松只发";
const simp_only = new Set(Array.from(SRC).filter((c) => !DST.includes(c) && !AMBIGUOUS.includes(c)));
let fails = 0;
let checks = 0;
const ok = (c, m) => {
  checks++;
  if (!c) {
    fails++;
    console.log("FAIL ", m);
  }
};

async function texts(page) {
  return page.evaluate(() => {
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 3) {
        const t = n.textContent.trim();
        if (t) out.push(t);
      } else if (n.nodeType === 1) {
        if (n.title) out.push(n.title);
        for (const c of n.childNodes) walk(c);
      }
    };
    walk(document.getElementById("stage"));
    return out;
  });
}
const simplified_in = (list) => {
  const bad = [];
  for (const t of list) for (const ch of t) if (simp_only.has(ch)) bad.push(`${ch} in ${t.slice(0, 30)}`);
  return bad;
};

// 1. a first visit, English browser, nothing saved: Traditional -------------------------------------------------------------------
{
  const g = await open_game({ query: "fresh=1" });
  const p = g.page;
  const st = await p.evaluate(() => ({ lang: window.__bw.meta.options.lang, L: document.documentElement.lang, title: document.title, scr: window.__bw.screen_name }));
  ok(st.L === "zh-Hant", `the page language is zh-Hant by default (${st.L})`);
  ok(st.title === "無字命", `the tab title is Traditional (${st.title})`);
  const t = await texts(p);
  ok(t.includes("新生") && t.includes("設定"), `the title menu is Traditional (${t.slice(0, 8).join(" | ")})`);
  ok(simplified_in(t).length === 0, `no Simplified-only characters on the title (${simplified_in(t).slice(0, 3)})`);
  await shot(p, "shots/hant_title.png");
  // the Settings screen lists the three languages in their own words
  await p.click("[data-id=settings]");
  await sleep(500);
  const names = await p.evaluate(() => Array.from(document.querySelectorAll("[data-lang]")).map((b) => b.dataset.lang + ":" + b.textContent));
  ok(names.join(",") === "zh-Hant:繁體中文,zh-Hans:简体中文,en:English", `three languages offered, Traditional first (${names})`);
  await shot(p, "shots/hant_settings.png");
  // -> Simplified
  await p.click('[data-lang="zh-Hans"]');
  await p.waitForFunction(() => window.__bw.meta.options.lang === "zh-Hans" && document.querySelector("[data-lang]"), null, { timeout: 8000 });
  await sleep(300);
  let t2 = await texts(p);
  ok(t2.includes("设置") && !t2.includes("設定"), `Simplified after the switch (${t2.slice(0, 6).join(" | ")})`);
  ok(await p.evaluate(() => document.documentElement.lang === "zh-Hans"), "the page language follows (zh-Hans)");
  // -> English
  await p.click('[data-lang="en"]');
  await p.waitForFunction(() => window.__bw.meta.options.lang === "en" && document.querySelector("[data-lang]"), null, { timeout: 8000 });
  await sleep(300);
  t2 = await texts(p);
  ok(t2.includes("Settings"), "English after the switch");
  // -> Traditional again, remembered across a reload
  await p.click('[data-lang="zh-Hant"]');
  await p.waitForFunction(() => window.__bw.meta.options.lang === "zh-Hant", null, { timeout: 8000 });
  await close(g);
}

// 2. a saved choice is honoured, and the first release's "zh" is Simplified -----------------------------------------------------------
{
  const g = await open_game({ query: "screen=title" });
  const p = g.page;
  await p.evaluate(() => {
    localStorage.setItem("bw.profile", JSON.stringify({ imprints: 0, ranks: {}, flags: {}, lives: 0, options: { lang: "zh", hints_seen: {} } }));
  });
  await p.goto(p.url());
  await p.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 30000 });
  let l = await p.evaluate(() => window.__bw.meta.options.lang + "|" + document.documentElement.lang);
  ok(l.endsWith("zh-Hans"), `a first-release save with "zh" opens in Simplified (${l})`);
  await p.evaluate(() => {
    localStorage.setItem("bw.profile", JSON.stringify({ imprints: 0, ranks: {}, flags: {}, lives: 0, options: { lang: "en", hints_seen: {} } }));
  });
  await p.goto(p.url());
  await p.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 30000 });
  l = await p.evaluate(() => document.documentElement.lang);
  ok(l === "en", `a saved English choice is kept (${l})`);
  await p.evaluate(() => localStorage.clear());
  await close(g);
}

// 3. the life screens in Traditional ----------------------------------------------------------------------------------------------
{
  const g = await open_game({ query: "fresh=1&screen=term&autoplay=9&seed=77&fast=1" });
  const p = g.page;
  await sleep(1200);
  let t = await texts(p);
  ok(simplified_in(t).length === 0, `the term screen has no Simplified-only characters (${simplified_in(t).slice(0, 3)})`);
  ok(t.some((x) => x.includes("結束回合")), "the term screen says 結束回合");
  const cards = await p.evaluate(() => window.__bw.screen.hand.texts ? window.__bw.screen.hand.texts() : []);
  const ct = Array.isArray(cards) ? cards.flat().map(String) : [];
  ok(simplified_in(ct).length === 0, `the cards (${ct.length} texts) have no Simplified-only characters (${simplified_in(ct).slice(0, 3)})`);
  await shot(p, "shots/hant_term.png");
  // an event and a battle
  await p.goto(p.url().replace("screen=term", "screen=term&event=a1_winter_1"));
  await p.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 30000 });
  await sleep(1500);
  t = await texts(p);
  ok(simplified_in(t).length === 0, `an event has no Simplified-only characters (${simplified_in(t).slice(0, 3)})`);
  await shot(p, "shots/hant_event.png");
  await p.goto(p.url().replace("event=a1_winter_1", "battle=wolf"));
  await p.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 30000 });
  await sleep(4000);
  t = await texts(p);
  ok(simplified_in(t).length === 0, `a battle has no Simplified-only characters (${simplified_in(t).slice(0, 3)})`);
  await shot(p, "shots/hant_battle.png");
  const errs = g.errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED/.test(e));
  ok(errs.length === 0, `no page errors (${errs.slice(0, 3).join(" | ")})`);
  await close(g);
}

console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);

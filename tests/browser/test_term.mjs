// Browser test of the in-life screens (term, hand of cards, event dialog, battle window, overlays): drives the real UI like a player,
// in English and in Chinese, with a fresh profile.
//
//   timeout 150 node tests/browser/test_term.mjs                  both languages (about 2 x 60 s)
//   timeout 150 node tests/browser/test_term.mjs --lang=zh        one language
//   options: --shared (use the port in BW_PORT / 8712 instead of a private server on 8742)  --seed=77  --budget=30000 (ms of play per language)  --terms=40  --nogl (also run the no-WebGL fallback check)  --only=nogl (just that)
//
// What it checks: no page errors; the screens show up (term, event, results, battle, bag, techniques, journal, menu, shop, library);
// cards are played by clicking them where they are on the canvas, End Term by clicking its button, event choices and battle windows are
// clicked through until the life ends (or the budget); nothing stays "busy" for long; the hand on screen matches the run; every visible
// text is in the right language (no CJK in English; in Chinese no run of 3+ Latin letters outside a short allowlist).
// Screenshots go to shots/term_<lang>_*.png (read them!). Exit code != 0 on failure.
//
// Memory safety: one browser at a time, always closed; every loop is capped by an iteration count and a wall-clock deadline.

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v === undefined ? "1" : v]));

// The page asks for ~100 pictures at once; serve.py's listen backlog of 5 makes Windows refuse some of them (see NOTES_term.md). Unless a
// port is given (BW_PORT) or --shared is passed, the test serves the site itself from tests/browser/_serve_big.py on port 8742 and stops it
// at the end.
let own_server = null;
async function port_open(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/index.html`, { method: "HEAD" })).ok;
  } catch (e) {
    return false;
  }
}
if (!process.env.BW_PORT && !args.shared) {
  process.env.BW_PORT = "8742";
  if (!(await port_open(8742))) {
    own_server = spawn("python", [resolve(ROOT, "tests/browser/_serve_big.py"), "8742"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, SERVE_QUIET: "1" } });
    for (let i = 0; i < 60 && !(await port_open(8742)); i++) await new Promise((r) => setTimeout(r, 150));
  }
}
const stop_server = () => {
  if (own_server) {
    try {
      own_server.kill();
    } catch (e) {
      /* already gone */
    }
    own_server = null;
  }
};
process.on("exit", stop_server);
const { open_game, shot, close, sleep } = await import("./launch.mjs");
const PORT = Number(process.env.BW_PORT || 8712);
const LANGS = args.only === "nogl" ? [] : args.lang ? [args.lang] : ["en", "zh"];
const SEED = Number(args.seed || 77);
const BUDGET = Number(args.budget || 30000);
const MAX_TERMS = Number(args.terms || 40);

let failures = 0;
let checks = 0;
const notes = [];
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log("FAIL  " + msg);
  }
}

// ---- small pseudo-random for choices (a seeded LCG: the run is reproducible) ------------------------------------------------------
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- page helpers -----------------------------------------------------------------------------------------------------------------
const snap = (page) =>
  page.evaluate(() => {
    const b = window.__bw;
    const s = b && b.screen;
    const q = (x) => document.querySelector(x);
    const st = s && s.state ? s.state() : null;
    const bc = q("[data-bw=battle] [data-role=continue]");
    return {
      screen: b ? b.screen_name : "",
      st,
      battle: !!q("[data-bw=battle]"),
      battle_done: !!bc && getComputedStyle(bc).display !== "none",
      event: !!q("[data-bw=event]"),
      cont: !!q("[data-bw=event] [data-role=continue]"),
      choices: [...document.querySelectorAll("[data-bw=event] [data-role=choice]")].map((e) => ({ i: Number(e.dataset.i), off: e.classList.contains("disabled") })),
      overlay: (q("[data-bw=overlay]") || { dataset: {} }).dataset.kind || "",
      tooltip: !!q(".tooltip"),
    };
  });

async function texts(page) {
  return page.evaluate(() => {
    const st = document.getElementById("stage");
    const parts = [st ? st.innerText : ""];
    const s = window.__bw && window.__bw.screen;
    if (s && s.hand && s.hand.texts) parts.push(...s.hand.texts());
    return parts.join("\n");
  });
}

const RUN_SIG = () => {
  const r = window.__bw.run;
  return [r.ap, r.term, r.hand.map((h) => h.id).join(","), Object.keys(r.current || {}).length, r.dead].join("|");
};

const CJK = /[\u3400-\u9fff\uff00-\uffef]/;
const LATIN_RUN = /[A-Za-z]{3,}/g;
const ZH_ALLOW = [/^x\d/i];
// strings the run's log lines leak untranslated (sim side, same in the Godot game): reported as notes, not failures
const KNOWN_LEAKS = [/一条道路：[A-Za-z_]+$/, /撕下的无字书一页：[A-Za-z .,'’-]+$/];

function lang_violations(text, lang) {
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (lang === "en" && CJK.test(t)) out.push(t);
    if (lang === "zh") {
      const runs = t.match(LATIN_RUN) || [];
      const bad = runs.filter((r) => !ZH_ALLOW.some((a) => a.test(r)));
      if (bad.length) out.push(t);
    }
  }
  return out;
}

class Session {
  constructor(g, lang) {
    this.g = g;
    this.page = g.page;
    this.lang = lang;
    this.violations = new Map();
    this.shots = new Set();
  }
  async check_lang(where) {
    const t = await texts(this.page);
    for (const v of lang_violations(t, this.lang)) {
      const k = v.slice(0, 160);
      if (!this.violations.has(k)) this.violations.set(k, where);
    }
  }
  async shot(name) {
    if (this.shots.has(name)) return;
    this.shots.add(name);
    await shot(this.page, `shots/term_${this.lang}_${name}.png`);
  }
  async goto(query) {
    await this.page.goto(`http://127.0.0.1:${PORT}/index.html?${query}`);
    await this.page.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 30000 }).catch(() => {});
    await this.page.waitForFunction(() => window.__bw && window.__bw.screen && window.__bw.screen.state, null, { timeout: 20000 }).catch(() => {});
    await sleep(500);
  }
  async click(sel, timeout = 4000) {
    await this.page.locator(sel).first().click({ timeout });
  }
  async wait_for(fn, timeout = 5000) {
    const t0 = Date.now();
    for (let i = 0; i < 400 && Date.now() - t0 < timeout; i++) {
      const s = await snap(this.page);
      if (fn(s)) return s;
      await sleep(40);
    }
    return null;
  }
}

// ---- part A: the screens by their debug flags ---------------------------------------------------------------------------------------
async function part_screens(S) {
  const base = `fresh=1&fast=1&screen=term&autoplay=9&seed=${SEED}&lang=${S.lang}`;
  // the term screen and a hovered card
  await S.goto(base);
  let s = await snap(S.page);
  ok(s.screen === "term" && s.st && s.st.cards > 0 && s.st.cards === s.st.hand, `[${S.lang}] term screen with a hand (${JSON.stringify(s.st)})`);
  await sleep(700); // the deal animation
  await S.check_lang("term");
  await S.shot("term");
  const c = await S.page.evaluate(() => window.__bw.screen.hand.client_center(1));
  await S.page.mouse.move(c.x, c.y);
  await S.wait_for((x) => x.tooltip, 2000);
  s = await snap(S.page);
  ok(s.tooltip, `[${S.lang}] hovering a card shows its tooltip`);
  await sleep(300);
  await S.check_lang("hover");
  await S.shot("hover");
  await S.page.mouse.move(5, 540);
  // the overlays
  for (const [panel, role] of [["bag", "open-bag"], ["tech", "open-tech"], ["journal", "open-journal"]]) {
    await S.click(`[data-role=${role}]`);
    s = await S.wait_for((x) => x.overlay === panel, 2000);
    ok(!!s, `[${S.lang}] ${panel} overlay opens`);
    await sleep(250);
    await S.check_lang(panel);
    await S.shot(panel);
    await S.click("[data-bw=overlay] [data-role=close]");
    s = await S.wait_for((x) => x.overlay === "", 2000);
    ok(!!s, `[${S.lang}] ${panel} overlay closes`);
  }
  // the pause menu by Escape, toggled
  await S.page.keyboard.press("Escape");
  s = await S.wait_for((x) => x.overlay === "menu", 2000);
  ok(!!s, `[${S.lang}] Escape opens the pause menu`);
  await sleep(250);
  await S.check_lang("menu");
  await S.shot("menu");
  await S.page.keyboard.press("Escape");
  s = await S.wait_for((x) => x.overlay === "", 2000);
  ok(!!s, `[${S.lang}] Escape closes it again`);
  // swap mode: highlight, then a swap changes the hand
  const before = await S.page.evaluate(() => JSON.stringify(window.__bw.run.hand.map((h) => h.id)));
  await S.click("[data-role=swap]");
  s = await S.wait_for((x) => x.st && x.st.swap, 2000);
  ok(!!s, `[${S.lang}] the swap button enters swap mode`);
  await sleep(400);
  await S.shot("swap");
  const c0 = await S.page.evaluate(() => window.__bw.screen.hand.client_center(0));
  await S.page.mouse.move(c0.x, c0.y);
  await sleep(120);
  await S.page.mouse.click(c0.x, c0.y);
  s = await S.wait_for((x) => x.st && !x.st.swap && !x.st.busy, 3000);
  const after = await S.page.evaluate(() => JSON.stringify(window.__bw.run.hand.map((h) => h.id)));
  ok(!!s && (before !== after || (await S.page.evaluate(() => window.__bw.run.swaps_left)) === 0), `[${S.lang}] a swap replaces a card`);
  await S.page.mouse.move(5, 540);
  // an event, its results; a battle
  await S.goto(`${base}&event=a1_winter_1`);
  s = await S.wait_for((x) => x.event && x.choices.length > 0, 4000);
  ok(!!s && s.choices.length >= 2, `[${S.lang}] event dialog with choices`);
  await sleep(300);
  await S.check_lang("event");
  await S.shot("event");
  const first = s ? s.choices.find((x) => !x.off) : null;
  if (first) {
    await S.click(`[data-bw=event] [data-role=choice][data-i="${first.i}"]`);
    s = await S.wait_for((x) => x.cont, 4000);
    ok(!!s, `[${S.lang}] choosing shows the results panel`);
    await sleep(300);
    await S.check_lang("results");
    await S.shot("results");
  }
  await S.goto(`${base.replace("&fast=1", "")}&battle=wolf`);
  s = await S.wait_for((x) => x.battle, 4000);
  ok(!!s, `[${S.lang}] battle window opens`);
  await sleep(500);
  // pause (button, then Space), speed, skip
  const bstate = () => S.page.evaluate(() => ({ paused: window.__bw.screen.bv.paused, speed: window.__bw.screen.bv.speed, idx: window.__bw.screen.bv.idx, n: window.__bw.screen.bv.frames.length, done: window.__bw.screen.bv.done }));
  let b0 = await bstate();
  if (!b0.done) {
    await S.click("[data-bw=battle] .btn >> nth=0");
    let b1 = await bstate();
    ok(b1.paused, `[${S.lang}] the Pause button pauses the replay`);
    await S.page.keyboard.press("Space");
    b1 = await bstate();
    ok(!b1.paused, `[${S.lang}] Space resumes it`);
    await S.click("[data-bw=battle] .btn >> nth=1");
    b1 = await bstate();
    ok(b1.speed === 2, `[${S.lang}] the speed button cycles the replay speed`);
  }
  await sleep(500);
  await S.check_lang("battle");
  await S.shot("battle");
  if (!(await bstate()).done) await S.click("[data-bw=battle] [data-role=skip]");
  s = await S.wait_for((x) => x.battle_done, 8000);
  ok(!!s, `[${S.lang}] the battle replay ends with a Continue button`);
  await S.check_lang("battle-end");
  await S.shot("battle_end");
  for (const kind of ["shop", "library"]) {
    await S.goto(`${base}&panel=${kind}`);
    s = await S.wait_for((x) => x.overlay === kind, 3000);
    ok(!!s, `[${S.lang}] ${kind} overlay opens by flag`);
    await sleep(250);
    await S.check_lang(kind);
    await S.shot(kind);
  }
}

// ---- part B: a whole life by clicking -----------------------------------------------------------------------------------------------
async function part_play(S) {
  const rnd = lcg(SEED * 7 + (S.lang === "zh" ? 1 : 0));
  await S.goto(`fresh=1&fast=1&screen=term&seed=${SEED}&lang=${S.lang}`);
  const deadline = Date.now() + BUDGET;
  let terms = 0;
  let plays = 0;
  let events = 0;
  let battles = 0;
  let busy_since = 0;
  let ended = "";
  let iter = 0;
  const seen = { event: false, results: false, battle: false, shop: false, library: false };
  for (; iter < 4000 && Date.now() < deadline && terms < MAX_TERMS; iter++) {
    const s = await snap(S.page);
    if (s.screen !== "term") {
      ended = s.screen;
      break;
    }
    if (s.battle) {
      busy_since = 0;
      if (!seen.battle) {
        seen.battle = true;
        await S.check_lang("battle-play");
      }
      if (s.battle_done) {
        battles++;
        await S.click("[data-bw=battle] [data-role=continue]");
      } else if (rnd() < 0.5) await S.click("[data-bw=battle] [data-role=skip]");
      else await sleep(120);
      continue;
    }
    if (s.event) {
      busy_since = 0;
      if (s.cont) {
        if (!seen.results) {
          seen.results = true;
          await S.check_lang("results-play");
        }
        await S.click("[data-bw=event] [data-role=continue]");
        continue;
      }
      if (!seen.event) {
        seen.event = true;
        await S.check_lang("event-play");
      }
      const open = s.choices.filter((c) => !c.off);
      if (!open.length) {
        ok(false, `[${S.lang}] an event with no open choice`);
        break;
      }
      const pick = open[Math.floor(rnd() * open.length)];
      events++;
      await S.click(`[data-bw=event] [data-role=choice][data-i="${pick.i}"]`);
      await sleep(30);
      continue;
    }
    if (s.overlay) {
      busy_since = 0;
      if (s.overlay === "library") {
        if (!seen.library) {
          seen.library = true;
          await S.check_lang("library-play");
        }
        await S.click("[data-bw=overlay] [data-role=scroll]");
      } else if (s.overlay === "shop") {
        if (!seen.shop) {
          seen.shop = true;
          await S.check_lang("shop-play");
        }
        const buy = await S.page.$("[data-bw=overlay] [data-role=buy]:not(.disabled)");
        if (buy) await buy.click();
        await S.click("[data-bw=overlay] [data-role=close]");
      } else await S.click("[data-bw=overlay] [data-role=close]");
      await sleep(30);
      continue;
    }
    // the idle term screen
    if (s.st.busy) {
      if (!busy_since) busy_since = Date.now();
      if (Date.now() - busy_since > 8000) {
        ok(false, `[${S.lang}] the term screen stayed busy for 8 s with nothing on screen (${JSON.stringify(s.st)})`);
        break;
      }
      await sleep(50);
      continue;
    }
    busy_since = 0;
    if (s.st.cards !== s.st.hand) {
      // a rebuild is in flight (set_cards is async); give it a moment, then it is a failure
      await sleep(150);
      const s2 = await snap(S.page);
      if (s2.st && s2.st.cards !== s2.st.hand) {
        ok(false, `[${S.lang}] the hand on screen (${s2.st.cards}) does not match the run (${s2.st.hand})`);
        break;
      }
      continue;
    }
    const playable = await S.page.evaluate(() => {
      const r = window.__bw.run;
      const out = [];
      if (r.ap <= 0) return out;
      for (let i = 0; i < r.hand.length; i++) if (r.can_play(i).ok) out.push(i);
      return out;
    });
    if (playable.length > 0 && rnd() < 0.92) {
      const i = playable[Math.floor(rnd() * playable.length)];
      const c = await S.page.evaluate((k) => window.__bw.screen.hand.client_center(k), i);
      const sig0 = await S.page.evaluate(RUN_SIG);
      await S.page.mouse.move(c.x, c.y);
      await sleep(60);
      await S.page.mouse.click(c.x, c.y);
      plays++;
      // something must happen: the run changes (action points, hand), or an event / battle / overlay appears
      let changed = false;
      for (let k = 0; k < 60 && !changed; k++) {
        await sleep(50);
        const sig = await S.page.evaluate(RUN_SIG);
        changed = sig !== sig0;
      }
      ok(changed, `[${S.lang}] clicking a playable card does something`);
      if (!changed) break;
    } else {
      terms++;
      await S.click("[data-role=end-term]");
      await sleep(40);
    }
    if (iter % 25 === 0) await S.check_lang("play");
  }
  ok(iter < 4000, `[${S.lang}] the play loop finished inside its cap`);
  const info = await S.page.evaluate(() => {
    const r = window.__bw.run;
    return { term: r.term, realm: r.realm, layer: r.layer, dead: r.dead, cause: r.death_cause, ending: r.ending_id };
  });
  console.log(`[${S.lang}] played ${plays} cards, ${events} event choices, ${battles} battles, ${terms} terms ended in ${iter} steps; ended on "${ended || "term"}" ${JSON.stringify(info)}`);
  if (ended === "death" || ended === "ending") {
    await sleep(500);
    await S.shot(ended);
  }
  ok(plays > 0, `[${S.lang}] cards were played through the UI`);
  ok(events > 0, `[${S.lang}] events were resolved through the UI`);
}

// ---- part C: the DOM fallback when WebGL is unavailable -----------------------------------------------------------------------------
async function part_nogl() {
  const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--disable-3d-apis", "--disable-gpu", "--mute-audio"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/index.html?fresh=1&fast=1&screen=term&autoplay=9&seed=${SEED}&lang=en`);
    await page.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    const info = await page.evaluate(() => ({ gl: window.__bw && window.__bw.world && window.__bw.world.ok, cards: document.querySelectorAll(".bw-card").length, hand: window.__bw.run.hand.length }));
    ok(info.gl === false, "[nogl] WebGL is really unavailable in this run");
    ok(info.cards > 0 && info.cards === info.hand, `[nogl] the hand is drawn as DOM cards (${info.cards}/${info.hand})`);
    await shot(page, "shots/term_en_nogl.png");
    const playable = await page.evaluate(() => {
      const r = window.__bw.run;
      for (let i = 0; i < r.hand.length; i++) if (r.can_play(i).ok) return i;
      return -1;
    });
    if (playable >= 0) {
      const ap0 = await page.evaluate(() => window.__bw.run.ap);
      await page.locator(`.bw-card[data-card="${playable}"]`).click();
      await sleep(900);
      const st = await page.evaluate(() => ({ ap: window.__bw.run.ap, ev: !!document.querySelector("[data-bw=event]"), bt: !!document.querySelector("[data-bw=battle]") }));
      ok(st.ap < ap0 || st.ev || st.bt, "[nogl] clicking a DOM card plays it");
    }
    ok(errors.length === 0, `[nogl] no page errors (${errors.slice(0, 2).join(" | ")})`);
  } finally {
    await browser.close();
  }
}

// ---- main -------------------------------------------------------------------------------------------------------------------------
mkdirSync(resolve(ROOT, "shots"), { recursive: true });
const t_all = Date.now();
for (const lang of LANGS) {
  const g = await open_game({ query: `fresh=1&lang=${lang}`, console_errors: true });
  const S = new Session(g, lang);
  try {
    await part_screens(S);
    await part_play(S);
  } catch (e) {
    ok(false, `[${lang}] test crashed: ${e && e.stack ? e.stack.split("\n").slice(0, 4).join(" / ") : e}`);
  }
  const errs = g.errors.filter((e) => !/favicon|404/.test(e));
  ok(errs.length === 0, `[${lang}] no page errors (${errs.slice(0, 3).join(" | ")})`);
  for (const [text, where] of S.violations) {
    if (KNOWN_LEAKS.some((r) => r.test(text))) console.log(`NOTE  [${lang}] untranslated run-log text on ${where}: ${text}`);
    else ok(false, `[${lang}] wrong-language text on ${where}: ${text}`);
  }
  await close(g);
}
if (args.nogl || args.only === "nogl") await part_nogl();
console.log(`${checks} checks, ${failures} failed, ${((Date.now() - t_all) / 1000).toFixed(0)} s`);
stop_server();
process.exit(failures > 0 ? 1 : 0);

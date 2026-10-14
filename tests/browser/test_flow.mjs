// End to end through the real UI, the way a player goes: title -> New Life -> birth -> play terms (cards, events, battles) until death
// -> death screen -> the Wheel (buy a node) -> Begin another life -> birth -> a second life starts. Fresh profile, fast animations.
//   timeout 280 node tests/browser/test_flow.mjs [--lang=en|zh]

import { open_game, shot, close, sleep } from "./launch.mjs";

const lang = (process.argv.find((a) => a.startsWith("--lang=")) || "--lang=en").slice(7);
const BUDGET_MS = 200000;
let fails = 0;
let checks = 0;
function ok(c, m) {
  checks++;
  if (!c) {
    fails++;
    console.log("FAIL ", m);
  }
}

const g = await open_game({ query: `fresh=1&fast=1&seed=31&lang=${lang}`, console_errors: true });
const page = g.page;
const q = (sel) => page.$(sel);
const click = async (sel) => {
  const e = await q(sel);
  if (!e) return false;
  await e.click({ timeout: 3000 }).catch(() => {});
  return true;
};
const scr = () => page.evaluate(() => window.__bw.screen_name);

const t0 = Date.now();
let phase = "title";
let lives_started = 0;
let died = 0;
let bought = false;
let it = 0;
for (; it < 6000 && Date.now() - t0 < BUDGET_MS; it++) {
  const s = await scr();
  if (s === "title") {
    ok(phase === "title" || phase === "died", `title reached in phase ${phase}`);
    await shot(page, `shots/flow_${lang}_title.png`);
    await click("[data-id=new]");
    await sleep(250);
    phase = "birth";
  } else if (s === "birth") {
    if (it % 3 === 0) await shot(page, `shots/flow_${lang}_birth_${lives_started}.png`);
    await click("[data-id=begin]");
    await sleep(300);
  } else if (s === "term") {
    if (phase !== "playing") {
      phase = "playing";
      lives_started++;
      if (lives_started >= 2) break;
    }
    if (await q("[data-bw=battle]")) {
      if (!(await click("[data-bw=battle] [data-role=continue]"))) await click("[data-bw=battle] [data-role=skip]");
      await sleep(40);
      continue;
    }
    if (await q("[data-bw=event]")) {
      if (!(await click("[data-bw=event] [data-role=continue]"))) {
        const open = await page.$$("[data-bw=event] [data-role=choice]:not(.disabled)");
        if (open.length) await open[Math.min(open.length - 1, it % 3)].click({ timeout: 3000 }).catch(() => {});
      }
      await sleep(40);
      continue;
    }
    if (await q("[data-bw=overlay]")) {
      if (!(await click("[data-bw=overlay] [data-role=scroll]"))) await click("[data-bw=overlay] [data-role=close]");
      await sleep(40);
      continue;
    }
    const st = await page.evaluate(() => {
      const sc = window.__bw.screen;
      const r = window.__bw.run;
      const stt = sc.state ? sc.state() : {};
      const playable = [];
      if (r.ap > 0) for (let i = 0; i < r.hand.length; i++) if (r.can_play(i).ok) playable.push(i);
      return { busy: !!stt.busy, cards: stt.cards, hand: stt.hand, playable, dead: r.dead };
    });
    if (st.busy || st.cards !== st.hand) {
      await sleep(60);
      continue;
    }
    if (st.playable.length) {
      const c = await page.evaluate((k) => window.__bw.screen.hand.client_center(k), st.playable[0]);
      await page.mouse.move(c.x, c.y);
      await sleep(40);
      await page.mouse.click(c.x, c.y);
      await sleep(120);
    } else {
      await click("[data-role=end-term]");
      await sleep(60);
    }
  } else if (s === "death" || s === "ending") {
    if (phase !== "died") {
      phase = "died";
      died++;
      await sleep(900);
      await shot(page, `shots/flow_${lang}_${s}.png`);
    }
    await click("[data-id=wheel]");
    await sleep(300);
  } else if (s === "wheel") {
    if (!bought) {
      bought = true;
      await sleep(300);
      const before = await page.evaluate(() => window.__bw.meta.imprints);
      // the first node that can be bought
      const id = await page.evaluate(() => {
        const m = window.__bw.meta;
        const D = window.__bw.D;
        for (const k of Object.keys(D.wheel)) if (m.can_buy(k).ok) return k;
        return "";
      });
      if (id) {
        await click(`[data-node="${id}"]`);
        await sleep(150);
        await click("[data-id=buy]");
        await sleep(200);
        const after = await page.evaluate(() => window.__bw.meta.imprints);
        ok(after < before, `buying a Wheel node spends imprints (${before} -> ${after})`);
      } else console.log("note: nothing affordable on the Wheel after the first life");
      await shot(page, `shots/flow_${lang}_wheel.png`);
    }
    await click("[data-id=begin]");
    await sleep(300);
  } else {
    await sleep(100);
  }
}
const final = await page.evaluate(() => ({ screen: window.__bw.screen_name, lives: window.__bw.meta.lives, imprints: window.__bw.meta.imprints,
  term: window.__bw.run ? window.__bw.run.term : -1 }));
console.log(`[${lang}] ${it} steps in ${((Date.now() - t0) / 1000).toFixed(0)} s; lives started ${lives_started}, deaths ${died}; ${JSON.stringify(final)}`);
ok(died >= 1, "a life ran to its end through the UI");
ok(lives_started >= 2, "a second life began after the Wheel");
const errs = g.errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED/.test(e));
ok(errs.length === 0, `no page errors (${errs.slice(0, 3).join(" | ")})`);
console.log(`${checks} checks, ${fails} failed`);
await close(g);
process.exit(fails ? 1 : 0);

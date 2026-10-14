// The published site: loads it from GitHub Pages, starts a life, plays a few cards, checks there are no 404s / page errors and
// that pictures, data and sound files are really served (a case-sensitive host).
//   timeout 200 node tests/browser/test_live.mjs [url]

import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

const URL_BASE = process.argv[2] || "https://mitohacker.github.io/blank-writ-threejs/";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => existsSync(p));
let fails = 0;
let checks = 0;
const ok = (c, m) => {
  checks++;
  if (!c) {
    fails++;
    console.log("FAIL ", m);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const bad = [];
const errors = [];
let n_ok = 0;
page.on("response", (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  else n_ok++;
});
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push("console: " + m.text()));

await page.goto(URL_BASE + "?fresh=1&fast=1&lang=en", { waitUntil: "load" });
await page.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 60000 });
ok((await page.evaluate(() => window.__bw.screen_name)) === "title", "the title screen shows");
mkdirSync("shots", { recursive: true });
await page.screenshot({ path: "shots/live_title.png" });
await page.click("[data-id=new]");
await sleep(500);
await page.click("[data-id=begin]");
await sleep(1500);
const s = await page.evaluate(() => ({ screen: window.__bw.screen_name, hand: window.__bw.run ? window.__bw.run.hand.length : -1 }));
ok(s.screen === "term" && s.hand > 0, `a life started (${JSON.stringify(s)})`);
// play a card by clicking it on the canvas
const c = await page.evaluate(() => {
  const r = window.__bw.run;
  for (let i = 0; i < r.hand.length; i++) if (r.can_play(i).ok) return window.__bw.screen.hand.client_center(i);
  return null;
});
if (c) {
  const ap0 = await page.evaluate(() => window.__bw.run.ap);
  await page.mouse.move(c.x, c.y);
  await sleep(100);
  await page.mouse.click(c.x, c.y);
  await sleep(1500);
  const ap1 = await page.evaluate(() => window.__bw.run.ap);
  ok(ap1 < ap0 || (await page.$("[data-bw=event]")) !== null || (await page.$("[data-bw=battle]")) !== null, `clicking a card on the live site plays it (ap ${ap0} -> ${ap1})`);
}
await page.screenshot({ path: "shots/live_term.png" });
// the picture and sound files really come from the host
const probe = await page.evaluate(async () => {
  const base = location.href.split("?")[0];
  const out = {};
  for (const p of ["assets/art/bg/village.webp", "assets/art/cards/meditate.webp", "assets/audio/music/village.mp3", "data/events/act1_spine.json", "data/i18n/zh_ui.json", "vendor/three.module.js"]) {
    const r = await fetch(base + p, { method: "HEAD" });
    out[p] = r.status;
  }
  return out;
});
console.log(JSON.stringify(probe));
for (const [p, st] of Object.entries(probe)) ok(st === 200, `${p} -> ${st}`);
ok(bad.length === 0, `no 4xx/5xx responses (${bad.slice(0, 5).join(" | ")})`);
ok(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);
console.log(`${n_ok} good responses; ${checks} checks, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);

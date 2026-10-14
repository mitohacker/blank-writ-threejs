// Browser test of the menu-side screens: title, birth, Wheel, registry, settings, death, ending (English and Chinese).
//   timeout 150 node tests/browser/test_menus.mjs [en|zh]       (both languages by default; screenshots in shots/menus/)
// One browser at a time, always closed; every wait is capped. Exit code != 0 when a check fails.

import { open_game, shot, close, sleep } from "./launch.mjs";

const LANGS = process.argv[2] ? [process.argv[2]] : ["en", "zh"];
const SHOTS = "shots/menus";
const CJK = /[㐀-鿿豈-﫿]/;
const LATIN_RUN = /[A-Za-z]{3,}/;
const ZH_LATIN_OK = new Set(["English"]);   // the language chooser writes each language in its own words

let failures = 0;
let checks = 0;
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log("  FAIL:", msg);
  }
}
function note(msg) {
  console.log(msg);
}

// ---- page helpers ------------------------------------------------------------------------------------------------------------
async function visible_texts(page) {
  return page.evaluate(() => {
    const out = [];
    const root = document.getElementById("stage");
    for (const e of root.querySelectorAll("*")) {
      if (e.closest("#fade")) continue;
      if (e.getClientRects().length === 0) continue;
      for (const n of e.childNodes) {
        if (n.nodeType === 3) {
          const t = n.textContent.trim();
          if (t) out.push(t);
        }
      }
      if (e.tagName === "INPUT" && e.type === "text") {
        if (e.value) out.push(e.value);
        if (e.placeholder) out.push(e.placeholder);
      }
    }
    return out;
  });
}

function single_language(lang, texts, where) {
  const bad = [];
  for (const t of texts) {
    if (lang === "en") {
      if (CJK.test(t) && t !== "中文") bad.push(t);
    } else {
      const runs = t.match(/[A-Za-z]{3,}/g) || [];
      if (runs.some((r) => !ZH_LATIN_OK.has(r))) bad.push(t);
    }
  }
  check(bad.length === 0, `${where}: mixed language text: ${JSON.stringify(bad.slice(0, 5))}`);
  void LATIN_RUN;
}

async function goto(page, name, args = {}) {
  await page.evaluate(async ([n, a]) => {
    await window.__bw.goto(n, a);
  }, [name, args]);
  await sleep(200);
}

async function ev(page, fn, arg) {
  return page.evaluate(fn, arg);
}

async function screen_ok(page, lang, name, tag) {
  const texts = await visible_texts(page);
  check(texts.length > 2, `${tag}: some text is shown (${texts.length})`);
  single_language(lang, texts, tag);
  await shot(page, `${SHOTS}/${tag}_${lang}.png`);
  return texts;
}

function first_line(t) {
  return String(t).split(String.fromCharCode(10))[0];
}

/** open_game, retried (up to 4 times) when the static server dropped a request during boot: the content tables must be complete */
async function open_ok(opts) {
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    let g = null;
    try {
      g = await open_game(opts);
      const st = await g.page
        .evaluate(async () => {
          const { L } = await import("/src/sim/loc.js");
          return { errors: window.__bw && window.__bw.D ? window.__bw.D.errors.length : 99, zh: L.zh_count() };
        })
        .catch(() => ({ errors: 99, zh: 0 }));
      if (st.errors === 0 && st.zh > 1000) return g;
      console.log(`  (boot ${attempt + 1}: content incomplete ${JSON.stringify(st)}, retrying)`);
      last = new Error("content incomplete");
    } catch (e) {
      console.log(`  (boot ${attempt + 1}: ${first_line(e.message)}, retrying)`);
      last = e;
    }
    if (g) await close(g).catch(() => {});
    await sleep(500 * (attempt + 1));
  }
  throw last || new Error("could not open the game");
}

async function run_lang(lang) {
  note(`--- ${lang} ---`);
  const g = await open_ok({ query: `screen=title&fresh=1&lang=${lang}`, width: 1920, height: 1080 });
  const page = g.page;
  try {
    await sleep(600);
    check(await ev(page, () => !!window.__bw && !!window.__bw.D), "game booted");
    // the new-life flow must not need the term screen: it is recorded instead
    await ev(page, () => {
      const m = window.__bw;
      const orig = m.goto.bind(m);
      window.__term = null;
      m.goto = (n, a) => {
        if (n === "term") {
          window.__term = { a };
          return Promise.resolve();
        }
        return orig(n, a);
      };
      window.__goto_orig = orig;
    });

    // ===================================================================================================================
    // title
    // ===================================================================================================================
    note("title");
    await goto(page, "title");
    const title_texts = await screen_ok(page, lang, "title", "title");
    const n_buttons = await ev(page, () => document.querySelectorAll('#stage [data-id]').length);
    check(n_buttons === 5, `title has 5 buttons without a saved life (${n_buttons})`);
    check(title_texts.some((t) => (lang === "en" ? /Imprints 0/.test(t) : /轮回印 0/.test(t))), "title: stats line shows the imprints");
    // a hover text
    await page.hover('[data-id="wheel"]');
    await sleep(700);
    const tip = await ev(page, () => (document.querySelector(".mx-tip") || {}).textContent || "");
    check(tip.length > 5, "title: hover shows a tooltip");
    await page.mouse.move(5, 5);

    // ===================================================================================================================
    // birth: pick a talent, change the origin, name, gender, redraw (costs imprints), begin
    // ===================================================================================================================
    note("birth");
    await page.click('[data-id="new"]');
    await page.waitForSelector("[data-talent]", { timeout: 8000 });
    await sleep(500);
    const cards = await ev(page, () => [...document.querySelectorAll("[data-talent]")].map((e) => e.dataset.talent));
    check(cards.length === 3, `birth: three talent cards (${cards.length})`);
    const birth_texts = await screen_ok(page, lang, "birth", "birth");
    check(birth_texts.length > 20, "birth: the screen has its text");
    // choose the second card
    await page.click('[data-idx="1"]');
    await sleep(150);
    const sealed = await ev(page, () => {
      const out = [];
      for (const c of document.querySelectorAll("[data-talent]")) out.push(c.lastElementChild.style.display !== "none");
      return out;
    });
    check(sealed[1] === true && sealed[0] === false && sealed[2] === false, `birth: the second talent is chosen ${JSON.stringify(sealed)}`);
    const stat_after = await ev(page, () => document.body.innerText.length);
    check(stat_after > 0, "birth: page text");
    // origin
    const origin_ids = await ev(page, () => [...document.querySelectorAll("[data-origin]")].map((e) => e.dataset.origin));
    check(origin_ids.length >= 5, `birth: five origins (${origin_ids.length})`);
    const before_origin = await ev(page, () => window.__bw.screen._origin_title.textContent);
    await page.click(`[data-origin="${origin_ids[2]}"] .btn`);
    await sleep(150);
    const after_origin = await ev(page, () => window.__bw.screen._origin_title.textContent);
    check(before_origin !== after_origin, "birth: the origin text follows the pick");
    check((await ev(page, () => window.__bw.screen._origin_id)) === origin_ids[2], "birth: origin chosen");
    // gender
    await page.click('[data-gender="f"]');
    check((await ev(page, () => window.__bw.screen._gender)) === "f", "birth: gender chosen");
    // name
    await page.fill('[data-id="name"]', "Lin");
    // redraw is refused without imprints and is paid with them
    check(await ev(page, () => document.querySelector('[data-id="redraw"]').classList.contains("disabled")), "birth: redraw disabled without imprints");
    await ev(page, () => {
      window.__bw.meta.imprints = 12;
    });
    await goto(page, "birth");
    check(!(await ev(page, () => document.querySelector('[data-id="redraw"]').classList.contains("disabled"))), "birth: redraw enabled with imprints");
    const draw_before = await ev(page, () => JSON.stringify(window.__bw.meta.options.birth_draw));
    await page.click('[data-id="redraw"]');
    await sleep(200);
    const after_redraw = await ev(page, () => ({ imprints: window.__bw.meta.imprints, draw: JSON.stringify(window.__bw.meta.options.birth_draw), cards: document.querySelectorAll("[data-talent]").length }));
    check(after_redraw.imprints === 7, `birth: the redraw cost 5 imprints (${after_redraw.imprints})`);
    check(after_redraw.cards === 3, "birth: three cards after the redraw");
    check(typeof draw_before === "string" && typeof after_redraw.draw === "string", "birth: the draw is kept in the profile");
    // leaving and coming back keeps the draw (no free redraw)
    await goto(page, "birth");
    check((await ev(page, () => JSON.stringify(window.__bw.meta.options.birth_draw))) === after_redraw.draw, "birth: the draw survives the screen");
    // pick and begin
    await page.click('[data-idx="2"]');
    await page.click('[data-origin="beggar"] .btn');
    await page.click('[data-gender="f"]');
    await page.fill('[data-id="name"]', "Lin Yu");
    const picked = await ev(page, () => ({ talent: window.__bw.screen._talent_id(), origin: window.__bw.screen._origin_id }));
    await page.click('[data-id="begin"]');
    await sleep(300);
    const life = await ev(page, () => {
      const r = window.__bw.run;
      return r ? { name: r.hero_name, gender: r.gender, origin: r.origin, talent: r.talent, term: !!window.__term } : null;
    });
    check(life !== null, "birth: Begin the life creates a run");
    if (life) {
      check(life.name === "Lin Yu" && life.gender === "f", `birth: name and gender reach the run (${life.name}/${life.gender})`);
      check(life.origin === picked.origin && life.talent === picked.talent, `birth: origin and talent reach the run (${life.origin}/${life.talent})`);
      check(life.term === true, "birth: the router moves on to the term screen");
      check((await ev(page, () => window.__bw.meta.options.birth_draw)) === undefined, "birth: the draw is cleared once the life begins");
    }

    // ===================================================================================================================
    // the Wheel: select, read, locked reasons, buy, ranks, the hidden row
    // ===================================================================================================================
    note("wheel");
    await ev(page, () => {
      const m = window.__bw;
      m.run = null;
      m.meta.imprints = 0;
      m.meta.ranks = {};
      m.meta.flags = {};
    });
    await goto(page, "wheel");
    const ids = await ev(page, () => {
      const D = window.__bw.D;
      const free = Object.keys(D.wheel).find((i) => (D.wheel[i].req || []).length === 0 && D.wheel[i].branch !== "hidden" && !D.wheel[i].unlock);
      const lockedid = Object.keys(D.wheel).find((i) => (D.wheel[i].req || []).length > 0 && D.wheel[i].branch !== "hidden" && !D.wheel[i].unlock);
      const multi = Object.keys(D.wheel).find((i) => (D.wheel[i].max || 1) > 1 && (D.wheel[i].req || []).length === 0 && D.wheel[i].branch !== "hidden" && !D.wheel[i].unlock);
      const hidden = Object.keys(D.wheel).filter((i) => D.wheel[i].branch === "hidden");
      return { free, lockedid, multi, hidden, total: Object.keys(D.wheel).length };
    });
    note(`  nodes ${ids.total}, free ${ids.free}, locked ${ids.lockedid}, multi ${ids.multi}, hidden ${ids.hidden.length}`);
    const wn = await ev(page, () => document.querySelectorAll("[data-node]").length);
    check(wn === ids.total - ids.hidden.length, `wheel: every open node is drawn (${wn} of ${ids.total - ids.hidden.length})`);
    await screen_ok(page, lang, "wheel", "wheel");
    // hover reads
    await page.hover(`[data-node="${ids.free}"]`);
    await sleep(150);
    const hover_text = await ev(page, () => window.__bw.screen._info.textContent);
    const free_name = await ev(page, (id) => {
      const n = window.__bw.D.wheel[id];
      return window.__bw.screen._node_name(n, id);
    }, ids.free);
    check(hover_text.includes(free_name), "wheel: hovering a node reads its name");
    // select with no imprints: cannot be bought
    await page.click(`[data-node="${ids.free}"]`);
    await sleep(150);
    check(await ev(page, () => document.querySelector('[data-id="buy"]').classList.contains("disabled")), "wheel: cannot buy without imprints");
    const need_text = await ev(page, () => document.querySelector('[data-id="buy"]').textContent);
    check(need_text.length > 4, "wheel: the button says why");
    await shot(page, `${SHOTS}/wheel_selected_${lang}.png`);
    // a locked node explains itself
    await page.click(`[data-node="${ids.lockedid}"]`);
    await sleep(150);
    check(await ev(page, () => document.querySelector('[data-id="buy"]').classList.contains("disabled")), "wheel: a locked node cannot be bought");
    const lock_text = await ev(page, () => document.querySelector('[data-id="buy"]').textContent);
    check(lock_text.length > 4 && lock_text !== need_text, `wheel: the lock reason is shown (${lock_text})`);
    // imprints given: buy
    await ev(page, () => {
      window.__bw.meta.imprints = 500;
    });
    await goto(page, "wheel");
    await page.click(`[data-node="${ids.free}"]`);
    await sleep(150);
    check(!(await ev(page, () => document.querySelector('[data-id="buy"]').classList.contains("disabled"))), "wheel: buy is enabled with imprints");
    const cost = await ev(page, (id) => window.__bw.meta.node_cost(id), ids.free);
    await page.click('[data-id="buy"]');
    await sleep(200);
    const bought = await ev(page, (id) => ({ rank: window.__bw.meta.rank(id), imprints: window.__bw.meta.imprints }), ids.free);
    check(bought.rank === 1 && bought.imprints === 500 - cost, `wheel: bought (rank ${bought.rank}, imprints ${bought.imprints}, cost ${cost})`);
    const label_now = await ev(page, () => window.__bw.screen._imprint_label.textContent);
    check(label_now === String(500 - cost), `wheel: the imprint counter follows (${label_now})`);
    // a node that needed it is now reachable
    const child = await ev(page, (id) => {
      const D = window.__bw.D;
      return Object.keys(D.wheel).find((i) => (D.wheel[i].req || []).length === 1 && D.wheel[i].req[0] === id && !D.wheel[i].unlock && D.wheel[i].branch !== "hidden") || "";
    }, ids.free);
    if (child) {
      await page.click(`[data-node="${child}"]`);
      await sleep(150);
      const ok_child = await ev(page, (id) => window.__bw.meta.can_buy(id).ok, child);
      check(ok_child === (await ev(page, () => !document.querySelector('[data-id="buy"]').classList.contains("disabled"))), "wheel: the button follows can_buy");
    }
    // a multi-rank node: ranks cost more each time
    if (ids.multi) {
      const m1 = await ev(page, (id) => window.__bw.meta.node_cost(id), ids.multi);
      await page.click(`[data-node="${ids.multi}"]`);
      await page.click('[data-id="buy"]');
      await sleep(100);
      const m2 = await ev(page, (id) => window.__bw.meta.node_cost(id), ids.multi);
      check(m2 === m1 * 2, `wheel: the second rank costs double (${m1} -> ${m2})`);
    }
    // the hidden row needs the t_wheel memory
    check(await ev(page, () => !document.querySelector("[data-node]") || [...document.querySelectorAll("[data-node]")].every((e) => window.__bw.D.wheel[e.dataset.node].branch !== "hidden")), "wheel: no hidden row before the memory");
    if (ids.hidden.length) {
      await ev(page, () => {
        window.__bw.meta.flags.t_wheel = true;
      });
      await goto(page, "wheel");
      const hn = await ev(page, () => [...document.querySelectorAll("[data-node]")].filter((e) => window.__bw.D.wheel[e.dataset.node].branch === "hidden").length);
      check(hn === ids.hidden.length, `wheel: the hidden row appears with the memory (${hn})`);
      await page.hover(`[data-node="${ids.hidden[0]}"]`);
      await shot(page, `${SHOTS}/wheel_hidden_${lang}.png`);
    }
    // navigation: Registry (back to the Wheel) and Title
    await page.click("text=" + (lang === "en" ? "Registry" : "命簿"));
    await page.waitForSelector("[data-tab]", { timeout: 8000 });
    await sleep(300);

    // ===================================================================================================================
    // registry
    // ===================================================================================================================
    note("registry");
    const back_text = await ev(page, () => document.querySelector('[data-id="back"]').textContent);
    check(back_text === (lang === "en" ? "Back to the Wheel" : "返回轮回盘"), `registry: back goes to the Wheel (${back_text})`);
    await ev(page, () => {
      const m = window.__bw;
      m.meta.flags.t_blank = true;
      m.meta.flags.t_xiaohe = true;
      m.meta.endings = ["end_filed"];
      m.meta.lives = 2;
      m.meta.best_realm = 3;
      m.meta.best_layer = 2;
      m.meta.total_terms = 40;
      m.meta.history = [
        { life: 1, realm: 2, layer: 2, terms: 20, cause: "slain", imprints: 33, truths: ["t_blank"], ending: "" },
        { life: 2, realm: 3, layer: 2, terms: 20, cause: "ending", imprints: 91, truths: [], ending: "end_filed" },
      ];
    });
    await goto(page, "registry", { back: "wheel" });
    const tv = await ev(page, () => ({ strips: document.querySelectorAll("[data-truth]").length, known: document.querySelectorAll('[data-truth][data-known="1"]').length, all: Object.keys(window.__bw.D.truths).length,
      expect: Object.keys(window.__bw.D.truths).filter((t) => window.__bw.meta.has_flag(t)).length }));
    check(tv.strips === tv.all && tv.known === tv.expect && tv.known >= 2, `registry: truth strips ${tv.strips}/${tv.all}, known ${tv.known} (expected ${tv.expect})`);
    await screen_ok(page, lang, "registry_truths", "registry_truths");
    await page.click('[data-tab="endings"]');
    await sleep(200);
    const ev2 = await ev(page, () => ({ cards: document.querySelectorAll("[data-ending]").length, known: document.querySelectorAll('[data-ending][data-known="1"]').length }));
    check(ev2.cards >= 5 && ev2.known === 1, `registry: endings ${ev2.cards}, reached ${ev2.known}`);
    await screen_ok(page, lang, "registry_endings", "registry_endings");
    await page.click('[data-tab="lives"]');
    await sleep(200);
    const lives_texts = await screen_ok(page, lang, "registry_lives", "registry_lives");
    check(lives_texts.includes("+33") && lives_texts.includes("+91"), "registry: the lives table lists the imprints paid");
    // back -> the Wheel
    await page.click('[data-id="back"]');
    await sleep(500);
    check((await ev(page, () => window.__bw.screen_name)) === "wheel", "registry: Back returns to the Wheel");
    // the title's Registry has Back to the title
    await goto(page, "title");
    await page.click('[data-id="registry"]');
    await page.waitForSelector("[data-tab]", { timeout: 8000 });
    const back2 = await ev(page, () => document.querySelector('[data-id="back"]').textContent);
    check(back2 === (lang === "en" ? "Back to the title" : "返回标题"), `registry: from the title, back goes to the title (${back2})`);
    await page.click('[data-id="back"]');
    await sleep(500);
    check((await ev(page, () => window.__bw.screen_name)) === "title", "registry: Back returns to the title");

    // ===================================================================================================================
    // settings: language, volumes, mute, Esc
    // ===================================================================================================================
    note("settings");
    await page.click('[data-id="settings"]');
    await page.waitForSelector('[data-lang="zh"]', { timeout: 8000 });
    await sleep(300);
    await screen_ok(page, lang, "settings", "settings");
    // volume by a real click on the slider
    await page.click('input[data-key="music_vol"]', { position: { x: 220, y: 6 } });
    await sleep(100);
    const mv = await ev(page, () => window.__bw.meta.options.music_vol);
    check(typeof mv === "number" && Math.abs(mv - 25) <= 10, `settings: the music slider sets music_vol (${mv})`);
    await ev(page, () => {
      const s = document.querySelector('input[data-key="sfx_vol"]');
      s.value = "35";
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    check((await ev(page, () => window.__bw.meta.options.sfx_vol)) === 35, "settings: the effects slider sets sfx_vol");
    check((await ev(page, async () => (await import("/src/audio.js")).A.sfx_vol)) === 0.35, "settings: the audio system follows the slider");
    // mute
    await page.click('[data-id="mute"]');
    check((await ev(page, () => window.__bw.meta.options.muted)) === true, "settings: mute is saved");
    check((await ev(page, async () => (await import("/src/audio.js")).A.muted)) === true, "settings: the audio system is muted");
    await page.click('[data-id="mute"]');
    check((await ev(page, () => window.__bw.meta.options.muted)) === false, "settings: unmute");
    // language: switch to the other one and back
    const other = lang === "en" ? "zh" : "en";
    await page.click(`[data-lang="${other}"]`);
    await page.waitForFunction((o) => window.__bw.meta.options.lang === o && document.querySelector('[data-lang]'), other, { timeout: 8000 });
    await sleep(500);
    const heading_texts = await visible_texts(page);
    check(other === "zh" ? heading_texts.includes("设置") : heading_texts.includes("Settings"), `settings: the screen is rebuilt in ${other}`);
    single_language(other, heading_texts, `settings after switching to ${other}`);
    await shot(page, `${SHOTS}/settings_${lang}_to_${other}.png`);
    check((await ev(page, () => window.__bw.meta.options.lang)) === other, "settings: the language is saved in the profile options");
    await page.click(`[data-lang="${lang}"]`);
    await page.waitForFunction((o) => window.__bw.meta.options.lang === o, lang, { timeout: 8000 });
    await sleep(500);
    check((await ev(page, () => window.__bw.meta.options.lang)) === lang, "settings: switched back");
    // Esc goes back to the title
    await page.keyboard.press("Escape");
    await sleep(500);
    check((await ev(page, () => window.__bw.screen_name)) === "title", "settings: Esc goes back to the title");
    // a back destination from a life
    await goto(page, "settings", { back: "term" });
    const back3 = await ev(page, () => document.querySelector('[data-id="back"]').textContent);
    check(back3 === (lang === "en" ? "Back to the life" : "返回此生"), `settings: from a life, back says so (${back3})`);
    await page.click('[data-id="back"]');
    await sleep(300);
    check((await ev(page, () => !!window.__term)) === true, "settings: back from a life goes to the term screen");
    await ev(page, () => {
      window.__term = null;
    });

  } finally {
    await close(g);
  }
  return g.errors;
}

async function run_death_ending(lang) {
  note(`--- ${lang}: death and ending ---`);
  const g = await open_ok({ query: `screen=death&fresh=1&lang=${lang}&autoplay=12&seed=77`, width: 1920, height: 1080 });
  const page = g.page;
  try {
    await page.waitForSelector("[data-paid]", { timeout: 15000 });
    check(await ev(page, () => !!window.__bw.run && window.__bw.run.dead === true), "death: the demo life is over");
    const info = await ev(page, () => {
      const r = window.__bw.run;
      return { paid: Math.trunc((r.finished_record || {}).imprints || 0), imprints: window.__bw.meta.imprints, name: window.__bw.screen_name };
    });
    check(info.name === "death", "death: the death screen is showing");
    if (info.paid > 0) await page.waitForFunction((p) => document.querySelector("[data-paid]").textContent === "+" + p, info.paid, { timeout: 6000 }).catch(() => {});
    const counted = await ev(page, () => document.querySelector("[data-paid]").textContent);
    check(counted === "+" + info.paid, `death: the imprints count up to what was paid (${counted} vs +${info.paid})`);
    const texts = await visible_texts(page);
    single_language(lang, texts, "death");
    await shot(page, `${SHOTS}/death_${lang}.png`);
    check(texts.length > 6, "death: record is written out");
    await page.click('[data-id="wheel"]');
    await page.waitForSelector("[data-node]", { timeout: 8000 });
    await sleep(300);
    const w = await ev(page, () => ({ label: window.__bw.screen._imprint_label.textContent, imprints: window.__bw.meta.imprints }));
    check(w.label === String(w.imprints) && w.imprints === info.paid, `death: the Wheel opens with the imprints (${w.label})`);
    // an ending
    await ev(page, () => {
      const m = window.__bw;
      m.run.ending_id = "end_blank_writ";
      m.run.finished_record = Object.assign({}, m.run.finished_record, { imprints: 77 });
    });
    await goto(page, "ending");
    await page.waitForFunction(() => document.querySelector("[data-paid]").textContent === "+77", null, { timeout: 6000 }).catch(() => {});
    const et = await ev(page, () => document.querySelector("[data-paid]").textContent);
    check(et === "+77", `ending: the paid imprints count up (${et})`);
    const ending_texts = await visible_texts(page);
    single_language(lang, ending_texts, "ending");
    check(ending_texts.some((t) => t.length > 120), "ending: the ending's text is shown");
    await shot(page, `${SHOTS}/ending_${lang}.png`);
    await page.click('[data-id="wheel"]');
    await page.waitForSelector("[data-node]", { timeout: 8000 });
    // Begin another life from the Wheel goes to birth, with "Back to the Wheel"
    await page.click('[data-id="begin"]');
    await page.waitForSelector("[data-talent]", { timeout: 8000 });
    await sleep(300);
    const bb = await ev(page, () => document.querySelector('[data-id="back"]').textContent);
    check(bb === (lang === "en" ? "Back to the Wheel" : "返回轮回盘"), `birth: after a life, back goes to the Wheel (${bb})`);
    await page.click('[data-id="back"]');
    await page.waitForSelector("[data-node]", { timeout: 8000 });
    // Title drops the finished life
    await page.click("text=" + (lang === "en" ? "Title" : "标题"));
    await sleep(500);
    check((await ev(page, () => window.__bw.screen_name === "title" && window.__bw.run === null)), "wheel: Title goes to the title and drops the finished life");
  } finally {
    await close(g);
  }
  return g.errors;
}

async function run_continue(lang) {
  note(`--- ${lang}: continue ---`);
  // not fresh: the profile and the run live in this context's localStorage
  const g = await open_ok({ query: `screen=title&lang=${lang}`, width: 1920, height: 1080 });
  const page = g.page;
  try {
    await sleep(800);
    await ev(page, async () => {
      const m = window.__bw;
      const { Run } = await import("/src/sim/run.js");
      const r = new Run(m.D, m.meta, 5);
      r.begin("orphan", "", "Ada", "f");
      m.run = r;
      m.save_run();
      const orig = m.goto.bind(m);
      window.__term = null;
      m.goto = (n, a) => {
        if (n === "term") {
          window.__term = { a };
          return Promise.resolve();
        }
        return orig(n, a);
      };
      await orig("title");
    });
    await sleep(500);
    const n = await ev(page, () => document.querySelectorAll("#stage [data-id]").length);
    check(n === 6, `continue: a saved life adds the Continue button (${n} buttons)`);
    const texts = await visible_texts(page);
    single_language(lang, texts, "title with a saved life");
    await shot(page, `${SHOTS}/title_continue_${lang}.png`);
    await page.hover('[data-id="continue"]');
    await sleep(700);
    const tip = await ev(page, () => (document.querySelector(".mx-tip") || {}).textContent || "");
    check(tip.includes("Ada"), `continue: the tooltip names the saved life (${tip})`);
    await page.click('[data-id="continue"]');
    await sleep(300);
    check((await ev(page, () => !!window.__term)) === true, "continue: Continue resumes the life (term screen)");
    check((await ev(page, () => window.__bw.run && window.__bw.run.hero_name)) === "Ada", "continue: the run is the saved one");
    // resources: nothing failed to load
    const bad = await ev(page, () => performance.getEntriesByType("resource").filter((e) => e.responseStatus >= 400 && !/favicon/.test(e.name)).map((e) => e.name));
    check(bad.length === 0, `no resource failed to load ${JSON.stringify(bad)}`);
  } finally {
    await close(g);
  }
  return g.errors;
}

async function run_noart(lang) {
  note(`--- ${lang}: no pictures (stand-in boxes) ---`);
  const g = await open_game({ query: `screen=title&fresh=1&lang=${lang}`, width: 1920, height: 1080 });
  const page = g.page;
  try {
    // every picture "does not exist": the manifest is empty, so Art returns null and the screens draw their stand-ins
    await page.route("**/assets/art/manifest.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ files: [] }) }));
    const visits = [
      ["screen=title&fresh=1", "title"],
      ["screen=birth&fresh=1", "birth"],
      ["screen=wheel&fresh=1", "wheel"],
      ["screen=registry&fresh=1", "registry"],
      ["screen=settings&fresh=1", "settings"],
      ["screen=death&fresh=1&autoplay=12&seed=77", "death"],
    ];
    for (const [q, name] of visits) {
      await page.goto(`http://127.0.0.1:8712/index.html?${q}&lang=${lang}`);
      await page.waitForFunction(() => document.getElementById("boot")?.classList.contains("gone"), null, { timeout: 20000 }).catch(() => {});
      await sleep(500);
      const texts = await visible_texts(page);
      check(texts.length > 3, `no art: ${name} shows its text (${texts.length})`);
      single_language(lang, texts, `no art: ${name}`);
      await shot(page, `${SHOTS}/noart_${name}_${lang}.png`);
    }
    await page.evaluate(async () => {
      const m = window.__bw;
      m.run.ending_id = "end_filed";
      m.run.finished_record = Object.assign({}, m.run.finished_record, { imprints: 50 });
      await m.goto("ending");
    });
    await sleep(400);
    const texts = await visible_texts(page);
    check(texts.some((t) => t.length > 100), "no art: the ending is written out");
    await shot(page, `${SHOTS}/noart_ending_${lang}.png`);
  } finally {
    await close(g);
  }
  return g.errors;
}

function filter_errors(errs) {
  // a missing favicon is a browser request, not the game's; a refused connection to localhost is the shared static server's small
  // listen backlog (serve.py) when several test runs hit it at once: reported as a warning, not a game error
  const refused = errs.filter((e) => /ERR_CONNECTION_REFUSED/.test(e));
  if (refused.length) console.log(`  warning: ${refused.length} refused connection(s) to the static server (listen backlog)`);
  return errs.filter((e) => !/Failed to load resource.*404/.test(e) && !/favicon/.test(e) && !/ERR_CONNECTION_REFUSED/.test(e));
}

const t0 = Date.now();
for (const lang of LANGS) {
  let errs = [];
  try {
    errs = errs.concat(await run_lang(lang));
  } catch (e) {
    failures++;
    console.log("  EXCEPTION in run_lang:", e && e.message ? e.message : e);
  }
  try {
    errs = errs.concat(await run_death_ending(lang));
  } catch (e) {
    failures++;
    console.log("  EXCEPTION in run_death_ending:", e && e.message ? e.message : e);
  }
  try {
    errs = errs.concat(await run_continue(lang));
  } catch (e) {
    failures++;
    console.log("  EXCEPTION in run_continue:", e && e.message ? e.message : e);
  }
  if (lang === LANGS[0]) {
    try {
      errs = errs.concat(await run_noart(lang));
    } catch (e) {
      failures++;
      console.log("  EXCEPTION in run_noart:", e && e.message ? e.message : e);
    }
  }
  const real = filter_errors(errs);
  check(real.length === 0, `${lang}: no page errors ${JSON.stringify(real.slice(0, 5))}`);
}
console.log(`${checks} checks, ${failures} failures, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);

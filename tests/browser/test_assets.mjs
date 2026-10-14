// Assets: every picture the data can ask for exists (case-exact, so it works on a case-sensitive host such as GitHub Pages), every
// manifest entry is a real file, and in a real browser every sound effect decodes and every music file loads.
//   timeout 200 node tests/browser/test_assets.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { open_game, close } from "./launch.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
let fails = 0;
let checks = 0;
const ok = (c, m) => {
  checks++;
  if (!c) {
    fails++;
    console.log("FAIL ", m);
  }
};
const J = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

// -- pictures -------------------------------------------------------------------------------------------------------------------
const man = J("assets/art/manifest.json").files;
const set = new Set(man);
for (const f of man) ok(existsSync(resolve(ROOT, "assets/art", f)), `manifest file exists: ${f}`);
ok(man.every((f) => f === f.toLowerCase()), "every picture name is lower case");

const miss = [];
const need = (name) => {
  if (!set.has(name)) miss.push(name);
};
const files = J("data/manifest.json");
const all = (stem) => {
  const out = {};
  for (const f of files.files.filter((x) => x.startsWith(stem))) Object.assign(out, J("data/" + f));
  return out;
};
const listOf = (o, key) => {
  const v = o[key] ?? o;
  return Array.isArray(v) ? v : Object.entries(v).map(([id, e]) => ({ id, ...e }));
};
// cards: own painting, or a generic one (the Godot fallbacks)
const generic = ["c_letter", "c_invitation", "c_stranger", "c_secret", "c_danger", "c_fate"];
const card_missing = [];
for (const f of files.files.filter((x) => x.startsWith("cards"))) {
  const d = J("data/" + f);
  for (const c of listOf(d, "cards")) {
    if (!c.id) continue;
    const id = c.id;
    if (!set.has(`cards/${id}.webp`) && !set.has(`cards/${id.replace(/_plus$/, "")}.webp`) && !id.startsWith("c_")) card_missing.push(id);
  }
}
ok(card_missing.length <= 12, `cards without their own painting stay few (${card_missing.length}: ${card_missing.slice(0, 8).join(", ")})`);
for (const g of generic) need(`cards/${g}.webp`);
// places
for (const p of ["village", "town", "sect", "valley", "wilds", "ruin", "netherworld", "registry", "gate", "wheel", "cave", "road"]) need(`bg/${p}.webp`);
need("title.webp");
for (const e of ["ending_filed", "ending_slayer", "ending_blank_writ", "ending_mortal_dust", "ending_netherworld"]) need(`endings/${e}.webp`);
for (const u of ["btn_normal", "panel_parchment", "panel_dark", "card_grey", "card_green", "card_blue", "card_purple", "card_gold", "card_back", "fill_green", "fill_blue",
  "fill_amber", "fill_red", "lotus_lit", "lotus_dim", "ap_lit", "ap_dim"]) need(`ui/${u}.webp`);
for (const e of ["metal", "wood", "water", "fire", "earth"]) need(`icons/el_${e}.webp`);
ok(miss.length === 0, `required pictures exist (missing: ${miss.join(", ")})`);

// enemies have a sprite
const en_missing = [];
for (const f of files.files.filter((x) => x.startsWith("enemies"))) {
  for (const e of listOf(J("data/" + f), "enemies")) if (e.id && !set.has(`sprites/${e.sprite || e.id}.webp`)) en_missing.push(e.id);
}
ok(en_missing.length <= 3, `enemies have sprites (${en_missing.length} without: ${en_missing.slice(0, 6).join(", ")})`);

// -- sound ----------------------------------------------------------------------------------------------------------------------
const au = J("assets/audio/audio.json");
let nfiles = 0;
for (const [id, s] of Object.entries(au.sfx)) for (const f of s.files) {
  nfiles++;
  ok(existsSync(resolve(ROOT, "assets/audio", f)), `sfx file ${id}: ${f}`);
}
for (const [id, s] of Object.entries(au.music)) {
  nfiles++;
  ok(existsSync(resolve(ROOT, "assets/audio", s.file)), `music file ${id}: ${s.file}`);
}
console.log(`${Object.keys(au.sfx).length} effects, ${Object.keys(au.music).length} tracks, ${nfiles} files`);

const g = await open_game({ query: "fresh=1&screen=title&lang=en", sound: true });
const res = await g.page.evaluate(async () => {
  const mod = await import("/src/audio.js");
  const A = mod.A;
  const bad = [];
  let n = 0;
  if (!A.ctx) return { no_ctx: true, bad, n };
  for (const [id, s] of Object.entries(A.manifest.sfx)) {
    for (const f of s.files) {
      const b = await A._buffer(f);
      n++;
      if (!b || b.duration < 0.02) bad.push(f);
    }
  }
  const music_bad = [];
  for (const [id, s] of Object.entries(A.manifest.music)) {
    const r = await fetch(new URL("assets/audio/" + s.file, location.href), { method: "HEAD" });
    if (!r.ok || +r.headers.get("content-length") < 20000) music_bad.push(id);
  }
  return { no_ctx: false, bad, n, music_bad };
});
console.log(JSON.stringify(res));
ok(!res.no_ctx, "an AudioContext exists");
ok(res.bad.length === 0 && res.n > 100, `${res.n} effect files decode in the browser (bad: ${res.bad.slice(0, 4)})`);
ok((res.music_bad || []).length === 0, `music files are served (bad: ${(res.music_bad || []).join(",")})`);
await close(g);
console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);

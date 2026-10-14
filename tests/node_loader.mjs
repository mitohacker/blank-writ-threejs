// Node-side loader for the sim: the same manifest-driven loading as the browser, over the file system.
//   import { load_game, make_run } from "./node_loader.mjs";
//   const g = await load_game();            // {D, meta, store, L, make_run(seed, opts)}
//   const run = make_run(1234);             // a Run on the last loaded game (orphan, no talent, "Test", "m")
//   const run2 = g.make_run(7, {origin: "orphan", talent: "", name: "Bot", gender: "f"});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BWData } from "../src/sim/data.js";
import { L } from "../src/sim/loc.js";
import { Meta } from "../src/sim/meta.js";
import { Run } from "../src/sim/run.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** the browser's fetch_json over the file system: path relative to the site root -> parsed JSON */
export async function fetch_json(p) {
  const text = fs.readFileSync(path.join(ROOT, p), "utf8").replace(/^﻿/, "");
  return JSON.parse(text);
}

/** an in-memory store with the router's surface */
export class MemoryStore {
  constructor() {
    this.mem = new Map();
  }
  load(key) {
    return this.mem.has(key) ? this.mem.get(key) : null;
  }
  save(key, text) {
    this.mem.set(key, text);
  }
  remove(key) {
    this.mem.delete(key);
  }
}

let _game = null;

/** loads the data and the Chinese tables once per call; `save_enabled` is false unless `persist` is set */
export async function load_game({ lang = "en", persist = false } = {}) {
  const D = await BWData.load(fetch_json);
  await L.load(fetch_json, D.i18n_files);
  // the Traditional tables, and the data's names follow the language ("zh" = Simplified here, as in the first release)
  const hant = await Promise.all((D.i18n_hant_files || []).map((f) => fetch_json(f)));
  L.load_tables_hant(hant);
  L.link(D);
  L.set_lang(lang);
  const store = new MemoryStore();
  const meta = new Meta(D, store);
  meta.save_enabled = persist;
  const g = {
    D, meta, store, L,
    make_run(seed, opts = {}) {
      return make_run(seed, { ...opts, game: g });
    },
  };
  _game = g;
  return g;
}

/** a started Run; `opts.game` picks the game (default: the last one load_game made), `opts.meta` another profile */
export function make_run(seed, opts = {}) {
  const g = opts.game || _game;
  if (!g) throw new Error("make_run: call load_game() first");
  const run = new Run(g.D, opts.meta || g.meta, seed);
  run.begin(opts.origin ?? "orphan", opts.talent ?? "", opts.name ?? "Test", opts.gender ?? "m");
  return run;
}

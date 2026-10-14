// Router and shared state (port of scripts/bw_main.gd). Screens are modules in src/ui/screens/<name>.js whose default export is a class
// extending Screen (ui/ui.js) with `async setup(main, args)`; they ask the router for everything else:
//
//   main.D            BWData (all content)            main.meta   Meta (the profile: imprints, Wheel, memories)
//   main.run          Run of the life in progress     main.world  the three.js layer     main.stage  the 1920x1080 DOM stage
//   main.goto(name, args)   name in: title birth term wheel registry death ending settings
//   main.new_life(origin, talent, hero_name, gender)  builds a run and goes to "term"
//   main.continue_run() -> bool     main.save_run()     main.has_saved_run()     main.set_language(l)     main.apply_audio_options()
//   main.set_background(url, dim)   main.args (the page's ?query: screen, lang, seed, fresh, autoplay, event, battle, panel, hover, ...)
//
// Query flags mirror the Godot ones (without --bw-): ?screen=term&lang=zh&autoplay=9&seed=77&fresh=1&event=<id>&battle=<enemy>&panel=bag.
// `window.__bw` is the router, for tests.

import { World } from "./gfx/world.js";
import { Art } from "./ui/art.js";
import { A } from "./audio.js";
import { L } from "./sim/loc.js";
import { BWData } from "./sim/data.js";
import { Meta } from "./sim/meta.js";
import { Run } from "./sim/run.js";
import { Auto } from "./sim/auto.js";
import { RNG } from "./sim/rng.js";

const PROFILE_KEY = "bw.profile";
const RUN_KEY = "bw.run";

/** localStorage with a memory fallback (private windows, tests) */
class Store {
  constructor(persist) {
    this.persist = persist;
    this.mem = new Map();
  }
  load(key) {
    if (!this.persist) return this.mem.get(key) ?? null;
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return this.mem.get(key) ?? null;
    }
  }
  save(key, text) {
    if (!this.persist) {
      this.mem.set(key, text);
      return;
    }
    try {
      localStorage.setItem(key, text);
    } catch (e) {
      this.mem.set(key, text);
    }
  }
  remove(key) {
    this.mem.delete(key);
    if (!this.persist) return;
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }
}

async function fetch_json(path) {
  const r = await fetch(new URL("../" + path, import.meta.url), { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export class Main {
  constructor() {
    this.args = {};
    for (const [k, v] of new URLSearchParams(location.search)) this.args[k] = v === "" ? "1" : v;
    this.persist = !("fresh" in this.args);
    this.D = null;
    this.meta = null;
    this.run = null;
    this.screen = null;
    this.screen_name = "";
    this.stage = document.getElementById("stage");
    this.world = null;
    this.store = new Store(this.persist);
    this._token = 0;
  }

  async boot() {
    const sub = document.getElementById("boot-sub");
    const say = (t) => sub && (sub.textContent = t);
    this.world = new World(document.getElementById("world"));
    this.world.start();
    say("pictures");
    await Art.init();
    say("sound");
    await A.init();
    say("story");
    this.D = await BWData.load(fetch_json);
    await L.load(fetch_json, this.D.i18n_files || []);
    this.meta = new Meta(this.D, this.store);
    this.meta.load_profile();
    if ("fresh" in this.args) {
      this.meta.reset();
      this.meta.save_enabled = false;
    }
    // the language and the volumes are preferences of the profile (Settings); ?lang=zh overrides for one visit
    let lang = this.args.lang || ("fresh" in this.args ? "en" : this.meta.options.lang);
    if (!lang) lang = (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
    L.set_lang(lang);
    document.documentElement.lang = L.lang === "zh" ? "zh" : "en";
    this.apply_audio_options();
    // fade layer on top of the stage
    this.fade = document.createElement("div");
    this.fade.id = "fade";
    this.stage.appendChild(this.fade);
    window.__bw = this;
    const start = this.args.screen || "title";
    if (start === "term" || start === "death" || start === "ending") this._demo_run(start);
    else await this.goto(start);
    document.getElementById("boot")?.classList.add("gone");
    document.title = L.lang === "zh" ? "无字命" : "Blank Writ";
  }

  // ---- demo / test entry (port of _demo_run) ------------------------------------------------------------------------------
  _demo_run(start) {
    const seed = parseInt(this.args.seed ?? "77", 10);
    this.run = new Run(this.D, this.meta, seed);
    this.run.begin(this.args.origin || "orphan", this.args.talent || "", L.t("Wuming"), this.args.gender || "m");
    const terms = parseInt(this.args.autoplay ?? "0", 10);
    const pol = new RNG(seed + 5);
    const rec = {};
    for (let i = 0; i < terms; i++) {
      if (this.run.dead) break;
      Auto.resolve_events(this.run, pol, rec);
      Auto.play_term(this.run, pol, rec);
      if (this.run.dead) break;
      this.run.end_term();
      Auto.resolve_events(this.run, pol, rec);
    }
    if (start === "term") return this.goto("term", { demo: true });
    if (start === "death") {
      if (!this.run.dead) {
        this.run.life = 0;
        this.run.end_term();
      }
      return this.goto("death");
    }
    return this.goto("ending");
  }

  // ---- screens ------------------------------------------------------------------------------------------------------------
  async goto(name, args = {}) {
    const token = ++this._token;
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
    this.screen_name = name;
    this._screen_music(name);
    let mod;
    try {
      mod = await import(`./ui/screens/${name}.js`);
    } catch (e) {
      console.error(`no screen ${name}`, e);
      return;
    }
    if (token !== this._token) return;
    const s = new mod.default(this);
    this.stage.insertBefore(s.root, this.fade);
    this.screen = s;
    this.fade.style.transition = "none";
    this.fade.style.opacity = "1";
    try {
      await s.setup(this, args);
    } catch (e) {
      console.error(`screen ${name} setup failed`, e);
    }
    requestAnimationFrame(() => {
      this.fade.style.transition = "opacity .25s";
      this.fade.style.opacity = "0";
    });
  }

  /** music that belongs to a screen as a whole (the term screen picks its own by place) */
  _screen_music(name) {
    switch (name) {
      case "title":
      case "birth":
      case "settings":
        A.music("title");
        break;
      case "wheel":
        A.music("wheel");
        break;
      case "registry":
        A.music("registry");
        break;
      case "death":
        A.music("death");
        break;
      case "ending": {
        const eid = this.run ? String(this.run.ending_id || "") : "";
        A.music(eid || "end_filed");
        break;
      }
      default:
    }
  }

  set_background(url, dim = 0) {
    this.world.set_background(url, dim);
  }

  // ---- a life -------------------------------------------------------------------------------------------------------------
  new_life(origin, talent, hero_name, gender) {
    this.meta.last_name = hero_name;
    this.meta.last_gender = gender;
    this.meta.save();
    this.run = new Run(this.D, this.meta, 0);
    this.run.begin(origin, talent, hero_name, gender);
    this.save_run();
    return this.goto("term");
  }

  save_run() {
    if (!this.persist) return;
    if (this.run === null || this.run.dead) {
      this.store.remove(RUN_KEY);
      return;
    }
    this.store.save(RUN_KEY, JSON.stringify(this.run.to_dict()));
  }

  has_saved_run() {
    return this.persist && this.store.load(RUN_KEY) !== null;
  }

  /** the saved run's dictionary (for the title's Continue tooltip), or null */
  saved_run_dict() {
    const t = this.store.load(RUN_KEY);
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch (e) {
      return null;
    }
  }

  continue_run() {
    const d = this.saved_run_dict();
    if (!d) return false;
    this.run = new Run(this.D, this.meta, 0);
    this.run.from_dict(d);
    this.goto("term");
    return true;
  }

  quit_game() {
    this.meta.save();
    this.goto("title");
  }

  // ---- preferences --------------------------------------------------------------------------------------------------------
  /** pushes the saved volumes (percent) and the mute switch to the audio system */
  apply_audio_options() {
    const o = this.meta.options;
    A.set_volumes(Number(o.music_vol ?? 70), Number(o.sfx_vol ?? 90), !!o.muted);
  }

  /** Settings picks the language: remember it; the caller rebuilds its screen */
  set_language(l) {
    L.set_lang(l);
    this.meta.options.lang = L.lang;
    this.meta.save();
    document.documentElement.lang = L.lang === "zh" ? "zh" : "en";
    document.title = L.lang === "zh" ? "无字命" : "Blank Writ";
  }
}

export async function start() {
  const main = new Main();
  try {
    await main.boot();
  } catch (e) {
    console.error(e);
    const sub = document.getElementById("boot-sub");
    if (sub) sub.textContent = "could not start: " + e.message;
  }
  return main;
}

start();

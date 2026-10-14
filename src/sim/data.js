// All the content of Blank Writ (port of scripts/bw_data.gd). Pure data; works in the browser and in Node.
//
//   const D = await BWData.load(fetch_json);     // fetch_json("data/manifest.json") -> parsed JSON, paths relative to the site root
//   D.rules D.cards D.techs D.methods D.enemies D.items D.talents D.origins D.truths D.endings D.wheel D.wheel_order D.events
//   D.story_ids (highest prio first) D.random_ids D.errors D.i18n_files (paths, for L.load)
//   D.card(id) D.item(id) D.tech(id) D.enemy(id) D.realm(r)
//
// data/manifest.json = {files: [...], events: [...], i18n: [...]}: `files` are the names in data/, `events` the names in data/events/,
// `i18n` the names in data/i18n/. Like the GDScript, every `<stem>*.json` is merged (in name order) into one table per stem.

import { clampf, get, godot_sort_custom, has, int, is_dict, str } from "./util.js";

const DATA_DIR = "data";

export class BWData {
  constructor() {
    this.rules = {};
    this.cards = {};
    this.techs = {};
    this.methods = {};
    this.enemies = {};
    this.items = {};
    this.talents = {};
    this.origins = {};
    this.wheel = {};
    this.wheel_order = [];
    this.truths = {};
    this.endings = {};
    this.events = {};
    this.story_ids = []; // story events, highest prio first
    this.random_ids = [];
    this.errors = [];
    this.i18n_files = [];
    this.manifest = { files: [], events: [], i18n: [] };
    this._fetch = null;
  }

  /** the instance made by the last load() (BWData.shared() in the GDScript) */
  static shared() {
    return BWData._shared;
  }

  static async load(fetch_json) {
    const d = new BWData();
    await d.load_all(fetch_json);
    BWData._shared = d;
    return d;
  }

  async load_all(fetch_json) {
    this._fetch = fetch_json;
    this.errors = [];
    let manifest = null;
    try {
      manifest = await fetch_json(`${DATA_DIR}/manifest.json`);
    } catch (e) {
      this.errors.push(`missing ${DATA_DIR}/manifest.json`);
    }
    if (!is_dict(manifest)) manifest = { files: [], events: [], i18n: [] };
    this.manifest = manifest;
    const names = (a) => (Array.isArray(a) ? a.map(String).filter((n) => n.endsWith(".json")).sort() : []);
    const files = names(manifest.files);
    const event_files = names(manifest.events);
    this.i18n_files = names(manifest.i18n).map((n) => `${DATA_DIR}/i18n/${n}`);

    // every file is fetched at once (a static host answers in parallel), then merged in name order like the GDScript's loop
    const wanted = [...new Set([`${DATA_DIR}/rules.json`, ...files.map((n) => `${DATA_DIR}/${n}`), ...event_files.map((n) => `${DATA_DIR}/events/${n}`)])];
    const parsed = new Map();
    const got = await Promise.all(wanted.map((p) => this._read_json(p)));
    wanted.forEach((p, i) => parsed.set(p, got[i]));
    const stem = async (stem_name, key) => {
      const out = [];
      for (const n of files) {
        if (!n.startsWith(stem_name)) continue;
        const arr = get(parsed.get(`${DATA_DIR}/${n}`), key, []);
        if (Array.isArray(arr)) for (const x of arr) out.push(x);
      }
      return out;
    };

    this.rules = parsed.get(`${DATA_DIR}/rules.json`);
    this.cards = this._index(await stem("cards", "cards"));
    this.techs = this._index(await stem("techniques", "techniques"));
    this.methods = this._index(await stem("methods", "methods"));
    this.enemies = this._index(await stem("enemies", "enemies"));
    this.items = this._index(await stem("items", "items"));
    this.talents = this._index(await stem("talents", "talents"));
    this.origins = this._index(await stem("origins", "origins"));
    this.truths = this._index(await stem("truths", "truths"));
    this.endings = this._index(await stem("endings", "endings"));
    const wl = await stem("wheel", "nodes");
    this.wheel = this._index(wl);
    this.wheel_order = [];
    for (const n of wl) this.wheel_order.push(str(get(n, "id", "")));
    const ev = [];
    for (const n of event_files) {
      const arr = get(parsed.get(`${DATA_DIR}/events/${n}`), "events", []);
      if (Array.isArray(arr)) for (const e of arr) ev.push(e);
    }
    this.events = this._index(ev);
    this.story_ids = [];
    this.random_ids = [];
    for (const id of Object.keys(this.events)) {
      const e = this.events[id];
      switch (str(get(e, "kind", "random"))) {
        case "story":
          this.story_ids.push(id);
          break;
        case "random":
          this.random_ids.push(id);
          break;
        default:
      }
    }
    // Godot's sort_custom is not stable: the same algorithm gives the same order among events of one priority
    godot_sort_custom(this.story_ids, (a, b) => int(get(this.events[a], "prio", 0)) > int(get(this.events[b], "prio", 0)));
  }

  async _read_json(path) {
    try {
      const v = await this._fetch(path);
      if (is_dict(v)) return v;
      this.errors.push(`bad json ${path}`);
    } catch (e) {
      this.errors.push(`missing ${path}`);
    }
    return {};
  }

  _index(arr) {
    const out = {};
    for (const x of arr) {
      if (is_dict(x) && has(x, "id")) out[str(x.id)] = x;
    }
    return out;
  }

  // ---- convenience getters with a fallback so the UI never crashes on a missing id ---------------------------------------
  card(id) {
    return has(this.cards, id) ? this.cards[id] : { id, zh: id, en: id, cat: "chance", ap: 1, text: "", fx: [] };
  }

  item(id) {
    return has(this.items, id) ? this.items[id] : { id, zh: id, en: id, kind: "material", q: 1, price: 0 };
  }

  tech(id) {
    return has(this.techs, id) ? this.techs[id] : {};
  }

  enemy(id) {
    return has(this.enemies, id) ? this.enemies[id] : {};
  }

  realm(r) {
    const rs = get(this.rules, "realms", []);
    return rs[clampf(int(r), 0, rs.length - 1)];
  }
}

BWData._shared = null;

export default BWData;

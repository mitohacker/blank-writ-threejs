// Career bot: plays many lives with the greedy policy, buying the Wheel between lives, and prints how the curve looks
// (port of blank-writ/tools/bot_career.gd).
//   node tools/bot_career.mjs --lives=40 --seed=1 [--quiet] [--out=report.txt]      (or: node tools/bot_career.mjs 40 1)

import fs from "node:fs";
import { fetch_json } from "../tests/node_loader.mjs";
import { Auto } from "../src/sim/auto.js";
import { BWData } from "../src/sim/data.js";
import { L } from "../src/sim/loc.js";
import { sprintf } from "../src/sim/fmt.js";
import { Meta } from "../src/sim/meta.js";
import { RNG } from "../src/sim/rng.js";
import { Run } from "../src/sim/run.js";

const PRIORITY = ["w_ap", "w_cult", "w_life", "w_swap", "w_hand", "w_stone", "w_realm", "w_tier", "w_greed", "w_notice", "w_revive"];

function parse_args(argv) {
  const out = {};
  const pos = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const i = a.indexOf("=");
      if (i > 0) out[a.slice(2, i)] = a.slice(i + 1);
      else out[a.slice(2)] = "1";
    } else pos.push(a);
  }
  if (pos.length > 0 && out.lives === undefined) out.lives = pos[0];
  if (pos.length > 1 && out.seed === undefined) out.seed = pos[1];
  return out;
}

function buy_all(D, meta) {
  let bought = 0;
  for (let guard = 0; guard < 60; guard++) {
    let best = "";
    let best_key = 1.0e9;
    for (const id of D.wheel_order) {
      if (!meta.can_buy(id).ok) continue;
      const pri = PRIORITY.indexOf(id);
      const key = meta.node_cost(id) + (pri < 0 ? 0.0 : -1000.0 + pri * 10.0);
      if (key < best_key) {
        best_key = key;
        best = id;
      }
    }
    if (best === "") break;
    meta.buy(best);
    bought += 1;
  }
  return bought;
}

/** GDScript-ish printing of {1: 3, 2: 7} */
function show(o) {
  const parts = Object.keys(o).map((k) => `${JSON.stringify(isNaN(k) ? k : Number(k))}: ${JSON.stringify(o[k])}`);
  return parts.length ? `{ ${parts.join(", ")} }` : "{  }";
}

/** plays a career and returns {lines, stats}; usable from tests */
export async function career({ lives = 30, seed = 1, D = null } = {}) {
  if (!D) {
    D = await BWData.load(fetch_json);
    await L.load(fetch_json, D.i18n_files);
  }
  L.set_lang("en");
  lives = Math.max(1, Math.min(400, Math.trunc(lives)));
  const meta = new Meta(D, null);
  meta.save_enabled = false;
  const rng = new RNG(seed);
  const lines = [];
  const first_realm = {};
  const realm_lives = {};
  const causes = {};
  const endings = {};
  const seen_events = {};
  let total_terms = 0;
  let first_ending = 0;
  let capped = 0;
  let stuck_lives = 0;
  const per_life = [];
  lines.push("life origin       talent            realm  terms cause        pay  imprints nodes truths");
  for (let n = 0; n < lives; n++) {
    const origins = meta.unlocked_origins();
    const origin = origins.length ? String(origins[rng.randi_range(0, origins.length - 1)]) : "orphan";
    const talents = meta.draw_talents(rng);
    const talent = talents.length ? String(talents[rng.randi_range(0, talents.length - 1)]) : "";
    const run = new Run(D, meta, seed * 1000 + n + 1);
    run.begin(origin, talent, "Bot", "m");
    const pol = new RNG(seed * 77 + n);
    const rec = Auto.play_life(run, pol, 400);
    const realm = rec.realm;
    for (let r = 1; r <= realm; r++) if (!(r in first_realm)) first_realm[r] = n + 1;
    realm_lives[realm] = (realm_lives[realm] || 0) + 1;
    for (const e of rec.seen) seen_events[e] = (seen_events[e] || 0) + 1;
    causes[rec.cause] = (causes[rec.cause] || 0) + 1;
    if (rec.ending !== "") {
      endings[rec.ending] = (endings[rec.ending] || 0) + 1;
      if (first_ending === 0) first_ending = n + 1;
    }
    total_terms += rec.terms;
    const pay = run.finished_record.imprints || 0;
    buy_all(D, meta);
    lines.push(
      sprintf("%4d %-12s %-17s %d.%d  %5d %-11s %4d %8d %5d %6d%s", n + 1, origin, talent.slice(0, 17), realm, rec.layer, rec.terms, rec.cause,
        pay, meta.imprints, Object.keys(meta.ranks).length, rec.truths, rec.stuck > 0 ? "  stuck" : ""),
    );
    if (rec.stuck > 0) stuck_lives += 1;
    if (rec.stuck_guard) {
      capped += 1;
      lines.push("      !! hit the term cap");
    }
    per_life.push({ n: n + 1, origin, talent, realm, layer: rec.layer, terms: rec.terms, cause: rec.cause, ending: rec.ending, pay });
  }
  lines.push("");
  lines.push(`lives ending in each realm: ${show(realm_lives)}`);
  lines.push(`first life reaching each realm: ${show(first_realm)}`);
  lines.push(`deaths: ${show(causes)}`);
  lines.push(`endings: ${show(endings)}   first ending at life ${first_ending}`);
  lines.push(sprintf("avg terms per life: %.1f", total_terms / lives));
  const unseen = Object.keys(D.events).filter((id) => !(id in seen_events)).sort();
  lines.push(`events seen: ${Object.keys(seen_events).length} of ${Object.keys(D.events).length}; never seen: ${unseen.join(", ")}`);
  lines.push(`wheel nodes bought: ${Object.keys(meta.ranks).length} of ${Object.keys(D.wheel).length}, imprints left ${meta.imprints}`);
  return {
    lines, first_realm, realm_lives, causes, endings, first_ending, avg_terms: total_terms / lives, unseen, capped, stuck_lives, per_life,
    wheel_bought: Object.keys(meta.ranks).length,
  };
}

const is_main = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (is_main) {
  const args = parse_args(process.argv.slice(2));
  const res = await career({ lives: parseInt(args.lives ?? "30", 10), seed: parseInt(args.seed ?? "1", 10) });
  if (args.quiet === undefined) for (const l of res.lines) console.log(l);
  else for (const l of res.lines.slice(res.lines.length - 7)) console.log(l);
  if (args.out) fs.writeFileSync(args.out, res.lines.join("\n"));
}

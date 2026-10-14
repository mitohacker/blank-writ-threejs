# Porting Blank Writ (Godot -> three.js + DOM)

Source of truth for behaviour: the Godot project `C:\Dev\Prototypes\blank-writ` (`scripts/*.gd`, `data/*.json`, `data/SCHEMA.md`, `SPEC.md`).
This folder is the browser build: plain ES modules, **no bundler, no npm runtime deps** (three.js is vendored in `vendor/`), published as a static
site (GitHub Pages). The game must behave like the Godot one: same rules, same content, same screens, both languages, sound and music.

## Layout and owners

| path | what | owner |
|---|---|---|
| `index.html`, `css/game.css`, `serve.py`, `src/main.js` | page, router (`goto`, saves, language), boot | lead (done; ask before changing) |
| `src/ui/ui.js`, `src/ui/art.js`, `src/audio.js`, `src/gfx/world.js`, `src/sim/fmt.js`, `src/sim/rng.js` | shared toolkit (done) | lead |
| `src/sim/{data,loc,text,meta,run,battle,auto}.js`, `tests/test_sim.mjs`, `tools/bot_career.mjs`, `tests/node_loader.mjs` | the game logic (port of `bw_data bw_loc bw_text bw_meta bw_run bw_battle bw_auto`) | **sim agent** |
| `src/ui/screens/term.js`, `src/ui/event_view.js`, `src/ui/battle_view.js`, `src/ui/overlays.js`, `src/gfx/cards3d.js`, `tests/browser/test_term.mjs` | the term screen, hand of cards (WebGL), event dialog, battle window, overlays | **term agent** |
| `src/ui/screens/{title,birth,wheel,registry,death,ending,settings}.js`, `src/ui/ui_extra.js`, `tests/browser/test_menus.mjs` | menu-side screens | **menu agent** |

Touch only your own files. If you need a change in someone else's file (or in a lead file), write it into `NOTES_<your-agent>.md` at the repo
root with the exact change and carry on with a local workaround; the lead merges.

## Rules of the port

* **Same names.** Keep the GDScript identifiers (snake_case) for classes' fields and methods, dictionary keys, outcome keys, ids, `data` keys.
  `run.can_play(i)`, `run.end_term()`, `out.lines`, `meta.imprints`, `D.card(id)`. Class names: `BWData`, `Meta`, `Run`, `Battle` (static
  methods), `Auto` (static), `Txt` (static), `L` (static). A Godot `Dictionary` is a plain object, `Array` is an Array, `String` string,
  `int`/`float` number, `RefCounted` class, `preload` import, `static func` static method, `signal` an event/promise, `await` await.
* **Numbers match.** `int(x)` truncates toward zero (`Math.trunc`), `roundi/round` is half away from zero, integer division `a / b` of two
  ints truncates, `%` on negatives follows GDScript (sign of the dividend, like JS), `clampf/clampi/minf/maxf/lerpf/absf/floori/ceili/signf`
  exist in GDScript - replicate carefully. Dictionary iteration is insertion order in both.
* **Formatting.** `"fmt" % x` -> `sprintf(fmt, ...args)` from `src/sim/fmt.js` (one array argument is spread). Every string a player reads goes
  through `L.t(english)` exactly as in the Godot code (the English text is the key into `data/i18n/zh_*.json`); entity names through
  `L.name_of(entity)`; never write a bilingual label.
* **Randomness** comes from `RNG` (`src/sim/rng.js`, same surface as Godot's RandomNumberGenerator: `randf() randi() randi_range(a,b)
  randf_range(a,b) seed state randomize()`). Draw in the same order as the GDScript so behaviour is comparable.
* **Storage** is injected: `new Meta(D, store)` with `store = {load(key) -> string|null, save(key, text), remove(key)}`; keys `bw.profile`,
  `bw.run`. No `localStorage` in `src/sim/**` (Node tests run them too).
* **Data loading**: `await BWData.load(fetch_json)` where `fetch_json(path)` resolves a path relative to the site root (`"data/manifest.json"`,
  `"data/cards.json"`, `"data/events/act1_a.json"` ...) to parsed JSON; `data/manifest.json` = `{files:[...], events:[...], i18n:[...]}`
  (made by `tools/build_assets.py` from the Godot data; a static host cannot glob). `BWData` merges every `<stem>*.json` like `bw_data.gd`,
  and exposes `i18n_files` (paths) for `await L.load(fetch_json, D.i18n_files)`. Node tests use `tests/node_loader.mjs` (fs-based `fetch_json`).
* **No DOM / three.js / window in `src/sim/**`.** It must run in plain Node 22.
* Save format: `run.to_dict()` / `run.from_dict(d)` JSON-safe (RNG state included), same keys as the GDScript.

## UI conventions (term + menu agents)

* The page is a **1920x1080 stage** (`#stage`, scaled to fit the window by `world.js`); every element is `position:absolute` in design pixels, so
  Godot coordinates carry over 1:1. Screens are classes `export default class XScreen extends Screen` (`src/ui/ui.js`) with `async setup(main, args)`;
  put elements in `this.root` (a full-stage div); `destroy()` removes it. Navigate with `main.goto(name, args)`.
* Toolkit (`src/ui/ui.js`): `label, wrap_label, rich, panel (nine-patch from art/ui), flat, button, set_enabled, bar, tex_rect, toast, tween,
  fit_size, text_width, at, add, hit, clear, el`. Pictures: `Art.bg/card/portrait/sprite/icon/ui/ending/title/frames()` return a url or null.
  Sounds: `A.sfx(id)`, `A.music(id)`, `A.music_for_place(place, winter)`; ids exactly as in the Godot code (`assets/audio/audio.json`).
* **Pointer events**: `#stage` has `pointer-events:none`; interactive elements are `.hit` (buttons already are). Anything that must block
  clicks (modal dim, overlays) is `.hit`. The WebGL canvas below receives the rest (card picking).
* **WebGL**: `main.world` (`src/gfx/world.js`) owns the scene/camera/renderer; design px -> scene via `world.pos(x, y, z)`. The painted place and
  ambience are already there (`main.set_background(url, dim)`). The hand of cards is drawn by `src/gfx/cards3d.js` (term agent).
* Fonts: CSS variables `--font-body`, `--font-title`, `--font-cjk` (system fonts; the Godot version used the same families).
* Language switch: `main.set_language(l)` then rebuild the screen (`main.goto(sameScreen, args)`).
* Every screen must work with no art for a picture (stand-in boxes) and with both languages; `tests/browser/*` must pass in English and Chinese.

## Testing

* Node (sim): `node tests/test_sim.mjs` - port the checks of `tests/verify_bw_core.gd`, plus save/load round trip, whole lives by the bot
  (`Auto`), and a career curve like `tools/bot_career.gd`. Exit code != 0 on failure.
* Browser: `tests/browser/launch.mjs` (Playwright + the installed Edge, headless, WebGL via SwiftShader) against the static server on
  **port 8712, already running** (`python serve.py 8712` if not). Pattern: `const g = await open_game({query: "screen=term&fresh=1&autoplay=9&lang=zh"})`,
  drive the page with `g.page.evaluate(() => window.__bw ...)` and real clicks, `shot(g.page, "shots/x.png")`, then **look at the screenshots** (Read the
  PNG) and fix what looks wrong. Query flags: `screen, lang, seed, fresh, autoplay, origin, talent, event, battle, panel, hover`.
* Memory/CPU safety (this machine hard-reset four times from one runaway loop): no unbounded `while`; give every loop and await a cap; run
  one browser at a time, always `await close(g)`, use `timeout 120 node ...`; no background loops left running; never loop on
  `children.length` while removing; if something grows without bound, stop and report.

## Assets

`assets/art/<kind>/<name>.webp` (listed in `assets/art/manifest.json`, `ui/frames.json` has card frame windows), `assets/audio/{sfx,music}/*.mp3`
+ `assets/audio/audio.json`, `data/**`. Regenerate with `python tools/build_assets.py` (reads the Godot project).

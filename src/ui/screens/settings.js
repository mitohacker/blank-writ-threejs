// Settings (port of scripts/bw_screen_settings.gd): the language (each choice written in its own words), the music and effect volumes,
// and a mute switch. Reached from the title menu and from the pause menu; `args.back` names the screen the Back button returns to
// ("term" from a life). Picking a language rebuilds this screen in it, and every screen after it, so only the chosen language is shown.

import { Screen, button, el } from "../ui.js";
import { Art } from "../art.js";
import { A } from "../../audio.js";
import { L } from "../../sim/loc.js";
import * as X from "../ui_extra.js";

const PANEL_POS = [360, 120];
const PANEL_SIZE = [1200, 840];
const LANG_BTN = [380, 96];

const LANGS = (L.LANGS && L.LANGS.length ? L.LANGS : ["en", "zh"]);
const NATIVE_NAMES = L.NATIVE_NAMES || { en: "English", zh: "中文" };

export default class SettingsScreen extends Screen {
  async setup(main, args = {}) {
    this.main = main;
    this.on_destroy(X.hide_tooltip);
    this._back_to = String(args.back ?? "");
    this._val_labels = {};
    this._sliders = {};
    const root = this.root;
    X.backdrop(root, main, Art.title(), 0.35, [0.08, 0.09, 0.12]);
    root.appendChild(X.box(PANEL_POS, PANEL_SIZE, X.flat([0.03, 0.03, 0.04, 0.82], [0.86, 0.7, 0.3, 0.6], 2, 14)));
    X.text_at(root, L.t("Settings"), [PANEL_POS[0] + 60, PANEL_POS[1] + 36], 56, X.GOLD, true);

    const back = button(this._back_text(), 320, 62, { font_size: 24, sound: "ui_back", onclick: () => this._on_back() });
    X.place(back, [PANEL_POS[0] + PANEL_SIZE[0] - 380, PANEL_POS[1] + 40]);
    back.dataset.id = "back";
    root.appendChild(back);

    this._build_language([PANEL_POS[0] + 60, PANEL_POS[1] + 150]);
    this._build_volume("music_vol", L.t("Music"), 70, [PANEL_POS[0] + 60, PANEL_POS[1] + 400]);
    this._build_volume("sfx_vol", L.t("Sound effects"), 90, [PANEL_POS[0] + 60, PANEL_POS[1] + 530]);
    this._build_mute([PANEL_POS[0] + 60, PANEL_POS[1] + 680]);
    X.text_at(root, L.t("Changes are saved at once."), [PANEL_POS[0] + 60, PANEL_POS[1] + PANEL_SIZE[1] - 70], 20, [0.7, 0.66, 0.56]);

    // Esc is Back
    const onkey = (ev) => {
      if (ev.key === "Escape" && !ev.repeat) {
        ev.preventDefault();
        this._on_back();
      }
    };
    window.addEventListener("keydown", onkey);
    this.on_destroy(() => window.removeEventListener("keydown", onkey));
  }

  // ---- language -----------------------------------------------------------------------------------------------------------------
  _build_language(pos) {
    const root = this.root;
    X.text_at(root, L.t("Language"), pos, 32, X.CREAM);
    let x = 0;
    for (const code of LANGS) {
      const id = String(code);
      const on = L.lang === id;
      if (on) root.appendChild(X.ring_box([pos[0] + x - 6, pos[1] + 58], [LANG_BTN[0] + 12, LANG_BTN[1] + 12], X.GOLD, 4, 14, 8));
      // the name is written in its own language, whichever one is showing
      const b = button(String(NATIVE_NAMES[id] ?? id), LANG_BTN[0], LANG_BTN[1], { font_size: 40, onclick: () => this._pick_language(id) });
      X.place(b, [pos[0] + x, pos[1] + 64]);
      b.dataset.lang = id;
      root.appendChild(b);
      x += LANG_BTN[0] + 40;
    }
  }

  _pick_language(id) {
    if (id === L.lang) return;
    this.main.set_language(id);
    this.main.goto("settings", { back: this._back_to });
  }

  // ---- volume ---------------------------------------------------------------------------------------------------------------------
  _build_volume(key, title, default_pct, pos) {
    const root = this.root;
    const meta = this.main.meta;
    X.text_at(root, title, pos, 32, X.CREAM);
    const s = el("input", "mx-range hit");
    s.type = "range";
    s.min = "0";
    s.max = "100";
    s.step = "5";
    s.value = String(Math.max(0, Math.min(100, Number(meta.options[key] ?? default_pct))));
    s.dataset.key = key;
    X.place(s, [pos[0], pos[1] + 62], [880, 40]);
    // the part up to the thumb is lit gold (the Godot slider's grabber area)
    const paint = () => {
      const p = Number(s.value);
      s.style.background = `linear-gradient(to right, #c79a38 0, #c79a38 ${p}%, #2e2823 ${p}%, #2e2823 100%)`;
    };
    s.style.height = "12px";
    s.style.marginTop = "14px";
    paint();
    root.appendChild(s);
    this._sliders[key] = s;
    const v = X.text_at(root, `${Math.trunc(Number(s.value))}%`, [pos[0] + 910, pos[1] + 52], 32, X.GOLD, false, 120, "right");
    this._val_labels[key] = v;
    s.addEventListener("input", () => {
      const val = Math.trunc(Number(s.value));
      meta.options[key] = val;
      v.textContent = `${val}%`;
      paint();
      A.sfx("ui_tick");
      this.main.apply_audio_options();
      meta.save();
    });
    // a sample of the sound that was just set, once the thumb is let go
    s.addEventListener("change", () => A.sfx(key === "sfx_vol" ? "gain" : "ui_confirm"));
  }

  // ---- mute -------------------------------------------------------------------------------------------------------------------
  _build_mute(pos) {
    this._mute_btn = button("", 520, 76, { font_size: 30, onclick: () => this._toggle_mute() });
    X.place(this._mute_btn, pos);
    this._mute_btn.dataset.id = "mute";
    this.root.appendChild(this._mute_btn);
    this._refresh_mute();
  }

  _muted() {
    return !!this.main.meta.options.muted;
  }

  _refresh_mute() {
    this._mute_btn.textContent = this._muted() ? L.t("Sound: off") : L.t("Sound: on");
  }

  _toggle_mute() {
    const meta = this.main.meta;
    meta.options.muted = !this._muted();
    this.main.apply_audio_options();
    meta.save();
    this._refresh_mute();
    if (!this._muted()) A.sfx("ui_confirm");
  }

  // ---- back -------------------------------------------------------------------------------------------------------------------
  _back_dest() {
    return this._back_to !== "" ? this._back_to : "title";
  }

  _back_text() {
    return this._back_dest() === "term" ? L.t("Back to the life") : L.t("Back to the title");
  }

  _on_back() {
    this.main.goto(this._back_dest());
  }
}

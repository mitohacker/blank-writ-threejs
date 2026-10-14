// The auto-battle window (port of scripts/bw_battle_view.gd): replays a Battle result frame by frame (bars, damage numbers, log), with
// pause / speed / skip, VICTORY / DEFEAT, the battle music and a sound per frame.
//
//   const v = new BattleView(main, parent_el);  await v.show_battle(result, place);   // resolves when the player presses Continue

import { el, at, add, tex_rect, panel, button, set_enabled } from "./ui.js";
import { Art } from "./art.js";
import { A } from "../audio.js";
import { L } from "../sim/loc.js";
import { sprintf } from "../sim/fmt.js";
import { bar, outline, make_modal, on_window, plabel as label } from "./term_kit.js";

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const int = (v, d = 0) => Math.trunc(num(v, d));
const escape_html = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class BattleView {
  constructor(main, parent) {
    this.main = main;
    this.parent = parent;
    this.root = make_modal("rgba(8,8,10,0.72)");
    this.root.dataset.bw = "battle";
    this.res = {};
    this.frames = [];
    this.idx = 0;
    this.speed = 1;
    this.paused = false;
    this.done = false;
    this._timer = 0;
    this._raf = 0;
    this._gone = false;
    this._off = [];
    this.finished = new Promise((res) => (this._resolve = res));
  }

  /** builds the window and starts the replay; resolves when the player continues */
  show_battle(result, place) {
    const { main } = this;
    const run = main.run;
    this.res = result;
    this.frames = result.frames || [];
    this.parent.appendChild(this.root);
    const w = { x: 1560, y: 800 };
    const o = { x: (1920 - w.x) / 2, y: 110 };
    const R = this.root;
    // the ink frame: the place's painting inside a dark lacquer border
    add(R, at(panel("panel_dark", 40, "#121010eb"), o.x - 24, o.y - 24, w.x + 48, w.y + 48));
    add(R, at(tex_rect(Art.bg(place), w.x, w.y, true), o.x, o.y));
    const veil = el("div", "abs");
    at(veil, o.x, o.y, w.x, w.y);
    veil.style.background = "rgba(255,255,255,0.12)";
    veil.style.pointerEvents = "none";
    add(R, veil);
    // combatants
    const hero_id = "hero_" + run.gender;
    const hero_url = Art.sprite(hero_id);
    const en_url = Art.sprite(String(result.enemy_id || "")) || Art.sprite(String(result.enemy_art || ""));
    this._hero_home = { x: o.x + 250, y: o.y + 190 };
    this._enemy_home = { x: o.x + w.x - 560, y: o.y + 160 };
    this._hero_spr = this._sprite(hero_url, 330, 520, String(run.hero_name), "#e6e6d9");
    at(this._hero_spr, this._hero_home.x, this._hero_home.y);
    add(R, this._hero_spr);
    this._enemy_spr = this._sprite(en_url, 380, 560, this._enemy_name(), "#d99980");
    at(this._enemy_spr, this._enemy_home.x, this._enemy_home.y);
    add(R, this._enemy_spr);
    // bars
    this._p_max_hp = Math.max(1, num(result.p_max, 100));
    this._e_max_hp = Math.max(1, num(result.e_max, 100));
    const first = this.frames.length > 0 ? this.frames[0] : {};
    this._p_max_mp = Math.max(1, run.max_mp());
    this._e_max_mp = Math.max(1, num(first.emp, 20)) + 1;
    add(R, at(label(`${run.hero_name}  ${run.realm_label()}`, 26, "#1f1a14"), o.x + 24, o.y + 14));
    this._p_hp = bar("trough_a", "fill_green", 520, 36, "#4db366");
    add(R, at(this._p_hp.el, o.x + 20, o.y + 52));
    this._p_mp = bar("trough_b", "fill_blue", 520, 30, "#4d80d9");
    add(R, at(this._p_mp.el, o.x + 20, o.y + 92));
    const en_l = label(this._enemy_name(), 26, "#1f1a14");
    add(R, at(en_l, o.x + w.x - 24 - 520, o.y + 14));
    this._e_hp = bar("trough_a", "fill_red", 520, 36, "#cc4d40");
    add(R, at(this._e_hp.el, o.x + w.x - 20 - 520, o.y + 52));
    this._e_mp = bar("trough_b", "fill_amber", 520, 30, "#d9a633");
    add(R, at(this._e_mp.el, o.x + w.x - 20 - 520, o.y + 92));
    // log
    add(R, at(panel("panel_dark", 30, "#0d0d0fd9"), o.x + 20, o.y + w.y - 230, 560, 210));
    this._log = el("div", "abs");
    at(this._log, o.x + 42, o.y + w.y - 200, 516, 160);
    this._log.style.overflowY = "hidden";
    this._log.style.fontSize = "18px";
    this._log.style.color = "#ebe0bf";
    this._log.style.lineHeight = "24px";
    this._log.style.pointerEvents = "none";
    add(R, this._log);
    // controls
    this._pause_btn = button(L.t("Pause"), 150, 54, { font_size: 22, onclick: () => this._on_pause() });
    add(R, at(this._pause_btn, o.x + w.x - 500, o.y + w.y - 80));
    this._speed_btn = button(sprintf(L.t("Speed x%d"), 1), 170, 54, { font_size: 22, onclick: () => this._on_speed() });
    add(R, at(this._speed_btn, o.x + w.x - 340, o.y + w.y - 80));
    this._skip_btn = button(L.t("Skip"), 130, 54, { font_size: 22, onclick: () => this._on_skip() });
    add(R, at(this._skip_btn, o.x + w.x - 160, o.y + w.y - 80));
    this._banner = label("", 96, "#faE68c", true, { width: 700, align: "center" });
    at(this._banner, o.x + w.x * 0.5 - 350, o.y + w.y * 0.5 - 90);
    outline(this._banner, "#00000099", 6);
    this._banner.style.display = "none";
    add(R, this._banner);
    this._cont = button(L.t("Continue"), 260, 64, { font_size: 28, onclick: () => this._on_continue() });
    at(this._cont, o.x + w.x * 0.5 - 130, o.y + w.y * 0.5 + 40);
    this._cont.style.display = "none";
    this._cont.dataset.role = "continue";
    add(R, this._cont);
    this._skip_btn.dataset.role = "skip";
    this._apply_bars(int(result.p_start, this._p_max_hp), int(first.ehp, this._e_max_hp), int(first.pmp, this._p_max_mp), int(first.emp, this._e_max_mp));
    this._log_html(`<span style="color:#ddddbb">${escape_html(sprintf(L.t("%s appears."), this._enemy_name()))}</span>`);
    this._start_sound();
    // the ambience calms down (fewer drifting papers) while the fight is on
    const world = main.world;
    this._mood = world ? world.mood : "calm";
    if (world && world.set_mood) world.set_mood("battle");
    this._off.push(
      on_window("keydown", (e) => {
        if (e.repeat) return;
        if ((e.key === "Enter" || e.key === " ") && this.done) {
          e.preventDefault();
          this._on_continue();
        } else if (e.key === " ") {
          e.preventDefault();
          this._on_pause();
        }
      }),
    );
    if (this.frames.length === 0) this._end();
    else this._loop();
    return this.finished;
  }

  _sprite(url, w, h, caption, tint) {
    const c = el("div", "abs");
    c.style.width = w + "px";
    c.style.height = h + "px";
    c.style.pointerEvents = "none";
    if (url) {
      add(c, tex_rect(url, w, h, false));
      c.firstChild.style.position = "absolute";
    } else {
      const box = el("div", "abs", c);
      at(box, w * 0.25, h * 0.1, w * 0.5, h * 0.85);
      box.style.background = "rgba(80,80,80,.55)";
      add(c, at(label(caption, 30, "#ffffff"), w * 0.3, h * 0.4));
    }
    return c;
  }

  _apply_bars(php, ehp, pmp, emp) {
    this._p_hp.set_value(php / this._p_max_hp, `${php} / ${int(this._p_max_hp)}`);
    this._p_mp.set_value(pmp / this._p_max_mp, `${pmp} / ${int(this._p_max_mp)}`);
    this._e_hp.set_value(ehp / this._e_max_hp, `${Math.max(0, ehp)} / ${int(this._e_max_hp)}`);
    this._e_mp.set_value(emp / this._e_max_mp, "");
  }

  _log_html(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    this._log.appendChild(d);
    // keep the window to what is visible plus a little (the oldest lines drop off)
    while (this._log.childNodes.length > 40) this._log.removeChild(this._log.firstChild);
    this._log.scrollTop = this._log.scrollHeight;
  }

  // ---- the replay -------------------------------------------------------------------------------------------------------------
  _loop() {
    let last = performance.now();
    const fast = this.main.args && "fast" in this.main.args;
    const step = (now) => {
      if (this._gone || this.done) return;
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (!this.paused) {
        this._timer += dt * this.speed * (fast ? 20 : 1);
        if (this._timer >= 0.5) {
          this._timer = 0;
          this._step();
        }
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _step() {
    if (this.idx >= this.frames.length) {
      this._end();
      return;
    }
    const f = this.frames[this.idx];
    this.idx += 1;
    this._apply_frame(f, true);
    if (this.idx >= this.frames.length) this._end();
  }

  _enemy_name() {
    const r = this.res;
    let n = String(r.enemy_name || "");
    if (n === "") n = L.is_zh() ? String(r.enemy_zh || "") : String(r.enemy_en || L.t("Enemy"));
    return n;
  }

  _skill_name(f) {
    if (L.is_zh() && String(f.zh || "") !== "") return String(f.zh);
    return L.t(String(f.skill || "Strike"));
  }

  _start_sound() {
    A.sfx("battle_start");
    const id = String(this.res.enemy_id || "");
    const e = this.main.D.enemy(id) || {};
    let m = "battle";
    if (id.startsWith("tribulation_")) m = "tribulation";
    else if (String(e.kind || "") === "boss" || (!!this.res.lethal && int(e.tier, 1) >= 5)) m = "battle_boss";
    A.music(m, 0.6);
  }

  _frame_sound(f) {
    const actor_p = int(f.a, 0) === 0;
    if (f.miss) {
      A.sfx("b_miss");
      return;
    }
    const kind = String(f.kind || "attack");
    const elem = String(f.elem || "");
    const sk = String(f.skill || "");
    if (sk === "Talisman") A.sfx("b_talisman");
    else if (kind === "heal") A.sfx("b_heal");
    else if (kind === "shield") A.sfx("b_shield");
    else if (kind === "buff") A.sfx("b_buff");
    else if (kind === "debuff") A.sfx("b_debuff");
    else if (String(this.res.enemy_id || "").startsWith("tribulation_") && !actor_p) A.sfx("bolt");
    else if (elem !== "" && elem !== "none" && int(f.dmg, 0) > 0) A.sfx("b_" + elem);
    else if (int(f.dmg, 0) > 0) A.sfx(f.crit ? "b_crit" : Math.random() < 0.5 ? "b_slash" : "b_hit");
    for (const t of f.text || []) {
      const ts = String(t);
      if (/burn|灼烧|poison|中毒/.test(ts)) {
        A.sfx("b_burn");
        break;
      }
      if (/stun|眩晕/.test(ts)) {
        A.sfx("b_stun");
        break;
      }
    }
  }

  _apply_frame(f, animate) {
    this._apply_bars(int(f.php, 0), int(f.ehp, 0), int(f.pmp, 0), int(f.emp, 0));
    const actor_p = int(f.a, 0) === 0;
    const who = actor_p ? String(this.main.run.hero_name) : this._enemy_name();
    const skill = this._skill_name(f);
    let line = `<span style="color:${actor_p ? "#99dddd" : "#ee9999"}">${escape_html(who)}</span> ${escape_html(skill)}`;
    if (f.miss) line += " — " + escape_html(L.t("missed"));
    else if (int(f.dmg, 0) > 0) line += ` — ${int(f.dmg)}${f.crit ? " " + escape_html(L.t("(crit!)")) : ""}`;
    else if (int(f.heal, 0) > 0) line += " — " + escape_html(sprintf(L.t("heals %d"), int(f.heal)));
    for (const t of f.text || []) line += `<br><span style="color:#bbbbbb">&nbsp;&nbsp;&nbsp;${escape_html(String(t))}</span>`;
    this._log_html(line);
    if (!animate) return;
    this._frame_sound(f);
    const target = actor_p ? this._enemy_spr : this._hero_spr;
    const src = actor_p ? this._hero_spr : this._enemy_spr;
    const amount = int(f.dmg, 0);
    let txt = "";
    let col = "#fff2cc";
    if (f.miss) {
      txt = L.t("miss");
      col = "#cccccc";
    } else if (amount > 0) {
      txt = String(amount) + (f.crit ? "!" : "");
      col = f.crit ? "#ff6650" : "#ffd980";
    } else if (int(f.heal, 0) > 0) {
      txt = `+${int(f.heal)}`;
      col = "#80ff99";
    }
    if (txt !== "") this._popup(int(f.heal, 0) === 0 ? target : src, txt, col);
    // a little lunge
    const dir = actor_p ? 40 : -40;
    if (src.animate) {
      src.animate([{ transform: "translateX(0)" }, { transform: `translateX(${dir}px)`, offset: 0.4 }, { transform: "translateX(0)" }], { duration: 200 });
    }
  }

  _popup(target, text, color) {
    const l = label(text, 54, color, true);
    outline(l, "#000000", 8);
    const x = parseFloat(target.style.left) + parseFloat(target.style.width) * 0.4;
    const y = parseFloat(target.style.top) + 20;
    at(l, x, y);
    add(this.root, l);
    if (l.animate) {
      const a = l.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-90px)", opacity: 0 }], { duration: 700, easing: "ease-out", fill: "forwards" });
      a.onfinish = () => l.remove();
    } else setTimeout(() => l.remove(), 700);
  }

  _on_pause() {
    if (this.done) return;
    this.paused = !this.paused;
    this._pause_btn.textContent = this.paused ? L.t("Play") : L.t("Pause");
  }

  _on_speed() {
    if (this.done) return;
    this.speed = this.speed < 2 ? 2 : this.speed < 4 ? 4 : 1;
    this._speed_btn.textContent = sprintf(L.t("Speed x%d"), int(this.speed));
  }

  _on_skip() {
    if (this.done) return;
    while (this.idx < this.frames.length) {
      const f = this.frames[this.idx];
      this.idx += 1;
      this._apply_frame(f, false);
    }
    this._end();
  }

  _end() {
    if (this.done) return;
    this.done = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    const win = !!this.res.win;
    this._banner.textContent = win ? L.t("VICTORY") : L.t("DEFEAT");
    A.music(win ? "win" : "lose", 0.4);
    if (!win) A.sfx("b_lose");
    this._banner.style.color = win ? "#faE68c" : "#e6665a";
    this._banner.style.display = "";
    this._cont.style.display = "";
    set_enabled(this._pause_btn, false);
    set_enabled(this._speed_btn, false);
  }

  /** the screen is going away: stop the replay and drop the window */
  abort() {
    if (this._gone) return;
    this._gone = true;
    this.done = true;
    this._restore_mood();
    for (const f of this._off.splice(0)) f();
    if (this._raf) cancelAnimationFrame(this._raf);
    this.root.remove();
    this._resolve();
  }

  _restore_mood() {
    const world = this.main.world;
    if (world && world.set_mood && this._mood) world.set_mood(this._mood);
  }

  _on_continue() {
    if (this._gone || !this.done) return;
    this._gone = true;
    this._restore_mood();
    for (const f of this._off.splice(0)) f();
    if (this._raf) cancelAnimationFrame(this._raf);
    this.root.remove();
    this._resolve();
  }
}

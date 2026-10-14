// Sound and music (port of scripts/bw_audio.gd): WebAudio one-shots with variants and a 45 ms throttle, HTMLAudio music with a crossfade.
// Safe to call before init() or when the files are missing (every call becomes a no-op), so tests and tools stay silent.
//
//   A.sfx("ui_click")   A.music("village")   A.music_for_place("sect", winter)   A.card_category("cultivate")
//   A.set_volumes(musicPct, sfxPct, muted)   A.stop_music(fade)   A.has_sound()

const ROOT = new URL("../assets/audio/", import.meta.url).href;

const PLACE_MUSIC = {
  village: "village", town: "town", sect: "sect", valley: "valley", wilds: "wilds", ruin: "ruin", netherworld: "netherworld",
  registry: "registry", gate: "gate", wheel: "wheel", cave: "cave", road: "road",
};

class AudioSystem {
  constructor() {
    this.manifest = { sfx: {}, music: {} };
    this.ctx = null;
    this.sfx_bus = null;
    this.buffers = new Map();       // file -> Promise<AudioBuffer|null>
    this.last_variant = {};
    this.last_time = {};
    this.music_vol = 0.7;
    this.sfx_vol = 0.9;
    this.muted = false;
    this.music_id = "";
    this.active = null;             // {el, id, fade: 0..1}
    this.fading = [];               // elements fading out
    this.pending_music = null;      // [id, fade] asked for before the first user gesture
    this.ready = false;
    this._raf = 0;
  }

  async init() {
    if (this.ready) return;
    try {
      const r = await fetch(ROOT + "audio.json", { cache: "no-store" });
      this.manifest = await r.json();
    } catch (e) {
      this.manifest = { sfx: {}, music: {} };
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AC) {
      try {
        this.ctx = new AC();
        this.sfx_bus = this.ctx.createGain();
        this.sfx_bus.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
      }
    }
    this._apply_volumes();
    const unlock = () => {
      if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {});
      if (this.pending_music) {
        const [id, fade] = this.pending_music;
        this.pending_music = null;
        this.music_id = "";
        this.music(id, fade);
      } else if (this.active && this.active.el.paused) {
        this.active.el.play().catch(() => {});
      }
    };
    for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, unlock, { passive: true });
    this.ready = true;
  }

  has_sound() {
    return !!this.ctx && Object.keys(this.manifest.sfx || {}).length > 0;
  }

  set_volumes(music_pct, sfx_pct, muted = false) {
    this.music_vol = Math.min(1, Math.max(0, music_pct / 100));
    this.sfx_vol = Math.min(1, Math.max(0, sfx_pct / 100));
    this.muted = !!muted;
    this._apply_volumes();
  }

  _apply_volumes() {
    if (this.sfx_bus) this.sfx_bus.gain.value = this.muted ? 0 : this.sfx_vol;
    this._music_levels();
  }

  _music_levels() {
    const m = this.muted ? 0 : this.music_vol;
    if (this.active) this.active.el.volume = Math.min(1, Math.max(0, this.active.fade * m));
    for (const f of this.fading) f.el.volume = Math.min(1, Math.max(0, f.fade * m));
  }

  _buffer(rel) {
    if (this.buffers.has(rel)) return this.buffers.get(rel);
    const p = (async () => {
      if (!this.ctx) return null;
      try {
        const r = await fetch(ROOT + rel);
        if (!r.ok) return null;
        return await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) {
        return null;
      }
    })();
    this.buffers.set(rel, p);
    return p;
  }

  async sfx(id, volume_db = 0) {
    const spec = (this.manifest.sfx || {})[id];
    if (!spec || !this.ctx) return;
    const now = performance.now();
    if (now - (this.last_time[id] ?? -1000) < 45) return;
    this.last_time[id] = now;
    const files = spec.files || [];
    if (!files.length) return;
    let i = Math.floor(Math.random() * files.length);
    if (files.length > 1 && i === (this.last_variant[id] ?? -1)) i = (i + 1) % files.length;
    this.last_variant[id] = i;
    const buf = await this._buffer(files[i]);
    if (!buf || this.ctx.state !== "running") return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 0.08 - 0.04);
    const g = this.ctx.createGain();
    g.gain.value = Math.pow(10, ((spec.gain || 0) + volume_db) / 20);
    src.connect(g).connect(this.sfx_bus);
    src.start();
  }

  card_category(cat) {
    this.sfx("card_" + cat);
  }

  music_for_place(place, winter = false) {
    const id = winter && place === "village" ? "winter" : PLACE_MUSIC[place] || "village";
    this.music(id);
  }

  music(id, fade = 1.6) {
    const spec = (this.manifest.music || {})[id];
    if (!spec || !spec.file) return;
    if (id === this.music_id && this.active && !this.active.el.paused) return;
    if (this.ctx && this.ctx.state !== "running" && !this._gesture_seen()) {
      this.pending_music = [id, fade];
      return;
    }
    this.music_id = id;
    const el = new Audio(ROOT + spec.file);
    el.loop = spec.loop !== false;
    el.volume = 0;
    const entry = { el, id, fade: 0 };
    const old = this.active;
    this.active = entry;
    el.play().catch(() => {
      // autoplay refused: try again on the first gesture
      this.pending_music = [id, fade];
      this.music_id = "";
    });
    if (old) {
      this.fading.push(old);
      old.target = 0;
    }
    entry.target = 1;
    entry.rate = 1 / Math.max(0.05, fade);
    this._start_fade();
  }

  _gesture_seen() {
    return !!(typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.hasBeenActive);
  }

  stop_music(fade = 1.0) {
    this.music_id = "";
    this.pending_music = null;
    if (this.active) {
      this.fading.push(this.active);
      this.active.target = 0;
      this.active.rate = 1 / Math.max(0.05, fade);
      this.active = null;
      this._start_fade();
    }
  }

  _start_fade() {
    if (this._raf) return;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let busy = false;
      const all = this.active ? [this.active, ...this.fading] : [...this.fading];
      for (const e of all) {
        const tgt = e.target ?? 1;
        const rate = e.rate ?? 1;
        if (e.fade < tgt) e.fade = Math.min(tgt, e.fade + dt * rate);
        else if (e.fade > tgt) e.fade = Math.max(tgt, e.fade - dt * rate);
        if (e.fade !== tgt) busy = true;
      }
      this.fading = this.fading.filter((e) => {
        if (e.fade <= 0.001 && (e.target ?? 1) === 0) {
          e.el.pause();
          e.el.src = "";
          return false;
        }
        return true;
      });
      this._music_levels();
      if (busy || this.fading.length) this._raf = requestAnimationFrame(step);
      else this._raf = 0;
    };
    this._raf = requestAnimationFrame(step);
  }
}

export const A = new AudioSystem();
export default A;

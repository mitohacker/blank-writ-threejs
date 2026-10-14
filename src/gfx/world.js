// The WebGL layer behind the DOM stage (three.js): the painted place with a slow drift, a veil, mist and drifting talismans, and the
// scene the card hand is drawn into (src/gfx/cards3d.js). Design units: 1 unit = 1 design pixel of the 1920x1080 stage.
//
//   const world = new World(canvas);  world.start();
//   world.set_background(url, dim, fade)   world.set_mood("calm" | "battle" | "winter" | "dark")
//   world.pos(x, y, z = 0) -> THREE.Vector3  (design px, y down, origin top-left of the stage -> scene coords)
//   world.to_design(clientX, clientY) -> {x, y}   world.scale (stage px per design px)   world.view {w, h} visible design size
//   world.scene / world.camera / world.renderer   world.add_frame_hook(fn(dt, t))
//   world.ok === false when WebGL is not available: the CSS fallback shows the painting instead

import * as THREE from "three";

const DESIGN_W = 1920;
const DESIGN_H = 1080;

function canvas_tex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = true;
    this.scale = 1;
    this.view = { w: DESIGN_W, h: DESIGN_H };
    this.hooks = [];
    this.mood = "calm";
    this._tex = new Map();
    this._bg = [null, null];       // [current, previous] {mesh, mat, w, h}
    this._bg_fade = 1;
    this._bg_fade_rate = 1.5;
    this._dim = 0;
    this._dim_target = 0;
    this._t = 0;
    this._running = false;
    this._mouse = { x: 0, y: 0 };
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch (e) {
      console.warn("WebGL unavailable", e);
      this.ok = false;
      this.renderer = null;
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-DESIGN_W / 2, DESIGN_W / 2, DESIGN_H / 2, -DESIGN_H / 2, -1000, 1000);
    this.camera.position.z = 100;
    if (this.renderer) {
      this.renderer.setClearColor(0x0c0b0a, 1);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this._build_layers();
    } else {
      this._css_bg = document.createElement("div");
      this._css_bg.style.cssText = "position:fixed;inset:0;background-size:cover;background-position:center;transition:filter .5s";
      document.body.insertBefore(this._css_bg, document.body.firstChild);
      canvas.style.display = "none";
    }
    addEventListener("resize", () => this.resize());
    addEventListener("pointermove", (e) => {
      this._mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this._mouse.y = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
    this.resize();
  }

  // ---- layout -------------------------------------------------------------------------------------------------------------
  resize() {
    const vw = innerWidth;
    const vh = innerHeight;
    this.scale = Math.min(vw / DESIGN_W, vh / DESIGN_H);
    this.view = { w: vw / this.scale, h: vh / this.scale };
    const stage = document.getElementById("stage");
    if (stage) {
      const ox = (vw - DESIGN_W * this.scale) / 2;
      const oy = (vh - DESIGN_H * this.scale) / 2;
      stage.style.left = ox + "px";
      stage.style.top = oy + "px";
      stage.style.transform = `scale(${this.scale})`;
      this.stage_origin = { x: ox, y: oy };
    }
    if (this.renderer) {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(vw, vh, false);
      const hw = this.view.w / 2;
      const hh = this.view.h / 2;
      this.camera.left = -hw;
      this.camera.right = hw;
      this.camera.top = hh;
      this.camera.bottom = -hh;
      this.camera.updateProjectionMatrix();
      for (const b of this._bg) if (b) this._fit_bg(b);
      if (this._veil) this._veil.scale.set(this.view.w, this.view.h, 1);
      if (this._vignette) this._vignette.scale.set(this.view.w, this.view.h, 1);
    }
  }

  /** design px (y down, from the stage's top-left) -> scene coordinates */
  pos(x, y, z = 0) {
    return new THREE.Vector3(x - DESIGN_W / 2, DESIGN_H / 2 - y, z);
  }

  /** a pointer position in the page -> design px on the stage */
  to_design(clientX, clientY) {
    const o = this.stage_origin || { x: 0, y: 0 };
    return { x: (clientX - o.x) / this.scale, y: (clientY - o.y) / this.scale };
  }

  add_frame_hook(fn) {
    this.hooks.push(fn);
    return () => {
      this.hooks = this.hooks.filter((h) => h !== fn);
    };
  }

  // ---- background ---------------------------------------------------------------------------------------------------------
  _texture(url) {
    if (this._tex.has(url)) return this._tex.get(url);
    const p = new Promise((res) => {
      new THREE.TextureLoader().load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        res(t);
      }, undefined, () => res(null));
    });
    this._tex.set(url, p);
    return p;
  }

  /** the painting (null = plain dark), the veil darkness 0..1, the crossfade seconds */
  async set_background(url, dim = 0, fade = 0.6) {
    this._dim_target = dim;
    if (!this.renderer) {
      if (this._css_bg) {
        this._css_bg.style.backgroundImage = url ? `url("${url}")` : "none";
        this._css_bg.style.filter = `brightness(${1 - dim})`;
      }
      return;
    }
    if (url === this._bg_url) return;
    this._bg_url = url;
    const tex = url ? await this._texture(url) : null;
    if (url !== this._bg_url) return;       // a newer request won while it loaded
    this._swap_bg(tex, fade);
  }

  set_dim(dim) {
    this._dim_target = dim;
    if (this._css_bg) this._css_bg.style.filter = `brightness(${1 - dim})`;
  }

  _swap_bg(tex, fade) {
    if (this._bg[1]) {
      this.scene.remove(this._bg[1].mesh);
      this._bg[1].mat.dispose();
    }
    this._bg[1] = this._bg[0];
    if (tex) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: this._bg[1] ? 0 : 1, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.position.z = -50;
      mesh.renderOrder = -20;
      const entry = { mesh, mat, iw: tex.image.width, ih: tex.image.height };
      this._fit_bg(entry);
      this.scene.add(mesh);
      this._bg[0] = entry;
      this._bg_fade = this._bg[1] ? 0 : 1;
    } else {
      this._bg[0] = null;
      this._bg_fade = 0;
    }
    this._bg_fade_rate = 1 / Math.max(0.05, fade);
    if (this._bg[1]) this._bg[1].mesh.renderOrder = -21;
  }

  _fit_bg(b) {
    // cover the visible frustum with 7 % to spare for the slow drift
    const s = Math.max(this.view.w / b.iw, this.view.h / b.ih) * 1.07;
    b.mesh.scale.set(b.iw * s, b.ih * s, 1);
    b.base = { w: b.iw * s, h: b.ih * s };
  }

  // ---- ambience -----------------------------------------------------------------------------------------------------------
  _build_layers() {
    // veil (dims the painting) and vignette
    const vmat = new THREE.MeshBasicMaterial({ color: 0x0d0b09, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this._veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), vmat);
    this._veil.position.z = -40;
    this._veil.renderOrder = -10;
    this.scene.add(this._veil);
    const vig = canvas_tex(256, 256, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, w * 0.28, w / 2, h / 2, w * 0.74);
      r.addColorStop(0, "rgba(0,0,0,0)");
      r.addColorStop(1, "rgba(0,0,0,0.55)");
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    });
    this._vignette = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: vig, transparent: true, depthTest: false, depthWrite: false }));
    this._vignette.position.z = -39;
    this._vignette.renderOrder = -9;
    this.scene.add(this._vignette);

    // paper talismans drifting like leaves
    const paper = canvas_tex(64, 96, (g, w, h) => {
      g.fillStyle = "#e9dcb6";
      g.fillRect(4, 4, w - 8, h - 8);
      g.strokeStyle = "#9b7b3a";
      g.lineWidth = 2;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = "#b32a1c";
      for (let i = 0; i < 4; i++) g.fillRect(w / 2 - 6 + (i % 2) * 5, 18 + i * 14, 6, 3);
    });
    this._paper = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: paper, transparent: true, opacity: 0.0, depthTest: false, depthWrite: false }));
      m.renderOrder = -8;
      m.position.z = -30;
      m.userData = { seed: Math.random() * 1000, speed: 14 + Math.random() * 26, sway: 20 + Math.random() * 60, size: 11 + Math.random() * 12, depth: Math.random() };
      this._paper.push(m);
      this.scene.add(m);
    }
    // mist
    const mist = canvas_tex(256, 256, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, "rgba(255,255,255,0.55)");
      r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    });
    this._mist = [];
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: mist, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false, color: 0xe8efe8 }));
      m.renderOrder = -7;
      m.position.z = -29;
      m.userData = { seed: Math.random() * 100, speed: 5 + Math.random() * 8, size: 620 + Math.random() * 500, y: (Math.random() - 0.5) * 0.9 };
      this._mist.push(m);
      this.scene.add(m);
    }
  }

  set_mood(mood) {
    this.mood = mood;
  }

  _mood_params() {
    switch (this.mood) {
      case "battle": return { paper: 0.15, mist: 0.1, tint: 0xffc9a0, mist_tint: 0xd8b8a8 };
      case "winter": return { paper: 0.55, mist: 0.28, tint: 0xf4f8ff, mist_tint: 0xf2f6ff };
      case "dark": return { paper: 0.25, mist: 0.2, tint: 0xd8c8ff, mist_tint: 0xb8a8d8 };
      default: return { paper: 0.7, mist: 0.18, tint: 0xffffff, mist_tint: 0xe8efe8 };
    }
  }

  // ---- loop ---------------------------------------------------------------------------------------------------------------
  start() {
    if (this._running) return;
    this._running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this._t += dt;
      this._frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
  }

  _frame(dt) {
    for (const h of this.hooks) h(dt, this._t);
    if (!this.renderer) return;
    // crossfade
    if (this._bg_fade < 1) {
      this._bg_fade = Math.min(1, this._bg_fade + dt * this._bg_fade_rate);
      if (this._bg[0]) this._bg[0].mat.opacity = this._bg_fade;
      if (this._bg_fade >= 1 && this._bg[1]) {
        this.scene.remove(this._bg[1].mesh);
        this._bg[1].mat.dispose();
        this._bg[1] = null;
      }
    }
    // slow drift + a touch of pointer parallax
    const t = this._t;
    for (const b of this._bg) {
      if (!b) continue;
      b.mesh.position.x = Math.sin(t * 0.045) * 14 - this._mouse.x * 10;
      b.mesh.position.y = Math.cos(t * 0.037) * 8 + this._mouse.y * 6;
      const z = 1 + Math.sin(t * 0.03) * 0.012;
      b.mesh.scale.set(b.base.w * z, b.base.h * z, 1);
    }
    // veil
    this._dim += (this._dim_target - this._dim) * Math.min(1, dt * 4);
    this._veil.material.opacity = this._dim;
    // ambience
    const m = this._mood_params();
    const vw = this.view.w;
    const vh = this.view.h;
    for (const p of this._paper) {
      const u = p.userData;
      const k = (t * u.speed + u.seed * 40) ;
      p.position.x = ((k % (vw + 200)) - (vw + 200) / 2) * 1.0;
      p.position.y = -((k * 0.35 + u.seed * 13) % (vh + 200)) + (vh + 200) / 2 + Math.sin(t * 0.7 + u.seed) * u.sway * 0.3;
      p.position.x += Math.sin(t * 0.5 + u.seed) * u.sway;
      p.material.rotation = Math.sin(t * 0.8 + u.seed) * 0.9 + u.seed;
      const s = u.size * (0.6 + u.depth * 0.8);
      p.scale.set(s, s * 1.5, 1);
      p.material.opacity = m.paper * (0.35 + 0.5 * u.depth);
      p.material.color.setHex(m.tint);
    }
    for (const g of this._mist) {
      const u = g.userData;
      g.position.x = (((t * u.speed + u.seed * 300) % (vw + u.size * 1.5)) - (vw + u.size * 1.5) / 2);
      g.position.y = u.y * vh * 0.5 + Math.sin(t * 0.1 + u.seed) * 40;
      g.scale.set(u.size, u.size * 0.5, 1);
      g.material.opacity = m.mist;
      g.material.color.setHex(m.mist_tint);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

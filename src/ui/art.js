// Picture lookup (port of scripts/bw_art.gd). Every picture is a .webp under assets/art/<kind>/<name>.webp, listed in
// assets/art/manifest.json, so a missing picture is a null (the UI draws a stand-in) and never a 404.
//
//   await Art.init()                        once at boot
//   Art.bg("village") -> url | null         Art.card(id) Art.portrait(id) Art.sprite(id) Art.icon(name) Art.ui(name) Art.ending(id) Art.title()
//   Art.frames()                            art/ui/frames.json: {card_grey: {size:[w,h], window:[x,y,w,h], ...}}
//   await Art.image(url) -> HTMLImageElement (cached)   Art.has("bg/village.webp")

const ROOT = new URL("../../assets/art/", import.meta.url).href;
let _files = new Set();
let _frames = {};
let _ready = false;
const _img = new Map();

function norm(rel) {
  return rel.replace(/\.(jpg|jpeg|png)$/i, ".webp");
}

export const Art = {
  async init() {
    if (_ready) return;
    try {
      const m = await (await fetch(ROOT + "manifest.json", { cache: "no-store" })).json();
      _files = new Set(m.files || []);
    } catch (e) {
      _files = new Set();
    }
    try {
      _frames = await (await fetch(ROOT + "ui/frames.json", { cache: "no-store" })).json();
    } catch (e) {
      _frames = {};
    }
    _ready = true;
  },
  has(rel) {
    return _files.has(norm(rel));
  },
  /** the url of art/<rel> (jpg/png names are mapped to webp), or null when the picture does not exist */
  tex(rel) {
    const n = norm(rel);
    return _files.has(n) ? ROOT + n : null;
  },
  ui(name) {
    return Art.tex(`ui/${name}.png`);
  },
  bg(place) {
    return Art.tex(`bg/${place}.jpg`) || Art.tex("bg/village.jpg");
  },
  card(id) {
    let t = Art.tex(`cards/${id}.jpg`);
    if (!t && id.endsWith("_plus")) t = Art.tex(`cards/${id.slice(0, -5)}.jpg`);
    if (!t && id.startsWith("c_")) {
      const generic = ["c_letter", "c_invitation", "c_stranger", "c_secret", "c_danger", "c_fate"];
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
      t = Art.tex(`cards/${generic[Math.abs(h) % generic.length]}.jpg`);
    }
    return t;
  },
  portrait(id) {
    return Art.tex(`portraits/${id}.jpg`);
  },
  sprite(id) {
    return Art.tex(`sprites/${id}.png`);
  },
  icon(name) {
    return Art.tex(`icons/${name}.png`);
  },
  ending(id) {
    return Art.tex(`endings/${id.replace("end_", "ending_")}.jpg`);
  },
  title() {
    return Art.tex("title.jpg");
  },
  frames() {
    return _frames;
  },
  /** decoded image for a url (cached); resolves null on failure */
  image(url) {
    if (!url) return Promise.resolve(null);
    if (_img.has(url)) return _img.get(url);
    const p = new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    });
    _img.set(url, p);
    return p;
  },
};

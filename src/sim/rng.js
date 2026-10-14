// Seedable RNG with the surface of Godot's RandomNumberGenerator (mulberry32: 32-bit state, JSON-safe).
//   const r = new RNG(77);  r.randf()  r.randi()  r.randi_range(a, b)  r.randf_range(a, b)  r.seed = 5  r.state (get/set, a uint32)  r.randomize()

export class RNG {
  constructor(seed = 0) {
    this._s = 0;
    this.seed = seed;
  }

  get seed() {
    return this._seed;
  }

  set seed(v) {
    this._seed = Math.trunc(Number(v) || 0);
    // spread small seeds so seed 1 and seed 2 do not start alike
    let h = (this._seed ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    this._s = (h ^ (h >>> 16)) >>> 0;
  }

  get state() {
    return this._s >>> 0;
  }

  set state(v) {
    this._s = Number(v) >>> 0;
  }

  randomize() {
    this.seed = Math.floor(Math.random() * 0xffffffff);
  }

  _next() {
    this._s = (this._s + 0x6d2b79f5) >>> 0;
    let t = this._s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, 1) */
  randf() {
    return this._next();
  }

  randf_range(a, b) {
    return a + (b - a) * this._next();
  }

  /** uint32 */
  randi() {
    return Math.floor(this._next() * 4294967296) >>> 0;
  }

  /** integer in [a, b] inclusive */
  randi_range(a, b) {
    if (b < a) [a, b] = [b, a];
    return a + Math.floor(this._next() * (b - a + 1));
  }

  /** a normal-ish value (Godot's randfn) */
  randfn(mean = 0, deviation = 1) {
    const u = Math.max(1e-12, this._next());
    const v = this._next();
    return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export default RNG;

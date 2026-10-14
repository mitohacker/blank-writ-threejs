// Small helpers shared by the sim modules: GDScript's numeric and dictionary behaviours that JS does not have.
//   roundi(x)   round() half away from zero (Math.round rounds -2.5 to -2, GDScript to -3)
//   int(x)      int(x): truncate toward zero (0 for null / NaN)
//   has/get     Dictionary.has / Dictionary.get(key, default) on a plain object (own keys only)
//   is_empty    Dictionary / Array .is_empty()

/** GDScript round(): half away from zero */
export function roundi(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** GDScript int(x) */
export function int(x) {
  if (x === null || x === undefined || x === true || x === false) return x === true ? 1 : 0;
  if (typeof x === "string") {
    const n = parseInt(x, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  const v = Number(x);
  return Number.isFinite(v) ? Math.trunc(v) : 0;
}

/** GDScript float(x) */
export function float(x) {
  if (x === null || x === undefined) return 0;
  if (x === true) return 1;
  if (x === false) return 0;
  const v = Number(x);
  return Number.isNaN(v) ? 0 : v;
}

/** GDScript String(x): null -> "" */
export function str(x) {
  return x === null || x === undefined ? "" : String(x);
}

export function clampf(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export const clampi = clampf;

export function has(o, k) {
  return o !== null && o !== undefined && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
}

/** Dictionary.get(key, default) */
export function get(o, k, d = null) {
  return has(o, k) ? o[k] : d;
}

/** a value is a Dictionary (a plain, non-array object) */
export function is_dict(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function is_empty(o) {
  if (o === null || o === undefined) return true;
  if (Array.isArray(o)) return o.length === 0;
  return Object.keys(o).length === 0;
}

/** Array.duplicate(true) / Dictionary.duplicate(true) for JSON-like data */
export function deep_copy(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(deep_copy);
  const out = {};
  for (const k of Object.keys(v)) out[k] = deep_copy(v[k]);
  return out;
}

/** String.capitalize(): "xiao_he" -> "Xiao He", "camelCase" -> "Camel Case" */
export function capitalize(s) {
  const aux = String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/_/g, " ")
    .trim();
  return aux
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** String.trim_prefix */
export function trim_prefix(s, p) {
  s = String(s);
  return s.startsWith(p) ? s.slice(p.length) : s;
}

/**
 * Array.sort_custom() of Godot (an unstable introsort: partition around a median of three, insertion sort below 16 elements).
 * `less(a, b)` is the callable's `a before b` test. Sorts in place and returns the array. Elements that compare equal end up in
 * the same order as in Godot, which a stable sort would not give (story events of one priority).
 */
export function godot_sort_custom(arr, less) {
  const THRESHOLD = 16;
  const n = arr.length;
  const median_of_3 = (a, b, c) => {
    if (less(a, b)) {
      if (less(b, c)) return b;
      if (less(a, c)) return c;
      return a;
    }
    if (less(a, c)) return a;
    if (less(b, c)) return c;
    return b;
  };
  const unguarded_linear_insert = (last, val) => {
    let next = last - 1;
    while (next >= 0 && less(val, arr[next])) {
      arr[last] = arr[next];
      last = next;
      next--;
    }
    arr[last] = val;
  };
  const linear_insert = (first, last) => {
    const val = arr[last];
    if (less(val, arr[first])) {
      for (let i = last; i > first; i--) arr[i] = arr[i - 1];
      arr[first] = val;
    } else {
      unguarded_linear_insert(last, val);
    }
  };
  const insertion_sort = (first, last) => {
    if (first === last) return;
    for (let i = first + 1; i !== last; i++) linear_insert(first, i);
  };
  const unguarded_insertion_sort = (first, last) => {
    for (let i = first; i !== last; i++) unguarded_linear_insert(i, arr[i]);
  };
  const partitioner = (first, last, pivot) => {
    let guard = 0;
    while (guard++ < 1e6) {
      while (first < n && less(arr[first], pivot)) first++;
      last--;
      while (last > 0 && less(pivot, arr[last])) last--;
      if (!(first < last)) return first;
      const t = arr[first];
      arr[first] = arr[last];
      arr[last] = t;
      first++;
    }
    return first;
  };
  const introsort = (first, last, max_depth) => {
    while (last - first > THRESHOLD) {
      if (max_depth === 0) {
        // Godot falls back to a heap sort here; a plain sort of the range is just as good (never reached on small arrays)
        const part = arr.slice(first, last).sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
        for (let i = 0; i < part.length; i++) arr[first + i] = part[i];
        return;
      }
      max_depth--;
      const cut = partitioner(first, last, median_of_3(arr[first], arr[first + Math.trunc((last - first) / 2)], arr[last - 1]));
      introsort(cut, last, max_depth);
      last = cut;
    }
  };
  if (n > 1) {
    const bitlog = (m) => {
      let k = 0;
      for (; m !== 1; m >>= 1) ++k;
      return k;
    };
    introsort(0, n, bitlog(n) * 2);
    if (n > THRESHOLD) {
      insertion_sort(0, THRESHOLD);
      unguarded_insertion_sort(THRESHOLD, n);
    } else {
      insertion_sort(0, n);
    }
  }
  return arr;
}

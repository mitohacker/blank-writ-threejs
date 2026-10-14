// Simplified -> Traditional Chinese for the strings the game holds in Simplified at run time: the names in the data's `zh` fields and the few
// strings written in the code. (The story and interface text is converted ahead of time into data/i18n/hant/ by tools/build_hant.py.)
//
//   import { convert } from "./hant.js";   convert("修为")  ->  "修為"
//
// Exact strings of the vocabulary are looked up first (phrase-aware result), then each character is mapped; characters that are the same in
// both scripts, ASCII and anything unknown pass through unchanged.

import { SRC, DST, EXC } from "./hant_data.js";

const MAP = new Map();
{
  const a = Array.from(SRC);
  const b = Array.from(DST);
  for (let i = 0; i < a.length; i++) MAP.set(a[i], b[i]);
}

export function convert(s) {
  if (s === null || s === undefined) return s;
  s = String(s);
  const e = EXC[s];
  if (e !== undefined) return e;
  let out = "";
  for (const ch of s) {
    const m = MAP.get(ch);
    out += m === undefined ? ch : m;
  }
  return out;
}

/** true when a string still holds a character that only exists in Simplified (tests) */
export function has_simplified(s) {
  for (const ch of String(s)) if (MAP.has(ch)) return true;
  return false;
}

export default convert;

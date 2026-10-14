// GDScript's `"..." % value` as a function: sprintf(fmt, ...args). The Godot code passes one value or an array; here pass the values
// as separate arguments, or one array (a lone array argument is spread).
//   sprintf("%s: %d / %d", name, hp, max)      sprintf("%+d%% HP", 12)      sprintf("x%.1f", 1.25)      sprintf("%03d", 7)
// Supports %s %d %i %f %x %X %c %o %b and %%, flags + - 0 space, width, .precision. %d truncates toward zero like GDScript.

export function sprintf(fmt, ...args) {
  if (args.length === 1 && Array.isArray(args[0])) args = args[0];
  let ai = 0;
  return String(fmt).replace(/%([+\- 0#]*)(\d+)?(?:\.(\d+))?([sdifxXcob%])/g, (m, flags, width, prec, conv) => {
    if (conv === "%") return "%";
    let v = args[ai++];
    let s;
    switch (conv) {
      case "s":
        s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        if (prec !== undefined) s = s.slice(0, +prec);
        break;
      case "d":
      case "i": {
        const n = Math.trunc(Number(v) || 0);
        s = String(Math.abs(n));
        if (n < 0) s = "-" + s;
        else if (flags.includes("+")) s = "+" + s;
        else if (flags.includes(" ")) s = " " + s;
        break;
      }
      case "f": {
        const n = Number(v) || 0;
        s = Math.abs(n).toFixed(prec === undefined ? 6 : +prec);
        if (n < 0 && Number(s) !== 0) s = "-" + s;
        else if (n < 0) s = "-" + s;
        else if (flags.includes("+")) s = "+" + s;
        else if (flags.includes(" ")) s = " " + s;
        break;
      }
      case "x": s = Math.trunc(Number(v) || 0).toString(16); break;
      case "X": s = Math.trunc(Number(v) || 0).toString(16).toUpperCase(); break;
      case "o": s = Math.trunc(Number(v) || 0).toString(8); break;
      case "b": s = Math.trunc(Number(v) || 0).toString(2); break;
      case "c": s = typeof v === "number" ? String.fromCodePoint(v) : String(v ?? ""); break;
      default: s = m;
    }
    if (width !== undefined) {
      const w = +width;
      if (s.length < w) {
        if (flags.includes("-")) s = s + " ".repeat(w - s.length);
        else if (flags.includes("0") && conv !== "s") {
          const neg = /^[+-]/.test(s) ? s[0] : "";
          const body = neg ? s.slice(1) : s;
          s = neg + "0".repeat(w - s.length) + body;
        } else s = " ".repeat(w - s.length) + s;
      }
    }
    return s;
  });
}

export default sprintf;

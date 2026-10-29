// Go time.ParseDuration, ported so lagotto-ts accepts exactly the strings the Go
// CLI does where Go tries time.ParseDuration first ("1h30m", "1.5h", "-5h", "90s")
// and only then falls back to lagotto's own short form ("7d", "1w") — see
// `parseTTL`. Returns MILLISECONDS (fractional for sub-ms units).

/** Milliseconds per Go duration unit (Go's unitMap). */
const UNIT_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  "µs": 1e-3, // U+00B5 micro sign
  "μs": 1e-3, // U+03BC Greek mu
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * Parse a Go duration string ("300ms", "-1.5h", "2h45m"): a possibly signed
 * sequence of decimal numbers, each with an optional fraction and a REQUIRED
 * unit (ns, us/µs, ms, s, m, h). "0" alone needs no unit. Throws with Go's
 * message shapes (`time: invalid duration "x"`, `time: missing unit ...`,
 * `time: unknown unit ...`).
 */
export function parseGoDuration(input: string): number {
  const quoted = JSON.stringify(input);
  let s = input;
  let neg = false;
  if (s !== "" && (s[0] === "-" || s[0] === "+")) {
    neg = s[0] === "-";
    s = s.slice(1);
  }
  if (s === "0") return 0;
  if (s === "") throw new Error(`time: invalid duration ${quoted}`);

  let total = 0;
  while (s !== "") {
    if (!(s[0] === "." || isDigit(s[0]))) throw new Error(`time: invalid duration ${quoted}`);
    let i = 0;
    while (isDigit(s[i])) i++;
    const intPart = s.slice(0, i);
    const pre = i > 0;
    s = s.slice(i);
    let fracPart = "";
    let post = false;
    if (s[0] === ".") {
      s = s.slice(1);
      let j = 0;
      while (isDigit(s[j])) j++;
      fracPart = s.slice(0, j);
      post = j > 0;
      s = s.slice(j);
    }
    if (!pre && !post) throw new Error(`time: invalid duration ${quoted}`);
    let k = 0;
    while (k < s.length && s[k] !== "." && !isDigit(s[k])) k++;
    const unit = s.slice(0, k);
    s = s.slice(k);
    if (unit === "") throw new Error(`time: missing unit in duration ${quoted}`);
    const ms = UNIT_MS[unit];
    if (ms === undefined) throw new Error(`time: unknown unit ${JSON.stringify(unit)} in duration ${quoted}`);
    total += Number(`${intPart || "0"}.${fracPart || "0"}`) * ms;
  }
  return neg ? -total : total;
}

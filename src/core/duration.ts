// Short-duration parsing — port of Go pkg/watcher/duration.go ParseDuration.
// Watches carry a TTL like "7d" / "48h" / "1w"; Go's time.ParseDuration doesn't
// understand "d"/"w", so lagotto has its own tiny parser. This returns
// MILLISECONDS (the JS time unit), where the Go version returns a
// time.Duration (nanoseconds).

/** Milliseconds per unit, matching the Go unit set (w/d/h/m/s). */
const UNIT_MS: Record<string, number> = {
  w: 7 * 24 * 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
};

/**
 * Parse a short duration of the form `<int><unit>` where unit is one of
 * w (weeks), d (days), h (hours), m (minutes), s (seconds) — e.g. "1w", "7d",
 * "24h", "30m", "45s". Returns the duration in MILLISECONDS. Throws on a
 * malformed string (too short, non-integer value, or unknown unit), with the
 * same shape of message as the Go parser.
 */
export function parseDuration(s: string): number {
  if (s.length < 2) {
    throw new Error(
      `invalid duration ${JSON.stringify(s)}: expected <number><unit> where unit is one of w/d/h/m/s (e.g. 1w, 7d, 24h)`,
    );
  }
  const unit = s[s.length - 1]!;
  const val = s.slice(0, -1);
  // Match the Go fmt.Sscanf("%d") contract: a base-10 integer, nothing else.
  if (!/^-?\d+$/.test(val)) {
    throw new Error(`invalid duration ${JSON.stringify(s)}: ${JSON.stringify(val)} is not a number`);
  }
  const ms = UNIT_MS[unit];
  if (ms === undefined) {
    throw new Error(`invalid duration ${JSON.stringify(s)}: unknown unit ${JSON.stringify(unit)} (use w/d/h/m/s)`);
  }
  return Number(val) * ms;
}

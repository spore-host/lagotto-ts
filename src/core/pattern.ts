// Instance-type pattern matching — port of Go lagotto pkg/watcher/poller.go
// wildcardToRegex / splitInstanceTypePatterns / patternToRegex (v0.64.1). A
// watch's pattern is a shell-style glob (`p5.*`, `g5.xlarge`), a raw regex (if it
// already contains regex metacharacters), or — since Go lagotto#135 — a
// comma-separated list of either, matched with OR semantics
// ("g6.4xlarge,g6.2xlarge").

/** Regex metacharacters that mark a pattern as already-a-regex (used as-is). */
const REGEX_META = /[\^$()[\]{}+\\]/;

/**
 * Convert ONE sub-pattern to a regex source string.
 *
 * - If it already looks like a regex (contains `^ $ ( ) [ ] { } + \`), it's
 *   returned unchanged — the caller can compile it directly.
 * - Otherwise it's treated as a glob: `.` is escaped and `*` becomes `.*`, then
 *   anchored `^…$` so `g5.*` matches `g5.xlarge` but not `xg5.xlarge`.
 *
 * Mirrors the Go implementation exactly so a pattern behaves the same in the CLI
 * and here.
 */
export function wildcardToRegex(pattern: string): string {
  if (REGEX_META.test(pattern)) {
    return pattern;
  }
  const escaped = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
  return `^${escaped}$`;
}

/**
 * Split a watch pattern on commas into its sub-patterns, trimming whitespace and
 * dropping empty entries (Go `splitInstanceTypePatterns`, #135). A pattern with
 * no comma yields one element; an all-blank pattern yields `[]`.
 */
export function splitInstanceTypePatterns(pattern: string): string[] {
  return pattern
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/**
 * Convert a whole watch pattern — possibly a comma-separated list — to one
 * regex source (Go `patternToRegex`, #135). Each sub-pattern keeps its own
 * glob/regex semantics via `wildcardToRegex`, and the alternatives are joined
 * with `|`. A single sub-pattern converts exactly as before; an all-blank
 * pattern falls back to converting the raw string, as Go does.
 */
export function patternToRegex(pattern: string): string {
  const parts = splitInstanceTypePatterns(pattern);
  if (parts.length <= 1) {
    return wildcardToRegex(parts.length === 1 ? parts[0]! : pattern);
  }
  return parts.map(wildcardToRegex).join("|");
}

/**
 * Compile a watch's instance-type pattern into a RegExp (via `patternToRegex`,
 * so comma lists work). Throws if the resulting source is not a valid regex
 * (mirrors the Go regexp.Compile error path).
 */
export function compilePattern(pattern: string): RegExp {
  return new RegExp(patternToRegex(pattern));
}

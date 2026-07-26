// Instance-type pattern matching — port of Go pkg/watcher/poller.go
// wildcardToRegex. A watch's pattern is either a shell-style glob (`p5.*`,
// `g5.xlarge`) or, if it already contains regex metacharacters, a raw regex.

/** Regex metacharacters that mark a pattern as already-a-regex (used as-is). */
const REGEX_META = /[\^$()[\]{}+\\]/;

/**
 * Convert a watch's instance-type pattern to a regex source string.
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
 * Compile a watch's instance-type pattern into a RegExp (via wildcardToRegex).
 * Throws if the resulting source is not a valid regex (mirrors the Go
 * regexp.Compile error path).
 */
export function compilePattern(pattern: string): RegExp {
  return new RegExp(wildcardToRegex(pattern));
}

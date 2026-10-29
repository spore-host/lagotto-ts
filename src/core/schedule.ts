// Scheduled-launch expressions — port of Go lagotto pkg/watcher/schedule_expr.go
// ScheduleExpression (v0.64.1, lagotto#49). Resolves `--at` / `--after` /
// `--cron` into an EventBridge Scheduler expression and reports whether it is a
// one-shot. Pure; `now` is injected so callers and tests control the clock.
//
// EventBridge Scheduler is CORS-open, so a browser can create the schedule with
// this expression itself — creating one is the caller's business, not this
// function's.

import { parseDuration } from "./duration.js";
import { parseGoDuration } from "./go-duration.js";

/** The three mutually exclusive ways to say when (empty string = unset, as in Go). */
export interface ScheduleInput {
  /** RFC 3339 instant, e.g. "2026-07-01T08:00:00Z". One-shot. */
  at?: string;
  /** Delay from `now`: a Go duration ("6h", "1h30m") or lagotto's short form ("2d"). One-shot. */
  after?: string;
  /** EventBridge cron body ("0 9 ? * MON-FRI *"), bare or already wrapped in cron(...). Recurring. */
  cron?: string;
}

export interface ScheduleExpressionResult {
  /** `at(2026-07-01T08:00:00)` or `cron(...)`. */
  expression: string;
  /** True for at/after; false for cron. */
  oneShot: boolean;
}

/**
 * Parse a TTL/delay the way Go's `parseTTL` does: Go `time.ParseDuration` first,
 * then lagotto's `<int><w|d|h|m|s>` form. Milliseconds. Throws the short-form
 * parser's error when both fail, as Go does.
 */
export function parseTTL(s: string): number {
  try {
    return parseGoDuration(s);
  } catch {
    return parseDuration(s);
  }
}

/**
 * Resolve exactly one of at/after/cron into a Scheduler expression (Go
 * `ScheduleExpression`). Throws when none or more than one is set, when `at` is
 * not RFC 3339 or not after `now`, or when `after` is unparseable or not > 0.
 */
export function scheduleExpression(input: ScheduleInput, now: Date): ScheduleExpressionResult {
  const at = input.at ?? "";
  const after = input.after ?? "";
  const cron = input.cron ?? "";
  const set = [at, after, cron].filter((v) => v !== "").length;
  if (set === 0) throw new Error("one of --at, --after, or --cron is required");
  if (set > 1) throw new Error("--at, --after, and --cron are mutually exclusive");

  if (cron !== "") {
    let c = cron.trim();
    // Accept a bare cron expression or one already wrapped in cron(...). Same
    // order as Go: TrimPrefix "cron(", then TrimSuffix ")".
    if (c.startsWith("cron(")) c = c.slice("cron(".length);
    if (c.endsWith(")")) c = c.slice(0, -1);
    return { expression: `cron(${c})`, oneShot: false };
  }

  if (after !== "") {
    let d: number;
    try {
      d = parseTTL(after);
    } catch (e) {
      throw new Error(`invalid --after ${JSON.stringify(after)}: ${(e as Error).message}`, { cause: e });
    }
    if (d <= 0) throw new Error(`invalid --after ${JSON.stringify(after)}: must be greater than zero`);
    return { expression: atExpr(new Date(now.getTime() + d)), oneShot: true };
  }

  const t = parseRFC3339(at);
  if (t === null) {
    throw new Error(`invalid --at ${JSON.stringify(at)} (want RFC3339, e.g. 2026-07-01T08:00:00Z)`);
  }
  if (!(t.getTime() > now.getTime())) throw new Error(`--at ${JSON.stringify(at)} is not in the future`);
  return { expression: atExpr(t), oneShot: true };
}

/** Scheduler at() expression: UTC, second precision, no zone suffix. */
function atExpr(t: Date): string {
  return `at(${t.toISOString().slice(0, 19)})`;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Strict RFC 3339 (Go `time.Parse(time.RFC3339, …)`): a zone is REQUIRED and
 * fields are range-checked. `Date.parse` is not used on its own because it
 * accepts a zoneless string as LOCAL time and a bare date, both of which Go
 * rejects. Returns null when invalid.
 */
function parseRFC3339(s: string): Date | null {
  const m = RFC3339.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, frac, , sign, oh, om] = m;
  const Y = Number(y), M = Number(mo), D = Number(d), H = Number(h), MI = Number(mi), S = Number(sec);
  if (M < 1 || M > 12 || H > 23 || MI > 59 || S > 59) return null;
  const daysInMonth = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  if (D < 1 || D > daysInMonth) return null;
  let offsetMin = 0;
  if (sign) {
    const OH = Number(oh), OM = Number(om);
    if (OH > 23 || OM > 59) return null;
    offsetMin = (sign === "-" ? -1 : 1) * (OH * 60 + OM);
  }
  const ms = frac ? Math.floor(Number(`0${frac}`) * 1000) : 0;
  // (Date.UTC reads years 0-99 as 1900+. Either reading is long past, so the
  // "not in the future" refusal is the same as Go's.)
  return new Date(Date.UTC(Y, M - 1, D, H, MI, S, ms) - offsetMin * 60_000);
}

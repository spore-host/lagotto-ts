// Cases verbatim from Go lagotto pkg/watcher/schedule_expr_test.go (v0.64.1),
// plus RFC 3339 strictness cases that JS Date.parse would otherwise let through.
import { describe, it, expect } from "vitest";
import { parseTTL, scheduleExpression } from "./schedule.js";

const now = new Date(Date.UTC(2026, 6, 1, 0, 0, 0)); // 2026-07-01T00:00:00Z

describe("scheduleExpression (Go TestScheduleExpression)", () => {
  it("at one-shot", () => {
    expect(scheduleExpression({ at: "2026-07-01T08:00:00Z" }, now)).toEqual({ expression: "at(2026-07-01T08:00:00)", oneShot: true });
  });

  it("after one-shot = now+delay", () => {
    expect(scheduleExpression({ after: "6h" }, now)).toEqual({ expression: "at(2026-07-01T06:00:00)", oneShot: true });
  });

  it("after accepts day form", () => {
    expect(scheduleExpression({ after: "2d" }, now).expression).toBe("at(2026-07-03T00:00:00)");
  });

  it("cron recurring", () => {
    expect(scheduleExpression({ cron: "0 9 ? * MON-FRI *" }, now)).toEqual({ expression: "cron(0 9 ? * MON-FRI *)", oneShot: false });
  });

  it("cron already wrapped is not double-wrapped", () => {
    expect(scheduleExpression({ cron: "cron(5 0 * * ? *)" }, now).expression).toBe("cron(5 0 * * ? *)");
  });

  describe("errors", () => {
    const cases: [string, { at?: string; after?: string; cron?: string }][] = [
      ["none", { at: "", after: "", cron: "" }],
      ["two set (at+after)", { at: "2026-07-01T08:00:00Z", after: "6h" }],
      ["two set (after+cron)", { after: "6h", cron: "0 9 ? * * *" }],
      ["bad RFC3339", { at: "not-a-time" }],
      ["in the past", { at: "2025-01-01T00:00:00Z" }],
      ["negative delay", { after: "-5h" }],
      ["zero delay (must be > 0)", { after: "0s" }],
      ["unparseable delay", { after: "garbage" }],
    ];
    for (const [name, input] of cases) it(name, () => expect(() => scheduleExpression(input, now)).toThrow());
  });

  it("uses Go's messages for the exclusivity errors", () => {
    expect(() => scheduleExpression({}, now)).toThrow("one of --at, --after, or --cron is required");
    expect(() => scheduleExpression({ at: "2026-07-02T00:00:00Z", cron: "x" }, now)).toThrow(
      "--at, --after, and --cron are mutually exclusive",
    );
    expect(() => scheduleExpression({ after: "-5h" }, now)).toThrow('invalid --after "-5h": must be greater than zero');
    expect(() => scheduleExpression({ at: "2026-07-01T00:00:00Z" }, now)).toThrow("is not in the future");
  });
});

describe("scheduleExpression — Go time.RFC3339 strictness", () => {
  it("converts an offset to UTC with no zone suffix", () => {
    expect(scheduleExpression({ at: "2026-07-01T10:30:00+02:00" }, now).expression).toBe("at(2026-07-01T08:30:00)");
  });

  it("accepts fractional seconds and truncates them", () => {
    expect(scheduleExpression({ at: "2026-07-01T08:00:00.987Z" }, now).expression).toBe("at(2026-07-01T08:00:00)");
  });

  for (const bad of [
    "2026-07-01T08:00:00", // no zone: Date.parse would read LOCAL time
    "2026-07-02", // bare date: Date.parse would accept it
    "2026-07-01 08:00:00Z", // space, not T
    "2026-02-30T08:00:00Z", // no such day
    "2026-13-01T08:00:00Z",
    "2026-07-01T24:00:00Z",
    "2026-07-01T08:00:60Z",
    "2026-07-01T08:00:00+2:00",
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => expect(() => scheduleExpression({ at: bad }, now)).toThrow(/invalid --at/));
  }
});

describe("parseTTL (Go parseTTL: time.ParseDuration, then the short form)", () => {
  it("accepts Go durations the short form cannot", () => {
    expect(parseTTL("1h30m")).toBe(90 * 60_000);
    expect(parseTTL("1.5h")).toBe(90 * 60_000);
    expect(parseTTL("90s")).toBe(90_000);
  });
  it("falls back to the short form for d/w", () => {
    expect(parseTTL("7d")).toBe(7 * 24 * 3_600_000);
    expect(parseTTL("1w")).toBe(7 * 24 * 3_600_000);
  });
  it("throws the short-form error when both fail", () => {
    expect(() => parseTTL("garbage")).toThrow(/invalid duration "garbage"/);
  });
});

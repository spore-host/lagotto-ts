// Cases from Go's own time.ParseDuration test table (src/time/time_test.go
// parseDurationTests / parseDurationErrorTests), in milliseconds.
import { describe, it, expect } from "vitest";
import { parseGoDuration } from "./go-duration.js";

describe("parseGoDuration (Go time.ParseDuration)", () => {
  const ok: [string, number][] = [
    ["0", 0],
    ["5s", 5000],
    ["30s", 30_000],
    ["1478s", 1_478_000],
    ["-5s", -5000],
    ["+5s", 5000],
    ["-0", 0],
    ["+0", 0],
    ["5.0s", 5000],
    ["5.6s", 5600],
    ["5.s", 5000],
    [".5s", 500],
    ["1.0s", 1000],
    ["1.00s", 1000],
    ["1.004s", 1004],
    ["1.0040s", 1004],
    ["100.00100s", 100_001],
    ["10ns", 10e-6],
    ["11us", 11e-3],
    ["12µs", 12e-3],
    ["12μs", 12e-3],
    ["13ms", 13],
    ["14s", 14_000],
    ["15m", 15 * 60_000],
    ["16h", 16 * 3_600_000],
    ["3h30m", 3.5 * 3_600_000],
    ["10.5s4m", 4 * 60_000 + 10_500],
    ["-2m3.4s", -(2 * 60_000 + 3400)],
    ["1h2m3s4ms5us6ns", 3_600_000 + 2 * 60_000 + 3000 + 4 + 5e-3 + 6e-6],
    ["39h9m14.425s", 39 * 3_600_000 + 9 * 60_000 + 14_425],
  ];
  for (const [s, want] of ok) it(JSON.stringify(s), () => expect(parseGoDuration(s)).toBeCloseTo(want, 9));

  const bad: [string, RegExp][] = [
    ["", /invalid duration/],
    ["3", /missing unit/],
    ["-", /invalid duration/],
    ["s", /invalid duration/],
    [".", /invalid duration/],
    ["-.", /invalid duration/],
    [".s", /invalid duration/],
    ["+.s", /invalid duration/],
    ["1d", /unknown unit "d"/],
    ["\x85\x85", /invalid duration/],
    ["\xffff", /invalid duration/],
    ["hello \xffff world", /invalid duration/],
    ["7d", /unknown unit/],
  ];
  for (const [s, re] of bad) it(`rejects ${JSON.stringify(s)}`, () => expect(() => parseGoDuration(s)).toThrow(re));
});

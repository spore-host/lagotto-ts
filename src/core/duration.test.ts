import { describe, it, expect } from "vitest";
import { parseDuration } from "./duration.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe("parseDuration", () => {
  it("parses each unit to milliseconds", () => {
    expect(parseDuration("45s")).toBe(45 * SEC);
    expect(parseDuration("30m")).toBe(30 * MIN);
    expect(parseDuration("24h")).toBe(24 * HOUR);
    expect(parseDuration("7d")).toBe(7 * DAY);
    expect(parseDuration("1w")).toBe(WEEK);
  });

  it("handles multi-digit values", () => {
    expect(parseDuration("48h")).toBe(48 * HOUR);
    expect(parseDuration("100d")).toBe(100 * DAY);
  });

  it("rejects a too-short string", () => {
    expect(() => parseDuration("d")).toThrow(/expected <number><unit>/);
    expect(() => parseDuration("")).toThrow(/expected <number><unit>/);
  });

  it("rejects a non-integer value", () => {
    expect(() => parseDuration("1.5h")).toThrow(/is not a number/);
    expect(() => parseDuration("xh")).toThrow(/is not a number/);
  });

  it("rejects an unknown unit", () => {
    expect(() => parseDuration("10y")).toThrow(/unknown unit/);
    expect(() => parseDuration("5M")).toThrow(/unknown unit/);
  });
});

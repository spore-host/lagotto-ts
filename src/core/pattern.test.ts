import { describe, it, expect } from "vitest";
import { wildcardToRegex, compilePattern, patternToRegex, splitInstanceTypePatterns } from "./pattern.js";

describe("wildcardToRegex", () => {
  it("converts a glob to an anchored regex with escaped dots", () => {
    expect(wildcardToRegex("g5.*")).toBe("^g5\\..*$");
    expect(wildcardToRegex("p5.48xlarge")).toBe("^p5\\.48xlarge$");
    expect(wildcardToRegex("*.xlarge")).toBe("^.*\\.xlarge$");
  });

  it("passes a pattern that already looks like a regex through unchanged", () => {
    expect(wildcardToRegex("^m7i\\.")).toBe("^m7i\\.");
    expect(wildcardToRegex("g5.(xlarge|2xlarge)")).toBe("g5.(xlarge|2xlarge)");
    expect(wildcardToRegex("g[56]\\.")).toBe("g[56]\\.");
  });

  it("anchored glob matches only the whole string", () => {
    const re = compilePattern("g5.*");
    expect(re.test("g5.xlarge")).toBe(true);
    expect(re.test("g5.48xlarge")).toBe(true);
    expect(re.test("xg5.xlarge")).toBe(false); // anchored ^ — no prefix match
    expect(re.test("g5x.large")).toBe(false); // the dot is literal
  });

  it("exact glob matches only that type", () => {
    const re = compilePattern("g5.xlarge");
    expect(re.test("g5.xlarge")).toBe(true);
    expect(re.test("g5.2xlarge")).toBe(false);
  });
});

// Go lagotto #135: comma-separated sub-patterns, OR semantics. Cases verbatim
// from matcher_test.go (v0.64.1).
describe("splitInstanceTypePatterns (Go TestSplitInstanceTypePatterns)", () => {
  const cases: [string, string[]][] = [
    ["g5.xlarge", ["g5.xlarge"]],
    ["g6.4xlarge,g6.2xlarge", ["g6.4xlarge", "g6.2xlarge"]],
    [" p5.* , g5.xlarge ", ["p5.*", "g5.xlarge"]],
    ["a,,b,", ["a", "b"]], // empty entries dropped
    ["", []],
    ["   ", []],
    [" , ", []],
  ];
  for (const [input, want] of cases) {
    it(JSON.stringify(input), () => expect(splitInstanceTypePatterns(input)).toEqual(want));
  }
});

describe("patternToRegex (Go #135)", () => {
  it("a single (comma-free) pattern converts exactly as wildcardToRegex", () => {
    for (const p of ["p5.*", "g5.xlarge", "t3.micro", "^p5\\..*$"]) {
      expect(patternToRegex(p)).toBe(wildcardToRegex(p));
    }
  });

  it("a comma list matches any listed rung, and nothing else", () => {
    const pattern = "g6.8xlarge,g6.4xlarge,g6.2xlarge,g6.xlarge";
    const re = compilePattern(pattern);
    for (const t of ["g6.8xlarge", "g6.4xlarge", "g6.2xlarge", "g6.xlarge"]) expect(re.test(t)).toBe(true);
    for (const t of ["g6.16xlarge", "g6.48xlarge", "g5.xlarge", "g6.8xlarge,g6.4xlarge"]) expect(re.test(t)).toBe(false);
  });

  it("sub-patterns may be wildcards, and surrounding spaces are trimmed", () => {
    const re = compilePattern(" p5.* , g5.xlarge ");
    for (const t of ["p5.48xlarge", "p5.4xlarge", "g5.xlarge"]) expect(re.test(t)).toBe(true);
    for (const t of ["g5.2xlarge", "p4d.24xlarge"]) expect(re.test(t)).toBe(false);
  });

  it("an all-blank pattern falls back to the raw string, as Go does", () => {
    expect(patternToRegex("   ")).toBe(wildcardToRegex("   "));
  });
});

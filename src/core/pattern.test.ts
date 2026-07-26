import { describe, it, expect } from "vitest";
import { wildcardToRegex, compilePattern } from "./pattern.js";

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

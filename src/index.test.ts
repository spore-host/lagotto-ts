import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERSION } from "./index.js";

describe("library scaffold", () => {
  // VERSION is a hand-maintained constant, so every release has to remember to
  // update it in two places. truffle-ts had the identical constant and its 0.5.0
  // bump missed it — caught only because that repo has this assertion. This is the
  // same guard, added here before the same thing happened at 0.2.0.
  //
  // A stale VERSION is quiet and misleading rather than loud: a consumer logging it
  // for a bug report names the wrong release, and the wrong changelog gets read.
  it("exports a VERSION matching package.json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  // Apache-2.0 §4(d): a redistribution must carry the NOTICE file. npm always
  // packs LICENSE and README, but NOTICE only if "files" names it, so 0.1.0 and
  // 0.2.0 shipped without it (same gap as truffle-ts#87).
  it("publishes NOTICE with the package", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { files: string[] };
    expect(pkg.files).toContain("NOTICE");
    expect(readFileSync(fileURLToPath(new URL("../NOTICE", import.meta.url)), "utf8")).toMatch(/lagotto-ts/);
  });
});

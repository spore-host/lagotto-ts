import { describe, it, expect } from "vitest";
import { CapacityWatcher, type CapacityFinder, type CheckWarning, type FinderInstanceType, type FinderSpotPrice } from "./watcher.js";
import type { Watch } from "../core/types.js";

const fixedNow = () => new Date("2026-07-26T00:00:00.000Z");

function finderOf(
  results: FinderInstanceType[],
  spot?: FinderSpotPrice[],
): CapacityFinder & { calls: RegExp[] } {
  const calls: RegExp[] = [];
  return {
    calls,
    async search(matcher) {
      calls.push(matcher);
      return results.filter((r) => matcher.test(r.instanceType));
    },
    async getSpotPricing() {
      return spot ?? [];
    },
  };
}

const watch: Watch = { watchId: "w-1", instanceTypePattern: "g5.*", regions: ["us-east-1"] };

describe("CapacityWatcher.check — on-demand", () => {
  it("returns null when nothing matches the pattern", async () => {
    const w = new CapacityWatcher({ finder: finderOf([{ instanceType: "m7i.large", region: "us-east-1", onDemandPrice: 0.1 }]), now: fixedNow });
    expect(await w.check(watch)).toBeNull();
  });

  it("returns the cheapest matching offering, stamped with matchedAt", async () => {
    const finder = finderOf([
      { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1.006, availableAZs: ["us-east-1a"] },
      { instanceType: "g5.2xlarge", region: "us-east-1", onDemandPrice: 1.212, availableAZs: ["us-east-1b"] },
    ]);
    const w = new CapacityWatcher({ finder, now: fixedNow });
    const m = await w.check(watch);
    expect(m).not.toBeNull();
    expect(m!.instanceType).toBe("g5.xlarge"); // cheaper of the two
    expect(m!.price).toBe(1.006);
    expect(m!.matchedAt).toBe("2026-07-26T00:00:00.000Z");
    // The finder was queried with the compiled glob.
    expect(finder.calls[0]!.source).toBe("^g5\\..*$");
  });

  it("respects the price cap", async () => {
    const finder = finderOf([
      { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1.006, availableAZs: ["us-east-1a"] },
    ]);
    const w = new CapacityWatcher({ finder, now: fixedNow });
    expect(await w.check({ ...watch, maxPrice: 0.5 })).toBeNull();
  });

  it("does not let an UNPRICED offering win 'cheapest'", async () => {
    // The comparison was `m.price < best.price`. With price now optional
    // (truffle-ts 0.5.0 omits prices it can't establish rather than fabricating
    // them — truffle-ts#39/#42), an absent price coerces and the type we know
    // LEAST about takes the cheapest slot. Same defect as truffle-ts's own sort,
    // one layer up. Listed first here so a plain scan would pick it.
    const finder = finderOf([
      { instanceType: "g5.unpriced", region: "us-east-1", availableAZs: ["us-east-1a"] },
      { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1.006, availableAZs: ["us-east-1a"] },
    ]);
    const w = new CapacityWatcher({ finder, now: fixedNow });
    const m = await w.check(watch);
    expect(m!.instanceType).toBe("g5.xlarge");
    expect(m!.price).toBe(1.006);
  });

  it("still reports an unpriced offering when it's the only match", async () => {
    // Sunk, not dropped — otherwise a watch on a brand-new accelerator reports no
    // capacity when capacity exists, which is the worse failure: the user waits
    // forever on a machine that was available the whole time.
    const finder = finderOf([
      { instanceType: "g5.unpriced", region: "us-east-1", availableAZs: ["us-east-1a"] },
    ]);
    const w = new CapacityWatcher({ finder, now: fixedNow });
    const m = await w.check(watch);
    expect(m).not.toBeNull();
    expect(m!.instanceType).toBe("g5.unpriced");
    expect(m!.price).toBeUndefined(); // unknown, never 0
  });
});

describe("CapacityWatcher.check — spot", () => {
  it("returns the cheapest spot offering under the cap", async () => {
    const finder = finderOf(
      [
        { instanceType: "g5.xlarge", region: "us-east-1" },
        { instanceType: "g5.2xlarge", region: "us-east-1" },
      ],
      [
        { instanceType: "g5.xlarge", region: "us-east-1", spotPrice: 0.4, availabilityZone: "us-east-1a" },
        { instanceType: "g5.2xlarge", region: "us-east-1", spotPrice: 0.35, availabilityZone: "us-east-1b" },
      ],
    );
    const w = new CapacityWatcher({ finder, now: fixedNow });
    const m = await w.check({ ...watch, spot: true, maxPrice: 0.5 });
    expect(m!.isSpot).toBe(true);
    expect(m!.instanceType).toBe("g5.2xlarge"); // cheaper spot
    expect(m!.price).toBe(0.35);
    expect(m!.availabilityZone).toBe("us-east-1b");
  });

  it("throws if a spot watch is run against a finder without getSpotPricing", async () => {
    const finder: CapacityFinder = { async search() { return [{ instanceType: "g5.xlarge", region: "us-east-1" }]; } };
    const w = new CapacityWatcher({ finder, now: fixedNow });
    await expect(w.check({ ...watch, spot: true })).rejects.toThrow(/no getSpotPricing/);
  });
});

describe("CapacityWatcher.poll", () => {
  it("stops at maxChecks when no capacity appears, reporting each check", async () => {
    const finder = finderOf([]); // never any capacity
    const w = new CapacityWatcher({ finder, now: fixedNow });
    const seen: number[] = [];
    const result = await w.poll(watch, {
      intervalMs: 0,
      maxChecks: 3,
      onCheck: (_r, n) => seen.push(n),
    });
    expect(result).toBeNull();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("resolves with the first match and stops polling", async () => {
    let calls = 0;
    const finder: CapacityFinder = {
      async search(matcher) {
        calls++;
        // No capacity on the first check, then g5.xlarge appears.
        if (calls < 2) return [];
        return [{ instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1, availableAZs: ["us-east-1a"] }].filter((r) => matcher.test(r.instanceType));
      },
    };
    const w = new CapacityWatcher({ finder, now: fixedNow });
    const result = await w.poll(watch, { intervalMs: 0, maxChecks: 10 });
    expect(result).not.toBeNull();
    expect(result!.instanceType).toBe("g5.xlarge");
    expect(calls).toBe(2);
  });

  it("returns null promptly when the signal is already aborted", async () => {
    const finder = finderOf([]);
    const w = new CapacityWatcher({ finder, now: fixedNow });
    const ac = new AbortController();
    ac.abort();
    const result = await w.poll(watch, { intervalMs: 1000, signal: ac.signal });
    expect(result).toBeNull();
  });

  it("aborts during the inter-check wait", async () => {
    const finder = finderOf([]);
    const w = new CapacityWatcher({ finder, now: fixedNow });
    const ac = new AbortController();
    const p = w.poll(watch, { intervalMs: 10_000, signal: ac.signal });
    ac.abort(); // fire during the first sleep
    expect(await p).toBeNull();
  });
});

// lagotto-ts#1: a multi-region watch must search every region it names (Go's
// searchBestMatch passes w.Regions to SearchInstanceTypes), and must never
// silently search fewer.
describe("CapacityWatcher.check — regions (lagotto-ts#1)", () => {
  /** A per-region fake: each region offers its own rows, stamped with it. */
  function perRegion(
    table: Record<string, Omit<FinderInstanceType, "region">[]>,
    spot: Record<string, Omit<FinderSpotPrice, "region">[]> = {},
  ) {
    const asked: string[] = [];
    const finderFor = (region: string): CapacityFinder => ({
      regions: [region],
      async search(matcher) {
        asked.push(region);
        return (table[region] ?? []).filter((r) => matcher.test(r.instanceType)).map((r) => ({ ...r, region }));
      },
      async getSpotPricing() {
        return (spot[region] ?? []).map((s) => ({ ...s, region }));
      },
    });
    return { asked, finderFor };
  }

  const multi: Watch = { watchId: "w-m", instanceTypePattern: "p5.*", regions: ["us-east-1", "us-west-2", "eu-west-1"] };

  it("searches every region and returns the global cheapest", async () => {
    const { asked, finderFor } = perRegion({
      "us-east-1": [],
      "us-west-2": [{ instanceType: "p5.48xlarge", onDemandPrice: 98.32, availableAZs: ["us-west-2a"] }],
      "eu-west-1": [{ instanceType: "p5.48xlarge", onDemandPrice: 90.1, availableAZs: ["eu-west-1b"] }],
    });
    const w = new CapacityWatcher({ finderFor, now: fixedNow });
    const m = await w.check(multi);
    expect(asked.sort()).toEqual(["eu-west-1", "us-east-1", "us-west-2"]);
    expect(m!.region).toBe("eu-west-1");
    expect(m!.price).toBe(90.1);
  });

  it("finds capacity that exists only outside the first region", async () => {
    // The original defect: a watch over three regions answered from us-east-1
    // alone and sat "waiting" while capacity was free two regions over.
    const { finderFor } = perRegion({
      "us-west-2": [{ instanceType: "p5.48xlarge", onDemandPrice: 98.32, availableAZs: ["us-west-2a"] }],
    });
    const m = await new CapacityWatcher({ finderFor, now: fixedNow }).check(multi);
    expect(m).not.toBeNull();
    expect(m!.region).toBe("us-west-2");
  });

  it("folds spot prices across regions", async () => {
    const { finderFor } = perRegion(
      { "us-east-1": [{ instanceType: "p5.48xlarge" }], "us-west-2": [{ instanceType: "p5.48xlarge" }] },
      {
        "us-east-1": [{ instanceType: "p5.48xlarge", spotPrice: 40, availabilityZone: "us-east-1a" }],
        "us-west-2": [{ instanceType: "p5.48xlarge", spotPrice: 31, availabilityZone: "us-west-2c" }],
      },
    );
    const m = await new CapacityWatcher({ finderFor, now: fixedNow }).check({ ...multi, spot: true });
    expect(m!.region).toBe("us-west-2");
    expect(m!.availabilityZone).toBe("us-west-2c");
  });

  it("refuses a multi-region watch on a finder that declares no regions", async () => {
    const w = new CapacityWatcher({ finder: finderOf([]), now: fixedNow });
    await expect(w.check(multi)).rejects.toThrow(/names 3 regions/);
  });

  it("refuses a region the declared finder does not serve", async () => {
    const finder: CapacityFinder = { regions: ["us-east-1"], async search() { return []; } };
    const w = new CapacityWatcher({ finder, now: fixedNow });
    await expect(w.check(multi)).rejects.toThrow(/us-west-2, eu-west-1 that the finder does not serve/);
  });

  it("does not let a wider finder widen the watch", async () => {
    const finder: CapacityFinder = {
      regions: ["us-east-1", "ap-south-1"],
      async search() {
        return [{ instanceType: "p5.48xlarge", region: "ap-south-1", onDemandPrice: 1, availableAZs: ["ap-south-1a"] }];
      },
    };
    const w = new CapacityWatcher({ finder, now: fixedNow, onWarning: () => {} });
    expect(await w.check({ ...multi, regions: ["us-east-1"] })).toBeNull();
  });

  it("refuses a watch with no region", async () => {
    const w = new CapacityWatcher({ finder: finderOf([]), now: fixedNow });
    await expect(w.check({ ...watch, regions: [] })).rejects.toThrow(/names no region/);
  });

  it("throws when every region fails (a total failure is not 'no capacity')", async () => {
    const finderFor = (): CapacityFinder => ({ async search() { throw new Error("ExpiredToken"); } });
    const w = new CapacityWatcher({ finderFor, now: fixedNow });
    await expect(w.check(multi)).rejects.toThrow(/all 3 region queries failed: ExpiredToken/);
  });

  it("warns, and still answers, when only some regions fail", async () => {
    const warnings: CheckWarning[] = [];
    const finderFor = (region: string): CapacityFinder => ({
      async search() {
        if (region === "eu-west-1") throw new Error("throttled");
        return region === "us-west-2"
          ? [{ instanceType: "p5.48xlarge", region, onDemandPrice: 98, availableAZs: ["us-west-2a"] }]
          : [];
      },
    });
    const w = new CapacityWatcher({ finderFor, now: fixedNow, onWarning: (x) => warnings.push(x) });
    const m = await w.check(multi);
    expect(m!.region).toBe("us-west-2");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "region-failed", region: "eu-west-1" });
  });

  it("warns once per poll that a pattern matches nothing (Go warnUnmatchablePattern)", async () => {
    const warnings: CheckWarning[] = [];
    const w = new CapacityWatcher({ finder: finderOf([]), now: fixedNow, onWarning: (x) => warnings.push(x) });
    await w.poll({ ...watch, instanceTypePattern: "g5.xlargee" }, { intervalMs: 0, maxChecks: 3 });
    expect(warnings.map((x) => x.kind)).toEqual(["unmatchable-pattern"]);
    expect(warnings[0]!.message).toMatch(/matches no known instance type in us-east-1/);
  });

  it("throws rather than never matching an AZ-pinned on-demand watch when AZs are unknown", async () => {
    // Second silent-empty path from #1: truffle-ts reports no AZs (truffle-ts#33),
    // so evaluate() sees "offered nowhere" and a pinned watch would wait forever.
    const finder = finderOf([{ instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1 }]);
    const w = new CapacityWatcher({ finder, now: fixedNow });
    await expect(w.check({ ...watch, availabilityZones: ["us-east-1a"] })).rejects.toThrow(/reports no AZ data/);
  });

  it("still matches an AZ-pinned watch when the finder does report AZs", async () => {
    const finder = finderOf([{ instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1, availableAZs: ["us-east-1b", "us-east-1a"] }]);
    const m = await new CapacityWatcher({ finder, now: fixedNow }).check({ ...watch, availabilityZones: ["us-east-1a"] });
    expect(m!.availabilityZone).toBe("us-east-1a");
  });
});

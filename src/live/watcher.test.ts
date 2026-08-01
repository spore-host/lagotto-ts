import { describe, it, expect } from "vitest";
import { CapacityWatcher, type CapacityFinder, type FinderInstanceType, type FinderSpotPrice } from "./watcher.js";
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

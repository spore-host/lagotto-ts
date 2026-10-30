import { describe, it, expect } from "vitest";
import { truffleFinderAdapter, truffleFinderFor, type TruffleLiveFinder } from "./truffle-adapter.js";
import { CapacityWatcher } from "./watcher.js";

const fixedNow = () => new Date("2026-07-26T00:00:00.000Z");

describe("truffleFinderAdapter", () => {
  it("stamps the region onto region-agnostic truffle results", async () => {
    const truffle: TruffleLiveFinder = {
      async search() {
        return [{ instanceType: "g5.xlarge", onDemandPrice: 1.006 }];
      },
    };
    const finder = truffleFinderAdapter(truffle, "us-west-2");
    const out = await finder.search(/^g5\..*$/, { includeAZs: true });
    expect(out).toEqual([{ instanceType: "g5.xlarge", region: "us-west-2", onDemandPrice: 1.006, availableAZs: undefined }]);
  });

  it("keeps the region a truffle-ts >= 0.6 row names instead of relabelling it", async () => {
    // truffle-ts 0.6 returns one row per (type, region). A finder configured for
    // more regions than the adapter declares must not have eu-west-1's offering
    // relabelled as us-east-1's.
    const truffle: TruffleLiveFinder = {
      async search() {
        return [
          { instanceType: "g6.xlarge", region: "eu-west-1", onDemandPrice: 0.89 },
          { instanceType: "m7i.large", onDemandPrice: 0.1 }, // <= 0.5 row: no region
        ];
      },
    };
    const out = await truffleFinderAdapter(truffle, "us-east-1").search(/.*/, {});
    expect(out.map((r) => [r.instanceType, r.region])).toEqual([
      ["g6.xlarge", "eu-west-1"],
      ["m7i.large", "us-east-1"],
    ]);
  });

  it("does not match a watch on capacity that exists only in another region", async () => {
    const truffle: TruffleLiveFinder = {
      async search() {
        return [{ instanceType: "g6.xlarge", region: "eu-west-1", onDemandPrice: 0.89 }];
      },
    };
    const watcher = new CapacityWatcher({
      finder: truffleFinderAdapter(truffle, "us-east-1"),
      now: fixedNow,
      onWarning: () => {},
    });
    const m = await watcher.check({ watchId: "w1", instanceTypePattern: "g6.*", regions: ["us-east-1"] });
    expect(m).toBeNull();
  });

  it("has no getSpotPricing when the underlying finder lacks it", () => {
    const truffle: TruffleLiveFinder = { async search() { return []; } };
    const finder = truffleFinderAdapter(truffle, "us-east-1");
    expect(finder.getSpotPricing).toBeUndefined();
  });

  it("delegates + region-stamps spot pricing when present", async () => {
    const truffle: TruffleLiveFinder = {
      async search() {
        return [{ instanceType: "g5.xlarge", onDemandPrice: 1 }];
      },
      async getSpotPricing() {
        return [{ instanceType: "g5.xlarge", region: "", spotPrice: 0.3, availabilityZone: "us-east-1a" }];
      },
    };
    const finder = truffleFinderAdapter(truffle, "us-east-1");
    const spot = await finder.getSpotPricing!([{ instanceType: "g5.xlarge", region: "us-east-1" }], { onlyActive: true });
    expect(spot[0]).toEqual({ instanceType: "g5.xlarge", region: "us-east-1", spotPrice: 0.3, availabilityZone: "us-east-1a" });
  });

  it("drives a CapacityWatcher end-to-end through the adapter", async () => {
    const truffle: TruffleLiveFinder = {
      async search(matcher) {
        return [
          { instanceType: "g5.xlarge", onDemandPrice: 1.006 },
          { instanceType: "m7i.large", onDemandPrice: 0.1 },
        ].filter((r) => matcher.test(r.instanceType));
      },
    };
    const watcher = new CapacityWatcher({ finder: truffleFinderAdapter(truffle, "eu-west-1"), now: fixedNow });
    const m = await watcher.check({ watchId: "w1", instanceTypePattern: "g5.*", regions: ["eu-west-1"] });
    expect(m).not.toBeNull();
    expect(m!.instanceType).toBe("g5.xlarge");
    expect(m!.region).toBe("eu-west-1");
  });
});

describe("truffleFinderFor (lagotto-ts#1)", () => {
  it("builds one truffle finder per region, reuses it, and searches all of them", async () => {
    const built: string[] = [];
    const finderFor = truffleFinderFor((region) => {
      built.push(region);
      return {
        async search() {
          return region === "us-west-2" ? [{ instanceType: "p5.48xlarge", onDemandPrice: 98.32, vcpus: 192 }] : [];
        },
      };
    });
    const watcher = new CapacityWatcher({ finderFor, now: fixedNow, onWarning: () => {} });
    const w = { watchId: "w1", instanceTypePattern: "p5.*", regions: ["us-east-1", "us-west-2"] };
    const m = await watcher.check(w);
    await watcher.check(w);
    expect(built).toEqual(["us-east-1", "us-west-2"]);
    expect(m!.region).toBe("us-west-2");
    expect(m!.vcpus).toBe(192); // truffle-ts vcpus reaches the match (Go #153)
  });

  it("a single-region adapter refuses a watch on another region", async () => {
    const truffle: TruffleLiveFinder = { async search() { return [{ instanceType: "g5.xlarge" }]; } };
    const watcher = new CapacityWatcher({ finder: truffleFinderAdapter(truffle, "us-east-1"), now: fixedNow });
    await expect(
      watcher.check({ watchId: "w1", instanceTypePattern: "g5.*", regions: ["us-east-1", "us-west-2"] }),
    ).rejects.toThrow(/does not serve/);
  });
});

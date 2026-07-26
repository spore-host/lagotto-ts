import { describe, it, expect } from "vitest";
import { truffleFinderAdapter, type TruffleLiveFinder } from "./truffle-adapter.js";
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

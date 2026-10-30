// Runs lagotto-ts against the REAL truffle-ts AwsLiveFinder (the devDependency),
// with only the EC2 transport faked through its `ec2ClientFor` seam. Every other
// test feeds the adapter plain objects, so without this file a truffle-ts
// release could change what its finder returns and the suite would stay green.
// These cases must pass on every version in the peer range.

import { describe, it, expect } from "vitest";
import { AwsLiveFinder } from "@spore-host/truffle-ts/live";
import { truffleFinderAdapter, truffleFinderFor, type TruffleLiveFinder } from "./truffle-adapter.js";
import { CapacityWatcher } from "./watcher.js";

type LiveFinderOptions = ConstructorParameters<typeof AwsLiveFinder>[0];
type FakeEC2 = NonNullable<LiveFinderOptions["ec2ClientFor"]>;

const fixedNow = () => new Date("2026-10-30T00:00:00.000Z");

/** DescribeInstanceTypes rows per region; DescribeInstanceTypeOfferings is answered with `<region>a`. */
function fakeEC2(offered: Record<string, string[]>): FakeEC2 {
  return (region) =>
    ({
      async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
        const types = offered[region] ?? [];
        switch (cmd.constructor.name) {
          case "DescribeInstanceTypesCommand": {
            const wanted = cmd.input.InstanceTypes as string[] | undefined;
            return {
              InstanceTypes: types
                .filter((t) => !wanted || wanted.includes(t))
                .map((t) => ({
                  InstanceType: t,
                  VCpuInfo: { DefaultVCpus: t.endsWith(".xlarge") ? 4 : 2 },
                  MemoryInfo: { SizeInMiB: 16384 },
                  ProcessorInfo: { SupportedArchitectures: ["x86_64"] },
                })),
            };
          }
          case "DescribeSpotPriceHistoryCommand":
            return {
              SpotPriceHistory: types.map((t) => ({
                InstanceType: t,
                AvailabilityZone: `${region}a`,
                SpotPrice: "0.25",
                ProductDescription: "Linux/UNIX",
                Timestamp: new Date("2026-10-29T23:30:00.000Z"),
              })),
            };
          case "DescribeInstanceTypeOfferingsCommand":
            return {
              InstanceTypeOfferings: types.map((t) => ({ InstanceType: t, Location: `${region}a` })),
            };
          default:
            throw new Error(`unexpected EC2 call ${cmd.constructor.name}`);
        }
      },
    }) as unknown as ReturnType<FakeEC2>;
}

describe("against the real truffle-ts AwsLiveFinder", () => {
  it("fits the TruffleLiveFinder seam", () => {
    // Type-level: `npm run typecheck` fails here if truffle-ts changes the
    // search/getSpotPricing shape the adapter relies on.
    const f: TruffleLiveFinder = new AwsLiveFinder({ regions: "us-east-1", ec2ClientFor: fakeEC2({}) });
    expect(typeof f.search).toBe("function");
    expect(typeof f.getSpotPricing).toBe("function");
  });

  it("checks a single-region watch end to end, attributing the match to its region", async () => {
    const finder = new AwsLiveFinder({
      regions: "us-west-2",
      ec2ClientFor: fakeEC2({ "us-west-2": ["g6.xlarge", "m7i.large"] }),
    });
    const watcher = new CapacityWatcher({ finder: truffleFinderAdapter(finder, "us-west-2"), now: fixedNow });
    const m = await watcher.check({ watchId: "w1", instanceTypePattern: "g6.*", regions: ["us-west-2"] });
    expect(m).not.toBeNull();
    expect(m!.instanceType).toBe("g6.xlarge");
    expect(m!.region).toBe("us-west-2");
    expect(m!.vcpus).toBe(4);
  });

  it("an unpriced row (pricing off) matches with no cap and never passes a cap", async () => {
    // truffle-ts 0.6 returns no price rather than estimating one; with pricing
    // "off" no version prices the row. Unknown is not free.
    const make = () =>
      new AwsLiveFinder({ regions: "us-east-1", ec2ClientFor: fakeEC2({ "us-east-1": ["g6.xlarge"] }) });
    const uncapped = await new CapacityWatcher({ finder: truffleFinderAdapter(make(), "us-east-1"), now: fixedNow }).check(
      { watchId: "w1", instanceTypePattern: "g6.xlarge", regions: ["us-east-1"] },
    );
    expect(uncapped).not.toBeNull();
    expect(uncapped!.price).toBeUndefined();
    const capped = await new CapacityWatcher({ finder: truffleFinderAdapter(make(), "us-east-1"), now: fixedNow }).check(
      { watchId: "w1", instanceTypePattern: "g6.xlarge", regions: ["us-east-1"], maxPrice: 100 },
    );
    expect(capped).toBeNull();
  });

  it("prices a Spot watch through the real getSpotPricing", async () => {
    const finder = new AwsLiveFinder({
      regions: "us-east-1",
      ec2ClientFor: fakeEC2({ "us-east-1": ["g6.xlarge"] }),
    });
    const watcher = new CapacityWatcher({ finder: truffleFinderAdapter(finder, "us-east-1"), now: fixedNow });
    const m = await watcher.check({
      watchId: "w1",
      instanceTypePattern: "g6.*",
      regions: ["us-east-1"],
      spot: true,
      maxPrice: 1,
    });
    expect(m).not.toBeNull();
    expect(m!.price).toBe(0.25);
    expect(m!.availabilityZone).toBe("us-east-1a");
  });

  it("fans a multi-region watch out over per-region finders", async () => {
    const ec2 = fakeEC2({ "us-east-1": [], "eu-west-1": ["g6.xlarge"] });
    const watcher = new CapacityWatcher({
      finderFor: truffleFinderFor((r) => new AwsLiveFinder({ regions: r, ec2ClientFor: ec2 })),
      now: fixedNow,
      onWarning: () => {},
    });
    const m = await watcher.check({ watchId: "w1", instanceTypePattern: "g6.*", regions: ["us-east-1", "eu-west-1"] });
    expect(m!.region).toBe("eu-west-1");
  });

  it("a comma-list pattern is not mistaken for one exact type name", async () => {
    // truffle-ts pushes an exact `^name$` matcher into DescribeInstanceTypes; an
    // alternation must take the fetch-all path, or only one rung is searched.
    const finder = new AwsLiveFinder({
      regions: "us-east-1",
      ec2ClientFor: fakeEC2({ "us-east-1": ["g6.2xlarge", "m7i.large"] }),
    });
    const watcher = new CapacityWatcher({ finder: truffleFinderAdapter(finder, "us-east-1"), now: fixedNow });
    const m = await watcher.check({
      watchId: "w1",
      instanceTypePattern: "g6.4xlarge,g6.2xlarge",
      regions: ["us-east-1"],
    });
    expect(m!.instanceType).toBe("g6.2xlarge");
  });
});

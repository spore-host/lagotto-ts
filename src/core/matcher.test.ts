import { describe, it, expect } from "vitest";
import { evaluate, type MatchCandidate } from "./matcher.js";
import type { Watch } from "./types.js";

const baseWatch: Watch = {
  watchId: "w-1",
  instanceTypePattern: "g5.*",
  regions: ["us-east-1"],
};

describe("evaluate — on-demand branch", () => {
  it("matches an offering under the price cap and carries ordered AZs", () => {
    const w: Watch = { ...baseWatch, maxPrice: 2 };
    const c: MatchCandidate = {
      instanceType: {
        instanceType: "g5.xlarge",
        region: "us-east-1",
        onDemandPrice: 1.006,
        availableAZs: ["us-east-1a", "us-east-1b"],
      },
    };
    const m = evaluate(w, c);
    expect(m).not.toBeNull();
    expect(m!.instanceType).toBe("g5.xlarge");
    expect(m!.isSpot).toBe(false);
    expect(m!.price).toBe(1.006);
    expect(m!.availabilityZone).toBe("us-east-1a");
    expect(m!.candidateAzs).toEqual(["us-east-1a", "us-east-1b"]);
  });

  it("rejects an offering over the price cap", () => {
    const w: Watch = { ...baseWatch, maxPrice: 0.5 };
    const c: MatchCandidate = {
      instanceType: { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1.006, availableAZs: ["us-east-1a"] },
    };
    expect(evaluate(w, c)).toBeNull();
  });

  it("no price cap (maxPrice 0/undefined) always passes the price check", () => {
    const c: MatchCandidate = {
      instanceType: { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 999, availableAZs: ["us-east-1a"] },
    };
    expect(evaluate(baseWatch, c)).not.toBeNull();
  });

  it("rejects an UNPRICED offering against a price cap", () => {
    // The price read `?? 0`, so an absent price compared as free and passed EVERY
    // ceiling: a watch saying "wake me under $1/hr" fired on a machine whose cost
    // we cannot establish, and the user learned the price from the bill.
    //
    // Latent until truffle-ts 0.5.0 made it the common case — that version omits
    // the price for types it can't price rather than fabricating one
    // (truffle-ts#39/#42), so `undefined` now arrives here routinely.
    const w: Watch = { ...baseWatch, maxPrice: 1 };
    const c: MatchCandidate = {
      // The real shape of an unpriced entry: p6e-gb200.36xlarge, ~$100/hr.
      instanceType: { instanceType: "p6e-gb200.36xlarge", region: "us-east-1", availableAZs: ["us-east-1a"] },
    };
    expect(evaluate(w, c)).toBeNull();
  });

  it("still matches an unpriced offering when NO cap is set", () => {
    // Symmetry matters: with no maxPrice the watch has expressed no price opinion,
    // so an unpriced type is a legitimate match. Rejecting it here would make a
    // brand-new accelerator unwatchable — the wrong correction to the bug above.
    const c: MatchCandidate = {
      instanceType: { instanceType: "p6e-gb200.36xlarge", region: "us-east-1", availableAZs: ["us-east-1a"] },
    };
    const m = evaluate(baseWatch, c);
    expect(m).not.toBeNull();
    // And the price it reports must stay absent rather than becoming a 0 downstream.
    expect(m!.price).toBeUndefined();
  });

  it("honors an AZ pin: reorders to the preference and picks the first", () => {
    const w: Watch = { ...baseWatch, availabilityZones: ["us-east-1c", "us-east-1a"] };
    const c: MatchCandidate = {
      instanceType: {
        instanceType: "g5.xlarge",
        region: "us-east-1",
        onDemandPrice: 1,
        availableAZs: ["us-east-1a", "us-east-1b", "us-east-1c"],
      },
    };
    const m = evaluate(w, c)!;
    expect(m.candidateAzs).toEqual(["us-east-1c", "us-east-1a"]);
    expect(m.availabilityZone).toBe("us-east-1c");
  });

  it("rejects when the watch pins AZs none of which offer the type", () => {
    const w: Watch = { ...baseWatch, availabilityZones: ["us-east-1f"] };
    const c: MatchCandidate = {
      instanceType: { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1, availableAZs: ["us-east-1a"] },
    };
    expect(evaluate(w, c)).toBeNull();
  });

  it("matches with empty AZ (source didn't report zones)", () => {
    const c: MatchCandidate = {
      instanceType: { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1 },
    };
    const m = evaluate(baseWatch, c)!;
    expect(m.availabilityZone).toBe("");
    expect(m.candidateAzs).toEqual([]);
  });
});

describe("evaluate — spot branch", () => {
  const spotWatch: Watch = { ...baseWatch, spot: true };

  it("matches a spot price under the cap at its AZ", () => {
    const w: Watch = { ...spotWatch, maxPrice: 0.5 };
    const c: MatchCandidate = {
      instanceType: { instanceType: "g5.xlarge", region: "us-east-1" },
      spotPrice: { instanceType: "g5.xlarge", region: "us-east-1", spotPrice: 0.31, availabilityZone: "us-east-1b" },
    };
    const m = evaluate(w, c)!;
    expect(m.isSpot).toBe(true);
    expect(m.price).toBe(0.31);
    expect(m.availabilityZone).toBe("us-east-1b");
    expect(m.candidateAzs).toEqual(["us-east-1b"]);
  });

  it("rejects a spot price over the cap", () => {
    const w: Watch = { ...spotWatch, maxPrice: 0.2 };
    const c: MatchCandidate = {
      instanceType: { instanceType: "g5.xlarge", region: "us-east-1" },
      spotPrice: { instanceType: "g5.xlarge", region: "us-east-1", spotPrice: 0.31, availabilityZone: "us-east-1b" },
    };
    expect(evaluate(w, c)).toBeNull();
  });

  it("rejects a spot price in an AZ excluded by the pin", () => {
    const w: Watch = { ...spotWatch, availabilityZones: ["us-east-1a"] };
    const c: MatchCandidate = {
      instanceType: { instanceType: "g5.xlarge", region: "us-east-1" },
      spotPrice: { instanceType: "g5.xlarge", region: "us-east-1", spotPrice: 0.31, availabilityZone: "us-east-1b" },
    };
    expect(evaluate(w, c)).toBeNull();
  });

  it("a spot watch with NO spot price does not match", () => {
    const c: MatchCandidate = {
      instanceType: { instanceType: "g5.xlarge", region: "us-east-1", onDemandPrice: 1 },
    };
    expect(evaluate(spotWatch, c)).toBeNull();
  });
});

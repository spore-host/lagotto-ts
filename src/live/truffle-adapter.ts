// Adapter: wrap a truffle-ts LiveFinder as a lagotto CapacityFinder.
//
// truffle-ts's live finder is REGION-AGNOSTIC — `search` dedupes instance types
// across its configured regions and its InstanceType carries no
// `region`/`availableAZs` (truffle-ts#31, truffle-ts#33). So one truffle finder
// can only honestly answer for ONE region: this adapter stamps that region onto
// each result and declares it in `regions`, and CapacityWatcher refuses a watch
// naming any other region. To watch several regions, build one truffle finder
// per region with `truffleFinderFor` (lagotto-ts#1). When truffle-ts returns
// per-region rows, this is the one place that changes.
//
// The truffle finder is typed structurally (TruffleLiveFinder) so lagotto-ts
// never imports @spore-host/truffle-ts — it stays a peer/optional dependency.

import type { CapacityFinder, FinderInstanceType, FinderSpotPrice } from "./watcher.js";

/** The slice of truffle-ts's Finder/LiveFinder this adapter uses. */
export interface TruffleInstanceType {
  instanceType: string;
  onDemandPrice?: number;
  /** vCPU count (truffle-ts InstanceType.vcpus), carried onto the match. */
  vcpus?: number;
  /** Present only if a future truffle-ts attaches per-region AZs. */
  availableAZs?: string[];
}

export interface TruffleSpotPriceResult {
  instanceType: string;
  region: string;
  spotPrice: number;
  availabilityZone?: string;
}

export interface TruffleLiveFinder {
  search(matcher: RegExp, filters: { includeAZs?: boolean }): Promise<TruffleInstanceType[]>;
  getSpotPricing?(
    instances: TruffleInstanceType[],
    opts: { onlyActive?: boolean },
  ): Promise<TruffleSpotPriceResult[]>;
}

/**
 * Adapt a truffle-ts live finder to lagotto's CapacityFinder for a single
 * region. `region` is stamped onto every result (truffle-ts's results are
 * region-agnostic) and declared in `regions`, so a CapacityWatcher given this
 * finder throws for a watch naming any other region instead of silently
 * searching this one. The truffle finder MUST be configured for `region` alone —
 * one configured for several would have its deduped rows misattributed.
 *
 * Spot pricing is delegated when the underlying finder supports it; otherwise
 * the adapter has no getSpotPricing and a Spot watch against it throws a clear
 * error in CapacityWatcher.
 */
export function truffleFinderAdapter(finder: TruffleLiveFinder, region: string): CapacityFinder {
  const adapter: CapacityFinder = {
    regions: [region],
    async search(matcher, filters): Promise<FinderInstanceType[]> {
      const results = await finder.search(matcher, filters);
      return results.map((r) => ({
        instanceType: r.instanceType,
        region,
        onDemandPrice: r.onDemandPrice,
        availableAZs: r.availableAZs,
        vcpus: r.vcpus,
      }));
    },
  };

  if (finder.getSpotPricing) {
    adapter.getSpotPricing = async (instances, opts): Promise<FinderSpotPrice[]> => {
      const spot = await finder.getSpotPricing!(instances, opts);
      return spot.map((s) => ({
        instanceType: s.instanceType,
        region: s.region || region,
        spotPrice: s.spotPrice,
        availabilityZone: s.availabilityZone,
      }));
    };
  }

  return adapter;
}

/**
 * A per-region finder factory for `CapacityWatcherOptions.finderFor`: `make`
 * builds a truffle-ts finder for ONE region (e.g.
 * `(r) => new AwsLiveFinder({ regions: r, pricing: "lazy" })`), and each is
 * wrapped by `truffleFinderAdapter`. Finders are built lazily and reused per
 * region, so repeated polls don't rebuild SDK clients.
 */
export function truffleFinderFor(
  make: (region: string) => TruffleLiveFinder,
): (region: string) => CapacityFinder {
  const cache = new Map<string, CapacityFinder>();
  return (region) => {
    let f = cache.get(region);
    if (!f) {
      f = truffleFinderAdapter(make(region), region);
      cache.set(region, f);
    }
    return f;
  };
}

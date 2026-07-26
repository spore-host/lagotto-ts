// Adapter: wrap a truffle-ts LiveFinder as a lagotto CapacityFinder.
//
// truffle-ts's live finder is REGION-AGNOSTIC — `search` dedupes instance types
// across regions and its InstanceType carries no `region`/`availableAZs`, and
// spot pricing is not implemented there yet (truffle-ts#18). So lagotto can't
// consume it structurally; this adapter bridges the gap by stamping the region
// the watcher is querying onto each result. When truffle-ts grows real
// per-region AZ + spot data, this is the one place that changes.
//
// The truffle finder is typed structurally (TruffleLiveFinder) so lagotto-ts
// never imports @spore-host/truffle-ts — it stays a peer/optional dependency.

import type { CapacityFinder, FinderInstanceType, FinderSpotPrice } from "./watcher.js";

/** The slice of truffle-ts's Finder/LiveFinder this adapter uses. */
export interface TruffleInstanceType {
  instanceType: string;
  onDemandPrice?: number;
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
 * region-agnostic). Spot pricing is delegated when the underlying finder
 * supports it; otherwise the adapter has no getSpotPricing and a Spot watch
 * against it throws a clear error in CapacityWatcher.
 */
export function truffleFinderAdapter(finder: TruffleLiveFinder, region: string): CapacityFinder {
  const adapter: CapacityFinder = {
    async search(matcher, filters): Promise<FinderInstanceType[]> {
      const results = await finder.search(matcher, filters);
      return results.map((r) => ({
        instanceType: r.instanceType,
        region,
        onDemandPrice: r.onDemandPrice,
        availableAZs: r.availableAZs,
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

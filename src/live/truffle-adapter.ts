// Adapter: wrap a truffle-ts LiveFinder as a lagotto CapacityFinder.
//
// truffle-ts <= 0.5 deduped instance types across its configured regions and
// its rows carried no `region` (truffle-ts#31). truffle-ts 0.6 returns one row
// per (type, region), each with its `region`. This adapter declares ONE region
// in `regions`, so CapacityWatcher refuses a watch naming any other region; to
// watch several, build one truffle finder per region with `truffleFinderFor`
// (lagotto-ts#1).
//
// A row keeps the region truffle-ts gives it; only a row with none (truffle-ts
// <= 0.5) is stamped with the adapter's region. Stamping every row would
// relabel another region's offering as this one's, so a finder configured for
// more regions than it was declared for could match a watch on capacity that
// exists only elsewhere. Rows for other regions are then dropped by
// CapacityWatcher's region filter.
//
// The truffle finder is typed structurally (TruffleLiveFinder) so lagotto-ts
// never imports @spore-host/truffle-ts — it stays a peer/optional dependency.

import type { CapacityFinder, FinderInstanceType, FinderSpotPrice } from "./watcher.js";

/** The slice of truffle-ts's Finder/LiveFinder this adapter uses. */
export interface TruffleInstanceType {
  instanceType: string;
  /** The region the row came from (truffle-ts >= 0.6). Absent before 0.6. */
  region?: string;
  /** Absent when truffle-ts cannot establish a price (never `0`). */
  onDemandPrice?: number;
  /** vCPU count (truffle-ts InstanceType.vcpus), carried onto the match. */
  vcpus?: number;
  /**
   * AZs offering the type in its region. truffle-ts >= 0.6 fills it when the
   * finder is built with `includeAZs: true`; it is absent otherwise.
   */
  availableAZs?: string[];
}

export interface TruffleSpotPriceResult {
  instanceType: string;
  region: string;
  spotPrice: number;
  availabilityZone?: string;
}

export interface TruffleLiveFinder {
  /**
   * truffle-ts's `search(matcher, filters: FilterOptions)`. The adapter passes
   * no filters: the pattern is the whole query, and AZs are a finder option in
   * truffle-ts (`includeAZs`), not a filter. Typed `{}` so a real truffle-ts
   * finder is assignable: lagotto's `{ includeAZs?: boolean }` shares no property
   * with `FilterOptions`, so TypeScript rejected `AwsLiveFinder` here.
   */
  search(matcher: RegExp, filters: Record<string, never>): Promise<TruffleInstanceType[]>;
  /**
   * truffle-ts's `getSpotPricing(instances, opts: SpotOptions)`. The adapter
   * passes no options: with no `lookbackHours`, truffle-ts returns the latest
   * observation per AZ, the current price. truffle-ts has no `onlyActive`
   * option, and typing `opts` as lagotto's `{ onlyActive?: boolean }` made
   * `AwsLiveFinder` unassignable here, as with `search`.
   */
  getSpotPricing?(
    instances: TruffleInstanceType[],
    opts: Record<string, never>,
  ): Promise<TruffleSpotPriceResult[]>;
}

/**
 * Adapt a truffle-ts live finder to lagotto's CapacityFinder for a single
 * region. `region` is declared in `regions`, so a CapacityWatcher given this
 * finder throws for a watch naming any other region instead of silently
 * searching this one. It is stamped onto rows that carry no region of their own
 * (truffle-ts <= 0.5); a row that names its region keeps it. Configure the
 * truffle finder for `region` alone: truffle-ts <= 0.5 rows from a
 * multi-region finder carry no region and would be misattributed.
 *
 * Spot pricing is delegated when the underlying finder supports it; otherwise
 * the adapter has no getSpotPricing and a Spot watch against it throws a clear
 * error in CapacityWatcher.
 */
export function truffleFinderAdapter(finder: TruffleLiveFinder, region: string): CapacityFinder {
  const adapter: CapacityFinder = {
    regions: [region],
    async search(matcher): Promise<FinderInstanceType[]> {
      const results = await finder.search(matcher, {});
      return results.map((r) => ({
        instanceType: r.instanceType,
        region: r.region || region,
        onDemandPrice: r.onDemandPrice,
        availableAZs: r.availableAZs,
        vcpus: r.vcpus,
      }));
    },
  };

  if (finder.getSpotPricing) {
    adapter.getSpotPricing = async (instances): Promise<FinderSpotPrice[]> => {
      const spot = await finder.getSpotPricing!(instances, {});
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
 * builds a truffle-ts finder for ONE region, and each is wrapped by
 * `truffleFinderAdapter`. Finders are built lazily and reused per region, so
 * repeated polls don't rebuild SDK clients. For example:
 *
 *   (r) => new AwsLiveFinder({ regions: r, pricing: "lazy", includeAZs: true })
 *
 * An on-demand watch that pins `availabilityZones` needs `includeAZs: true`,
 * which truffle-ts >= 0.6 supports.
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

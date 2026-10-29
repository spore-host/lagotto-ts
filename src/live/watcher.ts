// CapacityWatcher — the live capacity check, ported from Go
// pkg/watcher/poller.go searchBestMatch. Given a Watch, it searches the watch's
// instance-type pattern in EVERY region the watch names, evaluates each offering
// with the pure `evaluate` matcher, and returns the CHEAPEST match across all of
// them (or null if no capacity yet). It also drives a poll-while-open loop for a
// browser/Node consumer.
//
// The finder is consumed through a minimal seam (CapacityFinder) that lagotto
// OWNS — tests inject a fake with zero AWS, and a truffle-ts AwsLiveFinder is
// wired in via `truffleFinderAdapter` / `truffleFinderFor`. This keeps truffle-ts
// a peer/optional dependency: lagotto-ts core never imports it.
//
// Regions (lagotto-ts#1). Go passes `w.Regions` straight into truffle's
// SearchInstanceTypes, so a three-region watch searches three regions. truffle-ts
// cannot do that through one finder today — its multi-region search dedupes by
// instance type and drops region identity (truffle-ts#31) — so lagotto-ts takes
// a per-region finder FACTORY (`finderFor`) and fans out itself. A single
// `finder` is still accepted, but only for the regions it declares it serves; a
// watch naming a region the finder can't serve is a thrown error, never a
// quietly narrowed search that reads like a completed one (Go #63).

import { evaluate, type SpotObservation } from "../core/matcher.js";
import { compilePattern } from "../core/pattern.js";
import type { MatchResult, Watch } from "../core/types.js";

/** The instance-type facts CapacityWatcher reads from a finder result. */
export interface FinderInstanceType {
  instanceType: string;
  region: string;
  onDemandPrice?: number;
  /**
   * AZs where the type is offered in `region`. `undefined` means the finder does
   * not report AZs at all (truffle-ts today, truffle-ts#33) — distinct from `[]`,
   * "offered in no AZ".
   */
  availableAZs?: string[];
  /** Authoritative vCPU count, carried onto the match (Go #153). */
  vcpus?: number;
}

/** A spot price observation as returned by the finder. */
export interface FinderSpotPrice {
  instanceType: string;
  region: string;
  spotPrice: number;
  availabilityZone?: string;
}

/**
 * The read-only capacity source CapacityWatcher needs — lagotto's own seam.
 * `search` returns instance offerings; `getSpotPricing` (optional) prices them
 * for a Spot watch. Every result must carry the region it came from.
 *
 * `regions` declares which regions one `search` call covers. A finder that
 * omits it is treated as serving exactly one (unnamed) region, so it can only
 * back a single-region watch. `truffleFinderAdapter` sets it.
 */
export interface CapacityFinder {
  readonly regions?: readonly string[];
  search(matcher: RegExp, filters: { includeAZs?: boolean }): Promise<FinderInstanceType[]>;
  getSpotPricing?(
    instances: FinderInstanceType[],
    opts: { onlyActive?: boolean },
  ): Promise<FinderSpotPrice[]>;
}

/** A non-fatal problem a check ran into — the analogue of Go's stderr warnings. */
export type CheckWarning =
  | {
      /** Some (not all) regions failed; the check used the ones that answered. */
      kind: "region-failed";
      region: string;
      error: unknown;
      message: string;
    }
  | {
      /**
       * The pattern matched no instance type in any queried region. Go's
       * warnUnmatchablePattern: almost always a typo, but not fatal — the type
       * may simply not be offered yet.
       */
      kind: "unmatchable-pattern";
      message: string;
    };

export interface CapacityWatcherOptions {
  /**
   * A finder for the region(s) it declares in `finder.regions` (or, if it
   * declares none, for a single-region watch only). Supply this OR `finderFor`.
   */
  finder?: CapacityFinder;
  /**
   * Per-region finder factory: called once per region the watch names, and the
   * results are folded into one global cheapest match — Go's behaviour. This is
   * the way to watch several regions with truffle-ts today (see
   * `truffleFinderFor`).
   */
  finderFor?: (region: string) => CapacityFinder;
  /**
   * Clock seam for `matchedAt` stamping + tests (default `() => new Date()`).
   * Injected so tests are deterministic.
   */
  now?: () => Date;
  /**
   * Receives non-fatal warnings (a partial region failure, an unmatchable
   * pattern). Go always prints these to stderr; a library must not, so the
   * default is `console.warn` and a UI can route them somewhere visible.
   */
  onWarning?: (w: CheckWarning) => void;
}

/** A single check's outcome: the best match, or null if no capacity appeared. */
export type CheckResult = MatchResult | null;

/**
 * Is `m` a better "cheapest match" than the incumbent `best`?
 *
 * A match with NO price must not win. `MatchResult.price` became optional when
 * truffle-ts 0.5.0 started omitting prices it can't establish rather than
 * fabricating them (truffle-ts#39/#42), and the comparison here was `m.price <
 * best.price` — under which an absent price coerces and an unpriced type takes
 * the "cheapest" slot it has the least evidence for. Same defect truffle-ts's own
 * sort had, one layer up.
 *
 * A priced match always beats an unpriced one; an unpriced match is only kept
 * when there's nothing else, so a watch on a type nobody prices still reports
 * capacity rather than silently finding none.
 */
function isCheaper(m: MatchResult, best: MatchResult | null): boolean {
  if (best === null) return true;
  if (m.price == null) return false; // never displaces anything
  if (best.price == null) return true; // any real price beats no price
  return m.price < best.price;
}

/** One unit of search work: a finder plus the watch regions it is answering for. */
interface SearchPlan {
  finder: CapacityFinder;
  /** The watch regions this finder covers (used for attribution + filtering). */
  regions: string[];
}

export class CapacityWatcher {
  private readonly finder?: CapacityFinder;
  private readonly finderFor?: (region: string) => CapacityFinder;
  private readonly now: () => Date;
  private readonly onWarning: (w: CheckWarning) => void;

  constructor(opts: CapacityWatcherOptions) {
    if (!opts.finder && !opts.finderFor) {
      throw new Error("CapacityWatcher needs a finder or a finderFor factory");
    }
    if (opts.finder && opts.finderFor) {
      throw new Error("CapacityWatcher takes a finder OR a finderFor factory, not both");
    }
    this.finder = opts.finder;
    this.finderFor = opts.finderFor;
    this.now = opts.now ?? (() => new Date());
    this.onWarning = opts.onWarning ?? ((w) => console.warn(`lagotto-ts: ${w.message}`));
  }

  /**
   * Check once for capacity satisfying `watch`, across every region it names.
   * Returns the cheapest eligible match (on-demand availability, or Spot under
   * the price cap) or null if none is available right now. Ports
   * searchBestMatch: search → (spot pricing) → evaluate each candidate → keep
   * the lowest price.
   *
   * Throws if the watch names no region, if the configured finder cannot serve a
   * region the watch names, if EVERY region's query failed (a total failure is
   * not "no capacity" — Go #63), or if the watch pins AZs on the on-demand path
   * and the finder reports no AZ data (that combination can never match, so
   * returning null would be a false "still waiting").
   */
  async check(watch: Watch): Promise<CheckResult> {
    return this.checkOnce(watch, true);
  }

  private async checkOnce(watch: Watch, firstCheck: boolean): Promise<CheckResult> {
    const plans = this.plan(watch);
    const matcher = compilePattern(watch.instanceTypePattern);
    if (watch.spot) {
      for (const p of plans) {
        if (!p.finder.getSpotPricing) {
          throw new Error("watch requests Spot but the finder has no getSpotPricing");
        }
      }
    }

    // Fan out like Go's SearchInstanceTypesByRegion: partial failure is a
    // warning, total failure is an error.
    const settled = await Promise.allSettled(
      plans.map(async (p) => {
        const wanted = new Set(p.regions);
        const results = (await p.finder.search(matcher, { includeAZs: true })).filter(
          // A finder that serves more regions than the watch asked for must not
          // widen the watch.
          (r) => wanted.has(r.region),
        );
        let spot: FinderSpotPrice[] = [];
        if (watch.spot && results.length > 0) {
          spot = (await p.finder.getSpotPricing!(results, { onlyActive: true })).filter((s) =>
            wanted.has(s.region),
          );
        }
        return { results, spot };
      }),
    );

    const failures: { regions: string[]; error: unknown }[] = [];
    const results: FinderInstanceType[] = [];
    const spot: FinderSpotPrice[] = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") {
        results.push(...s.value.results);
        spot.push(...s.value.spot);
      } else {
        failures.push({ regions: plans[i]!.regions, error: s.reason });
      }
    });
    if (failures.length === plans.length) {
      const errs = failures.map((f) => f.error);
      throw new AggregateError(
        errs,
        `all ${plans.length} region queries failed: ${errs.map(errorMessage).join("; ")}`,
      );
    }
    for (const f of failures) {
      for (const region of f.regions) {
        this.onWarning({
          kind: "region-failed",
          region,
          error: f.error,
          message: `region ${region} query failed; results may be incomplete: ${errorMessage(f.error)}`,
        });
      }
    }

    if (results.length === 0) {
      if (firstCheck) {
        this.onWarning({
          kind: "unmatchable-pattern",
          message: `watch ${watch.watchId} pattern ${JSON.stringify(watch.instanceTypePattern)} matches no known instance type in ${watch.regions.join(", ")} — check for typos; still watching in case it becomes available`,
        });
      }
      return null;
    }

    if (
      !watch.spot &&
      watch.availabilityZones &&
      watch.availabilityZones.length > 0 &&
      results.every((r) => r.availableAZs === undefined)
    ) {
      // evaluate() rejects a pinned watch when no offered AZ matches, and an
      // unknown AZ list reads as "offered nowhere" — so this watch would sit at
      // null forever while capacity may be free (lagotto-ts#1, truffle-ts#33).
      throw new Error(
        "watch pins availabilityZones but the finder reports no AZ data for any result, so an on-demand match can never be evaluated",
      );
    }

    const stamp = this.now().toISOString();
    let best: MatchResult | null = null;

    if (watch.spot) {
      const byType = new Map(results.map((r) => [`${r.instanceType}@${r.region}`, r]));
      for (const sp of spot) {
        const inst = byType.get(`${sp.instanceType}@${sp.region}`) ?? {
          instanceType: sp.instanceType,
          region: sp.region,
        };
        const m = evaluate(watch, { instanceType: inst, spotPrice: toSpotObservation(sp) });
        if (m) {
          m.matchedAt = stamp;
          if (isCheaper(m, best)) best = m;
        }
      }
    } else {
      for (const inst of results) {
        const m = evaluate(watch, { instanceType: inst });
        if (m) {
          m.matchedAt = stamp;
          if (isCheaper(m, best)) best = m;
        }
      }
    }
    return best;
  }

  /** Decide which finder answers for which of the watch's regions — or refuse. */
  private plan(watch: Watch): SearchPlan[] {
    const regions = [...new Set(watch.regions ?? [])];
    if (regions.length === 0) {
      throw new Error(`watch ${watch.watchId} names no region; at least one is required`);
    }
    if (this.finderFor) {
      return regions.map((r) => ({ finder: stampingFinder(this.finderFor!(r), r), regions: [r] }));
    }
    const finder = this.finder!;
    if (finder.regions === undefined) {
      if (regions.length > 1) {
        throw new Error(
          `watch ${watch.watchId} names ${regions.length} regions (${regions.join(", ")}) but the finder serves one and does not declare which; pass finderFor to search every region`,
        );
      }
      // Legacy single-region finder: trust its rows for the one region asked.
      return [{ finder: stampingFinder(finder, regions[0]!), regions }];
    }
    const served = new Set(finder.regions);
    const missing = regions.filter((r) => !served.has(r));
    if (missing.length > 0) {
      throw new Error(
        `watch ${watch.watchId} names region(s) ${missing.join(", ")} that the finder does not serve (it serves ${[...served].join(", ") || "none"}); pass finderFor to search every region`,
      );
    }
    return [{ finder, regions }];
  }

  /**
   * Poll for capacity until a match is found, the signal aborts, or `maxChecks`
   * is reached. Calls `onCheck` (if given) after every check with the result so a
   * UI can show "still waiting". Resolves with the first match, or null if it
   * stopped without one. Intended for a browser tab or a short-lived Node script
   * — persistent/hosted polling is a server concern, not part of this library.
   * The unmatchable-pattern warning fires on the first check only, as in Go.
   */
  async poll(
    watch: Watch,
    opts: {
      intervalMs: number;
      maxChecks?: number;
      signal?: AbortSignal;
      onCheck?: (result: CheckResult, checkNumber: number) => void;
    },
  ): Promise<CheckResult> {
    const { intervalMs, maxChecks, signal, onCheck } = opts;
    let n = 0;
    while (!signal?.aborted) {
      n++;
      const result = await this.checkOnce(watch, n === 1);
      onCheck?.(result, n);
      if (result) return result;
      if (maxChecks !== undefined && n >= maxChecks) return null;
      const done = await sleep(intervalMs, signal);
      if (!done) return null; // aborted during the wait
    }
    return null;
  }
}

/**
 * Pin a finder to the ONE region it is answering for (a legacy finder that
 * declares no regions, or a `finderFor(region)` product): rows it returns without
 * a region are attributed to that region so the region filter does not drop them.
 */
function stampingFinder(f: CapacityFinder, region: string): CapacityFinder {
  const out: CapacityFinder = {
    regions: [region],
    async search(m, filters) {
      return (await f.search(m, filters)).map((r) => ({ ...r, region: r.region || region }));
    },
  };
  if (f.getSpotPricing) {
    out.getSpotPricing = async (inst, o) =>
      (await f.getSpotPricing!(inst, o)).map((s) => ({ ...s, region: s.region || region }));
  }
  return out;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toSpotObservation(sp: FinderSpotPrice): SpotObservation {
  return {
    instanceType: sp.instanceType,
    region: sp.region,
    spotPrice: sp.spotPrice,
    availabilityZone: sp.availabilityZone,
  };
}

/** Resolve true after `ms`, or false if `signal` aborts first. No unhandled reject. */
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

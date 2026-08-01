// CapacityWatcher — the live capacity check, ported from Go
// pkg/watcher/poller.go searchBestMatch. Given a Watch, it searches the watch's
// instance-type pattern via a truffle-ts LiveFinder, evaluates each offering
// with the pure `evaluate` matcher, and returns the CHEAPEST match (or null if
// no capacity yet). It also drives a poll-while-open loop for a browser/Node
// consumer.
//
// The finder is consumed through a minimal seam (CapacityFinder) that lagotto
// OWNS — tests inject a fake with zero AWS, and a truffle-ts AwsLiveFinder is
// wired in via `truffleFinderAdapter` (truffle-ts's live finder returns
// region-agnostic instance types today, so the adapter stamps the region and
// delegates spot pricing). This keeps truffle-ts a peer/optional dependency:
// lagotto-ts core never imports it.

import { evaluate, type SpotObservation } from "../core/matcher.js";
import { compilePattern } from "../core/pattern.js";
import type { MatchResult, Watch } from "../core/types.js";

/** The instance-type facts CapacityWatcher reads from a finder result. */
export interface FinderInstanceType {
  instanceType: string;
  region: string;
  onDemandPrice?: number;
  availableAZs?: string[];
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
 * `search` returns instance offerings for a region; `getSpotPricing` (optional)
 * prices them for a Spot watch. A truffle-ts live finder is adapted to this via
 * `truffleFinderAdapter` (truffle-ts results are region-agnostic, so the adapter
 * stamps the region); tests implement it directly with a fake.
 */
export interface CapacityFinder {
  search(matcher: RegExp, filters: { includeAZs?: boolean }): Promise<FinderInstanceType[]>;
  getSpotPricing?(
    instances: FinderInstanceType[],
    opts: { onlyActive?: boolean },
  ): Promise<FinderSpotPrice[]>;
}

export interface CapacityWatcherOptions {
  finder: CapacityFinder;
  /**
   * Clock seam for `matchedAt` stamping + tests (default `() => new Date()`).
   * Injected so tests are deterministic.
   */
  now?: () => Date;
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

export class CapacityWatcher {
  private readonly finder: CapacityFinder;
  private readonly now: () => Date;

  constructor(opts: CapacityWatcherOptions) {
    this.finder = opts.finder;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Check once for capacity satisfying `watch`. Returns the cheapest eligible
   * match (on-demand availability, or Spot under the price cap) or null if none
   * is available right now. Ports searchBestMatch: search → (spot pricing) →
   * evaluate each candidate → keep the lowest price.
   */
  async check(watch: Watch): Promise<CheckResult> {
    const matcher = compilePattern(watch.instanceTypePattern);
    const results = await this.finder.search(matcher, { includeAZs: true });
    if (results.length === 0) return null;

    const stamp = this.now().toISOString();
    let best: MatchResult | null = null;

    if (watch.spot) {
      if (!this.finder.getSpotPricing) {
        throw new Error("watch requests Spot but the finder has no getSpotPricing");
      }
      const spot = await this.finder.getSpotPricing(results, { onlyActive: true });
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

  /**
   * Poll for capacity until a match is found, the signal aborts, or `maxChecks`
   * is reached. Calls `onCheck` (if given) after every check with the result so a
   * UI can show "still waiting". Resolves with the first match, or null if it
   * stopped without one. Intended for a browser tab or a short-lived Node script
   * — persistent/hosted polling is a server concern, not part of this library.
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
      const result = await this.check(watch);
      onCheck?.(result, n);
      if (result) return result;
      if (maxChecks !== undefined && n >= maxChecks) return null;
      const done = await sleep(intervalMs, signal);
      if (!done) return null; // aborted during the wait
    }
    return null;
  }
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

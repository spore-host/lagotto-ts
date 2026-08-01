// The capacity matcher — port of Go pkg/watcher/matcher.go Evaluate. Given a
// Watch and a candidate offering (an instance type, optionally with a Spot
// price), decide whether it satisfies the watch and, if so, produce the
// MatchResult. Pure and provider-agnostic: the live watcher feeds it candidates
// built from truffle-ts results, but tests feed it plain objects.

import type { MatchResult, Watch } from "./types.js";
import { azAllowed, orderAZs } from "./azs.js";

/**
 * The instance-type facts the matcher needs, independent of where they came
 * from. A subset of truffle-ts's InstanceType — just the fields Evaluate reads —
 * so the core has no dependency on truffle-ts.
 */
export interface InstanceOffering {
  instanceType: string;
  region: string;
  /** On-demand hourly USD (may be undefined if the source didn't price it). */
  onDemandPrice?: number;
  /** AZs where this type is offered in the region (empty/undefined if unknown). */
  availableAZs?: string[];
}

/** A live Spot price observation for an instance type in one AZ. */
export interface SpotObservation {
  instanceType: string;
  region: string;
  spotPrice: number;
  /** The AZ this Spot price is for ("" if the source didn't report one). */
  availabilityZone?: string;
}

/**
 * A potential capacity match to evaluate against a watch: an instance offering,
 * and — for a Spot watch — the Spot price observation for it.
 */
export interface MatchCandidate {
  instanceType: InstanceOffering;
  /** Present only for a Spot check; drives the Spot branch of Evaluate. */
  spotPrice?: SpotObservation;
}

/**
 * Evaluate whether a candidate satisfies the watch. Returns a MatchResult
 * (without `matchedAt` — the caller stamps that) or null if it doesn't match.
 *
 * Ports the Go Evaluate exactly:
 * - Spot watch WITH a spot price: reject if over maxPrice or the AZ is excluded
 *   by the watch's AZ pin; otherwise match at that AZ.
 * - On-demand watch (spot false): reject if the on-demand price is over
 *   maxPrice, or if the watch pinned AZs none of which offer the type; otherwise
 *   match, carrying all eligible AZs in preference order.
 * - Spot watch with NO spot price: no match.
 */
export function evaluate(w: Watch, c: MatchCandidate): MatchResult | null {
  const maxPrice = w.maxPrice ?? 0;

  // Spot branch: a Spot watch with a Spot price observation.
  if (w.spot && c.spotPrice) {
    if (maxPrice > 0 && c.spotPrice.spotPrice > maxPrice) {
      return null;
    }
    const az = c.spotPrice.availabilityZone ?? "";
    // A spot price is for one AZ; honor an --azs pin if it excludes that AZ.
    if (!azAllowed(az, w.availabilityZones)) {
      return null;
    }
    return {
      watchId: w.watchId,
      region: c.spotPrice.region,
      availabilityZone: az,
      candidateAzs: az !== "" ? [az] : [],
      instanceType: c.spotPrice.instanceType,
      price: c.spotPrice.spotPrice,
      isSpot: true,
    };
  }

  // On-demand branch.
  if (!w.spot) {
    // An UNKNOWN price must not satisfy a price ceiling. This read `?? 0`, which
    // made an absent price compare as free and therefore pass *every* maxPrice —
    // a watch that says "wake me under $1/hr" would fire on a machine whose cost
    // we can't establish, and the user finds out from the bill. An error must
    // never be indistinguishable from an absence of data (truffle-ts#63), and a
    // missing price is an absence, not a zero.
    //
    // Latent until truffle-ts 0.5.0, which made this the COMMON case: it now
    // omits the price for types it can't price rather than fabricating one
    // (truffle-ts#39/#42), so `undefined` arrives here routinely instead of never.
    //
    // Only rejects when a ceiling is actually set: with no maxPrice the watch has
    // expressed no price opinion and an unpriced type is still a valid match.
    const price = c.instanceType.onDemandPrice;
    if (maxPrice > 0 && (price == null || price > maxPrice)) {
      return null;
    }
    // Restrict/order the offered AZs by the watch's preference (empty = all
    // offered AZs, in the source's order). All eligible AZs are carried so a
    // consumer can retry the next on InsufficientInstanceCapacity.
    const candidates = orderAZs(c.instanceType.availableAZs ?? [], w.availabilityZones);
    if (w.availabilityZones && w.availabilityZones.length > 0 && candidates.length === 0) {
      // The watch pinned AZs, none of which offer this type right now.
      return null;
    }
    const az = candidates.length > 0 ? candidates[0]! : "";
    return {
      watchId: w.watchId,
      region: c.instanceType.region,
      availabilityZone: az,
      candidateAzs: candidates,
      instanceType: c.instanceType.instanceType,
      price,
      isSpot: false,
    };
  }

  // Spot watch but no pricing data available — no match.
  return null;
}

// Core domain types for lagotto-ts — the capacity-watching model, ported from
// the Go tool's pkg/watcher/types.go. This is the browser-relevant subset: a
// Watch describes what capacity to look for and MatchResult records a hit. The
// persistence, lease, fleet-supervisor, and SageMaker fields of the Go Watch are
// server/daemon concerns and are intentionally omitted from this first cut.

/** What happens when capacity is found. */
export type ActionMode = "notify" | "spawn" | "hold";

/** Lifecycle state of a watch. */
export type WatchStatus =
  | "active" // being polled
  | "matched" // capacity found and the action fired
  | "expired" // TTL elapsed without a match
  | "cancelled" // cancelled by the user
  | "failed"; // hit a terminal error

/**
 * A request to watch for instance-type capacity. `instanceTypePattern` is a glob
 * (`p5.*`) or a regex; `spot` + `maxPrice` narrow to affordable Spot capacity;
 * `availabilityZones` optionally pins/orders eligible AZs (empty = all AZs in the
 * region, in the finder's order). Mirrors the Go Watch, trimmed to the fields the
 * pure matcher needs.
 */
export interface Watch {
  /** Stable id for the watch (the caller supplies it; lagotto-ts holds no store). */
  watchId: string;
  /** Glob (`g5.*`, `p5.*`) or regex describing the wanted instance types. */
  instanceTypePattern: string;
  /** Regions to search. At least one. */
  regions: string[];
  /**
   * Optional AZ pin/order within the region(s). Empty = every AZ. A non-empty
   * list both narrows (only these AZs are eligible) and prioritizes (in order).
   */
  availabilityZones?: string[];
  /** Watch Spot capacity (and price) rather than on-demand availability. */
  spot?: boolean;
  /** Only match at/under this hourly USD price. 0 / undefined = no cap. */
  maxPrice?: number;
  /** What to do on a match. Informational in this cut — actions land later. */
  action?: ActionMode;
}

/** A capacity match: the cheapest eligible offering found for a watch. */
export interface MatchResult {
  watchId: string;
  region: string;
  /** The chosen AZ (CandidateAZs[0]); "" if the source didn't report one. */
  availabilityZone: string;
  /**
   * All AZs (in preference order) where the type was offered this check, so a
   * consumer can retry the next on InsufficientInstanceCapacity. Mirrors the Go
   * MatchResult.CandidateAZs.
   */
  candidateAzs: string[];
  instanceType: string;
  /** Hourly USD — Spot price for a spot match, on-demand price otherwise. */
  price: number;
  isSpot: boolean;
  /** ISO-8601 timestamp the match was observed (set by the watcher). */
  matchedAt?: string;
}

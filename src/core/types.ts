// Core domain types for lagotto-ts — the capacity-watching model, ported from
// the Go tool's pkg/watcher/types.go. This is the browser-relevant subset: a
// Watch describes what capacity to look for and MatchResult records a hit. The
// persistence, lease, and quota-cap bookkeeping fields of the Go Watch are
// server/daemon concerns and are intentionally omitted. The fleet-supervisor
// fields (`desiredCount`, `completionCondition`) are carried so a watch record
// round-trips, but lagotto-ts does not supervise fleets: nothing here launches,
// tops up, or evaluates `--until` on its own.

import type { Service } from "./service.js";

/** What happens when capacity is found. */
export type ActionMode = "notify" | "spawn" | "hold";

/** Lifecycle state of a watch. */
export type WatchStatus =
  | "active" // being polled
  | "matched" // capacity found and the action fired (a single-shot that fired once)
  | "completed" // a fleet watch whose completion condition became true — the work is done
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
  /**
   * Capacity surface. Absent/"" means "ec2" (Go `normalizeService`). lagotto-ts
   * only watches EC2; see `validateWatchPattern`.
   */
  service?: Service;
  /** Fleet watches: how many workers to keep running (Go `DesiredCount`). Carried, not acted on. */
  desiredCount?: number;
  /**
   * Fleet watches: the `--until` condition string (Go `CompletionCondition`),
   * parseable with `parseCondition`. Carried, not evaluated automatically.
   */
  completionCondition?: string;
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
  /**
   * Hourly USD — Spot price for a spot match, on-demand price otherwise.
   *
   * **`undefined` when the source didn't price the type**, which is a real
   * outcome and not an error: truffle-ts 0.5.0 omits the price for types it can't
   * price rather than fabricating one (truffle-ts#39/#42). This was a required
   * `number`, and that type forced the very fabrication we're trying to remove —
   * the matcher had to invent a `0`, and a 0 read as free.
   *
   * A spot match always carries a price (the observation is the reason it
   * matched); only the on-demand branch can leave it absent. Render it as unknown,
   * never as `0`.
   */
  price?: number;
  isSpot: boolean;
  /**
   * The matched type's vCPU count when the source reported it (Go #153) — the
   * authoritative figure EC2 quotas are denominated in. Absent, never 0, when
   * unknown.
   */
  vcpus?: number;
  /** ISO-8601 timestamp the match was observed (set by the watcher). */
  matchedAt?: string;
}

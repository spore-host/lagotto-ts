// Public API surface for lagotto-ts as a library. The default "." entry is the
// PURE, offline, provider-agnostic capacity-watching core — types, the matcher,
// pattern/duration/AZ helpers, and completion conditions. It has no dependency on
// truffle-ts or any AWS SDK, so it's safe in any bundle.
//
// The LIVE capacity watcher (which consumes a truffle-ts finder to hit real AWS)
// lives behind the "@spore-host/lagotto-ts/live" subpath — import it only from
// Node/CLI/server code.
//
//   import { evaluate, wildcardToRegex } from "@spore-host/lagotto-ts";
//   import { CapacityWatcher } from "@spore-host/lagotto-ts/live";
//
// lagotto-ts is a browser-native port of the spore.host `lagotto` tool: watch for
// EC2 instance-type capacity and report when it appears.

/** Library version, matching package.json. */
export const VERSION = "0.1.0";

// Domain types.
export type { Watch, MatchResult, ActionMode, WatchStatus } from "./core/types.js";

// The pure matcher + its candidate shapes.
export { evaluate } from "./core/matcher.js";
export type { MatchCandidate, InstanceOffering, SpotObservation } from "./core/matcher.js";

// Instance-type pattern conversion (glob → regex) + compile helper.
export { wildcardToRegex, compilePattern } from "./core/pattern.js";

// Short-duration parsing ("7d"/"48h"/"1w" → milliseconds).
export { parseDuration } from "./core/duration.js";

// Availability-zone preference handling.
export { azAllowed, orderAZs } from "./core/azs.js";

// Completion conditions (--until): http-200 + s3-empty (shell is intentionally
// not ported — see conditions.ts).
export { parseCondition, HttpCondition, S3EmptyCondition, parseS3Uri } from "./core/conditions.js";
export type { Condition, S3Lister } from "./core/conditions.js";

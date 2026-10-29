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
export const VERSION = "0.2.0";

// Domain types.
export type { Watch, MatchResult, ActionMode, WatchStatus } from "./core/types.js";

// Watch service + pattern validation (Go service.go).
export { isValidService, normalizeService, validateWatchPattern } from "./core/service.js";
export type { Service } from "./core/service.js";

// The pure matcher + its candidate shapes.
export { evaluate } from "./core/matcher.js";
export type { MatchCandidate, InstanceOffering, SpotObservation } from "./core/matcher.js";

// Instance-type pattern conversion (glob → regex) + compile helper.
// Comma-separated lists are OR'd (Go #135).
export { wildcardToRegex, patternToRegex, splitInstanceTypePatterns, compilePattern } from "./core/pattern.js";

// Short-duration parsing ("7d"/"48h"/"1w" → milliseconds).
export { parseDuration } from "./core/duration.js";
// Go time.ParseDuration ("1h30m", "1.5h"), and Go parseTTL (that, then the short form).
export { parseGoDuration } from "./core/go-duration.js";

// Scheduled-launch expressions for EventBridge Scheduler (Go schedule_expr.go).
export { scheduleExpression, parseTTL } from "./core/schedule.js";
export type { ScheduleInput, ScheduleExpressionResult } from "./core/schedule.js";

// Syntactic webhook URL vetting — NOT an SSRF guard (no DNS in a browser); see webhook.ts.
export { validateWebhookURLSyntax } from "./core/webhook.js";

// Availability-zone preference handling.
export { azAllowed, orderAZs } from "./core/azs.js";

// Completion conditions (--until): http-200 + s3-empty (shell is intentionally
// not ported — see conditions.ts).
export { parseCondition, HttpCondition, S3EmptyCondition, parseS3Uri } from "./core/conditions.js";
export type { Condition, S3Lister } from "./core/conditions.js";

// Launch-failure classification (Go pkg/failure): capacity / terminal / unknown.
export {
  classifyFailure,
  isQuotaExceeded,
  failureLabel,
  MAX_CONSECUTIVE_FAILURES,
  CAPACITY_ERROR_CODES,
  QUOTA_ERROR_CODES,
  TERMINAL_ERROR_CODES,
} from "./core/failure.js";
export type { FailureKind, ClassifyOptions } from "./core/failure.js";

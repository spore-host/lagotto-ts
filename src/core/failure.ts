// Launch-failure classification — port of Go lagotto pkg/failure/failure.go
// (v0.64.1). Answers the question lagotto exists to answer: "this launch failed —
// is that capacity, or is it broken?" Pure and SDK-free, like the Go leaf it
// ports (lagotto#75): errors are inspected structurally, so a consumer passes
// whatever `@aws-sdk/*` threw without lagotto-ts importing the SDK.
//
// The taxonomy (lagotto#41) is three-way on purpose. Two-way (retry / don't) is
// wrong in both directions: a real capacity wait must not be capped, and a
// persistently broken watch must not burn a launch attempt every poll for its
// whole TTL.
//
// Divergences from Go, each forced by the platform:
// - Go matches spawn's `launchererr.ErrPostLaunch` sentinel. spawn-ts has no such
//   sentinel, so a post-launch teardown is a caller-supplied hint
//   (`{ postLaunch: true }`) rather than an invented error class.
// - Go treats `*json.SyntaxError` and `*json.UnmarshalTypeError` as terminal. JS
//   has only the first (`JSON.parse` throws `SyntaxError`); `JSON.parse` does no
//   type checking, so there is no unmarshal-type error to recognise.

/** Why a launch/hold attempt failed, which decides retry vs stop. */
export type FailureKind =
  /** No failure. */
  | "none"
  /**
   * AWS had no capacity for the type/AZ right now. The launch IS the capacity
   * test (no read-only API reports this), so the watch retries — uncapped, since
   * a watch may legitimately wait out scarce capacity for days.
   */
  | "capacity"
  /**
   * The attempt can never succeed as configured (bad AMI/IAM, exhausted quota,
   * malformed request). Retrying wastes poll cycles, so the watch stops.
   */
  | "terminal"
  /**
   * Unrecognised but plausibly transient (an unlisted AWS code, a network blip).
   * Retried like capacity, but counted toward `MAX_CONSECUTIVE_FAILURES` so a
   * persistently broken watch stops after a bounded number of polls.
   */
  | "unknown";

/**
 * Consecutive `unknown` failures after which a watch is stopped as failed (Go
 * `watcher.MaxConsecutiveFailures`, lagotto#41). Capacity failures never count.
 */
export const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * AWS error codes for a transient lack of capacity — the one thing worth
 * retrying. Verbatim from Go `capacityErrorCodes`.
 */
export const CAPACITY_ERROR_CODES: ReadonlySet<string> = new Set([
  "InsufficientInstanceCapacity", // RunInstances / CreateCapacityReservation, On-Demand & Spot
  "InsufficientHostCapacity", // Dedicated Hosts
  "InsufficientReservedInstanceCapacity",
  "InsufficientCapacity",
  "Server.InsufficientInstanceCapacity", // sometimes server-namespaced
  "SpotMaxPriceTooLow", // spot bid below market — clears when price drops
]);

/**
 * AWS error codes for an exhausted account quota (Go `quotaErrorCodes`, #116).
 * They classify as `terminal` — waiting never raises a quota; the user must
 * request an increase — but `isQuotaExceeded` can tell them apart from the rest
 * of the terminal bucket. Listed once: not repeated in TERMINAL_ERROR_CODES.
 */
export const QUOTA_ERROR_CODES: ReadonlySet<string> = new Set([
  "InstanceLimitExceeded", // On-Demand vCPU/instance quota
  "VcpuLimitExceeded",
  "MaxSpotInstanceCountExceeded", // Spot quota
]);

/**
 * AWS error codes that will never resolve by waiting, EXCLUDING the quota codes.
 * Verbatim from Go `terminalErrorCodes`, including the pre-launch config/setup
 * codes (SSM AMI resolution, IAM) added in lagotto#105.
 */
export const TERMINAL_ERROR_CODES: ReadonlySet<string> = new Set([
  "InvalidAMIID.NotFound",
  "InvalidAMIID.Malformed",
  "UnauthorizedOperation",
  "AuthFailure",
  "InvalidParameterValue",
  "InvalidParameterCombination",
  "InvalidSubnetID.NotFound",
  "InvalidGroup.NotFound",
  "Unsupported", // type not supported in this AZ/config
  "ParameterNotFound",
  "AccessDenied",
  "AccessDeniedException",
  "ValidationError",
  "ValidationException",
]);

/** Short human label for a failure kind (Go `failure.Label`), verbatim. */
export function failureLabel(k: FailureKind): string {
  switch (k) {
    case "capacity":
      return "capacity, will retry";
    case "terminal":
      return "terminal, stopping watch";
    case "unknown":
      return "unknown, will retry (capped)";
    default:
      return "none";
  }
}

export interface ClassifyOptions {
  /**
   * The failure happened AFTER the instance launched (e.g. a post-launch setup
   * step failed and the launcher tore the instance down). Capacity existed, so
   * retrying other AZs only churns launch+terminate cycles: terminal. The
   * analogue of Go's `errors.Is(err, launchererr.ErrPostLaunch)` (spawn#220).
   */
  postLaunch?: boolean;
}

/**
 * Classify a launch/hold error into a retry decision (Go `ClassifyFailure`).
 *
 * - `null`/`undefined` → `none`.
 * - `postLaunch` hint → `terminal`.
 * - An AWS service error (an `@aws-sdk/*` exception — recognised by its
 *   `$metadata`/`$fault` fields — anywhere in the `cause`/`errors` chain, the
 *   analogue of Go's `errors.As(err, &smithy.APIError)`): a capacity code →
 *   `capacity`; a quota or terminal code → `terminal`; a code CONTAINING
 *   `InsufficientInstanceCapacity`/`InsufficientCapacity` → `capacity`;
 *   anything else → `unknown`.
 * - A `SyntaxError` (a malformed stored config, deterministic) → `terminal`.
 * - A message carrying a specific "insufficient capacity" phrasing, for a
 *   capacity error flattened to text somewhere in wrapping (lagotto#140) →
 *   `capacity`. The bare word "capacity" does not count.
 * - Everything else → `unknown`.
 */
export function classifyFailure(err: unknown, opts: ClassifyOptions = {}): FailureKind {
  if (err === null || err === undefined) return "none";
  if (opts.postLaunch) return "terminal";

  const code = awsErrorCode(err);
  if (code !== undefined) {
    if (CAPACITY_ERROR_CODES.has(code)) return "capacity";
    if (QUOTA_ERROR_CODES.has(code) || TERMINAL_ERROR_CODES.has(code)) return "terminal";
    // Substring fallback for code variants AWS may namespace differently.
    if (code.includes("InsufficientInstanceCapacity") || code.includes("InsufficientCapacity")) {
      return "capacity";
    }
    return "unknown";
  }

  if (findInChain(err, (e) => e instanceof SyntaxError) !== undefined) return "terminal";

  if (messageLooksLikeCapacity(errorText(err))) return "capacity";

  return "unknown";
}

/**
 * Whether `err` is specifically an exhausted account quota (Go
 * `IsQuotaExceeded`, #116) — finer-grained than `terminal`, which also covers a
 * bad AMI or an IAM denial. Purely additive: a quota error still classifies as
 * `terminal`.
 */
export function isQuotaExceeded(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const code = awsErrorCode(err);
  return code !== undefined && QUOTA_ERROR_CODES.has(code);
}

/** Lower-cased capacity phrasings (Go `messageLooksLikeCapacity`), verbatim. */
const CAPACITY_PHRASES = [
  "insufficientinstancecapacity",
  "insufficienthostcapacity",
  "insufficientreservedinstancecapacity",
  "insufficientcapacity",
  "insufficient capacity",
  "insufficient instance capacity",
];

function messageLooksLikeCapacity(msg: string): boolean {
  const m = msg.toLowerCase();
  return CAPACITY_PHRASES.some((s) => m.includes(s));
}

/** Is `e` shaped like an AWS SDK v3 service exception? */
function isAwsServiceError(e: unknown): e is { name?: unknown; Code?: unknown } {
  if (typeof e !== "object" || e === null) return false;
  const o = e as { $metadata?: unknown; $fault?: unknown };
  return (typeof o.$metadata === "object" && o.$metadata !== null) || typeof o.$fault === "string";
}

/** The error code of the first AWS service error in the chain, if any. */
function awsErrorCode(err: unknown): string | undefined {
  const e = findInChain(err, isAwsServiceError) as { name?: unknown; Code?: unknown } | undefined;
  if (e === undefined) return undefined;
  if (typeof e.Code === "string" && e.Code !== "") return e.Code;
  return typeof e.name === "string" ? e.name : "";
}

/**
 * Depth-first search of an error and what it wraps (`cause`, and an
 * `AggregateError`'s `errors`) — the analogue of Go's errors.As walking `%w`
 * and errors.Join chains. Cycle-safe.
 */
function findInChain(err: unknown, pred: (e: unknown) => boolean): unknown {
  const seen = new Set<unknown>();
  const stack: unknown[] = [err];
  while (stack.length > 0) {
    const e = stack.pop();
    if (e === null || e === undefined || seen.has(e)) continue;
    seen.add(e);
    if (pred(e)) return e;
    if (typeof e === "object") {
      const o = e as { cause?: unknown; errors?: unknown };
      // Push in reverse so `cause` is visited before `errors`, and errors[0] first.
      if (Array.isArray(o.errors)) for (let i = o.errors.length - 1; i >= 0; i--) stack.push(o.errors[i]);
      if (o.cause !== undefined) stack.push(o.cause);
    }
  }
  return undefined;
}

/** The text Go's `err.Error()` would show: the message plus wrapped messages. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  findInChain(err, (e) => {
    parts.push(e instanceof Error ? e.message : String(e));
    return false;
  });
  return parts.join(": ");
}

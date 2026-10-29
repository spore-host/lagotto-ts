// Cases ported verbatim from Go lagotto pkg/failure/failure_test.go (v0.64.1),
// so the two classifiers cannot drift. Go's `&apiErr{code}` (a smithy.APIError)
// becomes `awsErr(code)`, shaped like an @aws-sdk v3 ServiceException.
import { describe, it, expect } from "vitest";
import {
  CAPACITY_ERROR_CODES,
  MAX_CONSECUTIVE_FAILURES,
  QUOTA_ERROR_CODES,
  TERMINAL_ERROR_CODES,
  classifyFailure,
  failureLabel,
  isQuotaExceeded,
  type FailureKind,
} from "./failure.js";

/** An @aws-sdk/* service exception: `name` is the code, plus $fault/$metadata. */
function awsErr(code: string): Error {
  return Object.assign(new Error(code), { name: code, $fault: "server", $metadata: { httpStatusCode: 400 } });
}

/** A real SyntaxError as produced by parsing malformed JSON. */
function jsonSyntaxErr(): Error {
  try {
    JSON.parse("{not valid json");
  } catch (e) {
    return e as Error;
  }
  throw new Error("JSON.parse unexpectedly succeeded");
}

describe("classifyFailure (Go TestClassifyFailure)", () => {
  const cases: [string, unknown, FailureKind, { postLaunch?: boolean }?][] = [
    ["nil", null, "none"],
    ["insufficient capacity", awsErr("InsufficientInstanceCapacity"), "capacity"],
    ["spot price too low", awsErr("SpotMaxPriceTooLow"), "capacity"],
    ["namespaced capacity", awsErr("Server.InsufficientInstanceCapacity"), "capacity"],
    ["instance limit (quota)", awsErr("InstanceLimitExceeded"), "terminal"],
    ["spot quota", awsErr("MaxSpotInstanceCountExceeded"), "terminal"],
    ["bad ami", awsErr("InvalidAMIID.NotFound"), "terminal"],
    ["unauthorized", awsErr("UnauthorizedOperation"), "terminal"],
    ["unsupported type", awsErr("Unsupported"), "terminal"],
    // #105: config/setup errors surfaced by a pre-launch step.
    ["missing ssm param", awsErr("ParameterNotFound"), "terminal"],
    ["access denied", awsErr("AccessDenied"), "terminal"],
    ["access denied exception", awsErr("AccessDeniedException"), "terminal"],
    ["validation error", awsErr("ValidationError"), "terminal"],
    ["validation exception", awsErr("ValidationException"), "terminal"],
    // #41: an unlisted AWS code and a plain non-AWS blip are retryable but capped.
    ["unknown aws code", awsErr("SomeNewErrorCode"), "unknown"],
    ["capacity substring", awsErr("FooInsufficientCapacityBar"), "capacity"],
    ["plain error", new Error("dial tcp: timeout"), "unknown"],
    // #41: deterministic serialization errors — terminal, bare and wrapped.
    ["json syntax error", jsonSyntaxErr(), "terminal"],
    // (Go's "json unmarshal type error" case has no JS analogue: JSON.parse does
    // no type checking, so there is no such error to produce.)
    ["json syntax wrapped", new Error("unmarshal spawn config", { cause: jsonSyntaxErr() }), "terminal"],
    // spawn#354: Go matches the post-launch sentinel; lagotto-ts takes a hint.
    ["post-launch sentinel", new Error("post-launch provisioning failure"), "terminal", { postLaunch: true }],
    [
      "post-launch wrapped",
      new Error("launch instance (tried 1 AZ)", { cause: new Error("post-launch provisioning failure") }),
      "terminal",
      { postLaunch: true },
    ],
    // #140: a capacity failure flattened to text in wrapping is still capacity;
    // the generic word "capacity" is not.
    [
      "flattened capacity (non-smithy)",
      new Error("provision: launch: failed to launch instance: InsufficientInstanceCapacity: Insufficient capacity."),
      "capacity",
    ],
    ["flattened capacity phrase", new Error("launch instance (tried 3 AZ(s)): insufficient capacity"), "capacity"],
    ["generic 'capacity' word not matched", new Error("volume capacity 100 GiB exceeds limit"), "unknown"],
  ];
  for (const [name, err, want, opts] of cases) {
    it(name, () => {
      expect(classifyFailure(err, opts)).toBe(want);
    });
  }
});

describe("classifyFailure — TS-specific shapes", () => {
  it("undefined is none", () => {
    expect(classifyFailure(undefined)).toBe("none");
  });

  it("finds an AWS error wrapped in a cause chain (errors.As through %w)", () => {
    const wrapped = new Error("launch instance", { cause: new Error("provision", { cause: awsErr("VcpuLimitExceeded") }) });
    expect(classifyFailure(wrapped)).toBe("terminal");
    expect(isQuotaExceeded(wrapped)).toBe(true);
  });

  it("finds an AWS error inside an AggregateError (errors.Join)", () => {
    const agg = new AggregateError([new Error("dial tcp"), awsErr("InsufficientInstanceCapacity")], "all AZs failed");
    expect(classifyFailure(agg)).toBe("capacity");
  });

  it("prefers an explicit Code field over name", () => {
    const e = Object.assign(new Error("x"), { name: "EC2ServiceException", Code: "InvalidAMIID.Malformed", $metadata: {} });
    expect(classifyFailure(e)).toBe("terminal");
  });

  it("does not treat a plain Error's name as an AWS code", () => {
    // A plain Error named like an AWS code is not an APIError in Go either.
    const e = Object.assign(new Error("boom"), { name: "AccessDenied" });
    expect(classifyFailure(e)).toBe("unknown");
  });

  it("an AWS error with an unlisted code is unknown even if its message says capacity", () => {
    // Go only applies the raw-message fallback when no APIError was found.
    const e = Object.assign(awsErr("SomeNewErrorCode"), { message: "insufficient capacity" });
    expect(classifyFailure(e)).toBe("unknown");
  });

  it("is cycle-safe", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(classifyFailure(a)).toBe("unknown");
  });
});

describe("isQuotaExceeded (Go TestIsQuotaExceeded)", () => {
  const cases: [string, unknown, boolean][] = [
    ["nil", null, false],
    ["instance limit (on-demand quota)", awsErr("InstanceLimitExceeded"), true],
    ["vcpu limit (on-demand quota)", awsErr("VcpuLimitExceeded"), true],
    ["spot quota", awsErr("MaxSpotInstanceCountExceeded"), true],
    ["bad ami (terminal, not quota)", awsErr("InvalidAMIID.NotFound"), false],
    ["unauthorized (terminal, not quota)", awsErr("UnauthorizedOperation"), false],
    ["missing ssm param (terminal, not quota)", awsErr("ParameterNotFound"), false],
    ["access denied (terminal, not quota)", awsErr("AccessDenied"), false],
    ["insufficient capacity (not terminal at all)", awsErr("InsufficientInstanceCapacity"), false],
    ["unknown aws code", awsErr("SomeNewErrorCode"), false],
    ["plain non-AWS error", new Error("dial tcp: timeout"), false],
  ];
  for (const [name, err, want] of cases) {
    it(name, () => {
      expect(isQuotaExceeded(err)).toBe(want);
    });
  }
});

describe("Go TestIsQuotaExceeded_StillClassifiesTerminal", () => {
  for (const code of ["InstanceLimitExceeded", "VcpuLimitExceeded", "MaxSpotInstanceCountExceeded"]) {
    it(code, () => {
      expect(classifyFailure(awsErr(code))).toBe("terminal");
      expect(isQuotaExceeded(awsErr(code))).toBe(true);
    });
  }
});

describe("code tables", () => {
  // Every code in every table is its own assertion, so a code dropped from (or
  // moved between) tables fails here even if no named case above covers it.
  for (const code of CAPACITY_ERROR_CODES) it(`capacity: ${code}`, () => expect(classifyFailure(awsErr(code))).toBe("capacity"));
  for (const code of QUOTA_ERROR_CODES) it(`quota→terminal: ${code}`, () => expect(classifyFailure(awsErr(code))).toBe("terminal"));
  for (const code of TERMINAL_ERROR_CODES) {
    it(`terminal: ${code}`, () => {
      expect(classifyFailure(awsErr(code))).toBe("terminal");
      expect(isQuotaExceeded(awsErr(code))).toBe(false);
    });
  }

  it("matches Go's tables exactly (sizes + no double-listing)", () => {
    expect([...CAPACITY_ERROR_CODES]).toEqual([
      "InsufficientInstanceCapacity",
      "InsufficientHostCapacity",
      "InsufficientReservedInstanceCapacity",
      "InsufficientCapacity",
      "Server.InsufficientInstanceCapacity",
      "SpotMaxPriceTooLow",
    ]);
    expect([...QUOTA_ERROR_CODES]).toEqual(["InstanceLimitExceeded", "VcpuLimitExceeded", "MaxSpotInstanceCountExceeded"]);
    expect(TERMINAL_ERROR_CODES.size).toBe(14);
    for (const q of QUOTA_ERROR_CODES) expect(TERMINAL_ERROR_CODES.has(q)).toBe(false);
  });

  it("MAX_CONSECUTIVE_FAILURES is Go's 10", () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBe(10);
  });
});

describe("failureLabel (Go TestLabel)", () => {
  const cases: Record<FailureKind, string> = {
    none: "none",
    capacity: "capacity, will retry",
    terminal: "terminal, stopping watch",
    unknown: "unknown, will retry (capped)",
  };
  for (const [k, want] of Object.entries(cases)) {
    it(k, () => expect(failureLabel(k as FailureKind)).toBe(want));
  }
});

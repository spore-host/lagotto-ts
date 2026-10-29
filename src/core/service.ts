// Watch service + pattern validation — port of Go lagotto
// pkg/watcher/service.go (v0.64.1). The guard that stops an `ml.g5.2xlarge`
// watch being pointed at the EC2 offerings API, where it would never match and
// never say why.
//
// lagotto-ts watches EC2 only; SageMaker capacity watching is out of scope (it
// works by submitting the user's training job, a server-side action). The
// `sagemaker` value is still modelled so a watch record written by the Go tool
// validates the same way here.

import { splitInstanceTypePatterns } from "./pattern.js";

/** Which AWS capacity surface a watch targets (Go `Service`). */
export type Service = "ec2" | "sagemaker";

/** Whether `s` is a recognised service. Case-sensitive; "" is not valid (Go `Service.Valid`). */
export function isValidService(s: string): s is Service {
  return s === "ec2" || s === "sagemaker";
}

/** The effective service: empty/absent → "ec2", for watches written before the field existed. */
export function normalizeService(s: string | undefined): string {
  return s === undefined || s === "" ? "ec2" : s;
}

/**
 * Check a pattern is well-formed for the service (Go `ValidateWatchPattern`).
 * The pattern may be a comma-separated list (#135); EVERY sub-pattern must
 * satisfy the rule: SageMaker patterns must start with `ml.`, EC2 patterns must
 * not. Throws on an empty (or all-blank) pattern or a violating sub-pattern.
 */
export function validateWatchPattern(service: string | undefined, pattern: string): void {
  const subs = splitInstanceTypePatterns(pattern);
  if (subs.length === 0) throw new Error("instance type pattern must not be empty");
  const svc = normalizeService(service);
  for (const p of subs) {
    if (svc === "sagemaker" && !p.startsWith("ml.")) {
      throw new Error(`SageMaker pattern ${JSON.stringify(p)} must start with "ml." (e.g. ml.g5.2xlarge)`);
    }
    if (svc === "ec2" && p.startsWith("ml.")) {
      throw new Error(
        `EC2 pattern ${JSON.stringify(p)} must not start with "ml."; use --service sagemaker for SageMaker types`,
      );
    }
  }
}

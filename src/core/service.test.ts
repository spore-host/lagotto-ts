// Cases verbatim from Go lagotto pkg/watcher/service_test.go (v0.64.1).
import { describe, it, expect } from "vitest";
import { isValidService, normalizeService, validateWatchPattern } from "./service.js";

describe("isValidService (Go TestService_Valid)", () => {
  const cases: [string, boolean][] = [
    ["ec2", true],
    ["sagemaker", true],
    ["", false],
    ["lambda", false],
    ["EC2", false], // case-sensitive
  ];
  for (const [svc, want] of cases) it(JSON.stringify(svc), () => expect(isValidService(svc)).toBe(want));
});

describe("normalizeService", () => {
  it("defaults empty/absent to ec2", () => {
    expect(normalizeService("")).toBe("ec2");
    expect(normalizeService(undefined)).toBe("ec2");
    expect(normalizeService("sagemaker")).toBe("sagemaker");
  });
});

describe("validateWatchPattern (Go TestValidateWatchPattern)", () => {
  const cases: [string, string, string, boolean][] = [
    ["ec2 plain", "ec2", "g5.2xlarge", false],
    ["ec2 wildcard", "ec2", "g5.*", false],
    ["ec2 rejects ml prefix", "ec2", "ml.g5.2xlarge", true],
    ["sagemaker ml type", "sagemaker", "ml.g5.2xlarge", false],
    ["sagemaker wildcard", "sagemaker", "ml.g5.*", false],
    ["sagemaker rejects bare type", "sagemaker", "g5.2xlarge", true],
    ["empty pattern", "ec2", "", true],
    ["whitespace-only pattern", "ec2", "  ,  ", true],
    ["default service treats as ec2", "", "g5.2xlarge", false],
    ["ec2 comma-list ok", "ec2", "g6.8xlarge,g6.4xlarge,g6.2xlarge", false],
    ["ec2 comma-list with spaces ok", "ec2", " g6.4xlarge , g6.2xlarge ", false],
    ["ec2 comma-list rejects ml rung", "ec2", "g6.4xlarge,ml.g5.2xlarge", true],
    ["sagemaker comma-list ok", "sagemaker", "ml.g5.2xlarge,ml.p4d.24xlarge", false],
    ["sagemaker comma-list rejects bare rung", "sagemaker", "ml.g5.2xlarge,g6.2xlarge", true],
  ];
  for (const [name, svc, pattern, wantErr] of cases) {
    it(name, () => {
      if (wantErr) expect(() => validateWatchPattern(svc, pattern)).toThrow();
      else expect(() => validateWatchPattern(svc, pattern)).not.toThrow();
    });
  }

  it("names the offending rung, with Go's message", () => {
    expect(() => validateWatchPattern("ec2", "g6.4xlarge,ml.g5.2xlarge")).toThrow(
      'EC2 pattern "ml.g5.2xlarge" must not start with "ml."; use --service sagemaker for SageMaker types',
    );
    expect(() => validateWatchPattern("ec2", " , ")).toThrow("instance type pattern must not be empty");
  });
});

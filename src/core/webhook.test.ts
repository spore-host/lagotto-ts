// Cases from Go lagotto pkg/watcher/validation_test.go (v0.64.1). Go resolves
// hostnames; a browser cannot, so the cases that depend on DNS are marked and
// mapped to their nearest syntactic equivalent rather than silently dropped.
import { describe, it, expect } from "vitest";
import { validateWebhookURLSyntax } from "./webhook.js";

const ok = (u: string) => expect(() => validateWebhookURLSyntax(u)).not.toThrow();
const bad = (u: string, re?: RegExp) => expect(() => validateWebhookURLSyntax(u)).toThrow(re);

describe("validateWebhookURLSyntax (Go TestValidateWebhookURL_*)", () => {
  it("AcceptsHTTPS", () => {
    ok("https://example.com/webhook");
    ok("https://example.com:8443/notify/abc123");
  });

  it("RejectsUnresolvableHost — only for the reserved .invalid TLD (no DNS in a browser)", () => {
    bad("https://nonexistent.invalid/webhook", /could not be resolved/);
  });

  it("RejectsHTTP", () => bad("http://example.com/webhook", /must use HTTPS \(got "http"\)/));

  it("RejectsMetadataService", () => {
    for (const u of [
      "https://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "https://169.254.169.254:80/foo",
      "https://169.254.0.1/anything",
    ]) bad(u, /link-local/);
  });

  it("RejectsLoopback (localhost by name: RFC 6761, Go gets it from DNS)", () => {
    for (const u of ["https://127.0.0.1/admin", "https://localhost/admin", "https://[::1]/admin"]) bad(u, /loopback/);
  });

  it("RejectsPrivateRanges", () => {
    for (const u of ["https://10.0.0.1/internal", "https://172.16.0.1/internal", "https://192.168.1.1/internal"]) bad(u, /private/);
  });

  it("RejectsNoScheme", () => bad("example.com/webhook"));

  it("RejectsEmptyHost (WHATWG would read host 'webhook')", () => bad("https:///webhook", /must have a host/));
});

describe("validateWebhookURLSyntax — literal-IP edges (Go net.IP predicates)", () => {
  it("catches obfuscated IPv4 forms the WHATWG parser normalises", () => {
    bad("https://2130706433/", /loopback/); // 127.0.0.1
    bad("https://0x7f.1/", /loopback/);
    bad("https://0251.0376.0251.0376/", /link-local/); // 169.254.169.254 in octal
  });

  it("treats IPv4-mapped IPv6 as IPv4, like Go", () => {
    bad("https://[::ffff:127.0.0.1]/", /loopback/);
    bad("https://[::ffff:10.1.2.3]/", /private/);
    bad("https://[::ffff:169.254.169.254]/", /link-local/);
  });

  it("covers the IPv6 ranges", () => {
    bad("https://[fd00::1]/", /private/);
    bad("https://[fe80::1]/", /link-local/);
    bad("https://[ff02::1]/", /link-local/);
    bad("https://[::]/", /unspecified/);
    ok("https://[2606:4700:4700::1111]/");
  });

  it("covers the remaining IPv4 ranges and their edges", () => {
    bad("https://0.0.0.0/", /unspecified/);
    bad("https://224.0.0.251/", /link-local/);
    bad("https://172.31.255.255/", /private/);
    ok("https://172.32.0.1/");
    ok("https://172.15.0.1/");
    ok("https://8.8.8.8/");
    ok("https://0.0.0.1/");
  });

  it("rejects *.localhost and a trailing-dot localhost", () => {
    bad("https://api.localhost/", /loopback/);
    bad("https://localhost./", /loopback/);
  });

  it("does NOT (cannot) catch a name that resolves to a private address", () => {
    // Documented gap: Go resolves and rejects; a browser has no DNS API.
    ok("https://internal.example.com/");
  });
});

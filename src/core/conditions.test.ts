import { describe, it, expect, vi, afterEach } from "vitest";
import { parseCondition, HttpCondition, S3EmptyCondition, parseS3Uri, type S3Lister } from "./conditions.js";

describe("parseCondition", () => {
  it("parses http-200", () => {
    const c = parseCondition("http-200: https://example.com/done");
    expect(c).toBeInstanceOf(HttpCondition);
    expect(c.spec).toBe("http-200: https://example.com/done");
  });

  it("parses s3-empty with a lister", () => {
    const lister: S3Lister = { countObjects: async () => 0 };
    const c = parseCondition("s3-empty: s3://b/wanted minus s3://b/done/", lister);
    expect(c).toBeInstanceOf(S3EmptyCondition);
  });

  it("rejects a spec without a colon", () => {
    expect(() => parseCondition("nope")).toThrow(/want '<kind>: <arg>'/);
  });

  it("rejects a missing argument", () => {
    expect(() => parseCondition("http-200:   ")).toThrow(/missing argument/);
  });

  it("rejects an unknown kind", () => {
    expect(() => parseCondition("shell: rm -rf /")).toThrow(/unknown kind/);
  });

  it("rejects s3-empty without a lister", () => {
    expect(() => parseCondition("s3-empty: s3://b/w minus s3://b/d")).toThrow(/needs an S3 lister/);
  });

  it("rejects a malformed s3-empty spec (no ' minus ')", () => {
    const lister: S3Lister = { countObjects: async () => 0 };
    expect(() => parseCondition("s3-empty: s3://b/only", lister)).toThrow(/want 's3:\/\/…\/wanted minus/);
  });
});

describe("parseS3Uri", () => {
  it("splits bucket and key", () => {
    expect(parseS3Uri("s3://bucket/some/prefix", "ctx")).toEqual(["bucket", "some/prefix"]);
  });
  it("allows a bucket-root prefix", () => {
    expect(parseS3Uri("s3://bucket", "ctx")).toEqual(["bucket", ""]);
  });
  it("rejects a non-s3 URI", () => {
    expect(() => parseS3Uri("http://x", "ctx")).toThrow(/want s3:\/\/bucket\/key/);
  });
  it("rejects a missing bucket", () => {
    expect(() => parseS3Uri("s3:///key", "ctx")).toThrow(/missing bucket/);
  });
});

describe("S3EmptyCondition.done", () => {
  it("is done when done-count >= wanted-count", async () => {
    const counts: Record<string, number> = { "b/wanted": 3, "b/done/": 3 };
    const lister: S3Lister = { countObjects: async (bkt, pfx) => counts[`${bkt}/${pfx}`] ?? 0 };
    const c = new S3EmptyCondition("spec", lister, "b", "wanted", "b", "done/");
    expect(await c.done()).toBe(true);
  });
  it("is not done when items remain", async () => {
    const counts: Record<string, number> = { "b/wanted": 5, "b/done/": 2 };
    const lister: S3Lister = { countObjects: async (bkt, pfx) => counts[`${bkt}/${pfx}`] ?? 0 };
    const c = new S3EmptyCondition("spec", lister, "b", "wanted", "b", "done/");
    expect(await c.done()).toBe(false);
  });
});

describe("HttpCondition.done", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is done on a 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const c = new HttpCondition("spec", "https://x/done");
    expect(await c.done()).toBe(true);
  });
  it("is not done on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const c = new HttpCondition("spec", "https://x/done");
    expect(await c.done()).toBe(false);
  });
});

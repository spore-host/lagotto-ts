import { describe, it, expect } from "vitest";
import { azAllowed, orderAZs } from "./azs.js";

describe("azAllowed", () => {
  it("allows any AZ when the preference is empty", () => {
    expect(azAllowed("us-east-1a", [])).toBe(true);
    expect(azAllowed("us-east-1a", undefined)).toBe(true);
  });
  it("allows an empty AZ regardless of preference", () => {
    expect(azAllowed("", ["us-east-1a"])).toBe(true);
  });
  it("allows only AZs in the preference", () => {
    expect(azAllowed("us-east-1a", ["us-east-1a", "us-east-1b"])).toBe(true);
    expect(azAllowed("us-east-1c", ["us-east-1a", "us-east-1b"])).toBe(false);
  });
});

describe("orderAZs", () => {
  it("returns offered unchanged when preference is empty", () => {
    expect(orderAZs(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
    expect(orderAZs(["a", "b"], undefined)).toEqual(["a", "b"]);
  });
  it("filters + orders offered by the preference", () => {
    expect(orderAZs(["a", "b", "c"], ["c", "a"])).toEqual(["c", "a"]);
  });
  it("drops preferred AZs that aren't offered", () => {
    expect(orderAZs(["a", "b"], ["c", "a", "z"])).toEqual(["a"]);
  });
  it("returns empty when no preferred AZ is offered", () => {
    expect(orderAZs(["a", "b"], ["x", "y"])).toEqual([]);
  });
});

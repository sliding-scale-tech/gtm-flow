import { describe, expect, it } from "vitest";
import { domainSearchAllowed, precheckRejects } from "./precheck";

describe("precheckRejects", () => {
  it("rejects confident non-ICP segments only", () => {
    expect(precheckRejects("vacation", 0.9, 0.85)).toBe(true);
    expect(precheckRejects("vacation", 0.85, 0.85)).toBe(true);
    expect(precheckRejects("vacation", 0.8, 0.85)).toBe(false);
    expect(precheckRejects("residential", 0.99, 0.85)).toBe(false);
    expect(precheckRejects("hoa", 0.99, 0.85)).toBe(false);
    expect(precheckRejects("commercial", 0.99, 0.85)).toBe(false);
  });
});

describe("domainSearchAllowed", () => {
  const list = ["property management", "hoa"];
  it("matches case-insensitive substrings", () => {
    expect(domainSearchAllowed("Property management company", list)).toBe(true);
    expect(domainSearchAllowed("Real estate agency", list)).toBe(false);
    expect(domainSearchAllowed("", list)).toBe(false);
  });
});

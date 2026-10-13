import { describe, expect, it } from "vitest";
import { quotaError } from "./quota";

describe("quotaError", () => {
  it("detects the Gemini spending cap", () => {
    expect(quotaError("429 Your project has exceeded its monthly spending cap")).toMatch(/^Gemini spending cap reached/);
  });
  it("detects Exa credit exhaustion", () => {
    expect(quotaError("You have exceeded your credits limit")).toMatch(/^Exa credits used up/);
    expect(quotaError("exa HTTP 402")).toMatch(/^Exa credits used up/);
  });
  it("ignores other errors", () => {
    expect(quotaError("fetch failed")).toBeNull();
    expect(quotaError("GEMINI_API_KEY is not set on the Convex deployment")).toBeNull();
  });
});

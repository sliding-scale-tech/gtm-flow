import { describe, expect, it } from "vitest";
import { cleanRow } from "./rules";
import { DEFAULT_SETTINGS } from "../defaults";

const S = DEFAULT_SETTINGS;
describe("rules: new deny categories", () => {
  it.each([
    "Vacation home rental agency", "Apartment rental agency", "Property maintenance", "Equipment rental agency",
    "County government office", "Housing development", "Lodging", "Tax assessor", "Legal services", "Forestry service",
    "Property investment company", "Condominium rental agency",
  ])("rejects %s", (category) => {
    expect(cleanRow({ name: "Acme Co", category }, S)).toEqual({ ok: false, reason: `category:${category}` });
  });
  it("rejects names containing vacation", () => {
    expect(cleanRow({ name: "Smoky Mtn VACATION Rentals", category: "Property management company" }, S))
      .toEqual({ ok: false, reason: "category:Property management company" });
  });
  it("still passes ABC Property Management", () => {
    expect(cleanRow({ name: "ABC Property Management", category: "Property management company" }, S))
      .toEqual({ ok: true, likelyIcp: true, isBuilding: false });
  });
});

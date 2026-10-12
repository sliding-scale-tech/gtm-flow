import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CsvStream, parseCsv, toCsv } from "./csv";
import { cleanRow, failedGates } from "./rules";
import { clip, normalizeCompany, parseReviews, rootDomain, isBadHost, splitName } from "./text";
import { DEFAULT_SETTINGS } from "../defaults";

describe("csv", () => {
  it("parses WV.csv sample (quoted reviews with commas)", () => {
    const rows = parseCsv(readFileSync(new URL("../../WV.csv", import.meta.url), "utf8"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Lane Property Management LLC");
    expect(rows[0].category).toBe("Waste management service");
    expect(rows[0].allReviews).toContain("Best company for trash pickup");
    expect(rows[0].times_seen).toBe("4");
  });
  it("handles escaped quotes, CRLF and embedded newlines", () => {
    const rows = parseCsv('a,b\r\n"x ""y""","line1\nline2"\r\n');
    expect(rows).toEqual([{ a: 'x "y"', b: "line1\nline2" }]);
  });
  it("streaming gives identical rows for every chunk split point", () => {
    const text = 'a,b,c\r\n"x ""q"", y","l1\r\nl2",3\n"",z,\r\nlast,"",9';
    const whole = parseCsv(text);
    expect(whole).toHaveLength(3);
    for (let i = 0; i <= text.length; i++) {
      const p = new CsvStream();
      expect([...p.push(text.slice(0, i)), ...p.push(text.slice(i)), ...p.end()]).toEqual(whole);
    }
  });
  it("round-trips and escapes formula injection", () => {
    const out = toCsv([{ a: "=HYPERLINK()", b: 'q"q' }], ["a", "b"]);
    expect(out).toBe('a,b\r\n\'=HYPERLINK(),"q""q"');
  });
});

describe("text", () => {
  it("normalizes company names like the BitScale formula", () => {
    expect(normalizeCompany("Lane Property Management LLC")).toBe("lane property management");
    expect(normalizeCompany("Acme Corp. (HQ) [old]")).toBe("acme");
  });
  it("extracts root domains and flags directory hosts", () => {
    expect(rootDomain("https://www.Foo.com/about?x=1")).toBe("foo.com");
    expect(rootDomain("foo.com")).toBe("foo.com");
    expect(rootDomain("Not found")).toBe("");
    expect(isBadHost("m.facebook.com")).toBe(true);
    expect(isBadHost("acme.appfolio.com")).toBe(true);
    expect(isBadHost("acmepm.com")).toBe(false);
  });
  it("splits names keeping full last name and dropping titles", () => {
    expect(splitName("Mary Ann Van Buren")).toEqual({ first: "Mary", last: "Ann Van Buren" });
    expect(splitName("Dr. John Smith Jr., CPM")).toEqual({ first: "John", last: "Smith" });
    expect(splitName('Robert "Bob" Jones')).toEqual({ first: "Robert", last: "Jones" });
    expect(splitName("")).toEqual({ first: "", last: "" });
  });
  it("clip never leaves half an emoji", () => {
    const s = "ab\u{1F600}cd";
    expect(clip(s, 3)).toBe("ab");
    expect(clip(s, 4)).toBe("ab\u{1F600}");
    expect(clip("x" + String.fromCharCode(0xdc00) + "y", 10)).toBe("xy");
  });
  it("parses allReviews", () => {
    const r = parseReviews("5 Great, on time! || 4 ok || junk || 5 Fast\nservice");
    expect(r).toEqual([
      { stars: 5, text: "Great, on time!" },
      { stars: 4, text: "ok" },
      { stars: 5, text: "Fast\nservice" },
    ]);
  });
});

describe("rules", () => {
  it("rejects the WV sample: PM name but waste-management category", () => {
    expect(cleanRow({ name: "Lane Property Management LLC", category: "Waste management service" }, DEFAULT_SETTINGS))
      .toEqual({ ok: false, reason: "category:Waste management service" });
  });
  it("keeps real PMs, flags buildings, rejects chains and closed", () => {
    expect(cleanRow({ name: "Blue Ridge Rentals", category: "Property management company" }, DEFAULT_SETTINGS))
      .toEqual({ ok: true, likelyIcp: true, isBuilding: false });
    expect(cleanRow({ name: "Greystar", category: "Property management company" }, DEFAULT_SETTINGS).ok).toBe(false);
    expect(cleanRow({ name: "X", category: "Property management company", open_state: "Permanently closed" }, DEFAULT_SETTINGS))
      .toEqual({ ok: false, reason: "closed" });
    expect(cleanRow({ name: "Y Group", category: "Consultant" }, DEFAULT_SETTINGS)).toEqual({ ok: true, likelyIcp: false, isBuilding: false });
    expect(cleanRow({ name: "The Grand at Legacy", category: "Apartment complex" }, DEFAULT_SETTINGS)).toEqual({ ok: true, likelyIcp: false, isBuilding: true });
  });
  it("hard gates", () => {
    const pass = { segment: "hoa", isPropertyManager: true, isIndependent: true, domain: "a.com", siteOk: true, ownerName: "Jo Doe", ownerTitle: "Owner" };
    expect(failedGates(pass, DEFAULT_SETTINGS)).toEqual([]);
    expect(failedGates({ ...pass, segment: "vacation", ownerTitle: "Leasing Agent" }, DEFAULT_SETTINGS)).toEqual(["icp", "owner"]);
    expect(failedGates({ ...pass, estSize: "200+" }, DEFAULT_SETTINGS)).toEqual(["size"]);
    expect(failedGates({ ...pass, estSize: "unknown" }, DEFAULT_SETTINGS)).toEqual([]);
  });
});

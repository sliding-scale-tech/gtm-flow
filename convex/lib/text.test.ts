import { describe, expect, it } from "vitest";
import { trimSite } from "./text";

describe("trimSite", () => {
  const input = [
    "### https://a.com\nHome | About\n\nJane Smith, Owner\n[Contact us](https://a.com/c)\n![logo](x.png)",
    "### https://a.com/about\n  home |   about \nOur Team\nJane Smith, Owner\nContact us",
  ].join("\n\n");
  const out = trimSite(input);
  it("keeps headers and drops cross-page duplicates", () => {
    expect(out).toContain("### https://a.com\n");
    expect(out).toContain("### https://a.com/about\n");
    expect(out.match(/Home \| About/gi)).toHaveLength(1);
    expect(out.match(/Jane Smith, Owner/g)).toHaveLength(1);
    expect(out.match(/Contact us/g)).toHaveLength(1);
  });
  it("strips links and images, keeps titles", () => {
    expect(out).not.toMatch(/\]\(|!\[|x\.png/);
    expect(out).toContain("Our Team");
  });
  it("keeps page order and drops empty lines", () => {
    expect(out.indexOf("a.com\n")).toBeLessThan(out.indexOf("/about"));
    expect(out).not.toMatch(/\n\n/);
  });
});

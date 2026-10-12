// Port of BitScale doc §4.1 company normalization.
export function normalizeCompany(name: string | null | undefined): string {
  let s = String(name ?? "").toLowerCase();
  s = s.replace(/\(.*?\)|\[.*?\]/g, " ");
  s = s.replace(
    /\b(pvt(\.)?\s*ltd(\.)?|private\s+limited|inc(\.)?|llc|ltd(\.)?|limited|co(\.)?|company|corp(\.)?|corporation|gmbh|plc|bv|nv|oy|ab|s\.a\.|s\.a\.s|s\.l\.|pte(\.)?\s*ltd(\.)?|official|headquarters?|hq)\b/g,
    "",
  );
  s = s.replace(/[-,_]+/g, " ");
  return s.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// Hosts that are never a company's own domain (social, directories, PM-software tenant portals).
const BAD_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "youtube.com",
  "yelp.com", "linktr.ee", "google.com", "goo.gl", "g.page", "business.site", "nextdoor.com", "bbb.org",
  "yellowpages.com", "mapquest.com", "angi.com", "homeadvisor.com", "thumbtack.com", "zillow.com", "trulia.com",
  "realtor.com", "apartments.com", "rent.com", "rentcafe.com", "appfolio.com", "buildium.com", "managebuilding.com",
  "doorloop.com", "propertyware.com", "rentmanager.com", "wixsite.com", "godaddysites.com", "square.site",
  "weebly.com", "blogspot.com", "wordpress.com", "carrd.co",
];

/** "https://www.Foo.com/about?x" -> "foo.com". Returns "" for junk. */
export function rootDomain(url: string | null | undefined): string {
  const raw = String(url ?? "").trim();
  if (!raw || /^not found$/i.test(raw)) return "";
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.includes(".") ? host.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

export function isBadHost(domain: string): boolean {
  return BAD_HOSTS.some((d) => domain === d || domain.endsWith("." + d));
}

const PREFIX = /^(mr|mrs|ms|miss|dr|prof)$/i;
const SUFFIX = /^(jr|sr|ii|iii|iv|v|cpm|mba|phd|md|esq|ccim|cmca|ams|pcam|rmp|mpm|crm|cam|arm|cpa|pe|realtor|broker)$/i;

/** Fixes the doc §4.2 bug (last name = only 2nd token): last name is every remaining token. */
export function splitName(full: string | null | undefined): { first: string; last: string } {
  const tokens = String(full ?? "")
    .replace(/["“”].*?["“”]|\(.*?\)/g, " ") // nicknames
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, ""))
    .filter((t) => t && !PREFIX.test(t) && !SUFFIX.test(t.replace(/\./g, "")));
  return { first: tokens[0] ?? "", last: tokens.slice(1).join(" ") };
}

/** allReviews = "5 text || 4 text || …" (no reviewer names). */
export function parseReviews(all: string | null | undefined): { stars: number; text: string }[] {
  return String(all ?? "")
    .split(/\s*\|\|\s*/)
    .map((r) => r.trim().match(/^(\d(?:\.\d)?)\s+([\s\S]+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ stars: Number(m[1]), text: m[2].trim() }));
}

/** slice() that never leaves half an emoji (a lone UTF-16 surrogate) — Convex rejects such strings. */
export function clip(s: string | null | undefined, max: number): string {
  return String(s ?? "").slice(0, max).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

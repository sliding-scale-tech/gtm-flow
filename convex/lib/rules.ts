import { normalizeCompany } from "./text";

export type RuleSettings = {
  denyCategories: string[]; // lowercase substrings
  allowCategories: string[];
  chains: string[]; // normalized chain names
  buildingCategories: string[]; // a single property (apartment complex…) — resolved to the company behind it later
};

export type CleanResult =
  | { ok: true; likelyIcp: boolean; isBuilding: boolean }
  | { ok: false; reason: string };

const has = (hay: string, needles: string[]) => needles.some((n) => n && hay.includes(n.toLowerCase()));

/** Free, deterministic first pass. Category beats name: "Lane Property Management" filed as "Waste management service" is a trash company. */
export function cleanRow(row: { name?: string; category?: string; open_state?: string }, s: RuleSettings): CleanResult {
  const name = normalizeCompany(row.name);
  if (!name) return { ok: false, reason: "no_name" };
  if (/permanently closed|temporarily closed/i.test(row.open_state ?? "")) return { ok: false, reason: "closed" };

  const padded = ` ${name} `;
  const chain = s.chains.find((c) => c && padded.includes(` ${normalizeCompany(c)} `));
  if (chain) return { ok: false, reason: `chain:${chain}` };

  const cat = (row.category ?? "").toLowerCase();
  const isBuilding = has(cat, s.buildingCategories);
  const allowed = !isBuilding && has(cat, s.allowCategories);
  if (!allowed && !isBuilding && has(cat, s.denyCategories)) return { ok: false, reason: `category:${row.category}` };
  return { ok: true, likelyIcp: allowed, isBuilding };
}

export type GateInput = {
  segment?: string;
  isPropertyManager?: boolean;
  isIndependent?: boolean;
  domain?: string;
  siteOk?: boolean;
  ownerName?: string;
  ownerTitle?: string;
  estSize?: string;
};

export const SIZES = ["1-10", "11-50", "51-200", "200+"];
export type GateSettings = { icpSegments: string[]; allowedTitles: string[]; maxCompanySize: string };

/** The 4 hard gates from the go/no-go rule. Returns failed gate names (empty = pass). Model output can't skip these. */
export function failedGates(g: GateInput, s: GateSettings): string[] {
  const failed: string[] = [];
  if (!g.isPropertyManager || !s.icpSegments.includes(g.segment ?? "")) failed.push("icp");
  if (!g.isIndependent) failed.push("independent");
  // "unknown" size passes; otherwise the estimate must not exceed the configured max.
  if (SIZES.indexOf(g.estSize ?? "") > SIZES.indexOf(s.maxCompanySize)) failed.push("size");
  if (!g.domain || !g.siteOk) failed.push("domain");
  const title = (g.ownerTitle ?? "").toLowerCase();
  if (!g.ownerName?.trim() || !s.allowedTitles.some((t) => title.includes(t.toLowerCase()))) failed.push("owner");
  return failed;
}

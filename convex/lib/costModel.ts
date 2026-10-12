// Cost report model. Pure: turns the `runs` rows (their counters + provider costs) into everything the Costs page shows.
// Counter keys it reads (all written by pipeline.apply, or backfilled by costs.backfill):
//   in:<stage>            leads that entered a stage          rej:<reason>, dup, error, email:<status>   how leads ended
//   c:stage:<stage>:<provider>   $ per stage per provider      c:out:<outcome key>   $ spent on leads that ended that way
//   src:<finder>          usable emails by finder
export type RunLite = {
  id: string; name: string; status: string; startedAt: number; finishedAt?: number;
  spentUsd: number; costs: Record<string, number>; counts: Record<string, number>;
};
export type ScanFile = { name: string; rows: number; passing: number; seen: number; fresh: number };

export const PROVIDER_LABEL: Record<string, string> = { exa: "Exa (web search)", gemini: "Gemini (AI)", findymail: "Findymail", trykitt: "TryKitt", bouncer: "Bouncer", instantly: "Instantly", aiark: "AI Ark" };
export const STAGE_LABEL: Record<string, string> = {
  domain: "Find website", site: "Read website", building: "Building check", research: "Research agent", find_email: "Email search", verify: "Email search",
  personalize: "Write lines", classify: "Old test steps", owner: "Old test steps", decide: "Old test steps",
};
export const REASON_LABEL: Record<string, string> = {
  not_icp: "Not a target type", not_independent: "Not independent", no_owner: "No owner found", no_domain: "No website found", site_unreadable: "Website unreadable",
  building_only: "Apartment, no manager", building_unclear: "Apartment, unclear", no_email: "No email found", invalid_email: "Email invalid", gate: "Failed hard gates",
  agent_skip: "Agent said skip", agent_error: "Agent failed", category: "Wrong category (free)", chain: "National chain (free)", closed: "Closed (free)", no_name: "No name (free)",
};
const FREE = new Set(["category", "chain", "closed", "no_name"]);

const cnt = (runs: RunLite[], k: string) => runs.reduce((a, r) => a + (r.counts[k] ?? 0), 0);
const leadsIn = (r: RunLite) => r.counts["in:domain"] ?? 0;
const usableOf = (r: RunLite) => (r.counts["email:valid"] ?? 0) + (r.counts["email:catch_all"] ?? 0);
const sumKeys = (c: Record<string, number>, prefix: string) => Object.entries(c).reduce((a, [k, v]) => (k.startsWith(prefix) ? a + v : a), 0);

export function buildModel(runs: RunLite[]) {
  const spent = runs.reduce((a, r) => a + r.spentUsd, 0);
  const valid = cnt(runs, "email:valid"), catchAll = cnt(runs, "email:catch_all"), risky = cnt(runs, "email:risky");
  const usable = valid + catchAll;

  const prov: Record<string, number> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.costs)) prov[k] = (prov[k] ?? 0) + v;
  const providers = Object.entries(prov).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([key, v]) => ({ key, label: PROVIDER_LABEL[key] ?? key, v }));

  // Stage costs (+ per-provider split) across all runs.
  const stageMap: Record<string, { total: number; by: Record<string, number> }> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.counts)) {
    if (!k.startsWith("c:stage:")) continue;
    const [, , stage, provider] = k.split(":");
    const s = (stageMap[STAGE_LABEL[stage] ?? stage] ||= { total: 0, by: {} });
    s.total += v; s.by[provider] = (s.by[provider] ?? 0) + v;
  }
  const stages = Object.entries(stageMap).map(([label, s]) => ({ label, ...s })).sort((a, b) => b.total - a.total);
  const hasStageCosts = stages.length > 0;

  // How leads ended + what they cost.
  const outKeys = new Set<string>();
  for (const r of runs) for (const k of Object.keys(r.counts)) if (k.startsWith("c:out:")) outKeys.add(k.slice(6));
  const outcomes = [...outKeys].map((key) => {
    const cost = cnt(runs, "c:out:" + key), n = cnt(runs, key);
    const [kind, rest] = key.split(":");
    const label = kind === "rej" ? REASON_LABEL[rest] ?? rest : key === "email:valid" ? "Usable: valid" : key === "email:catch_all" ? "Usable: catch-all" : key === "email:risky" ? "Risky email" : key === "dup" ? "Duplicate company" : key === "error" ? "Error" : key;
    return { key, label, n, cost, avg: n ? cost / n : 0, usable: key === "email:valid" || key === "email:catch_all" };
  }).filter((o) => o.cost > 0 || o.n > 0).sort((a, b) => b.cost - a.cost);

  const finders = Object.entries(runs.reduce((a, r) => { for (const [k, v] of Object.entries(r.counts)) if (k.startsWith("src:")) a[k.slice(4)] = (a[k.slice(4)] ?? 0) + v; return a; }, {} as Record<string, number>))
    .map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);

  // The biggest run is the baseline for predictions.
  const byLeads = [...runs].filter((r) => leadsIn(r) > 0).sort((a, b) => leadsIn(b) - leadsIn(a));
  const base = byLeads[0] ?? null;
  const others = byLeads.slice(1);
  const sc = (rs: RunLite[]) => {
    const n = rs.reduce((a, r) => a + leadsIn(r), 0), cost = rs.reduce((a, r) => a + r.spentUsd, 0), u = rs.reduce((a, r) => a + usableOf(r), 0);
    return n ? { leads: n, cost: cost / n, yld: u / n, usable: u } : null;
  };
  const scenA = base ? sc([base]) : null;
  const othersN = others.reduce((a, r) => a + leadsIn(r), 0);
  const scenB = othersN >= 30 ? sc(others) : null;

  let speed: number | null = null;
  if (base?.finishedAt && base.startedAt) {
    const h = (base.finishedAt - base.startedAt) / 3.6e6;
    if (h > 0 && h < 6) speed = Math.round(leadsIn(base) / h);
  }

  // Funnel + drop reasons for the baseline run.
  let funnel: { label: string; n: number; stageCost: number | null; drop: { text: string; n: number } | null }[] = [];
  let levers: { name: string; how: string; per1000: number; risk: string }[] = [];
  if (base) {
    const c = base.counts, n0 = leadsIn(base);
    const stageCost = (...stages: string[]) => stages.reduce((a, s) => a + sumKeys(c, `c:stage:${s}:`), 0) || null;
    // Reasons that explain a drop; whatever is left over (mostly duplicate companies) is shown as "other" so the numbers add up.
    const why = (reasons: string[], dropN: number) => {
      const parts = reasons.map((x) => [REASON_LABEL[x] ?? x, c["rej:" + x] ?? 0] as [string, number]).filter(([, v]) => v > 0);
      const rest = dropN - parts.reduce((a, [, v]) => a + v, 0);
      if (rest > 0) parts.push(["other (mostly duplicate companies)", rest]);
      return parts.map(([l, v]) => `${v} ${l.toLowerCase()}`).join(", ");
    };
    const ready = c.ready ?? 0, usableB = usableOf(base);
    const steps: [string, number, number | null, string[]][] = [
      ["Enter the pipeline", n0, stageCost("domain"), []],
      ["Website found", c["in:site"] ?? 0, stageCost("site", "building"), ["no_domain"]],
      ["Reach the AI research", c["in:research"] ?? 0, stageCost("research"), ["site_unreadable", "building_only", "building_unclear"]],
      ["Reach email search", c["in:find_email"] ?? 0, stageCost("find_email", "verify"), ["not_icp", "not_independent", "no_owner", "gate", "agent_skip", "agent_error"]],
      ["Finish with an email", ready, stageCost("personalize"), ["no_email", "invalid_email"]],
      ["Usable email", usableB, null, []],
    ];
    funnel = steps.map(([label, n, stageCostV, reasons], i) => {
      const dropN = i ? steps[i - 1][1] - n : 0;
      const text = i === steps.length - 1 ? (c["email:risky"] ? `${c["email:risky"]} risky (not confirmed)` : "") : why(reasons, dropN);
      return { label, n, stageCost: stageCostV, drop: dropN > 0 ? { text, n: dropN } : null };
    });

    const rExa = c["c:stage:research:exa"] ?? 0, rGem = c["c:stage:research:gemini"] ?? 0, rTotal = sumKeys(c, "c:stage:research:");
    const sExa = c["c:stage:site:exa"] ?? 0, inRes = c["in:research"] ?? 0, notIcp = c["rej:not_icp"] ?? 0;
    const k = n0 ? 1000 / n0 : 0;
    if (rTotal > 0 && inRes > 0) {
      levers = [
        { name: "Cheap pre-check before the agent", how: "One tiny Gemini call on the homepage text we already fetched asks 'vacation rental, realtor, trade?'. Assumes it stops 60% of the leads the agent rejected as not a target.", per1000: (notIcp * 0.6 * (rTotal / inRes) - inRes * 0.0005) * k, risk: "Low: it only rejects clear non-targets." },
        { name: "Fast model for the agent", how: "Switch the research agent from the smart Gemini model to the fast one (about a third of the price). Assumes 65% off the Gemini part of research.", per1000: rGem * 0.65 * k, risk: "Medium: may find owners less often. Test on 20 leads first." },
        { name: "Agent tool calls 4 → 2", how: "Each extra web search costs about $0.007. Assumes 25% off the Exa part of research.", per1000: rExa * 0.25 * k, risk: "Medium: a few more 'no owner found'." },
        { name: "Read fewer subpages per website", how: "Fetch about, contact and team pages only. Assumes 15% off the Exa part of the website step.", per1000: sExa * 0.15 * k, risk: "Low." },
      ].filter((l) => l.per1000 > 0);
    }
  }

  const freeRejected = [...Object.keys(runs.reduce((a, r) => ({ ...a, ...r.counts }), {} as Record<string, number>))].filter((k) => k.startsWith("rej:") && FREE.has(k.slice(4))).reduce((a, k) => a + cnt(runs, k), 0);
  return { spent, rows: cnt(runs, "rows"), valid, catchAll, risky, usable, ready: cnt(runs, "ready"), leads: runs.reduce((a, r) => a + leadsIn(r), 0), freeRejected,
    providers, stages, hasStageCosts, outcomes, finders, base: base ? { name: base.name, leads: leadsIn(base), spent: base.spentUsd, usable: usableOf(base) } : null, scenA, scenB, speed, funnel, levers };
}

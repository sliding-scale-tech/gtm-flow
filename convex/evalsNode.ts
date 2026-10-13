"use node";
// Agent-model A/B (manual, paid, writes nothing to the DB). Re-runs research() with settings.models.smart = `model`.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { research } from "./agent";
import { exaSearch } from "./providers/exa";
import { fmtHits } from "./stageKit";
import type { Settings, PromptKey } from "./defaults";
import type { Call } from "./stageKit";

const MAX_USD = 2.0;
const lastName = (s: string) => (s || "").trim().toLowerCase().split(/\s+/).filter(Boolean).pop() ?? "";

export const agentModel = internalAction({
  args: { n: v.number(), model: v.string() },
  handler: async (ctx, { n, model }): Promise<Record<string, unknown>> => {
    const want = Math.max(1, Math.min(Math.floor(n), 60));
    const { settings: base, prompts }: { settings: Settings; prompts: Record<PromptKey, string> } = await ctx.runQuery(internal.settings.config, {});
    // Override the smart model; price it at the fast-tier rates so cost is honest for a flash-lite run.
    const isFast = model === base.models.fast; // price at fast rates only when the requested model IS the fast model
    const settings: Settings = { ...base, models: { ...base.models, smart: model }, prices: isFast ? { ...base.prices, smartIn: base.prices.fastIn, smartOut: base.prices.fastOut, smartCached: base.prices.fastCached } : base.prices };
    const cands: { lead: any; blob: any; kind: string }[] = await ctx.runQuery(internal.evals.agentModelCandidates, { n: want });

    let spent = 0, stopped = false;
    const rows: any[] = [];
    const queue = [...cands];
    const worker = async () => {
      for (;;) {
        if (spent >= MAX_USD) { stopped = true; return; }
        const c = queue.shift(); if (!c) return;
        const { lead, blob } = c;
        const calls: Call[] = [];
        const storedPass = lead.decision?.decision === "find_email";
        const stored = { verdict: storedPass ? "pass" : "reject", segment: lead.classify?.segment ?? "", owner: lead.owner?.fullName ?? "", reason: lead.rejectReason ?? "" };
        try {
          const out = await research({ lead, blob, calls, settings, prompts });
          const cost = { exa: 0, gemini: 0 };
          for (const k of calls) if (k.provider === "exa") cost.exa += k.costUsd; else cost.gemini += k.costUsd;
          spent += cost.exa + cost.gemini;
          const p: any = out.patch;
          rows.push({
            name: lead.company || lead.name, kind: c.kind, stored,
            new: { verdict: out.next === "find_email" ? "pass" : "reject", segment: p.classify?.segment ?? "", owner: p.owner?.fullName ?? "", reason: out.reject ?? "", summary: out.summary },
            cost: { exa: cost.exa, gemini: cost.gemini, total: cost.exa + cost.gemini },
          });
        } catch (e) {
          for (const k of calls) spent += k.costUsd;
          rows.push({ name: lead.company || lead.name, kind: c.kind, stored, error: String((e as Error)?.message ?? e).slice(0, 300), cost: { total: calls.reduce((a, k) => a + k.costUsd, 0) } });
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    const ok = rows.filter((r) => !r.error);
    const verdictAgree = ok.filter((r) => r.stored.verdict === r.new.verdict).length;
    const storedPasses = ok.filter((r) => r.stored.verdict === "pass");
    const ownerAgree = storedPasses.filter((r) => lastName(r.stored.owner) && lastName(r.stored.owner) === lastName(r.new.owner)).length;
    const segAgree = ok.filter((r) => r.stored.segment === r.new.segment).length;
    const exa = ok.reduce((a, r) => a + r.cost.exa, 0), gem = ok.reduce((a, r) => a + r.cost.gemini, 0);
    return {
      model, requested: want, evaluated: ok.length, errors: rows.length - ok.length, stoppedForBudget: stopped,
      verdictAgreePct: ok.length ? (100 * verdictAgree) / ok.length : 0,
      segmentAgreePct: ok.length ? (100 * segAgree) / ok.length : 0,
      ownerAgreeAmongStoredPasses: `${ownerAgree}/${storedPasses.length}`,
      totalUsd: spent, perLeadUsd: ok.length ? (exa + gem) / ok.length : 0, perLeadExa: ok.length ? exa / ok.length : 0, perLeadGemini: ok.length ? gem / ok.length : 0,
      rows,
    };
  },
});

// Exa search type A/B: same stored first query, "auto" vs "instant". Paid, writes nothing.
export const exaType = internalAction({
  args: { n: v.number() },
  handler: async (ctx, { n }): Promise<Record<string, unknown>> => {
    const { settings: base }: { settings: Settings } = await ctx.runQuery(internal.settings.config, {});
    const cands: { company: string; domain: string; last: string; tool: string; query: string }[] = await ctx.runQuery(internal.evals.exaTypeCandidates, { n: Math.max(1, Math.min(Math.floor(n), 100)) });
    const types = ["auto", "instant"] as const;
    let spent = 0;
    const rows: any[] = [];
    for (const c of cands) {
      if (spent >= 1.0) break;
      const row: any = { company: c.company, domain: c.domain, last: c.last, tool: c.tool, query: c.query };
      for (const t of types) {
        try {
          const people = c.tool === "search_people";
          const r = await exaSearch(c.query, { ...base, exaSearchType: t }, { numResults: 5, maxChars: people ? 500 : 600, ...(people ? { category: "people" } : {}) });
          spent += r.costUsd;
          const text = fmtHits(r.hits).toLowerCase();
          row[t] = { owner: !!c.last && text.includes(c.last.toLowerCase()), domain: !!c.domain && r.hits.some((h) => h.url.toLowerCase().includes(c.domain)), cost: r.costUsd };
        } catch (e) { row[t] = { error: String((e as Error)?.message ?? e).slice(0, 150), cost: 0 }; }
      }
      rows.push(row);
    }
    const stat = (t: "auto" | "instant") => {
      const ok = rows.filter((r) => !r[t].error);
      return { n: ok.length, ownerHit: ok.filter((r) => r[t].owner).length, domainHit: ok.filter((r) => r[t].domain).length, usdPerCall: ok.length ? ok.reduce((a, r) => a + r[t].cost, 0) / ok.length : 0 };
    };
    return { cases: rows.length, totalUsd: spent, auto: stat("auto"), instant: stat("instant"),
      autoHitInstantMissed: rows.filter((r) => r.auto.owner && !r.instant.owner).map((r) => ({ company: r.company, tool: r.tool, query: r.query })), rows };
  },
});

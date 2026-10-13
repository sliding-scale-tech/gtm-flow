// Offline evals (run manually from the Convex dashboard / CLI). Not used by the pipeline.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { precheckRejects } from "./lib/precheck";
import { clean, fill, gemini } from "./providers/gemini";

import type { PromptKey, Settings } from "./defaults";
type Cand = { id: string; name: string; category: string; siteText: string; kind: "usable" | "notIcp" | "other" };
const MAX_USD = 0.5;
const MAX_BYTES = 6_000_000; // cap on site text read per query

/** Finished-research leads with site text: every usable lead, then agent not_icp, then others, up to n. */
export const precheckCandidates = internalQuery({
  args: { n: v.number() },
  handler: async (ctx, { n }) => {
    const slim = (l: any, siteText: string, kind: "usable" | "notIcp" | "other") => ({
      id: l._id as string, name: l.company || l.name, category: l.category, siteText, kind,
    });
    const buckets: Record<"usable" | "notIcp" | "other", any[]> = { usable: [], notIcp: [], other: [] };
    const done = ctx.db.query("leads").withIndex("by_state", (q) => q.eq("state", "done"));
    for await (const l of done) {
      if (!l.classify) continue;
      if (l.emailStatus === "valid" || l.emailStatus === "catch_all") buckets.usable.push(l);
      else buckets.other.push(l);
      if (buckets.usable.length >= n && buckets.other.length >= n) break;
    }
    const rej = ctx.db.query("leads").withIndex("by_state", (q) => q.eq("state", "rejected"));
    for await (const l of rej) {
      if (!l.classify) continue;
      if ((l.rejectReason ?? "").startsWith("not_icp")) buckets.notIcp.push(l);
      else buckets.other.push(l);
      if (buckets.notIcp.length >= n && buckets.other.length >= n) break;
    }
    // Priority: all usable, then agent not_icp, then others. Roughly balance not_icp/other for the remainder.
    const order: any[] = [];
    const take = (arr: any[], kind: "usable" | "notIcp" | "other", cap: number) => { for (const l of arr.slice(0, cap)) order.push([l, kind]); };
    take(buckets.usable, "usable", n);
    const rest = Math.max(0, n - order.length);
    const nCap = Math.min(buckets.notIcp.length, Math.ceil(rest / 2));
    take(buckets.notIcp, "notIcp", nCap);
    take(buckets.other, "other", Math.max(0, rest - nCap));
    take(buckets.notIcp.slice(nCap), "notIcp", Math.max(0, n - order.length));

    const out: ReturnType<typeof slim>[] = [];
    let bytes = 0;
    for (const [l, kind] of order) {
      if (out.length >= n || bytes > MAX_BYTES) break;
      const blob = await ctx.db.query("leadBlobs").withIndex("by_lead", (q) => q.eq("leadId", l._id)).unique();
      if (!blob?.siteText) continue;
      bytes += blob.siteText.length;
      out.push(slim(l, blob.siteText, kind));
    }
    return out;
  },
});

/** Runs the pre-check on finished leads and compares it with the agent's verdict. Hard stop at $0.50. */
export const precheck = internalAction({
  args: { n: v.number() },
  handler: async (ctx, { n }): Promise<Record<string, unknown>> => {
    const want = Math.max(1, Math.min(Math.floor(n), 300));
    const { settings, prompts }: { settings: Settings; prompts: Record<PromptKey, string> } = await ctx.runQuery(internal.settings.config, {});
    const leads: Cand[] = await ctx.runQuery(internal.evals.precheckCandidates, { n: want });
    const min = settings.precheckMinConfidence;
    const schema = { type: "object", properties: { segment: { type: "string" }, confidence: { type: "number" }, reason: { type: "string" } }, required: ["segment", "confidence", "reason"] };

    let spent = 0, stoppedForBudget = false, errors = 0, errorSample = "";
    const perLead: { usable: boolean; agentNotIcp: boolean; segment: string; conf: number }[] = [];
    const wouldRejectUsable: { name: string; category: string; segment: string; conf: number; reason: string }[] = [];
    const confusion = { tp: 0, fp: 0, fn: 0, tn: 0 }; // positive = "not ICP"; truth = agent not_icp; predicted = precheck rejects
    for (const l of leads) {
      if (spent > MAX_USD) { stoppedForBudget = true; break; }
      try {
        const r = await gemini<{ segment: string; confidence: number; reason: string }>({
          tier: "fast", settings, schema, mockKey: "precheck", mockSeed: l.name,
          prompt: fill(prompts.precheck, { name: l.name, category: l.category, site: clean(l.siteText, 6000) }),
        });
        spent += r.costUsd;
        const d = r.data;
        const usable = l.kind === "usable", agentNotIcp = l.kind === "notIcp";
        const rejects = precheckRejects(d.segment, d.confidence, min);
        perLead.push({ usable, agentNotIcp, segment: d.segment, conf: d.confidence });
        if (rejects && agentNotIcp) confusion.tp++; else if (rejects) confusion.fp++; else if (agentNotIcp) confusion.fn++; else confusion.tn++;
        if (rejects && usable) wouldRejectUsable.push({ name: l.name, category: l.category, segment: d.segment, conf: d.confidence, reason: d.reason });
      } catch (e) { errors++; if (!errorSample) errorSample = String((e as Error)?.message ?? e).slice(0, 300); }
    }
    return {
      errorSample, threshold: min, evaluated: perLead.length, requested: want, errors, stoppedForBudget,
      confusion, wouldRejectUsable, perLead,
      totalUsd: spent, avgUsdPerLead: perLead.length ? spent / perLead.length : 0,
    };
  },
});

/** Agent-model A/B candidates: researched leads with site text. ~60% reached find_email (usable first), ~40% agent not_icp/no_owner rejects. Deterministic order. */
export const agentModelCandidates = internalQuery({
  args: { n: v.number() },
  handler: async (ctx, { n }) => {
    const wantPass = Math.round(n * 0.6), wantRej = n - wantPass;
    const usable: any[] = [], otherPass: any[] = [], rejs: any[] = [];
    for await (const l of ctx.db.query("leads").withIndex("by_state", (q) => q.eq("state", "done"))) {
      if (!l.classify || l.decision?.decision !== "find_email") continue;
      (l.emailStatus === "valid" || l.emailStatus === "catch_all" ? usable : otherPass).push(l);
      if (usable.length + otherPass.length >= n * 3) break;
    }
    for await (const l of ctx.db.query("leads").withIndex("by_state", (q) => q.eq("state", "rejected"))) {
      if (!l.classify) continue;
      const r = l.rejectReason ?? "";
      if (l.decision?.decision === "find_email") otherPass.push(l);
      else if (r.startsWith("not_icp") || r === "no_owner") rejs.push(l);
      if (rejs.length >= n * 3) break;
    }
    const passes = [...usable.slice(0, Math.ceil(wantPass / 2)), ...otherPass, ...usable.slice(Math.ceil(wantPass / 2))].slice(0, wantPass);
    const order = [...passes.map((l) => [l, "pass"] as const), ...rejs.slice(0, wantRej + 5).map((l) => [l, "reject"] as const)];
    const out: { lead: any; blob: any; kind: string }[] = [];
    let rejTaken = 0, passTaken = 0;
    for (const [l, kind] of order) {
      if (out.length >= n) break;
      if (kind === "reject" && rejTaken >= wantRej + Math.max(0, wantPass - passTaken)) continue;
      const blob = await ctx.db.query("leadBlobs").withIndex("by_lead", (q) => q.eq("leadId", l._id)).unique();
      if (!blob?.siteText) continue;
      if (kind === "pass") passTaken++; else rejTaken++;
      out.push({ lead: l, blob: { siteText: blob.siteText, evidence: blob.evidence }, kind });
    }
    return out;
  },
});

// Leads that passed research with an owner and have a stored successful search query (for the Exa type test).
export const exaTypeCandidates = internalQuery({
  args: { n: v.number() },
  handler: async (ctx, { n }) => {
    const out: { company: string; domain: string; last: string; tool: string; query: string }[] = [];
    for await (const l of ctx.db.query("leads").withIndex("by_state", (q) => q.eq("state", "done"))) {
      const last = l.owner?.lastName?.trim();
      if (!last || !l.agentTrace) continue;
      for (const t of l.agentTrace) {
        if (!t.ok || (t.tool !== "web_search" && t.tool !== "search_people")) continue;
        let q = ""; try { q = JSON.parse(t.input)?.query ?? ""; } catch { /* truncated input */ }
        if (!q) continue;
        out.push({ company: l.company || l.name, domain: (l.domain ?? "").toLowerCase(), last, tool: t.tool, query: q });
        break;
      }
      if (out.length >= n) break;
    }
    return out;
  },
});

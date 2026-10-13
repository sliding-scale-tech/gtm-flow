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

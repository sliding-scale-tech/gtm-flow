import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSession } from "./auth";
import { PROMPT_KEYS } from "./defaults";
import { instantlyAddLeads, instantlyCampaigns } from "./providers/email";
import { clean, fill, gemini } from "./providers/gemini";
import { loadSettings } from "./settings";
import { STAGES } from "./lib/stageList";

const filtersV = {
  runId: v.optional(v.id("runs")),
  state: v.optional(v.string()),
  emailStatus: v.optional(v.string()),
  segment: v.optional(v.string()),
};

/** Grid rows without the heavy review text. */
const slim = ({ reviews, ...l }: Doc<"leads">) => ({ ...l, hasReviews: !!reviews });

export const page = query({
  args: { token: v.string(), paginationOpts: paginationOptsValidator, ...filtersV },
  handler: async (ctx, { token, paginationOpts, runId, state, emailStatus, segment }) => {
    await requireSession(ctx, token);
    const st = state as Doc<"leads">["state"] | undefined;
    const base = runId
      ? ctx.db.query("leads").withIndex("by_run_state", (q) => (st ? q.eq("runId", runId).eq("state", st) : q.eq("runId", runId)))
      : st ? ctx.db.query("leads").withIndex("by_state", (q) => q.eq("state", st)) : ctx.db.query("leads");
    let q = base.order("desc");
    if (emailStatus) q = q.filter((f) => f.eq(f.field("emailStatus"), emailStatus));
    if (segment) q = q.filter((f) => f.eq(f.field("classify.segment"), segment));
    const res = await q.paginate({ ...paginationOpts, numItems: Math.min(Math.max(1, paginationOpts.numItems), 500) });
    return { ...res, page: res.page.map(slim) };
  },
});

export const detail = query({
  args: { token: v.string(), leadId: v.id("leads") },
  handler: async (ctx, { token, leadId }) => {
    await requireSession(ctx, token);
    const lead = await ctx.db.get(leadId);
    if (!lead) return null;
    const blob = await ctx.db.query("leadBlobs").withIndex("by_lead", (q) => q.eq("leadId", leadId)).unique();
    const logs = await ctx.db.query("stepLogs").withIndex("by_lead", (q) => q.eq("leadId", leadId)).collect();
    const twin = lead.duplicateOf ? await ctx.db.get(lead.duplicateOf) : null;
    const named = (await ctx.db.query("reviews").withIndex("by_place", (q) => q.eq("placeId", lead.placeId)).take(3)).map((r) => ({ author: r.author, text: r.text }));
    return { lead, siteText: blob?.siteText ?? "", evidence: blob?.evidence ?? "", logs, duplicateOfName: twin?.name ?? null, named };
  },
});

/** Manual override from the drawer. */
export const override = mutation({
  args: { token: v.string(), leadId: v.id("leads"), action: v.union(v.literal("go"), v.literal("reject"), v.literal("rerun")), stage: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, { token, leadId, action, stage, note }) => {
    await requireSession(ctx, token);
    const lead = await ctx.db.get(leadId);
    if (!lead) throw new ConvexError("Lead not found");
    const n = note?.slice(0, 500);
    if (action === "reject") return await ctx.db.patch(leadId, { state: "rejected", rejectReason: "manual", note: n });
    let next: string;
    if (action === "go") {
      if (!lead.owner?.fullName || !lead.domain) throw new ConvexError("Needs a domain and an owner name first — re-run those stages.");
      await ctx.db.patch(leadId, { decision: { decision: "find_email", reasons: ["Manual override"], failedGates: [] } });
      next = "find_email";
    } else {
      if (!stage || !(STAGES as readonly string[]).includes(stage)) throw new ConvexError("Pick a stage to re-run");
      next = stage;
    }
    await ctx.db.patch(leadId, {
      state: "queued", stage: next, attempts: 0, rejectReason: undefined, lastError: undefined, note: n,
      ...(next === "find_email" || next === "verify" ? { tried: [], email: undefined, emailStatus: undefined, emailSource: undefined, emailTrail: undefined } : {}),
    });
    const run = await ctx.db.get(lead.runId);
    if (run && run.status !== "running" && run.status !== "ingesting") {
      await ctx.db.patch(run._id, { status: "running", pauseReason: undefined, tickAt: Date.now(), finishedAt: undefined });
      await ctx.scheduler.runAfter(0, internal.worker.tick, { runId: run._id });
    }
  },
});

// ---------------------------------------------------------------- Instantly push

export const campaigns = action({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await ctx.runQuery(internal.auth.assert, { token });
    return await instantlyCampaigns();
  },
});

export const pushable = internalQuery({
  args: { runId: v.optional(v.id("runs")), leadIds: v.optional(v.array(v.id("leads"))), includeCatchAll: v.boolean() },
  handler: async (ctx, { runId, leadIds, includeCatchAll }) => {
    const leads = leadIds
      ? (await Promise.all(leadIds.map((id) => ctx.db.get(id)))).filter((l): l is Doc<"leads"> => !!l)
      : runId ? await ctx.db.query("leads").withIndex("by_run_state", (q) => q.eq("runId", runId).eq("state", "done")).collect() : [];
    const ok = includeCatchAll ? ["valid", "catch_all"] : ["valid"];
    return leads.filter((l) => l.state === "done" && l.email && ok.includes(l.emailStatus ?? "") && !l.pushedAt);
  },
});

export const markPushed = internalMutation({
  args: { leadIds: v.array(v.id("leads")), campaignId: v.string() },
  handler: async (ctx, { leadIds, campaignId }) => {
    for (const id of leadIds) await ctx.db.patch(id, { pushedAt: Date.now(), pushedCampaign: campaignId });
  },
});

export const push = action({
  args: { token: v.string(), campaignId: v.string(), includeCatchAll: v.boolean(), runId: v.optional(v.id("runs")), leadIds: v.optional(v.array(v.id("leads"))) },
  handler: async (ctx, a): Promise<{ uploaded: number; skipped: number; considered: number }> => {
    await ctx.runQuery(internal.auth.assert, { token: a.token });
    if (!a.runId && !a.leadIds?.length) throw new ConvexError("Pick a run or some leads");
    if ((a.leadIds?.length ?? 0) > 5000) throw new ConvexError("Max 5000 leads per push");
    const leads = await ctx.runQuery(internal.leads.pushable, { runId: a.runId, leadIds: a.leadIds, includeCatchAll: a.includeCatchAll });
    let uploaded = 0, skipped = 0;
    for (let i = 0; i < leads.length; i += 500) {
      const chunk = leads.slice(i, i + 500);
      const r = await instantlyAddLeads(a.campaignId, chunk.map((l) => ({
        email: l.email, first_name: l.owner?.firstName ?? "", last_name: l.owner?.lastName ?? "", company_name: l.name,
        website: l.domain ?? "", phone: l.phone, job_title: l.owner?.title ?? "", personalization: l.personal?.finalLine ?? "",
        custom_variables: {
          reviewLine: l.personal?.reviewLine ?? "", companyDescription: l.personal?.description ?? "", genericLine: l.personal?.genericLine ?? "",
          serviceLabel: l.personal?.serviceLabel ?? "", county: l.county, state: l.usState, emailStatus: l.emailStatus ?? "", ...(l.vars ?? {}),
        },
      })));
      uploaded += r.uploaded; skipped += r.skipped;
      await ctx.runMutation(internal.leads.markPushed, { leadIds: chunk.map((l) => l._id), campaignId: a.campaignId });
    }
    return { uploaded, skipped, considered: leads.length };
  },
});

// ---------------------------------------------------------------- prompt test

export const promptContext = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    const lead = await ctx.db.get(leadId);
    const blob = await ctx.db.query("leadBlobs").withIndex("by_lead", (q) => q.eq("leadId", leadId)).unique();
    return { lead, siteText: blob?.siteText ?? "", evidence: blob?.evidence ?? "", settings: await loadSettings(ctx) };
  },
});

/** Runs an (unsaved) prompt against a real lead and returns the raw model text. Costs one Gemini call. */
export const testPrompt = action({
  args: { token: v.string(), key: v.string(), text: v.string(), leadId: v.id("leads") },
  handler: async (ctx, { token, key, text, leadId }): Promise<string> => {
    await ctx.runQuery(internal.auth.assert, { token });
    if (!(PROMPT_KEYS as readonly string[]).includes(key) || text.length > 20000) throw new ConvexError("Bad prompt");
    const c = await ctx.runQuery(internal.leads.promptContext, { leadId });
    if (!c.lead) throw new ConvexError("Lead not found");
    const l = c.lead;
    const prompt = fill(text, {
      name: l.name, company: l.company ?? l.name, building_note: "", max_tools: 4, category: l.category, city: l.county, state: l.usState, phone: l.phone, rating: l.rating, reviews_count: l.reviewsCount,
      domain: l.domain, url: `https://${l.domain}`, site: clean(c.siteText, 10000), evidence: clean(c.evidence || c.siteText, 12000),
      reviews: clean(l.reviews, 4000), results: "(search results are only available during a real run)",
      summary: clean(JSON.stringify({ company: l.name, classification: l.classify, decision_maker: l.owner }), 6000),
      variables: c.settings.campaignVariables.map((cv) => `- ${cv.key}: sentence: "${cv.sentence}" | instructions: ${cv.instructions} | fallback: "${cv.fallback}"`).join("\n"),
    });
    const r = await gemini<string>({ tier: "fast", settings: c.settings, prompt, mockKey: key, mockSeed: l.name });
    return typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
  },
});


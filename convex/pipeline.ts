// Run engine: one self-rescheduling `tick` per run. Each tick claims a batch of queued leads,
// advances each by ONE stage in parallel and saves each lead as soon as its stage finishes.
// ponytail: single tick chain per run, batch-level budget check (can overshoot by one batch). Upgrade to Workpool if per-provider rate limits bite.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { STAGES, type Stage } from "./lib/stageList";
import type { StageOut } from "./stageKit";
import { loadPrompts, loadSettings } from "./settings";
import { cleanRow } from "./lib/rules";

const LEASE_MS = 20 * 60 * 1000; // longer than any single batch
const MAX_ATTEMPTS = 3;

const bump = (counts: Record<string, number>, key: string, n = 1) => { counts[key] = (counts[key] ?? 0) + n; };

// ---------------------------------------------------------------- ingest

const rowV = v.object({
  placeId: v.string(), name: v.string(), category: v.string(), address: v.string(), phone: v.string(), website: v.string(),
  rating: v.optional(v.number()), reviewsCount: v.optional(v.number()), county: v.string(), usState: v.string(),
  mapsUrl: v.string(), reviews: v.string(), openState: v.string(),
});

/**
 * Clean rules + global place_id dedupe, then insert. Called in chunks by the ingest action.
 * Rows already seen (any run) are only counted, not stored, so re-running a big state file
 * in chunks costs nothing for the part already done. `maxNew` caps leads that pass cleaning (the ones that
 * cost money). Returns how many such leads were queued.
 */
export const insertBatch = internalMutation({
  args: { runId: v.id("runs"), rows: v.array(rowV), maxNew: v.optional(v.number()) },
  handler: async (ctx, { runId, rows, maxNew }) => {
    const settings = await loadSettings(ctx);
    const run = (await ctx.db.get(runId))!;
    const counts = { ...run.counts };
    let fresh = 0;
    for (const { openState, ...r } of rows) {
      if (maxNew !== undefined && fresh >= maxNew) break;
      bump(counts, "rows");
      const base = { ...r, runId, costUsd: 0, attempts: 0, likelyIcp: false, stage: "domain" };
      const prior = r.placeId ? await ctx.db.query("leads").withIndex("by_placeId", (q) => q.eq("placeId", r.placeId)).first() : null;
      if (prior) { bump(counts, "dup"); continue; }
      const c = cleanRow({ name: r.name, category: r.category, open_state: openState }, settings);
      if (!c.ok) {
        bump(counts, `rej:${c.reason.split(":")[0]}`);
        await ctx.db.insert("leads", { ...base, state: "rejected", rejectReason: c.reason });
        continue;
      }
      bump(counts, "in:domain");
      fresh++;
      await ctx.db.insert("leads", { ...base, state: "queued", likelyIcp: c.likelyIcp, isBuilding: c.isBuilding });
    }
    await ctx.db.patch(runId, { counts });
    return fresh;
  },
});

/** For the New run preview: every processed place id, one page at a time (cheaper than one lookup per CSV row). */
export const placeIdPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("leads").paginate({ cursor, numItems: 500 }) // lead docs carry review text; 500 keeps a page well under read limits;
    return { ids: page.page.map((l) => l.placeId), cursor: page.continueCursor, done: page.isDone };
  },
});

// ---------------------------------------------------------------- tick

export const tickState = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    return run && { status: run.status, budgetUsd: run.budgetUsd, spentUsd: run.spentUsd, settings: await loadSettings(ctx), prompts: await loadPrompts(ctx) };
  },
});

export const claim = internalMutation({
  args: { runId: v.id("runs"), n: v.number() },
  handler: async (ctx, { runId, n }) => {
    await ctx.db.patch(runId, { tickAt: Date.now() });
    const leads = await ctx.db.query("leads").withIndex("by_run_state", (q) => q.eq("runId", runId).eq("state", "queued")).take(n);
    const out = [];
    for (const lead of leads) {
      await ctx.db.patch(lead._id, { state: "working", leaseAt: Date.now() });
      const blob = await ctx.db.query("leadBlobs").withIndex("by_lead", (q) => q.eq("leadId", lead._id)).unique();
      const named = lead.stage === "personalize"
        ? (await ctx.db.query("reviews").withIndex("by_place", (q) => q.eq("placeId", lead.placeId)).take(3)).map((r) => ({ author: r.author, text: r.text }))
        : [];
      out.push({ lead: { ...lead, state: "working" as const }, blob: blob && { siteText: blob.siteText, evidence: blob.evidence }, named });
    }
    return out;
  },
});

type Result = { leadId: Id<"leads">; stage: Stage; ms: number; out?: StageOut; error?: string; calls?: StageOut["calls"] };

export const apply = internalMutation({
  args: { runId: v.id("runs"), results: v.any() },
  handler: async (ctx, { runId, results }) => {
    const run = (await ctx.db.get(runId))!;
    const counts = { ...run.counts };
    const costs = { ...run.costs };
    let spent = run.spentUsd;

    for (const r of results as Result[]) {
      const lead = await ctx.db.get(r.leadId);
      if (!lead || lead.state !== "working") continue; // overridden/stopped meanwhile
      const calls = r.out?.calls ?? r.calls ?? []; // a thrown stage still bills the calls it made
      const cost = calls.reduce((s, c) => s + c.costUsd, 0);
      for (const c of calls) costs[c.provider] = (costs[c.provider] ?? 0) + c.costUsd;
      spent += cost;

      await ctx.db.insert("stepLogs", {
        runId, leadId: r.leadId, stage: r.stage, ok: !r.error && r.out?.next !== "rejected", ms: r.ms, costUsd: cost,
        calls, summary: r.out?.summary ?? "", ...(r.error ? { error: r.error.slice(0, 1000) } : {}),
      });

      if (r.error) {
        // Missing API key: park the lead as "blocked" (no attempt burned). The rest of the run keeps going;
        // finishIfIdle pauses the run at the end and Resume unblocks.
        if (/ is not set on the Convex deployment/.test(r.error)) {
          await ctx.db.patch(lead._id, { state: "blocked", lastError: r.error });
          continue;
        }
        const attempts = lead.attempts + 1;
        await ctx.db.patch(lead._id, { attempts, lastError: r.error.slice(0, 500), state: attempts >= MAX_ATTEMPTS ? "error" : "queued" });
        if (attempts >= MAX_ATTEMPTS) bump(counts, "error");
        continue;
      }
      const out = r.out!;
      if (out.blob) await upsertBlob(ctx, lead._id, out.blob);
      const patch: Partial<Doc<"leads">> = { ...out.patch, costUsd: lead.costUsd + cost, attempts: 0, lastError: undefined };

      // Global dedupe by domain: one company = one lead, across all runs.
      for (const b of out.bumps ?? []) bump(counts, b);
      if (out.patch.domain && out.patch.domain !== lead.domain && out.next !== "rejected") {
        const twin = await ctx.db.query("leads").withIndex("by_domain", (q) => q.eq("domain", out.patch.domain)).first();
        if (twin && twin._id !== lead._id) {
          bump(counts, "dup");
          await ctx.db.patch(lead._id, { ...patch, state: "duplicate", duplicateOf: twin._id, rejectReason: "duplicate_domain" });
          continue;
        }
      }
      if (out.next === "blocked") {
        // Waiting for an API key; partial progress (patch) is kept so Resume doesn't pay for it again.
        await ctx.db.patch(lead._id, { ...patch, state: "blocked", lastError: out.reject });
      } else if (out.next === "rejected") {
        bump(counts, `rej:${(out.reject ?? "rejected").split(":")[0]}`);
        await ctx.db.patch(lead._id, { ...patch, state: "rejected", rejectReason: out.reject });
      } else if (out.next === "ready") {
        bump(counts, "ready");
        await ctx.db.patch(lead._id, { ...patch, state: "done", stage: "ready" });
      } else {
        if (STAGES.indexOf(out.next as Stage) > STAGES.indexOf(r.stage)) bump(counts, `in:${out.next}`);
        if (out.patch.emailStatus && out.next === "personalize") bump(counts, `email:${out.patch.emailStatus}`);
        await ctx.db.patch(lead._id, { ...patch, state: "queued", stage: out.next });
      }
    }
    await ctx.db.patch(runId, { counts, costs, spentUsd: spent });
  },
});

async function upsertBlob(ctx: MutationCtx, leadId: Id<"leads">, blob: { siteText?: string; evidence?: string }) {
  const doc = await ctx.db.query("leadBlobs").withIndex("by_lead", (q) => q.eq("leadId", leadId)).unique();
  if (doc) await ctx.db.patch(doc._id, blob);
  else await ctx.db.insert("leadBlobs", { leadId, ...blob });
}

export const finishIfIdle = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const busy = await ctx.db.query("leads").withIndex("by_run_state", (q) => q.eq("runId", runId).eq("state", "working")).first();
    const run = await ctx.db.get(runId);
    if (busy || run?.status !== "running") return;
    const blocked = await ctx.db.query("leads").withIndex("by_run_state", (q) => q.eq("runId", runId).eq("state", "blocked")).take(5000);
    if (blocked.length) {
      const keys = [...new Set(blocked.map((l) => l.lastError?.match(/(\w+) is not set/)?.[1]).filter(Boolean))].join(", ");
      await ctx.db.patch(runId, { status: "paused", pauseReason: `${blocked.length} lead(s) are waiting for ${keys}. Add it in Convex → Settings → Environment Variables, then Resume.` });
    } else await ctx.db.patch(runId, { status: "done", finishedAt: Date.now() });
  },
});

export const setStatus = internalMutation({
  args: { runId: v.id("runs"), status: v.string(), pauseReason: v.optional(v.string()) },
  handler: async (ctx, { runId, status, pauseReason }) => {
    await ctx.db.patch(runId, { status: status as Doc<"runs">["status"], pauseReason });
  },
});

// ---------------------------------------------------------------- sweeper (cron)

/** Re-queue leads whose tick died, and restart tick chains for running runs that went quiet. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const lead of await ctx.db.query("leads").withIndex("by_state", (q) => q.eq("state", "working")).take(500))
      if ((lead.leaseAt ?? 0) < now - LEASE_MS) {
        // Its tick died mid-stage: counts as a failed attempt, so a lead that keeps killing ticks can't loop forever.
        const attempts = lead.attempts + 1;
        await ctx.db.patch(lead._id, { attempts, state: attempts >= MAX_ATTEMPTS ? "error" : "queued", lastError: "worker stopped mid-stage (timeout/crash)" });
      }
    for (const run of await ctx.db.query("runs").collect())
      if (run.status === "running" && run.tickAt < now - 15 * 60 * 1000) {
        await ctx.db.patch(run._id, { tickAt: now });
        await ctx.scheduler.runAfter(0, internal.worker.tick, { runId: run._id });
      }
  },
});

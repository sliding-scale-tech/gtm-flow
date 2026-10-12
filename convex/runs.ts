import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireSession } from "./auth";

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireSession(ctx, token);
    return await ctx.db.query("runs").order("desc").take(100);
  },
});

export const get = query({
  args: { token: v.string(), runId: v.id("runs") },
  handler: async (ctx, { token, runId }) => {
    await requireSession(ctx, token);
    return await ctx.db.get(runId);
  },
});

export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireSession(ctx, token);
    const runs = await ctx.db.query("runs").collect();
    const t = { runs: runs.length, rows: 0, spent: 0, valid: 0, catchAll: 0, risky: 0, ready: 0, costs: {} as Record<string, number> };
    for (const r of runs) {
      t.rows += r.counts.rows ?? 0;
      t.spent += r.spentUsd;
      t.valid += r.counts["email:valid"] ?? 0;
      t.catchAll += r.counts["email:catch_all"] ?? 0;
      t.risky += r.counts["email:risky"] ?? 0;
      t.ready += r.counts.ready ?? 0;
      for (const [k, c] of Object.entries(r.costs)) t.costs[k] = (t.costs[k] ?? 0) + c;
    }
    return t;
  },
});

export const control = mutation({
  args: { token: v.string(), runId: v.id("runs"), action: v.union(v.literal("pause"), v.literal("resume"), v.literal("stop")), budgetUsd: v.optional(v.number()) },
  handler: async (ctx, { token, runId, action, budgetUsd }) => {
    await requireSession(ctx, token);
    const run = await ctx.db.get(runId);
    if (!run) throw new ConvexError("Run not found");
    if (budgetUsd !== undefined) {
      if (!(budgetUsd >= 0 && budgetUsd <= 100000)) throw new ConvexError("Budget must be 0-100000");
      await ctx.db.patch(runId, { budgetUsd });
    }
    if (action === "pause" && run.status === "running") await ctx.db.patch(runId, { status: "paused", pauseReason: "Paused by you" });
    if (action === "stop" && run.status !== "done") await ctx.db.patch(runId, { status: "stopped", finishedAt: Date.now() });
    if (action === "resume" && ["paused", "done", "stopped"].includes(run.status)) {
      const budget = budgetUsd ?? run.budgetUsd;
      if (run.spentUsd >= budget) throw new ConvexError("Raise the budget first — this run already spent its budget.");
      for (const l of await ctx.db.query("leads").withIndex("by_run_state", (q) => q.eq("runId", runId).eq("state", "blocked")).take(5000))
        await ctx.db.patch(l._id, { state: "queued" });
      await ctx.db.patch(runId, { status: "running", pauseReason: undefined, tickAt: Date.now(), finishedAt: undefined });
      await ctx.scheduler.runAfter(0, internal.worker.tick, { runId });
    }
  },
});

export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireSession(ctx, token);
    return await ctx.storage.generateUploadUrl();
  },
});

// ---- internal helpers for the ingest action ----

export const create = internalMutation({
  args: { fileName: v.string(), source: v.string(), budgetUsd: v.number() },
  handler: async (ctx, a) =>
    await ctx.db.insert("runs", { ...a, status: "ingesting", spentUsd: 0, costs: {}, counts: {}, rowsTotal: 0, tickAt: Date.now(), startedAt: Date.now() }),
});

export const markIngested = internalMutation({
  args: { runId: v.id("runs"), rowsTotal: v.number(), error: v.optional(v.string()) },
  handler: async (ctx, { runId, rowsTotal, error }) => {
    if (error) return await ctx.db.patch(runId, { status: "error", error, rowsTotal });
    await ctx.db.patch(runId, { status: "running", rowsTotal, tickAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.worker.tick, { runId });
  },
});

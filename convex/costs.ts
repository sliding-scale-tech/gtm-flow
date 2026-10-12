// Backend for the Costs page. The page reads one snapshot (runs + prices + last Drive scan) only when you press Refresh.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { requireSession } from "./auth";
import { loadSettings } from "./settings";

const SCAN_KEY = "driveScan";

export const report = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireSession(ctx, token);
    const runs = await ctx.db.query("runs").order("desc").take(500);
    const scan = (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", SCAN_KEY)).unique())?.value ?? null;
    const settings = await loadSettings(ctx);
    return {
      at: Date.now(),
      prices: settings.prices,
      scan,
      runs: runs.map((r) => ({ id: r._id as string, name: r.fileName, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, spentUsd: r.spentUsd, costs: r.costs, counts: r.counts })),
    };
  },
});

// ---- Drive scan state (written by ingest.runDriveScan) ----
export const scanState = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", SCAN_KEY)).unique())?.value ?? null,
});

export const setScan = internalMutation({
  args: { value: v.any() },
  handler: async (ctx, { value }) => {
    const doc = await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", SCAN_KEY)).unique();
    if (doc) await ctx.db.patch(doc._id, { value });
    else await ctx.db.insert("meta", { key: SCAN_KEY, value });
  },
});

// ---- One-time backfill of the counters pipeline.apply now keeps (run: npx convex run costs:backfill) ----
export const logPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const p = await ctx.db.query("stepLogs").paginate({ cursor, numItems: 500 });
    return { rows: p.page.map((l) => ({ runId: l.runId as string, stage: l.stage, calls: l.calls })), cursor: p.continueCursor, done: p.isDone };
  },
});

export const leadPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const p = await ctx.db.query("leads").paginate({ cursor, numItems: 200 });
    return {
      rows: p.page.map((l) => ({ runId: l.runId as string, state: l.state, rejectReason: l.rejectReason, emailStatus: l.emailStatus, emailSource: l.emailSource, costUsd: l.costUsd })),
      cursor: p.continueCursor, done: p.isDone,
    };
  },
});

const PREFIXES = ["c:stage:", "c:out:", "src:"];
export const setCounters = internalMutation({
  args: { runId: v.id("runs"), kv: v.record(v.string(), v.number()) },
  handler: async (ctx, { runId, kv }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const counts = Object.fromEntries(Object.entries(run.counts).filter(([k]) => !PREFIXES.some((p) => k.startsWith(p))));
    await ctx.db.patch(runId, { counts: { ...counts, ...kv } });
  },
});

export const backfill = internalAction({
  args: {},
  handler: async (ctx) => {
    const per: Record<string, Record<string, number>> = {};
    const add = (runId: string, key: string, n: number) => { const m = (per[runId] ||= {}); m[key] = (m[key] ?? 0) + n; };
    for (let cursor: string | null = null; ;) {
      const p: { rows: { runId: string; stage: string; calls: { provider: string; costUsd: number }[] }[]; cursor: string; done: boolean } = await ctx.runQuery(internal.costs.logPage, { cursor });
      for (const l of p.rows) for (const c of l.calls) add(l.runId, `c:stage:${l.stage}:${c.provider}`, c.costUsd);
      if (p.done) break;
      cursor = p.cursor;
    }
    for (let cursor: string | null = null; ;) {
      const p: { rows: { runId: string; state: string; rejectReason?: string; emailStatus?: string; emailSource?: string; costUsd: number }[]; cursor: string; done: boolean } = await ctx.runQuery(internal.costs.leadPage, { cursor });
      for (const l of p.rows) {
        if (l.state === "rejected") add(l.runId, `c:out:rej:${(l.rejectReason ?? "rejected").split(":")[0]}`, l.costUsd);
        else if (l.state === "duplicate") add(l.runId, "c:out:dup", l.costUsd);
        else if (l.state === "error") add(l.runId, "c:out:error", l.costUsd);
        else if (l.state === "done") {
          const st = l.emailStatus ?? "none";
          add(l.runId, `c:out:email:${st}`, l.costUsd);
          if (st === "valid" || st === "catch_all") add(l.runId, `src:${l.emailSource ?? "unknown"}`, 1);
        }
      }
      if (p.done) break;
      cursor = p.cursor;
    }
    for (const [runId, kv] of Object.entries(per)) await ctx.runMutation(internal.costs.setCounters, { runId: runId as never, kv });
    return { runsUpdated: Object.keys(per).length };
  },
});

"use node";
// Pipeline worker (Node runtime: the LangGraph research agent needs it). DB work stays in pipeline.ts mutations.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { STAGES, type Stage } from "./lib/stageList";
import { RUNNERS } from "./stages";
import type { Call } from "./stageKit";

export const tick = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const st = await ctx.runQuery(internal.pipeline.tickState, { runId });
    if (!st || st.status !== "running") return;
    if (st.spentUsd >= st.budgetUsd) {
      await ctx.runMutation(internal.pipeline.setStatus, { runId, status: "paused", pauseReason: `Budget reached ($${st.spentUsd.toFixed(2)} of $${st.budgetUsd})` });
      return;
    }
    const batch = await ctx.runMutation(internal.pipeline.claim, { runId, n: st.settings.batchSize });
    if (!batch.length) {
      await ctx.runMutation(internal.pipeline.finishIfIdle, { runId });
      return;
    }
    // Each lead is saved the moment its stage finishes, so a crash/timeout mid-batch never loses finished work
    // (or its cost). Leads still unsaved stay "working" and the sweeper re-queues them.
    await Promise.all(batch.map(async ({ lead, blob, named }) => {
      const t0 = Date.now();
      const stage = lead.stage as Stage;
      const calls: Call[] = [];
      let result;
      try {
        if (!STAGES.includes(stage)) throw new Error(`unknown stage ${stage}`);
        const out = await RUNNERS[stage]({ lead, blob, named, calls, settings: st.settings, prompts: st.prompts });
        result = { leadId: lead._id, stage, ms: Date.now() - t0, out };
      } catch (e) {
        result = { leadId: lead._id, stage, ms: Date.now() - t0, calls, error: e instanceof Error ? e.message : String(e) };
      }
      await ctx.runMutation(internal.pipeline.apply, { runId, results: [result] as any });
    }));
    await ctx.scheduler.runAfter(0, internal.worker.tick, { runId });
  },
});


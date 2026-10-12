// Shared types + helpers for pipeline stages (split out so agent.ts and stages.ts don't import each other).
import type { Doc } from "./_generated/dataModel";
import type { PromptKey, Settings } from "./defaults";
import type { Stage } from "./lib/stageList";
import { parseReviews } from "./lib/text";
import type { ExaHit } from "./providers/exa";
import { fill, gemini, type Tier } from "./providers/gemini";

export type Call = { provider: string; costUsd: number };
export type StageOut = {
  patch: Partial<Doc<"leads">>;
  blob?: { siteText?: string; evidence?: string };
  next: Stage | "ready" | "rejected" | "blocked"; // blocked: waiting for a missing API key (reject = the message)
  reject?: string;
  bumps?: string[]; // extra funnel counters (site_ok, icp, owner)
  calls: Call[];
  summary: string;
};
export type StageCtx = {
  lead: Doc<"leads">;
  blob: { siteText?: string; evidence?: string } | null;
  named?: { author: string; text: string }[]; // 5★ reviews with reviewer first names (reviews.csv), personalize only
  calls?: Call[]; // shared with the worker, so paid calls are still billed if the stage throws
  settings: Settings;
  prompts: Record<PromptKey, string>;
};

export const str = { type: "string" };
export const num = { type: "number" };
export const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties) });

export const fmtHits = (hits: ExaHit[]) => hits.map((h, i) => `[${i + 1}] ${h.url} | ${h.title}\n${h.text.slice(0, 1200)}`).join("\n\n");

export function helpers(c: StageCtx) {
  const calls: Call[] = c.calls ?? [];
  const vars = {
    name: c.lead.name, category: c.lead.category, city: c.lead.county ? `${c.lead.county}` : "", state: c.lead.usState,
    phone: c.lead.phone, rating: c.lead.rating, reviews_count: c.lead.reviewsCount, domain: c.lead.domain,
  };
  const ai = async <T,>(key: PromptKey, tier: Tier, extra: Record<string, string>, schema?: object, tools?: object[]) => {
    const r = await gemini<T>({ tier, settings: c.settings, prompt: fill(c.prompts[key], { ...vars, ...extra }), schema, tools, mockKey: key, mockSeed: c.lead.name });
    calls.push({ provider: "gemini", costUsd: r.costUsd });
    return r.data;
  };
  const track = <T extends { costUsd: number }>(provider: string, r: T) => { calls.push({ provider, costUsd: r.costUsd }); return r; };
  return { calls, ai, track };
}

export const reject = (calls: Call[], reason: string, summary: string, patch: Partial<Doc<"leads">> = {}): StageOut =>
  ({ patch, next: "rejected", reject: reason, calls, summary });

export const reviewSample = (all: string, n = 6) => parseReviews(all).slice(0, n).map((r) => `${r.stars}★ ${r.text}`).join("\n");

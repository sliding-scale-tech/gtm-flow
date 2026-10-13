import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { requireSession } from "./auth";
import { DEFAULT_PROMPTS, DEFAULT_SETTINGS, PROMPT_KEYS, type PromptKey, type Settings } from "./defaults";

export async function loadSettings(ctx: QueryCtx): Promise<Settings> {
  const data = ((await ctx.db.query("settings").first())?.data ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    models: { ...DEFAULT_SETTINGS.models, ...data.models },
    prices: { ...DEFAULT_SETTINGS.prices, ...Object.fromEntries(Object.entries(data.prices ?? {}).filter(([k]) => k in DEFAULT_SETTINGS.prices)) },
  };
}

export async function loadPrompts(ctx: QueryCtx): Promise<Record<PromptKey, string>> {
  const out = { ...DEFAULT_PROMPTS };
  for (const p of await ctx.db.query("prompts").collect()) if (p.active) out[p.key as PromptKey] = p.text;
  return out;
}

export const config = internalQuery({
  args: {},
  handler: async (ctx) => ({ settings: await loadSettings(ctx), prompts: await loadPrompts(ctx) }),
});

export const get = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireSession(ctx, token);
    const keys = { gemini: "GEMINI_API_KEY", exa: "EXA_API_KEY", findymail: "FINDYMAIL_API_KEY", trykitt: "TRYKITT_API_KEY", bouncer: "BOUNCER_API_KEY",
      instantly: "INSTANTLY_API_KEY", googleServiceAccount: "GOOGLE_SERVICE_ACCOUNT_JSON", driveFolder: "DRIVE_FOLDER_ID" };
    // Only presence is exposed, never values.
    const keyStatus = Object.fromEntries(Object.entries(keys).map(([k, env]) => [k, !!process.env[env]]));
    return { settings: await loadSettings(ctx), defaults: DEFAULT_SETTINGS, keyStatus, mock: process.env.PIPELINE_MOCK === "1" };
  },
});

const isStrArr = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string" && s.length < 200) && x.length < 1000;

/** Allowlisted, type-checked merge — the client can't write arbitrary fields. */
function validate(input: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(input)) {
    const def = (DEFAULT_SETTINGS as Record<string, unknown>)[k];
    if (def === undefined) throw new ConvexError(`Unknown setting: ${k}`);
    if (k === "campaignVariables") {
      if (!Array.isArray(val) || val.length > 20) throw new ConvexError("campaignVariables must be a list (max 20)");
      for (const cv of val as Record<string, unknown>[]) {
        if (typeof cv.key !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(cv.key)) throw new ConvexError(`Bad variable key: ${cv.key}`);
        for (const f of ["sentence", "instructions", "fallback"]) if (typeof cv[f] !== "string" || (cv[f] as string).length > 4000) throw new ConvexError(`Variable ${cv.key}: bad ${f}`);
      }
      out[k] = val.map((cv: Record<string, string>) => ({ key: cv.key, sentence: cv.sentence, instructions: cv.instructions, fallback: cv.fallback }));
    } else if (Array.isArray(def)) {
      if (!isStrArr(val)) throw new ConvexError(`${k} must be a list of short strings`);
      out[k] = (val as string[]).map((s) => s.trim()).filter(Boolean);
    } else if (typeof def === "object") {
      const sub: Record<string, unknown> = {};
      for (const [sk, sv] of Object.entries(val as Record<string, unknown>)) {
        const sdef = (def as Record<string, unknown>)[sk];
        if (sdef === undefined || typeof sv !== typeof sdef) throw new ConvexError(`Bad ${k}.${sk}`);
        if (typeof sv === "number" && !(sv >= 0)) throw new ConvexError(`${k}.${sk} must be >= 0`);
        sub[sk] = sv;
      }
      out[k] = sub;
    } else {
      if (typeof val !== typeof def) throw new ConvexError(`${k} has the wrong type`);
      if (typeof val === "number" && !(val >= 0)) throw new ConvexError(`${k} must be >= 0`);
      out[k] = val;
    }
  }
  if (typeof out.batchSize === "number" && (out.batchSize < 1 || out.batchSize > 50)) throw new ConvexError("batchSize must be 1-50");
  if (out.maxCompanySize !== undefined && !["1-10", "11-50", "51-200", "200+"].includes(out.maxCompanySize as string)) throw new ConvexError("maxCompanySize must be 1-10, 11-50, 51-200 or 200+");
  if (typeof out.agentMaxTools === "number" && (out.agentMaxTools < 0 || out.agentMaxTools > 10)) throw new ConvexError("agentMaxTools must be 0-10");
  return out as Partial<Settings>;
}

export const save = mutation({
  args: { token: v.string(), data: v.any() },
  handler: async (ctx, { token, data }) => {
    await requireSession(ctx, token);
    const doc = await ctx.db.query("settings").first();
    const merged = { ...(doc?.data ?? {}), ...validate(data ?? {}) };
    if (doc) await ctx.db.patch(doc._id, { data: merged });
    else await ctx.db.insert("settings", { data: merged });
  },
});

// ---- prompts (versioned) ----

export const prompts = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireSession(ctx, token);
    const all = await ctx.db.query("prompts").collect();
    return PROMPT_KEYS.map((key) => {
      const versions = all.filter((p) => p.key === key).sort((a, b) => b.version - a.version);
      const active = versions.find((p) => p.active);
      return { key, text: active?.text ?? DEFAULT_PROMPTS[key], activeVersion: active?.version ?? 0, defaultText: DEFAULT_PROMPTS[key],
        versions: versions.map((p) => ({ version: p.version, active: p.active, createdAt: p.createdAt, text: p.text })) };
    });
  },
});

export const savePrompt = mutation({
  args: { token: v.string(), key: v.string(), text: v.string() },
  handler: async (ctx, { token, key, text }) => {
    await requireSession(ctx, token);
    if (!(PROMPT_KEYS as readonly string[]).includes(key)) throw new ConvexError("Unknown prompt");
    if (!text.trim() || text.length > 20000) throw new ConvexError("Prompt must be 1-20000 chars");
    const versions = await ctx.db.query("prompts").withIndex("by_key", (q) => q.eq("key", key)).collect();
    for (const p of versions) if (p.active) await ctx.db.patch(p._id, { active: false });
    const version = Math.max(0, ...versions.map((p) => p.version)) + 1;
    await ctx.db.insert("prompts", { key, version, text, active: true, createdAt: Date.now() });
    return version;
  },
});

/** version 0 = built-in default. */
export const activatePrompt = mutation({
  args: { token: v.string(), key: v.string(), version: v.number() },
  handler: async (ctx, { token, key, version }) => {
    await requireSession(ctx, token);
    for (const p of await ctx.db.query("prompts").withIndex("by_key", (q) => q.eq("key", key)).collect())
      await ctx.db.patch(p._id, { active: p.version === version });
  },
});

const NEW_DENY = ["vacation home rental agency", "apartment rental agency", "property maintenance", "equipment rental agency",
  "county government office", "housing development", "lodging", "tax assessor", "legal services", "forestry service",
  "property investment company", "condominium rental agency"];

/** One-off: bring saved settings in line with the new default deny/allow category lists. */
export const addDenyCategories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("settings").first();
    const data = (doc?.data ?? {}) as Partial<Settings>;
    const changed = { addedDeny: [] as string[], removedAllow: [] as string[] };
    if (!doc) return changed;
    const patch: Partial<Settings> = {};
    if (Array.isArray(data.denyCategories)) {
      changed.addedDeny = NEW_DENY.filter((c) => !data.denyCategories!.includes(c));
      if (changed.addedDeny.length) patch.denyCategories = [...data.denyCategories, ...changed.addedDeny];
    }
    if (Array.isArray(data.allowCategories) && data.allowCategories.includes("apartment rental agency")) {
      changed.removedAllow = ["apartment rental agency"];
      patch.allowCategories = data.allowCategories.filter((c) => c !== "apartment rental agency");
    }
    if (Object.keys(patch).length) await ctx.db.patch(doc._id, { data: { ...data, ...patch } });
    return changed;
  },
});

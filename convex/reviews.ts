// Reviewer-named 5★ reviews (from reviews.csv) used for the "I saw <first name>'s review…" opening line.
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireSession } from "./auth";

const MAX_PER_PLACE = 3;
const rowV = v.object({ placeId: v.string(), author: v.string(), rating: v.number(), text: v.string() });

/** Idempotent: keeps at most 3 per place and skips texts already stored, so re-running the import is safe. */
export const insertBatch = internalMutation({
  args: { rows: v.array(rowV) },
  handler: async (ctx, { rows }) => {
    const have = new Map<string, string[]>();
    let inserted = 0;
    for (const r of rows) {
      let texts = have.get(r.placeId);
      if (!texts) {
        texts = (await ctx.db.query("reviews").withIndex("by_place", (q) => q.eq("placeId", r.placeId)).take(MAX_PER_PLACE)).map((x) => x.text);
        have.set(r.placeId, texts);
      }
      if (texts.length >= MAX_PER_PLACE || texts.includes(r.text)) continue;
      await ctx.db.insert("reviews", r);
      texts.push(r.text);
      inserted++;
    }
    return inserted;
  },
});

export const setStatus = internalMutation({
  args: { value: v.any() },
  handler: async (ctx, { value }) => {
    const doc = await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", "reviewsImport")).unique();
    if (doc) await ctx.db.patch(doc._id, { value: { ...doc.value, ...value } });
    else await ctx.db.insert("meta", { key: "reviewsImport", value });
  },
});

export const status = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireSession(ctx, token);
    return (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", "reviewsImport")).unique())?.value ?? null;
  },
});

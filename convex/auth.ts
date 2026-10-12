import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const SESSION_MS = 30 * 24 * 3600 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const pwTag = async () => (await sha256(`session-v1:${process.env.APP_PASSWORD ?? ""}`)).slice(0, 32);

/** Guard for every public query/mutation. Throws if the token is missing, unknown, expired, or from before a password change. */
export async function requireSession(ctx: QueryCtx, token: string | undefined): Promise<void> {
  if (!token || token.length !== 64) throw new ConvexError("unauthorized");
  const hash = await sha256(token);
  const session = await ctx.db.query("sessions").withIndex("by_hash", (q) => q.eq("tokenHash", hash)).unique();
  if (!session || session.expiresAt < Date.now() || session.pwTag !== (await pwTag())) throw new ConvexError("unauthorized");
}

export const login = action({
  args: { password: v.string() },
  handler: async (ctx, { password }): Promise<string> => {
    // Only FAILED attempts count, so someone spamming wrong passwords can't burn the owner's successful logins.
    if (await ctx.runQuery(internal.auth.locked, {})) throw new ConvexError("Too many failed attempts. Try again in 15 minutes.");
    const expected = process.env.APP_PASSWORD;
    if (!expected || expected.length < 8) throw new ConvexError("APP_PASSWORD (8+ chars) is not set on the Convex deployment.");
    if (!sameString(await sha256(password), await sha256(expected))) {
      await ctx.runMutation(internal.auth.recordFailure, {});
      throw new ConvexError("Wrong password.");
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.runMutation(internal.auth.createSession, { tokenHash: await sha256(token) });
    return token;
  },
});

export const locked = internalQuery({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db.query("loginAttempts").first();
    return !!doc && Date.now() - doc.windowStart <= WINDOW_MS && doc.count >= MAX_ATTEMPTS;
  },
});

export const recordFailure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const doc = await ctx.db.query("loginAttempts").first();
    if (!doc) await ctx.db.insert("loginAttempts", { windowStart: now, count: 1 });
    else if (now - doc.windowStart > WINDOW_MS) await ctx.db.patch(doc._id, { windowStart: now, count: 1 });
    else await ctx.db.patch(doc._id, { count: doc.count + 1 });
  },
});

export const createSession = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const tag = await pwTag();
    // Drop expired sessions and ones issued under an old password; a good login also clears the failure counter.
    for (const old of await ctx.db.query("sessions").collect()) if (old.expiresAt < Date.now() || old.pwTag !== tag) await ctx.db.delete(old._id);
    for (const a of await ctx.db.query("loginAttempts").collect()) await ctx.db.delete(a._id);
    await ctx.db.insert("sessions", { tokenHash, expiresAt: Date.now() + SESSION_MS, pwTag: tag });
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const hash = await sha256(token);
    const s = await ctx.db.query("sessions").withIndex("by_hash", (q) => q.eq("tokenHash", hash)).unique();
    if (s) await ctx.db.delete(s._id);
  },
});

export const check = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }) => {
    try { await requireSession(ctx, token); return true; } catch { return false; }
  },
});

/** For actions: `await ctx.runQuery(internal.auth.assert, { token })`. */
export const assert = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => { await requireSession(ctx, token); },
});

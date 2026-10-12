"use node";
// Node runtime + streaming parse: state files can be 150 MB+ (TX). Rows are parsed and inserted
// chunk by chunk, so memory stays flat regardless of file size.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { CsvStream } from "./lib/csv";
import { cleanRow } from "./lib/rules";
import { clip } from "./lib/text";
import { listCsvFiles, openCsv, openReviewsCsv } from "./providers/google";

const CHUNK = 200;
const MAX_UPLOAD = 200 * 1024 * 1024;
const REQUIRED = ["name", "category"];

const num = (s: string | undefined) => (s && !Number.isNaN(Number(s)) ? Number(s) : undefined);
const mapRow = (r: Record<string, string>) => ({
  placeId: clip(r.place_id || r.cid || `${r.name}|${r.phone}`, 200),
  name: clip(r.name, 300),
  category: clip(r.category, 200),
  address: clip(r.address_line, 300),
  phone: clip(r.phone, 50),
  website: clip(r.website, 500),
  rating: num(r.rating),
  reviewsCount: num(r.reviews_count),
  county: clip(r.county_name, 100),
  usState: clip(r.state, 50),
  mapsUrl: clip(r.maps_url, 1000),
  reviews: clip(r.allReviews, 5000),
  openState: clip(r.open_state, 100),
});

export const driveFiles = action({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await ctx.runQuery(internal.auth.assert, { token });
    try { return { files: await listCsvFiles(), error: null as string | null }; }
    catch (e) { return { files: [], error: e instanceof Error ? e.message : String(e) }; }
  },
});

/**
 * Free preview of a Drive file: total rows, rows passing the free cleaning, and how many of those are new
 * (not processed in an earlier run). Streams the file; no paid calls.
 */
export const fileStats = action({
  args: { token: v.string(), driveFileId: v.string() },
  handler: async (ctx, { token, driveFileId }) => {
    await ctx.runQuery(internal.auth.assert, { token });
    const { settings } = await ctx.runQuery(internal.settings.config, {});
    const { body } = await openCsv(driveFileId);
    const parser = new CsvStream();
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let rows = 0, passing = 0, buildings = 0;
    const reasons: Record<string, number> = {};
    const ids: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      const out = done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(value, { stream: true }));
      for (const r of out) {
        rows++;
        const c = cleanRow({ name: r.name, category: r.category, open_state: r.open_state }, settings);
        if (!c.ok) { const k = c.reason.split(":")[0]; reasons[k] = (reasons[k] ?? 0) + 1; continue; }
        passing++;
        if (c.isBuilding) buildings++;
        ids.push((r.place_id || r.cid || `${r.name}|${r.phone}`).slice(0, 200));
      }
      if (done) break;
    }
    // "Already processed": load every processed place id once (paged) and check in memory. One index lookup per
    // CSV row (TX ≈ 31k) hit Convex's "too many system operations" limit and took minutes.
    // ponytail: reads the whole leads table; fine up to ~100k+ leads, switch to a slim placeIds table beyond that.
    const done = new Set<string>();
    for (let cursor: string | null = null; ;) {
      const p: { ids: string[]; cursor: string; done: boolean } = await ctx.runQuery(internal.pipeline.placeIdPage, { cursor });
      p.ids.forEach((id) => done.add(id));
      if (p.done) break;
      cursor = p.cursor;
    }
    const alreadySeen = ids.filter((id) => done.has(id)).length;
    return { rows, passing, buildings, alreadySeen, newLeads: passing - alreadySeen, dropped: reasons };
  },
});

/**
 * Start a run from a Drive file or an uploaded CSV. `maxNew` = stop after this many NEW leads pass
 * cleaning (rows seen in earlier runs are skipped for free), so a big state can be done in chunks.
 */
export const startRun = action({
  args: {
    token: v.string(),
    budgetUsd: v.number(),
    maxNew: v.optional(v.number()),
    driveFileId: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<Id<"runs">> => {
    await ctx.runQuery(internal.auth.assert, { token: a.token });
    if (!(a.budgetUsd > 0 && a.budgetUsd <= 100000)) throw new ConvexError("Budget must be between 0 and 100000");
    if (a.maxNew !== undefined && !(Number.isInteger(a.maxNew) && a.maxNew > 0)) throw new ConvexError("Max new leads must be a whole number above 0");
    if (!a.driveFileId === !a.storageId) throw new ConvexError("Pick exactly one file");

    let body: ReadableStream<Uint8Array>;
    let fileName: string;
    if (a.driveFileId) {
      const f = await openCsv(a.driveFileId);
      body = f.body; fileName = f.name;
    } else {
      const blob = await ctx.storage.get(a.storageId!);
      if (!blob) throw new ConvexError("Upload not found");
      if (blob.size > MAX_UPLOAD) throw new ConvexError("File too large (max 200 MB) — put it in the Drive folder instead");
      body = blob.stream() as ReadableStream<Uint8Array>;
      fileName = (a.fileName ?? "upload.csv").replace(/[^\w.\- ]/g, "").slice(0, 120) || "upload.csv";
    }
    if (a.maxNew) fileName += ` (next ${a.maxNew})`;

    const runId = await ctx.runMutation(internal.runs.create, { fileName, source: a.driveFileId ? "drive" : "upload", budgetUsd: a.budgetUsd });
    const parser = new CsvStream();
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let pending: Record<string, string>[] = [];
    let scanned = 0;
    let fresh = 0;
    const full = () => a.maxNew !== undefined && fresh >= a.maxNew;

    const flush = async () => {
      while (pending.length >= CHUNK || (pending.length && done)) {
        const batch = pending.splice(0, CHUNK);
        if (scanned === 0) {
          const missing = REQUIRED.filter((k) => !(k in batch[0]));
          if (missing.length) throw new ConvexError(`Not a Google Maps CSV (missing: ${missing.join(", ")})`);
        }
        scanned += batch.length;
        fresh += await ctx.runMutation(internal.pipeline.insertBatch, {
          runId, rows: batch.map(mapRow), ...(a.maxNew !== undefined ? { maxNew: a.maxNew - fresh } : {}),
        });
        if (full()) return;
      }
    };

    let done = false;
    try {
      while (!full()) {
        const { value, done: eof } = await reader.read();
        if (eof) {
          pending.push(...parser.push(decoder.decode()), ...parser.end());
          done = true;
          await flush();
          break;
        }
        pending.push(...parser.push(decoder.decode(value, { stream: true })));
        await flush();
      }
      await reader.cancel().catch(() => {});
      if (a.storageId) await ctx.storage.delete(a.storageId);
      if (scanned === 0) throw new ConvexError("The file has no data rows");
      await ctx.runMutation(internal.runs.markIngested, { runId, rowsTotal: scanned });
    } catch (e) {
      await reader.cancel().catch(() => {});
      await ctx.runMutation(internal.runs.markIngested, { runId, rowsTotal: scanned, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    return runId;
  },
});

// ---------------------------------------------------------------- reviews.csv (reviewer first names)

/** "BRUCE willows" -> "Bruce"; null for initials, emoji, numbers, business names. */
export function firstName(author: string): string | null {
  const t = (author ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{1,19}$/.test(t)) return null;
  return t[0].toUpperCase() + t.slice(1).toLowerCase();
}

export const importReviews = action({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await ctx.runQuery(internal.auth.assert, { token });
    await ctx.runMutation(internal.reviews.setStatus, { value: { state: "running", startedAt: Date.now(), rows: 0, kept: 0, error: null } });
    await ctx.scheduler.runAfter(0, internal.ingest.runReviewsImport, {});
  },
});

/** Streams reviews.csv, keeps 5★ reviews with a usable first name (max 3 per place), inserts idempotently. */
export const runReviewsImport = internalAction({
  args: {},
  handler: async (ctx) => {
    const MAX = 3;
    const perPlace = new Map<string, number>();
    let rows = 0, kept = 0, batch: { placeId: string; author: string; rating: number; text: string }[] = [], flushes = 0;
    const flush = async () => {
      if (!batch.length) return;
      await ctx.runMutation(internal.reviews.insertBatch, { rows: batch });
      batch = [];
      if (++flushes % 20 === 0) await ctx.runMutation(internal.reviews.setStatus, { value: { rows, kept } });
    };
    try {
      const { body } = await openReviewsCsv();
      const parser = new CsvStream(), decoder = new TextDecoder(), reader = body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        const out = done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(value, { stream: true }));
        for (const r of out) {
          rows++;
          const text = (r.text ?? "").replace(/\s+/g, " ").trim();
          if (Number(r.rating) < 5 || text.length < 25 || !r.place_id) continue;
          const name = firstName(r.author);
          if (!name || (perPlace.get(r.place_id) ?? 0) >= MAX) continue;
          perPlace.set(r.place_id, (perPlace.get(r.place_id) ?? 0) + 1);
          batch.push({ placeId: clip(r.place_id, 200), author: name, rating: 5, text: clip(text, 600) });
          kept++;
          if (batch.length >= 400) await flush();
        }
        if (done) break;
      }
      await flush();
      await ctx.runMutation(internal.reviews.setStatus, { value: { state: "done", rows, kept, places: perPlace.size, finishedAt: Date.now() } });
    } catch (e) {
      await ctx.runMutation(internal.reviews.setStatus, { value: { state: "error", rows, kept, error: e instanceof Error ? e.message : String(e) } });
    }
  },
});

# Convex
Researched: 2026-10-07 · Version: convex 1.46.0 (npm, modified 2026-10-07) · Sources: https://docs.convex.dev/quickstart/nextjs, https://docs.convex.dev/database/pagination, https://docs.convex.dev/production/state/limits, https://docs.convex.dev/functions/runtimes, https://docs.convex.dev/cli/agent-mode, https://docs.convex.dev/cli/local-deployments, https://docs.convex.dev/scheduling/cron-jobs, https://docs.convex.dev/scheduling/scheduled-functions, https://docs.convex.dev/file-storage/store-files, https://docs.convex.dev/production/environment-variables, https://docs.convex.dev/production/hosting/vercel (plus empirical local test, see below)

## What we use it for
Backend DB + server functions. Actions (default V8 runtime) fetch Google Drive with plain fetch + Web Crypto, mutations write rows, queries feed the Next.js UI reactively; crons poll Drive.

## Key APIs / setup (minimal examples)

### Next.js App Router
```bash
npm i convex
npx convex dev        # creates convex/, writes env, regenerates convex/_generated
```
```tsx
// app/ConvexClientProvider.tsx
"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
export default function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
// app/layout.tsx (server component): <body><ConvexClientProvider>{children}</ConvexClientProvider></body>
```
NOTE: `npx convex dev` (local/anonymous) wrote `CONVEX_URL=http://127.0.0.1:3210` to `.env.local` (not NEXT_PUBLIC_). Add `NEXT_PUBLIC_CONVEX_URL=<same value>` yourself.

### Schema + indexes (convex/schema.ts)
```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  files: defineTable({ driveId: v.string(), name: v.string(), modifiedTime: v.string(), storageId: v.optional(v.id("_storage")) })
    .index("by_driveId", ["driveId"]),
});
```
Query with index: `ctx.db.query("files").withIndex("by_driveId", q => q.eq("driveId", id)).unique()`.

### Functions
```ts
import { query, mutation, action, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const list = query({ args: {}, handler: async (ctx) => ctx.db.query("files").collect() });
export const upsert = internalMutation({
  args: { driveId: v.string(), name: v.string() },
  handler: async (ctx, a) => { await ctx.db.insert("files", { ...a, modifiedTime: "" }); },
});
export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.runQuery(internal.files.listInternal, {});
    await ctx.runMutation(internal.files.upsert, { driveId: "x", name: "y" });
    await ctx.scheduler.runAfter(0, internal.files.sync, {});   // (delayMs, fnRef, args)
  },
});
```
Actions have no `ctx.db`; use ctx.runQuery/runMutation. `fetch` only in actions.

### Crons (convex/crons.ts)
```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
const crons = cronJobs();
crons.interval("sync drive", { minutes: 15 }, internal.files.sync, {});
// crons.cron("name", "23 * * * *", fn, args)  // UTC; docs advise avoiding minute 0
export default crons;
```
Only one run per job at a time; runs may be skipped if previous still running.

### Pagination
```ts
import { paginationOptsValidator } from "convex/server";
export const page = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) =>
    ctx.db.query("files").order("desc").paginate(paginationOpts),   // {page, isDone, continueCursor}
});
// client
const { results, status, loadMore } = usePaginatedQuery(api.files.page, {}, { initialNumItems: 25 });
// status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"; loadMore(n)
```

### Storage from actions
`const storageId = await ctx.storage.store(new Blob([text], {type:"text/csv"}));` returns `Id<"_storage">`; validate with `v.id("_storage")`; `ctx.storage.getUrl(id)` for URL.

### Environment variables
`npx convex env set NAME 'value'` (per deployment), read `process.env.NAME` in functions (string | undefined). Limits: 512 vars, 8 KiB/value, 512 KiB total. Multi-line PEM private keys: normalize with `.replace(/\\n/g, "\n")`. Docs also describe a typed `env` import via convex.config.ts (not used here).

### Runtimes
Default (V8, "Convex runtime"): `fetch` available in actions only; Web Crypto `crypto.subtle` available. VERIFIED EMPIRICALLY (local backend, convex 1.46.0, 2026-10-07): in an action, `crypto.subtle.generateKey` / `exportKey("pkcs8")` / `importKey("pkcs8", ..., {name:"RSASSA-PKCS1-v1_5", hash:"SHA-256"}, false, ["sign"])` / `sign` returned a 256-byte signature; `typeof fetch` and `typeof btoa` were "function". So no `"use node"` needed for Drive JWT signing. A `"use node"` file runs only in the Node action runtime (no queries/mutations in that file); needed only for libs that do not run in a browser-like env. Node actions: 5 MiB arg limit, 10 min timeout.

### Local development WITHOUT a Convex account (verified)
```bash
export CONVEX_AGENT_MODE=anonymous        # PowerShell: $env:CONVEX_AGENT_MODE="anonymous"
npx convex dev --once                     # provisions anonymous local backend, pushes functions, runs codegen, exits
npx convex run files:list '{}'            # works against the local backend
npx convex codegen                        # works AFTER a deployment is configured
```
Observed: "[Local] Port 3210 • No Convex account"; backend http://127.0.0.1:3210, site URL port 3211; `.env.local` got `CONVEX_DEPLOYMENT=anonymous:anonymous-agent`, `CONVEX_URL`, `CONVEX_SITE_URL`; state in `.convex/`. `convex/_generated/{api.js,api.d.ts,dataModel.d.ts,server.js,server.d.ts}` were created by `dev --once`. `npx convex run hello:hi '{"n":"x"}'` returned `"hi x"`; an action using crypto.subtle also ran via `convex run`. Per docs: in non-interactive shells with no deployment configured and no CONVEX_DEPLOY_KEY the CLI defaults to a local deployment; `npx convex deployment select local` / `npx convex dev` also offers local; `npx convex login` links an account later. A running `npx convex dev` (not --once) is needed for the frontend/other commands to reach the backend (with --once the backend stops after exit; my `convex run` right after still worked, i.e. it re-spawns/serves the local backend; UI dev should run `convex dev` in a separate terminal).
Gotchas: first run downloads the local backend binary (internet needed once). `npx convex codegen` BEFORE any deployment is configured fails: "No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project" (verified) — so codegen is not usable from a cold start; use `convex dev --once` first. After setup, codegen output showed "Uploading functions to Convex... Generating TypeScript bindings... Running TypeScript". On Windows a harmless libuv assertion (`UV_HANDLE_CLOSING`) printed at exit of `convex run`/`dev --once`. Local backend has no public URL (no webhooks) and no default env vars; Node actions need matching Node version.

### Deploy with Vercel
Vercel Build Command: `npx convex deploy --cmd 'npm run build'`. Env var `CONVEX_DEPLOY_KEY` (production key with deployment:deploy permission, Production env only; separate preview key scoped to Preview only). `convex deploy` sets `CONVEX_URL` for the build command; add `--cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` so Next inlines it. Preview deployments get a fresh backend per branch; `--preview-run 'fn'` seeds data.

## Limits & gotchas
- Query/mutation: 1 s user-code time. Convex-runtime action: 30 min. Node action: 10 min.
- Per transaction: 16 MiB read, 16 MiB written, 32,000 docs scanned, 16,000 docs written, 4,096 index ranges.
- Document: 1 MiB, 1,024 top-level fields, nesting depth 16. Args and return: 16 MiB (Node action args 5 MiB). HTTP response 20 MiB.
- Concurrency (by deployment class): actions 64-2,048; queries 16-2,048; mutations 16-1,024; scheduled jobs 8-1,024.
- Scheduled: 1000 functions per mutation; 1M outstanding. File storage free tier 1 GB.
- Scheduling from a mutation is atomic; from an action it is not (at-most-once).
- Store big CSVs in `_storage`, not in a document (1 MiB cap); write rows in batches well under 16k docs/mutation.
- Pagination page sizes can change reactively.

## UNCONFIRMED
- Exact action-concurrency for our plan (varies by class).
- Exact lifetime of the local backend after `dev --once` exits (observed `convex run` still worked; docs say a `convex dev` must remain active).
- Offline (no internet ever) operation: first run needs a backend binary download; not tested without network.
- Schema/index/function snippets are the standard API; only the local-run snippets and crypto test were executed.

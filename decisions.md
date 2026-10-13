# Decisions log

Newest at the bottom. Each entry: date · decision · why.

## 2026-10-07 — Initial Q&A with user
- **Stack: Next.js (App Router, TS) on Vercel + Convex backend.** User choice.
- **AI: Gemini only** (was OpenAI, switched by user). Flash-tier for bulk, stronger model optional for owner/decide. Model IDs live in Settings.
- **Input: Google Drive folder via service-account JSON key.** User picks one CSV at a time; no OAuth login screen.
- **Run mode: auto-run with Pause/Resume/Stop and a per-run $ budget that auto-pauses.**
- **ICP = residential + HOA/community-association + commercial property management.** Exclude trades (lawn/trash/cleaning/handyman…) and big national chains.
- **Cleaning = free deterministic rules first, AI only on what's left.**
- **No website → Exa search + Gemini picks the official domain.**
- **Go/No-go needs ALL of: ICP fit, small/independent, working domain, decision-maker name.** Hard gates + Gemini verdict.
- **Decision-maker hierarchy: CEO → Founder → Owner → Co-Founder → Co-Owner** (kept from BitScale doc).
- **Email finding: Findymail → TryKitt, stop at first hit. No generic info@ emails.**
- **Verification: TryKitt verify → Instantly re-check only for catch-all/risky/unknown.** Catch-all/risky kept but tagged.
- **Personalization: review line, website description, generic service line, editable campaign variables.** Review line reworded because the CSV has no reviewer names.
- **Output stays in dashboard; Export CSV and Push-to-Instantly on demand.**
- **Global dedupe by place_id + root domain.** Never pay twice for the same company.
- **Single-user password login.**
- **Prompts editable + versioned in the UI.**
- **Website text: no direct server fetch. Exa `/contents` first, Gemini URL-context as fallback.** User choice.
- **Dropped from BitScale: Email Waterfall, Bouncer, Apify.**

## 2026-10-07 — Build simplifications (ponytail pass)
- **Plain `fetch` to every external API, no SDKs** (Gemini, Exa, Findymail, TryKitt, Instantly, Google OAuth/Drive). Why: each is 1–3 REST calls; SDKs add weight and supply-chain surface.
- **Drive service-account JWT signed with Web Crypto** instead of `google-auth-library`. ~25 lines.
- **Pipeline = one self-rescheduling "tick" action per run** (claims a batch of leads, advances each by one stage in parallel, reschedules) instead of `@convex-dev/workpool`. Pause/stop/budget checks live in one place. Upgrade to Workpool if per-provider rate limits start biting.
- **Auth = APP_PASSWORD env var + random session token in a `sessions` table**, token passed as an arg to every Convex function, instead of `@convex-dev/auth`. Single user makes full auth overkill.
- **No shadcn / TanStack Table / Recharts / papaparse.** Hand-written Tailwind components, server-side Convex pagination (100 rows/page) instead of virtualization, CSS bars for the funnel, small RFC-4180 CSV parser with tests.
- **No `companies` cache table.** Dedupe looks up existing leads via `by_placeId` / `by_domain` indexes.
- **Clean stage runs inside ingest** (it's pure rules), not as a separate pipeline step.
- **TypeScript pinned to ^6** — 7.0 is the new native compiler and Next.js tooling compatibility is unproven.
- **`PIPELINE_MOCK=1` Convex env var** makes every provider return deterministic fake data, so the whole flow runs before any API keys exist.

## 2026-10-07 — Changes found during live testing
- **Missing API key → lead becomes `blocked`, run continues, pauses at the end.** First version paused the whole run on the first missing key, which stalled the free research stages for every other lead. Resume unblocks.
- **Domain prompt loosened:** the Maps `county_name` is the search area, not the business address; Gemini was rejecting correct domains for being in a neighbouring county. Now: same state (or same phone) + clearly same business is enough.
- **Gemini site-reader apology filter:** blocked sites make Gemini answer "I am unable to access…"; treated as unreadable.
- **Owner stage is two-step:** website text first (cheap), Exa web + people search only if no confident owner — saves ~$0.014/lead when the site names the owner.
- **Upload-a-CSV path added** next to the Drive picker so runs work before the service account is connected.
- **Next 16 `agentRules: false`** — stops Next writing an AGENTS.md into the repo (CLAUDE.md says to ignore stray .md files anyway).
- **Session token lives in localStorage** (Convex client calls can't use httpOnly cookies). Mitigated with CSP/security headers in next.config.ts, no raw-HTML rendering, server-side expiry (30 days), and hashed tokens at rest.

## 2026-10-07 — Research agent (LangGraph) + big files + buildings
- **One LangGraph research agent per lead replaces classify / owner / decide** (user asked for a proper agent framework like LangChain). `createAgent` from `langchain` v1 + `ChatGoogle` from `@langchain/google` (createReactAgent is deprecated; @langchain/google-genai is on a deprecated Google SDK). Tools: web_search, search_people, read_page (all Exa). Structured output via zod `responseFormat`, fallback `withStructuredOutput`. Cap: `agentMaxTools` (default 4) enforced in our tool wrappers + `recursionLimit` backstop. Deterministic hard gates still run after the agent.
- **Pipeline worker moved to a Node action (`convex/worker.ts`)** — LangGraph needs `node:async_hooks`. Stage list lives in `lib/stageList.ts`, shared helpers in `stageKit.ts`, so default-runtime files never bundle LangChain.
- **Supply chain:** pinned versions ≥4 days old (langgraph 1.4.18, core 1.2.14, langgraph-sdk 1.12.0, langgraph-checkpoint 1.1.5 via npm `overrides`) because the latest were published the same day / day before. No install scripts in the LangChain tree; grep for decrypt+eval patterns clean.
- **Streaming CSV ingest** (TX.csv is 152 MB / 37,558 rows): parsed in chunks, 30 MB heap, ~7 s. **`maxNew`** caps leads that pass cleaning per run; rows seen in earlier runs are only counted (not stored), so a big state is processed in chunks by re-running it.
- **Apartment / condo building listings ("smart middle")**: kept, then `building` stage (fast Gemini) decides who runs the building → research the management company / switch to the manager's domain / drop (chain, building-only, unclear). Domain dedupe merges buildings of one manager.
- **Max company size gate** (default up to 200 employees, from the agent's estimate; unknown passes) — the agent considered privately-owned multi-state firms "independent".
- **More free deny categories** (assisted living, trucking, stores, schools…) after seeing raw TX rows.

## 2026-10-07 — Dashboard additions
- **Lead drawer "Enrichment grid" tab:** the 44 BitScale columns in doc order, each with its value and source (CSV / Exa / Gemini / Agent / Findymail / TryKitt / Instantly / Formula / Dropped), plus the columns this build adds (segment, size, building check, agent tool calls, gates…). Default tab; old view kept as "Details & steps".
- **New run file preview (`ingest.fileStats`, free):** streams the Drive file, applies the free cleaning rules and checks place_ids against all earlier runs → rows, pass cleaning, buildings, already processed, new leads, cost range. "Run whole file" clears Max new leads. TX: 37,558 rows → 31,150 pass → 31,144 new, ~20–25 s.
- **Never re-process (confirmed requirement):** place_id seen in any earlier run is skipped at import (not stored, $0); same website under another listing becomes a duplicate after the domain step, before paid research.

## 2026-10-07 — New Drive folder; by_state vs combined CSV
- **Drive folder switched** to https://drive.google.com/drive/folders/1nMVri2IQO6otdqepzdrKBazzFaOqTYC7 → `DRIVE_FOLDER_ID` = its `by_state` subfolder (1VgvUWy1OH6N8lE_ZgMwMeh9DtspJ3l0j, 52 files incl. `_unattributed.csv`).
- **Compared `property_managers.csv` (285 MB) with `by_state/*` (52 files):** identical — same 23 columns, same 107,257 rows / unique place_ids, 0 only-in-one, 0 rows in the wrong state file, same 70,857 rows with reviews. **Chosen: by_state** — same data, but per-state runs are smaller, previews are fast, progress is trackable per state, and a failure only affects one state. Global place_id dedupe means using the combined file later can never double-process.
- **`reviews.csv`** (294 MB, 424,844 rows, 70,857 places): place_id, name, state, county_name, rating, text, bucket (good/bad), author, relative_time, review_id — has **reviewer names**, which the CSV `allReviews` lacks (would allow the doc's original "I saw <first name>'s review…" line). Not wired in yet — pending user decision.
- **reviews.csv wired in (user: yes):** one-time free import (Settings → "Reviewer names") keeps 5★ reviews with a usable first name, max 3 per company, in a `reviews` table (424,844 read → 173,337 kept for 65,547 companies, ~5 min, idempotent/resumable). Personalize prefers these ("I saw Paula's review on your Google page…", doc 4.3 original); falls back to nameless CSV `allReviews`. Guard: a name in the line must be one of that company's stored reviewers. Grid columns 31/32 now show real reviewer + text.
- **`clip()` for all imported text:** slicing at a fixed length could split an emoji (lone UTF-16 surrogate) and Convex rejects those — the first reviews import failed at row 261,979 on exactly this. All CSV/review fields now go through `clip`.
- **Source file choice (user):** by_state files only on the New run page.

## 2026-10-08 — Email waterfall reordered (user)
- **New order, single pass (no back-edges → cannot loop):** 1) TryKitt find → Instantly verify; 2) if no *valid* email: Findymail find → TryKitt verify; 3) if neither is valid but a catch-all/unclear one exists → keep the best (catch-all > risky), tagged; 4) else reject (`no_email` / `invalid_email`). Max 2 finds + 2 verifies per lead.
- **"Good" = `valid` only** (user choice). Catch-all/unknown fall through to the next step.
- Same address from both finders is not re-verified. Every step stored in `lead.emailTrail`; grid columns 17–24 show it. Old `verify` stage maps to the same waterfall (for leads parked there).
- Covered by `convex/lib/waterfall.test.ts` (8 scenarios with faked providers).
- **2026-10-08 live email test (4 real leads):** Bay PMG → pfreeze@baymgmtgroup.com (TryKitt → Instantly: valid), Blackwell → patrick@rentblackwell.com (valid); Broad Management + Park Place: TryKitt has no email → waiting for Findymail.
- **Waterfall hardened after that test:** provider errors never throw (recorded in the trail, flow continues — no automatic re-pay); a missing key returns `blocked` with the finished steps saved, and resume reuses them; finder placeholders like `"no-results-found"` are treated as not found (`asEmail`). 25 unit tests.

## 2026-10-08 — AI Ark added to the email waterfall (planned, user)
- **Order (single pass, no loops):** 1) TryKitt find → Instantly verify; 2) **AI Ark** → Instantly verify; 3) Findymail find → TryKitt verify; 4) best catch-all/risky kept, tagged; 5) reject. AI Ark before Findymail because it's ~10× cheaper per found email.
- **AI Ark lookup:** owner LinkedIn URL from the agent → `export/single` directly; otherwise People Search (owner name WORD-match + lead domain, size 1) → only accept a hit whose `company.link.domain` = lead domain → `export/single` by id. Sync endpoints only (bulk email-finder needs a webhook; we have none).
- **Verification:** AI Ark's BounceBan result is kept in the trail, but every non-INVALID AI Ark email is **re-checked with Instantly** (user choice: sender reputation over the ~$0.005). AI Ark INVALID → skip without paying Instantly. Same address as TryKitt's already-verified one → not re-verified.
- **Guards:** reject an email whose domain ≠ lead domain, and `generic: true` addresses. HTTP-200-wrapped `status: 404` = not found.
- **Cost:** free plan for now → `prices.aiarkSearch` / `prices.aiarkFound` = $0 (editable in Settings when a paid plan starts; paid ≈ $0.002–0.004/credit; search 0.5 cr, found email 1 cr).
- Research pass: knowledge/kb/ai-ark.md. Key: `AIARK_API_KEY` (Convex env). First test = free `GET /v1/payments/credits`; live lead tests only with explicit approval.
- **Built + live-tested 2026-10-08 on WY.csv (10 leads waiting for Findymail).** First run: free-plan key is limited to **5 AI Ark requests/minute** → 8× HTTP 429. Fix: per-process throttle (`aiarkPerMinute`, Settings → Run settings, default 5; paid plans 300) and a 429'd AI Ark step is *not* final — it's retried on Resume. Cost tracking switched to credits: `prices.aiarkCredit` ($/credit, 0 on free plan) × credits (0.5 per search result, 1 per returned email); credits are counted per run (`counts["credits:aiark"]`) and shown on the run page, overview and Settings → "AI Ark credits" (live balance, free API call).

## 2026-10-08 — Save each lead as soon as it finishes; faster file preview
- **Per-lead save (user):** the tick no longer collects a whole batch and saves it at the end — each lead's result (patch, step log, cost) is written by its own `pipeline.apply` the moment its stage finishes. A tick that crashes or times out mid-batch keeps everything already finished. Stages share a `calls` list with the worker, so a stage that **throws** still has its paid calls billed to the run (closes audit lead "budget undercount"). The sweeper's re-queue of leads whose tick died now counts as a failed attempt (max 3 → `error`), so one lead can't loop forever.
- **File preview fix:** `ingest.fileStats` failed on big files with "too many system operations" (one index lookup per CSV row, 8×1000 in parallel). Now it pages through processed place ids once (`pipeline.placeIdPage`, 500/page) and checks in memory: TX.csv (37,568 rows) 3 min → 13 s, same numbers. ponytail: scans the leads table; add a slim placeIds table past ~100k leads.

## 2026-10-09 — Findymail replaces Instantly for email verification (user)
- Waterfall now: 1) TryKitt find → **Findymail verify**; 2) AI Ark find → **Findymail verify**; 3) Findymail find → TryKitt verify; 4) best catch-all/risky kept; 5) reject. Instantly is no longer used for verification (still used for campaigns + push). Old leads keep `verifier: "instantly"` in their trails.
- **Trade-off:** Findymail `POST /api/verify` returns only `verified` true/false — no catch-all/risky. So `verified:true` → "valid", `false` → "invalid"; the "catch_all" tag now only comes from AI Ark (BounceBan) / TryKitt. Whether Findymail marks catch-all domains true or false is UNCONFIRMED (needs 1 live test).
- **Limit:** 1 verifier credit per call, charged either way; the account had only 10 verifier credits (22 finder credits) on 2026-10-09. `prices.findymailVerify` = $0.01 estimate (Settings).

## 2026-10-09 — AI Ark removed (user)
- Removed the AI Ark step, provider code, `AIARK_API_KEY` key status, "AI Ark credits" Settings card, `aiarkPerMinute` / `aiarkCredit` settings, credits counters and grid columns. Reason: in the WY + NH tests it found **0 emails** for the 19 leads it was tried on (7 "no email found", the rest "person not found" / rate-limited) and cost nothing, so it added delay (free key = 5 requests/min) without results.
- Waterfall is back to: 1) TryKitt find → Findymail verify; 2) Findymail find → TryKitt verify; 3) best catch-all/risky kept; 4) reject. 25 tests pass.
- Old leads keep `aiark` rows in their email trail (display only). `calls[].credits` stays optional in the schema because old step logs contain it. Stale saved `prices.aiarkCredit` / `aiarkPerMinute` values are ignored on load.
- Still to do by the user: delete `AIARK_API_KEY` from Convex env variables if no longer wanted.

## 2026-10-12 — Bouncer replaces Findymail's verifier (user, option A)
- Step 1 is now TryKitt find -> **Bouncer** verify (`bouncerVerify`, kb/bouncer.md). Findymail's own verify call was removed (never used live). Step 2 unchanged: Findymail find -> TryKitt verify.
- Mapping: undeliverable -> invalid; deliverable -> valid (catch_all if `domain.acceptAll = yes`); risky -> risky (catch_all if acceptAll yes); unknown -> unknown (waterfall treats as risky). This restores the catch-all tag that Findymail's true/false verify could not give.
- `prices.bouncerVerify` = 0.008 estimate. Key: `BOUNCER_API_KEY` (Convex env). No free key test exists; first live call = 1 credit, only with user approval. 26 tests pass.

## 2026-10-12 — Costs page (user)
- New page **/costs** (menu: Costs) replaces the idea of a one-off HTML report. It shows spend by provider and step, the funnel of the biggest run, spend by outcome, finders compared, scenarios + calculator for predicting cost on the whole dataset, per-state projections, savings levers and a "how much to trust" table. Explanations are ⓘ tooltips.
- **Updates only on Refresh.** The page calls `costs.report` once per click (a one-shot `convex.query`, not a live subscription) and keeps the last snapshot in the browser, so reopening it shows the old numbers until you press Refresh.
- **Nothing hard-coded.** All numbers come from the `runs` table. `pipeline.apply` now also keeps per-run counters: `c:stage:<stage>:<provider>` ($ per step), `c:out:<outcome>` ($ spent on leads that ended that way), `src:<finder>` (usable emails by finder). `costs.backfill` (run once: `npx convex run costs:backfill`) filled them for the 9 existing runs from stepLogs + leads. Calculation lives in `convex/lib/costModel.ts` (unit-tested).
- **Baseline = the biggest run** (most leads that entered the pipeline); scenario B = all other runs combined (needs >= 30 leads); scenario C = A minus a saving % you type (an assumption, labelled).
- **Drive state table:** reading all 52 CSVs takes minutes, so it is a separate button (**Scan Drive files**) that runs `ingest.runDriveScan` in the background and stores the result in `meta` (`driveScan`). The processed-place-id set is loaded once per scan, not once per file.

## 2026-10-13 — Retry failed leads from the run page (user)
- Run page → "Why leads dropped" → the **Failed 3x (error)** line now has a **↻** button (`runs.retryFailed`). It puts that run's failed leads back in the queue **at the step that failed** (a lead's `stage` only changes when a step succeeds, so earlier results stay saved), resets their attempts, moves their cost out of the "error" bucket (so the Costs page doesn't count it twice) and starts the run again. Up to 1000 per click; press again for more. Refuses if the run already spent its budget.
- Use case: update Gemini (key / model / quota), then press ↻ instead of re-importing the file.

## 2026-10-13 — Cost cuts Phase A (user, deployment pending)
- **Analysis of 1,097 real research runs + 4,756 leads:**
  - (1) **Quota/credit errors now block instead of retry.** Gemini's "monthly spending cap" and Exa HTTP 402 (credits exhausted) previously triggered retries, re-buying Exa searches ($3.40 wasted on FL.csv). Now: lead becomes `blocked` and run pauses. Resume after raising the cap / adding credits. User must manually press Retry.
  - (2) **New free deny categories** (exact whole-category match beats allow list): vacation home rental agency, apartment rental agency, property maintenance, equipment rental agency, county government office, housing development, lodging, tax assessor, legal services, forestry service, property investment company, condominium rental agency. Also: business name containing "vacation" → rejected free. In live data: −10.9% spend, 0 usable emails lost. One-off setup: `npx convex run settings:addDenyCategories` on dev and prod.
  - (3) **Website text trimmed** (repeated menu/footer lines across subpages, link URLs, images dropped) → −16% chars to the agent, reducing token spend.
  - (4) **Gemini tokens logged per call:** in/cached/out/think. Cached tokens priced at the cached rate ($0.075/1M cached input on 3.8 Flash through Dec 31 2026; rate doubles after).
- **Rejected:** agent tools 4→2 (cost benefit is marginal: 3–4-tool leads give extra usable emails at ~$0.15 each, below the $0.22 average per lead); Gemini Flex tier (1–15 min latency adds complexity); agent on flash-lite (quality drops).
- **Phase B pending user approval:** Exa instant vs auto search test (~$0.45), pre-check prompt test (~$0.25).

## 2026-10-13 — Cost cuts 2: trimmed research agent, eval tools, Exa type test (user)
- **Research agent trimmed:** customer reviews removed from the prompt; tool outputs capped at 3000 chars (search) / 5000 chars (read_page). 25-lead check vs stored results: 23/25 same verdict, 14/15 same owner, cost ~$0.028 -> ~$0.020 per lead.
- **Rejected: flash-lite as the research agent** — lost 3/15 good leads and picked 1 wrong owner, though 77% cheaper.
- **Rejected: pre-check (cheap Gemini gate before the agent)** — at threshold 0.85 it wrongly rejected 10/150 usable leads.
- **Eval tooling:** `evalsNode:agentModel` now prices at fast-tier rates only when the requested model equals `settings.models.fast` (before, it always did, understating smart-model cost). New `evalsNode:exaType` re-runs each lead's first stored successful search query with Exa `auto` vs `instant` (paid, writes nothing, $1 cap).
- **Exa instant vs auto result (40 leads, $0.44 spent):** owner last name in results: auto 29/40 (72.5%), instant 28/40 (70%); lead domain in result URLs: auto 22/40 (55%), instant 24/40 (60%); cost per call: auto $0.007, instant $0.004 (~43% cheaper). Auto hit but instant missed on 3 owners (Rock Solid Properties, The Hodges Companies, KL Real Estate Services). Instant is a viable saving, but `exaSearchType` is left on `auto` in live settings until the user decides.

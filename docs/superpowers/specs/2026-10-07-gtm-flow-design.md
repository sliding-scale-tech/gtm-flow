# GTM Flow: Google Maps → Property-Manager Email Leads (code version of the BitScale grid)

## Context
Today the enrichment runs inside a BitScale grid (44 columns: BitAgent research, TryKitt/Findymail/Waterfall, Bouncer, Apify reviews, AI personalization). We're rebuilding that flow as our own app so we control cost, logic and data. We keep only these tools: **Gemini** (reasoning), **Exa** (web search and page contents), **Findymail + TryKitt** (email finding), **TryKitt + Instantly** (verification). Waterfall, Bouncer and Apify are dropped. The CSV already has `allReviews`, so we don't need Apify.

New compared with BitScale: Maps data is **cleaned first** (the sample row is a *trash/lawn* company called "Lane Property Management"), and a **go/no-go agent** decides whether a lead is worth spending email credits on.

**Goal:** process 5k+ row CSVs from Google Drive and end with **≥1,000 usable emails per 5k rows**, kept in a dashboard and sent to Instantly or exported on demand.

## Decisions (from Q&A)
| Topic | Decision |
|---|---|
| Stack | Next.js (App Router, TS) on **Vercel** + **Convex** backend |
| AI | **Gemini only** (`@google/genai` SDK, JSON output with `responseSchema`). Flash-tier model for bulk steps (classify, personalize); a stronger model is optional for OWNER/DECIDE. Model IDs are set in Settings and confirmed against current Gemini docs at build time |
| Input | Google Drive folder via **service account (JSON key)**. User picks one CSV at a time |
| Run mode | Auto-run, Pause/Resume/Stop, **$ budget auto-pause** per run |
| ICP keep | Residential, HOA/community association, Commercial property management |
| Exclude | Lawn/trash/cleaning/handyman trades; big national chains |
| Cleaning | Free rules first, then AI only on what's left |
| No website | Find it with Exa + Gemini |
| Go/No-go needs ALL | ICP fit, small/independent, working domain, decision-maker name found |
| Decision-maker | CEO → Founder → Owner → Co-Founder → Co-Owner (doc hierarchy) |
| Email finding | Findymail → TryKitt (stop at the first hit). **No generic info@ emails** |
| Verification | TryKitt verify → Instantly re-check for catch-all/risky/unknown |
| Catch-all/risky | Keep, tagged separately |
| Personalization | Review line, website description, generic service line, custom campaign variables (sentences added later and editable in the UI) |
| Output | Stays in the dashboard. Buttons: Export CSV / Push to Instantly campaign |
| Dedupe | Global, by `place_id` + root domain. Never pay twice |
| Login | Single user, password (Convex Auth Password provider, sign-ups disabled) |
| Prompts | Editable and versioned on a Prompts page |
| Website text | No direct fetching from our server. Exa first; Gemini only as backup |

## Pipeline (one lead moves through these stages)

```
INGEST → CLEAN(rules) → DOMAIN → SITE → CLASSIFY(AI) → OWNER(AI+Exa) → DECIDE(agent)
      → FIND_EMAIL(Findymail→TryKitt) → VERIFY(TryKitt→Instantly) → PERSONALIZE → READY
```
Any stage can end a lead with `rejected:<reason>`. The cheapest checks run first, so most junk dies before any paid call.

1. **INGEST** (free): download the CSV from Drive, parse it, map the columns (`place_id,name,category,address_line,phone,website,rating,reviews_count,…,county_name,state,…,open_state,keyword,allReviews,…`), and insert rows into `leads` in batches.
2. **CLEAN, rules only** (free):
   - Dedupe by `place_id` inside the file, then globally against the `companies` cache. A cache hit copies the prior result, at no cost.
   - Drop permanently closed businesses (`open_state`).
   - **Category deny list** (Waste management, Lawn care, Landscaper, Cleaning service, Handyman, Roofing, Pest control, Moving…) → reject, *even if the name says "Property Management"*.
   - **Category allow list** (Property management company, Homeowners' association, Condominium/HOA management, Real estate rental agency, Commercial real estate agency…) → `likely_icp`.
   - **National chain list** (Greystar, FirstService Residential, Associa, CBRE, JLL, Cushman & Wakefield, Lincoln Property, RPM Living, Invitation Homes, Mynd, etc.; editable in Settings) → reject.
   - Anything else → `unsure`. The AI decides in CLASSIFY.
3. **DOMAIN**: if `website` exists, normalize it to the root domain and reject social/directory hosts (facebook, yelp, linktr.ee, google sites, etc.). If it's missing or bad → Exa search `"{name}" {city} {state} property management` → Gemini picks the official domain or `not_found` (adapted from doc prompt 4.1). `not_found` → reject (`no_domain`).
4. **SITE**: no direct fetching from our own server. **Exa `/contents` first** (homepage plus about/team/contact subpages). **Only if Exa returns nothing** → Gemini with the **URL context** tool (Google Search grounding as a second option) reads the site and returns its plain text. The text is stored (truncated) **once** and reused by every later AI step (classify, 4.4, 4.5, 4.6, 4.7). Both fail → reject `site_unreadable`.
5. **CLASSIFY (Gemini Flash)**: inputs are name, category, site text and a review sample. Output: `{segment: residential|hoa|commercial|vacation|trade_service|real_estate_sales|other, is_property_manager, is_independent, est_size, confidence, reasoning}`. Reject non-ICP and non-independent leads before owner research.
6. **OWNER (Exa + Gemini)**: Exa searches (`"{company}" owner OR founder OR CEO`, a LinkedIn-scoped query, and the site's team/about text). Gemini applies the doc 4.2 rules (title hierarchy, current employee, clean `linkedin.com/in/` URL or null) and returns `{full_name, first_name, last_name, job_title, linkedin_url, source_urls, confidence}`. Fixes the doc's last-name bug: the last name is all the remaining tokens, with suffixes like Jr/III/CPM stripped.
7. **DECIDE (go/no-go agent, Gemini)**: hard gates (all 4 must pass) plus a Gemini verdict that sees all the evidence and returns `{decision: find_email|skip, reasons[]}`. `skip` → no paid email calls. The reasoning is shown in the dashboard.
8. **FIND_EMAIL**: Findymail (name + domain, plus LinkedIn if present) → if empty, TryKitt find. Stops at the first candidate.
9. **VERIFY**: TryKitt verify → `valid` ends there. `catch_all/risky/unknown` → Instantly verification → final `email_status ∈ {valid, catch_all, risky, invalid}`. `invalid` → TryKitt is tried as a second source if Findymail produced the bad one. Otherwise `no_email`.
10. **PERSONALIZE** (Gemini Flash, only for leads with an email, to save cost):
    - **Review line**: parse `allReviews` (`"5 text || 5 text"`, which has *no reviewer names*), keep only 5★ reviews, and adapt doc prompt 4.3 to not need a first name ("I saw a review on your Google page about how your team…, and I had a question:"). It keeps the attribute-lock and 25-word rules.
    - **Website description** (doc 4.4) from the stored site text.
    - **Primary service label → generic line** (doc 4.5 and 4.4 formula).
    - **Final line** = review line → description → generic line (the first one that isn't empty).
    - **Campaign variables**: a table of `{key, sentence_template, prompt, fallback}` edited in the UI and run as one structured call, using the same "<<FILL_THIS>> + grammar fit" pattern as doc 4.6/4.7.

## Doc items → what each one needs
| Needs | Doc items |
|---|---|
| **Gemini only** (CSV data) | 4.3 Review line (reworded, since there are no reviewer names) |
| **Gemini on stored site text** | 4.4 Website description · 4.5 Primary service label (special cases trimmed for PMs) · 4.6/4.7 campaign variables (JKO-specific → editable templates) · new Classify |
| **Gemini on collected data** | new Go/No-go decision |
| **Exa search + Gemini** | 4.1 Official URL (only rows with no website) · 4.2 Find owner |
| **Plain code** | Columns 1–5 mapping · §4.1 normalize · §4.2 name split (bug fixed) · §4.3 final email pick (now Findymail→TryKitt) · §4.4 generic line · final line merge |
| **Dropped** | Email Waterfall · Bouncer · Apify |

## Hitting 1,000 emails per 5k rows (being honest)
A rough funnel for raw Maps data: ~50–60% survive cleaning → ~75% get a domain → ~55% get a named owner → ~65% get an email → **~550–750 emails**. The run dashboard shows this funnel live, so we can see where leads drop. Levers if we fall short:
- Relax the "owner name" gate by allowing President/Managing Broker/Principal (one setting).
- Count catch-all emails as usable.
- Add the LinkedIn URL step before Findymail.
- Feed more CSVs. Global dedupe makes extra files cheap.

All gate thresholds live in Settings, so they can be tuned without code changes.

## Architecture

### Convex (`convex/`)
- `schema.ts`: tables
  - `runs` (driveFileId, fileName, status running|paused|stopped|done, budgetUsd, spentUsd, counts per stage, startedAt)
  - `leads` (runId, placeId, raw fields, domain, stage, status, rejectReason, classify{}, owner{}, decision{}, email, emailSource, emailStatus, personalization{}, overrides, timestamps; indexes by run+stage, run+status, placeId, domain)
  - `companies` (global dedupe cache keyed by placeId and domain → the lead's final enrichment)
  - `stepLogs` (leadId, step, provider, request summary, response summary, costUsd, ms, error), which feeds the row drawer and cost charts
  - `prompts` (key, version, text, model, active), seeded from the doc prompts and adapted for PMs
  - `settings` (category lists, chain list, thresholds, per-tool prices incl. Gemini per-token prices, Gemini model IDs, concurrency)
  - `campaignVariables`
- `pipeline/orchestrator.ts`: `advanceLead(leadId)` runs the next step for the lead's stage through the **Convex Workpool component** (a separate pool per provider so limits are respected: gemini≈10, exa≈5, findymail≈5, trykitt≈3, instantly≈3) with retries/backoff (429-aware for Gemini rate limits). Before every paid call it checks `run.status === "running"` and `spentUsd < budgetUsd`, or else pauses the run. Resume re-enqueues leads sitting at their current stage. A cron sweeper re-queues stuck leads.
- `pipeline/steps/*.ts`: one internal action per stage (above). Each step is idempotent and writes a `stepLog` with its cost (Gemini cost from `usageMetadata` token counts × Settings prices).
- `integrations/` (`"use node"` actions; keys only in **Convex env vars**, never sent to the client): `gemini.ts` (a `generateJson(prompt, schema, model)` helper plus `readSiteFallback(url)` using URL context / Search grounding), `exa.ts`, `findymail.ts`, `trykitt.ts`, `instantly.ts` (verify, list campaigns, add leads), `drive.ts` (service-account JWT → Drive v3 list and download for one folder).
- `lib/` (pure TS, unit-tested): `normalizeCompany` (port of doc §4.1), `rootDomain`/`isSocialHost`, `parseReviews`, `splitName`, `categoryRules`, `pickFinalLine`, `costOf(provider, usage)`.
- `auth.ts`: Convex Auth Password provider, sign-ups disabled after the single account is seeded. **Every** public query/mutation checks the identity.

### Next.js (`app/`): Tailwind + shadcn/ui, TanStack Table + virtualization, Recharts
- `/login`
- `/`: overview with all-time stats, recent runs, total spend by tool, and emails per $.
- `/drive`: lists CSVs in the shared folder (name, size, modified, already-processed badge). Pick one, set a budget, then Start.
- `/runs/[id]`: live **funnel** (raw → cleaned → domain → ICP → owner → go → email → valid), progress bar, live cost vs budget per tool, Pause/Resume/Stop, and a reject-reason breakdown.
- `/leads`: **spreadsheet-style grid** (virtualized, across runs). Column groups mirror the BitScale grid; filters (run, state, stage, segment, email status, decision); saved views. Clicking a row opens a **drawer** with all fields, the AI reasoning, source URLs, a step timeline with costs, a **manual override** (flip ICP/decision) and **re-run step**.
  - Bulk actions: **Export CSV** (choose columns) and **Push to Instantly** (pick a campaign, map variables to custom fields, valid-only / include catch-all). Pushed leads are marked so they aren't pushed twice.
- `/prompts`: edit each prompt, choose its Gemini model, view its version history, and **test on a sample lead** before activating.
- `/settings`: category/chain lists, gate thresholds, prices, Gemini model IDs, concurrency, campaign variables, and key status (only "set/missing" is shown, never the key).

## Project docs + CLAUDE.md (milestone 0, before any code)
Create `C:\Users\hp\Desktop\gtm-flow\CLAUDE.md` with this rule under `# Rules`, adapted from the user's text for this project:

> Before doing anything else in this project, load and treat ONLY the following files as your authoritative context. Do not read, assume, or infer from any other .md file in the repo unless I explicitly point you to one. Read these, in this order:
> 1. CLAUDE.md: project-specific instructions and conventions
> 2. prd.md: what we're building, including features, scope and success criteria (≥1,000 emails / 5k rows)
> 3. architecture.md: what's actually built vs planned ([x]/[ ] markers), folder structure, the LLM usage boundary rule (Gemini only for judgment/text; rules, dedupe, email pick and cost math stay plain code)
> 4. decisions.md: dated log of every architectural decision and why it was made
> 5. phases.md: phase-by-phase build plan, status, dependencies
> 6. progress.md: current status, including done, pending and open reminders
> 7. memory.md: cross-session context on where we left off
> 8. security.md: security considerations covering prompt injection (scraped site text/reviews are untrusted input), API-key handling, data ownership, and a threat log
> 9. knowledge/index.md: index of which library/tool has a research pass and when
> 10. knowledge/kb/*.md: next-js, convex, convex-auth, convex-workpool, gemini-genai, exa, findymail, trykitt, instantly, google-drive-api, shadcn-ui, tanstack-table, recharts, papaparse, vitest, convex-test. The standing rule is that no library gets used without a research pass logged here first
> 11. docs/superpowers/specs/2026-10-07-gtm-flow-design.md: the approved design spec (this plan)
> 12. docs/superpowers/plans/2026-10-07-gtm-flow.md: the implementation plan/checklist
>
> Treat architecture.md and decisions.md as ground truth over anything you might infer from the code itself. If they conflict with what you find in source, flag the conflict rather than trusting the code silently. Follow the standing rule in knowledge/index.md: before using any library not already covered in knowledge/kb/, do a research pass and write it there before writing code that uses it.

Also in milestone 0: create those docs, seeded from this plan (decisions.md gets the Q&A decisions dated 2026-10-07), and do the knowledge/kb research pass for each library before installing it (combined with the CLAUDE.md supply-chain check).

## Build order (each milestone works end-to-end before the next)
0. CLAUDE.md + project docs + knowledge/kb research passes (see above).
1. Scaffold Next.js + Convex, auth, schema, settings seed, app shell.
2. Drive picker → ingest → rules CLEAN → grid + funnel (**zero paid calls**; test on WV.csv).
3. DOMAIN + SITE (Exa, Gemini fallback) + CLASSIFY + OWNER + DECIDE (Gemini), cost logging, budget pause.
4. FIND_EMAIL + VERIFY (Findymail, TryKitt, Instantly).
5. PERSONALIZE + campaign variables + Prompts page.
6. Export, Instantly push, overview stats, polish.

Implementation notes:
- Before **any** `npm install`, run the supply-chain check from CLAUDE.md (Next, Convex, @convex-dev/workpool, @convex-dev/auth, shadcn deps, TanStack, Recharts, papaparse, google-auth-library, @google/genai).
- Use the **vibesec** skill while writing the auth, API-key and export code.
- Confirm the exact request/response shapes for the TryKitt find/verify, Findymail, Instantly v2 verify/leads, Exa and Gemini (structured output, URL context, grounding) APIs against their current docs when building each integration (the BitScale export omits request bodies). TryKitt find may be async/job-based. Some Gemini models may not allow tools (URL context/grounding) and JSON schema output in the same call, so the SITE fallback returns plain text and needs no schema.
- Env vars (Convex): `GEMINI_API_KEY`, `EXA_API_KEY`, `FINDYMAIL_API_KEY`, `TRYKITT_API_KEY`, `INSTANTLY_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `DRIVE_FOLDER_ID`.

## Verification
- **Unit tests (vitest)** for `lib/`: normalizeCompany (doc examples), splitName edge cases, parseReviews on the WV.csv `allReviews` format, category rules (the sample "Lane Property Management / Waste management service" row **must be rejected**), and rootDomain.
- **convex-test** for orchestrator transitions with mocked integrations: pause stops new paid calls, the budget limit pauses the run, global dedupe skips paid steps, and a `skip` decision makes no email calls.
- **Mock mode** (`PIPELINE_MOCK=1`): run a full CSV with fake providers to check the UI, funnel and costs at no cost.
- **Live smoke test**: a 25-row CSV from Drive with a $2 budget. Check the funnel counts, cost per tool against the provider dashboards (Gemini usage in Google AI Studio), open several drawers to check the reasoning, export the CSV, and push 1–2 test leads to a test Instantly campaign.
- Then a 5k-row run, comparing emails found per $ with the ≥1,000 target and tuning the gates in Settings.

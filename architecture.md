# Architecture

Status markers: `[x]` built · `[ ]` planned.

## LLM usage boundary rule
Gemini is used **only** for judgment and text generation: picking an official domain from search results, the building check, the LangGraph research agent (ICP + owner + go/no-go, may call Exa tools up to `agentMaxTools` times), personalization lines, campaign variables, and the site-reading fallback.
Everything else is **deterministic code**: CSV parsing, cleaning rules, dedupe, domain normalization, name splitting, hard gates, email waterfall order, final email pick, final-line merge, cost math, budget checks. Gemini output never bypasses a hard gate and is never executed.

## Data flow
```
Drive CSV ──ingest(+clean rules)──▶ leads(state=queued, stage=domain)
                                         │  tick(runId) every batch
  domain ─▶ site ─▶ [building] ─▶ research (LangGraph agent) ─▶ find_email ─▶ verify ─▶ personalize ─▶ ready
  (building only for apartment/condo listings; may switch to the manager's domain and go back to site)
     any stage may end with state=rejected + rejectReason
```
Leads that need a missing API key become `blocked` (no retry burned); the run keeps going and pauses at the end with "N leads waiting for <KEY>". Resume unblocks them.
Each tick: claim up to `batchSize` queued leads → run each lead's current stage in parallel → apply results (patch lead, add stage costs to run, write stepLog) → check budget/pause → reschedule.
A cron sweeper re-queues leads stuck in `working` and restarts dead tick chains.

## Folder structure
```
CLAUDE.md prd.md architecture.md decisions.md phases.md progress.md memory.md security.md
knowledge/index.md knowledge/kb/*.md      research passes (one per library/API)
docs/superpowers/specs|plans/             approved spec + checklist
app/                                       Next.js App Router pages
  layout.tsx providers.tsx globals.css
  login/ page.tsx(overview) drive/ runs/[id]/ leads/ costs/ prompts/ settings/
components/                                small Tailwind UI pieces (Nav, Funnel, LeadDrawer, ui.tsx)
lib/session.tsx                            client session token (localStorage) + hooks
convex/
  schema.ts                                tables + indexes
  auth.ts                                  login action, logout, requireSession
  settings.ts prompts.ts defaults.ts       settings doc, versioned prompts, seeded defaults
  runs.ts                                  run queries + pause/resume/stop
  pipeline.ts                              insertBatch, claim/apply mutations, sweeper (no Node deps)
  worker.ts ("use node")                   tick: claims a batch, runs stages in parallel (Node: LangGraph needs it)
  stages.ts                                stage functions (domain, site, building, find_email, verify, personalize)
  agent.ts                                 LangGraph research agent (createAgent + ChatGoogle + Exa tools)
  stageKit.ts / lib/stageList.ts           shared stage types/helpers + stage list (keeps LangChain out of V8 bundles)
  ingest.ts ("use node")                   Drive file list + startRun (CSV parse → insertBatch)
  leads.ts                                 grid queries, drawer, override, re-run, Instantly campaigns/push, prompt test
  crons.ts
  costs.ts lib/costModel.ts               Costs page backend (report query, Drive-scan state, one-time backfill) + pure cost model
  providers/  http.ts gemini.ts exa.ts email.ts (findymail/trykitt/instantly) google.ts — mocks inline, enabled by PIPELINE_MOCK=1
  lib/        csv.ts rules.ts text.ts cost.ts  (+ *.test.ts, pure, no Convex imports)
```

## Tables
- `sessions` {tokenHash, expiresAt}
- `loginAttempts` {windowStart, count} (single doc, rate limit)
- `settings` (single doc): category allow/deny, chains, gates, batchSize, budgets default, prices, models, campaignVariables
- `prompts` {key, version, text, active, createdAt}
- `runs` {fileId, fileName, status, budgetUsd, spentUsd, costs{provider→usd}, counts{…}, rowsTotal, tickAt, startedAt, finishedAt, error}
- `leads` {runId, state (queued|working|done|rejected|duplicate|error|blocked), stage, rejectReason, raw fields…, domain, siteText, classify, owner, decision, email, emailSource, emailStatus, personalization, vars, pushedAt, leaseAt, override}
  indexes: by_run_state, by_placeId, by_domain, by_state
- `stepLogs` {runId, leadId, stage, ok, ms, costUsd, calls[{provider, costUsd}], summary, error}

## Component status
- [x] Docs + knowledge/kb research passes
- [x] Scaffold (Next + Convex + Tailwind + vitest)
- [x] Auth (password + sessions)
- [x] Settings + prompts (defaults seeded from BitScale doc, adapted)
- [x] Drive list + ingest + clean rules
- [x] Pipeline tick + sweeper + budget/pause
- [x] Stages: domain, site, classify, owner, decide
- [x] Stages: find_email, verify
- [x] Stage: personalize + campaign variables
- [x] Providers (real) + mock provider
- [x] UI: overview, drive, run page, leads grid + drawer, prompts, settings
- [x] Export CSV + Instantly push
- [x] Unit tests for convex/lib
- [x] LangGraph research agent, building stage, streaming ingest + maxNew, size gate — live-tested on VA + TX from Drive
- [x] Live-tested 2026-10-07 on the gtm-flow dev deployment with real Gemini + Exa (9-row test + WV.csv upload)
- [ ] Live test of Findymail / TryKitt / Instantly (keys not added yet)
- [x] Google Drive (service account upwork-bot@…, folder by_state) — 46 state CSVs listed, VA + TX imported
- [ ] Vercel production deploy

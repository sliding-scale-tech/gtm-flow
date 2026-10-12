# PRD — GTM Flow

## Problem
We enrich Google Maps "property management" scrapes in a BitScale grid. It costs too much, mixes in non-ICP businesses (e.g. a trash/lawn company named "Lane Property Management") and spends email credits on leads we'd never mail. We want our own pipeline + dashboard with full control over cost and logic.

## Users
One operator (the owner). Single password login.

## Success criteria
- Process a 5k-row Google Maps CSV end-to-end unattended.
- **≥1,000 usable emails per 5k raw rows** (valid; catch-all counted separately). Funnel shows where leads drop so gates can be tuned.
- Never pay twice for the same company (global dedupe).
- A run never spends more than its budget (+ at most one batch of overshoot).
- Every AI decision is inspectable (reasoning + sources) and overridable.

## In scope
1. Pick a CSV from a shared Google Drive folder (service account) and start a run with a $ budget.
2. Free rule-based cleaning: dedupe, closed businesses, category allow/deny, national chains.
3. Domain resolution (CSV website → else Exa + Gemini).
4. Website text via Exa contents (Gemini URL-context fallback).
5. Gemini ICP classification (residential / HOA / commercial PM, independent?).
6. Owner research (Exa + Gemini): CEO → Founder → Owner → Co-Founder → Co-Owner.
7. Go/No-go agent: hard gates + Gemini verdict.
8. Email finding: Findymail → TryKitt. Personal emails only.
9. Verification: TryKitt → Instantly for catch-all/risky/unknown.
10. Personalization: review line, website description, generic service line, campaign variables.
11. Dashboard: overview, Drive picker, live run page (funnel, costs, controls), leads grid with drawer + override + re-run, prompts editor (versioned, test on a lead), settings.
12. Export CSV; push selected leads to an Instantly campaign.
13. Mock mode to run everything without API keys.

## Out of scope
Email sending/sequencing (Instantly does it), multi-user/teams, OAuth Drive login, Apify/Bouncer/waterfall providers, generic info@ emails.

## Input format
Google Maps CSV columns: `place_id,name,category,address_line,phone,website,rating,reviews_count,latitude,longitude,county_name,state,county_fips,maps_url,cid,kgmid,is_sponsored,open_state,keyword,allReviews,first_seen,last_seen,times_seen`.
`allReviews` = `"<stars> <text> || <stars> <text> …"` with no reviewer names.

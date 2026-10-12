# AI Ark
Researched: 2026-10-08 · Sources: https://docs.ai-ark.com/docs/get-started.md , https://docs.ai-ark.com/reference/people-search-1.md , https://docs.ai-ark.com/reference/people-export-single-v2.md , https://docs.ai-ark.com/reference/people-email-finder-by-track-id.md , https://docs.ai-ark.com/reference/get-email-finder-results-by-track-id.md , https://docs.ai-ark.com/reference/people-reverse-lookup.md , https://docs.ai-ark.com/reference/fetch-credit.md , https://ai-ark.com/pricing/ (index: https://docs.ai-ark.com/llms.txt)

## What we'd use it for
An extra email finder in the waterfall. It returns emails that have already been verified by BounceBan (SMTP and catch-all check), so a separate verify call is optional. It's very cheap per found email.

## Basics
- Base URL: `https://api.ai-ark.com/api/developer-portal`
- Auth: header `X-TOKEN: <key>` and `Content-Type: application/json`.
- Rate limit: the docs say 5 req/s, 300/min and 18,000/h, then `429`. The limit resets every 60 s. **Live check on 2026-10-08: our free-plan key allows 5 per MINUTE.** The response headers are `x-ratelimit-limit-minute: 5` and `ratelimit-reset`. On the first test, 10 parallel leads produced eight `429` responses. We now throttle with the Settings value `aiarkPerMinute`, and a rate-limited step is retried on Resume. Async jobs: max 500 in flight.
- Live check on 2026-10-08: the free plan has 100 credits. `GET /v1/payments/credits` returns `{"total":100.0}`.
- Credits: about **$2–4 per 1,000 credits** on paid plans (≥30K credits; pricing page). There's a free plan with a few credits. The real $/credit depends on the plan, so keep it as a Settings price.
- Errors:

  | Code | Meaning |
  |---|---|
  | 400 | bad request |
  | 401 | bad key (gateway, not wrapped) |
  | 402 | out of credits |
  | 403 | trackId refunded |
  | 404 | no data |
  | 429 | rate limit |
  | 500 | server error |

- `GET /v1/payments/credits` → `{ "total": <int> }`, **free**. Use it to test the key without spending anything.

## Endpoints we'd call (both synchronous; no webhook needed)

### 1. People Search: name + domain → AI Ark person id (0.5 credit per *returned* result)
`POST /v1/people`
```json
{ "account": { "domain": { "any": { "include": ["acme.com"] } } },
  "contact": { "fullName": { "any": { "include": { "mode": "WORD", "content": ["Jane Doe"] } } } },
  "page": 0, "size": 1 }
```
- The response has `content[]`. Each item includes:
  - `id` (uuid)
  - `profile.full_name` and `profile.title`
  - `link.linkedin`
  - `company.link.domain`
- It also returns `trackId`, `totalElements` and `totalPages`.
- Name match modes:
  - `SMART`: AI concept match, too loose for names.
  - `WORD`: phrase match.
  - `STRICT`: exact characters.
- Seniority enum: founder | owner | partner | c_suite | vp | director | head | manager | senior | mid-level | entry | intern.
- UNCONFIRMED: whether a search with 0 hits costs anything. The docs say billing is per returned result, so it should cost 0.

### 2. Export Single Person with Email (V2): id or LinkedIn URL → profile + verified email
`POST /v2/people/export/single` with body `{ "id": "<uuid>" }` or `{ "url": "https://www.linkedin.com/in/x" }`. One of the two is required.
- Credit: **1 credit only when an email is found** (0.5 enrichment + 0.5 BounceBan). Not found costs 0. Header `X-Credit: -1.0` appears when charged.
- **Not-found arrives as HTTP 200 with a wrapped body:** `{ "status": 404, "error": { "error": "person not found" | "no email found" }, "data": null }`. Check `body.status`, not only the HTTP code.
- Found: `data.email.output[]`. Each item has:
  - `address`
  - `status`: VALID | INVALID | RISKY | UNKNOWN
  - `subStatus`
  - `domainType`: SMTP | CATCH_ALL
  - `free` and `generic` (booleans)
  - `mx`
- `data.profile` carries `first_name`, `last_name`, `title`. `data.company` carries the company object.
- The docs show `status` VALID with `domainType` SMTP as the clean case. They don't fully list how VALID combines with CATCH_ALL. **Map defensively** and keep the raw values in the trail.

### Not used
- **Bulk email finder** (`/v1/people/email-finder` with trackId): async and needs a public **webhook**. We have no httpAction, and the single export already covers our one-person-per-lead case.
- **Reverse lookup** (`/v1/people/reverse-lookup`, email → profile, 0.5 credit): could later check that a found email belongs to the right company. Not needed now.
- **Mobile phone finder**: 5 credits per number. Out of scope.

## Gotchas
- Export needs an **id or LinkedIn URL, not name + domain**. Our agent's `owner.linkedinUrl` lets us skip the search. Otherwise run search (0.5) and then export.
- Check that the search hit's `company.link.domain` equals our lead domain and that the name matches before paying for the export. Also check that the returned email's domain equals the lead domain.
- `generic: true` (info@…) → skip; we never use generic emails.
- 5 req/s: batchSize 10 in parallel can exceed this. Our `http()` already retries `429`.

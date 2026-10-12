# TryKitt
Researched: 2026-10-07 · Sources: https://documenter.getpostman.com/view/479833/2s93m62NHf (official REST API Postman docs, read via collection JSON), https://trykitt.ai/pricing , https://github.com/samy-clivolt/trykitt-mcp (3rd-party MCP wrapper, params only)

## What we use it for
Find work emails from full name + domain (optionally LinkedIn URL) and verify emails. Fallback/waterfall finder.

## Endpoints & shapes (with minimal JSON examples)
- Base URL: `https://api.trykitt.ai`
- Auth: header `x-api-key: YOUR_TOKEN` (NOT Bearer). `GET /api/test-key` -> 200 ok / 401 bad key.
- `GET /credit` -> credit balance (response shape UNCONFIRMED).

### Find email
`POST /job/find_email`
```json
{ "fullName": "Erol Toker", "domain": "trykitt.ai",
  "linkedinStandardProfileURL": "https://linkedin.com/in/x",
  "realtime": true, "customData": "myInternalId",
  "callbackURL": "only used if realtime=false", "strictNameMatches": false }
```
- Required: `fullName`, `domain` (the docs prose says "website" in the required list; domain may be an email domain or a website URL, and the domain is extracted). Do not clean names.
- Best results: email domain > website > company name. LinkedIn URL helps when the name is hidden.
- Result at `data.botGeneratedEmail` (per our known usage; field not shown in the docs I could read).
- The MCP wrapper lists extra optional params (`companyName`, `fastMode`, `discoverAlternativeDomains`, `dataProviderFallback`, `callbackType`) and calls the domain field `domainOrWebsite`: UNCONFIRMED against the official API.

### Verify email
`POST /job/verify_email`
```json
{ "email": "erol@trykitt.ai", "customData": "id", "realtime": true,
  "callbackURL": "only if realtime=false", "treatAliasesAsValid": true }
```

### Get job
`GET /job?id=JOB_ID` (poll for non-realtime jobs).

### Sync vs async
- Realtime (`realtime: true`): preferred; result is in the HTTP response. Throttled: exceeding your concurrent limit returns an error, so retry. Extra concurrency via support.
- Webhook/callback (`realtime:false` + `callbackURL`): marked deprecated; up to 100,000 jobs queued, processed at your concurrency rate. Poll with `GET /job?id=`.
- HTTP codes: 200 ok, 401 auth, 402 "Rate Limit Or Insufficient Funds (error case in body)", 500 unhandled.

## Pricing / credits
- Pay As You Go: $0.0015 per verification, $0.005 per found email (pricing page). Free plan advertised as "unlimited searches & verifications" for individuals.
- Whether a not-found find is free: implied by "per found email" but UNCONFIRMED.

## Limits & gotchas
- 402 conflates rate-limit and out-of-funds: inspect the body to distinguish; back off on rate-limit.
- Concurrency limit value is account-specific, not published.
- Header is `x-api-key`; sending Bearer will 401.

## UNCONFIRMED
- Response JSON schema for find_email/verify_email/get_job (only `data.botGeneratedEmail` known from the user).
- verify_email result status values (valid/invalid/catch-all/risky/unknown): not in the docs I could read; do not assume.
- Exact rate limit numbers; credit cost per call in credit units.
- domain vs domainOrWebsite (official Postman docs use `domain`).

## Live-verified 2026-10-08 (real key)
- `GET /api/test-key` → `{"status":"success"}`; `GET /credit` → `{"credits":9.0275}` (USD).
- `POST /job/find_email` with `realtime:true` is synchronous. Body is **flat** (no `data` wrapper):
  `{jobId, fullName, domain, companyName, email, validIdentity, validSMTP, validity:"valid", displayText, botGeneratedEmail, mxDomain, credits:{jobCredits:0.005, remainingCredits}}` — the find already includes a validity check.
- `POST /job/verify_email` realtime: `{jobId, email, validity:"valid", validIdentity, validSMTP, displayText:"valid", mxDomain, reason, reasonCode, credits:{jobCredits:0.0015, remainingCredits}}`.
- Status lives in **`validity`** (seen: "valid"; other values not yet observed — `mapKittStatus` text-matches catch-all / invalid / risky / unknown). Cost: use `credits.jobCredits`.
- **Not found = placeholder, not null:** when TryKitt finds nothing, `botGeneratedEmail`/`email` = `"no-results-found"` (HTTP 200). Always validate the address shape (`asEmail`) — sending the placeholder to Instantly returns HTTP 500.

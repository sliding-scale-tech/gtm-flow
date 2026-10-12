# Findymail
Researched: 2026-10-07 · Sources: https://app.findymail.com/docs/ , https://www.findymail.com/api/email-finder/

## What we use it for
Find a work email from full name + company domain (or from a LinkedIn URL), and verify an email. Findymail only returns emails it has verified.

## Endpoints & shapes (with minimal JSON examples)
- Base URL: `https://app.findymail.com`
- Auth: `Authorization: Bearer {API_KEY}` on every call (token from app.findymail.com/user/api-tokens). `Content-Type: application/json`.

### Find by name + domain
`POST /api/search/name`
```json
{ "name": "John Doe", "domain": "website.com", "webhook_url": "optional" }
```
200 sync: `{ "contact": { "name": "John Doe", "domain": "website.com", "email": "john@website.com" } }`
- No separate "verified" flag on finds: any returned email is already verified (docs: credit used "if a verified email is found").
- With `webhook_url`, result is delivered async to the webhook as `{ "payload": { "contact": {...} } }`.
- Errors: 402 `{"error":"Not enough credits"}`, 423 `{"error":"Subscription is paused"}`.

### Find by LinkedIn URL
`POST /api/search/business-profile`
```json
{ "linkedin_url": "https://www.linkedin.com/in/johndoe", "webhook_url": "optional" }
```
Same `contact` response shape and errors as above.

### Verify email
`POST /api/verify`
```json
{ "email": "john@website.com" }
```
200: `{ "email": "john@website.com", "verified": true, "provider": "Google" }` (`verified` is boolean).

### Credits balance
`GET /api/credits`

## Pricing / credits
- Name search: 1 finder credit only if a verified email is found; no charge on not-found.
- Verify: 1 verifier credit on every attempted verification (charged regardless of result).
- Business-profile (LinkedIn) credit cost: UNCONFIRMED (docs mention separate credit types for phone/profile enrichment).

## Limits & gotchas
- Global concurrent limit: 300 simultaneous requests across endpoints.
- `/api/search/business-profile`: max 30 concurrent sync requests. Domain search: 5 concurrent sync.
- Limit is concurrency-based, not requests/minute. Use webhook_url for large batches.
- Not-found response shape: see UNCONFIRMED.

## UNCONFIRMED
- Exact JSON for "not found" on search/name (contact null? empty? 404?). Docs page was read only to char 100000 of 104677.
- Status code when concurrency exceeded (presumably 429).
- Credit cost of business-profile search; whether verify returns anything besides verified/provider (e.g. catch-all).
- Webhook retry/signature details.

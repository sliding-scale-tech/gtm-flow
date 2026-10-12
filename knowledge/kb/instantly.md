# Instantly (API v2)
Researched: 2026-10-07 · Sources: https://developer.instantly.ai/llms.txt , .../getting-started/authorization.md , .../getting-started/rate-limit.md , .../api-reference/emailverification/create-email-verification.md , .../api-reference/lead/create-lead.md , .../api-reference/lead/add-leads-in-bulk-to-a-campaign-or-list.md , .../api-reference/campaign/list-campaign.md

## What we use it for
Verify emails, list campaigns, push leads (single or bulk) into a campaign.

## Endpoints & shapes (with minimal JSON examples)
- Base URL: `https://api.instantly.ai/api/v2`
- Auth: `Authorization: Bearer {API_KEY}`. API keys carry scopes; endpoints accept `all:all` or resource-specific ones.

### Email verification
`POST /email-verification` — scopes: `email_verifications:create|all`, `all:create|all`
```json
{ "email": "a@b.com", "webhook_url": "optional" }
```
Response fields: `status` (success|error), `email`, `verification_status` (pending|verified|invalid), `catch_all` (true|false|"pending"), `credits`, `credits_used`.
- Semi-sync: waits up to 10s; if longer returns `verification_status: "pending"`. Then poll `GET /email-verification/{email}` or use `webhook_url`.
- No valid/risky/unknown enum: only pending/verified/invalid plus a separate `catch_all`. Treat verified + catch_all=true as risky.

### List campaigns
`GET /campaigns?limit=100&starting_after=<next_starting_after>` — scopes `campaigns:read|all`, `all:read|all`
Params: `limit` (1-100), `starting_after`, `search` (name), `tag_ids`, `status` (0 draft, 1 active, 2 paused, 3 completed, 4 running subsequences, -1 unhealthy, -2 bounce protect, -99 suspended), `exclude_status`.
```json
{ "items": [ { "id": "uuid", "name": "..." } ], "next_starting_after": "uuid-or-absent" }
```
Loop until `next_starting_after` is empty/absent. Errors: 401, 402 (no active paid plan), 429.

### Add single lead
`POST /leads` — scopes `leads:create|all`, `all:create|all`
```json
{ "campaign": "campaign-uuid", "email": "a@b.com", "first_name": "A", "last_name": "B",
  "company_name": "Acme", "website": "acme.com", "phone": "+1...", "job_title": "CEO",
  "personalization": "text", "custom_variables": { "key": "value" },
  "skip_if_in_workspace": true, "skip_if_in_campaign": true, "skip_if_in_list": false,
  "verify_leads_on_import": false }
```
Single-lead uses `campaign` (not `campaign_id`). Returns the Lead object (`id`, `status`, `timestamp_created`, ...).

### Add leads in bulk
`POST /leads/add` — same scopes; up to 1000 leads per request
```json
{ "campaign_id": "uuid", "leads": [ { "email": "a@b.com", "first_name": "A", "custom_variables": {} } ],
  "skip_if_in_workspace": true, "skip_if_in_campaign": true, "verify_leads_on_import": false,
  "blocklist_id": "uuid" }
```
Provide `campaign_id` OR `list_id`, not both. Lead item fields: email, first_name, last_name, company_name, job_title, phone, website, personalization, lt_interest_status, pl_value_lead, assigned_to, custom_variables.
Response fields: `status, total_sent, leads_uploaded, in_blocklist, duplicated_leads, skipped_count, invalid_email_count, incomplete_count, duplicate_email_count, remaining_in_plan, created_leads[{id,index,email,...}]`.

## Pricing / credits
- Verification returns `credits_used` and remaining `credits`; per-verification cost value UNCONFIRMED.

## Limits & gotchas
- Rate limit (workspace-wide, v1 and v2, all keys combined): 100 req/s and 6,000 req/min; exceeding either returns 429. Prefer bulk `/leads/add` (1000 per request) over per-lead calls.
- 402 on list campaigns means the workspace lacks a paid plan.

## UNCONFIRMED
- Credit cost per verification and which credit pool it draws from.
- GET /email-verification/{email} response/enum details (doc page 404'd; assumed same schema as POST).
- Whether "risky"/"unknown" ever appear (docs list only pending|verified|invalid).
- custom_variables value type restrictions (flat scalars assumed).
- Scopes for GET /email-verification/{email}.

# Bouncer

Researched: 2026-10-12 · Sources: https://docs.usebouncer.com/api-reference/real-time/verify-email , https://docs.usebouncer.com/quick-start (index: https://docs.usebouncer.com/llms.txt)

## What we use it for

Verify the email TryKitt finds (waterfall step 1). Gives deliverable / risky / undeliverable / unknown **plus** whether the domain accepts all addresses (catch-all), which Findymail's verify can't tell us.

## Basics

- Base URL: `https://api.usebouncer.com/v1.1`
- Auth: header `x-api-key: <key>`. Key: app.usebouncer.com → API (left menu) → Generate API Key.
- Real-time verify: `GET /email/verify?email=<email>&timeout=<seconds>` (timeout optional, default 10, max verification time 30 s).
- Limit: 1,000 requests/min by default → `429`. `402` = no credits left.
- No credits-balance endpoint found in the docs → no free key test. A key test costs 1 verification.

## Response (fields we use)

- `status`: `deliverable` | `risky` | `undeliverable` | `unknown`
- `reason`: accepted_email, low_deliverability, low_quality, invalid_email, invalid_domain, rejected_email, dns_error, unavailable_smtp, unsupported, timeout, unknown
- `domain.acceptAll`: `yes` | `no` | `unknown`
- Also: `retryAfter` (greylisted address), `didYouMean`, `toxic` / `toxicity`, `score`, account flags (role, disabled, fullMailbox).

## Our mapping

- `undeliverable` → invalid
- `deliverable` → `catch_all` if `acceptAll = yes`, else `valid`
- `risky` → `catch_all` if `acceptAll = yes`, else `risky`
- `unknown` / anything else → unknown (the waterfall treats it as risky)

## UNCONFIRMED

- Credit cost per verification and $ per credit (set `prices.bouncerVerify` in Settings; the default is an estimate).
- Response shape is CONFIRMED live on 2026-10-12: `domain.acceptAll` is a string ("yes"), `score` is 0-100, `provider` is shown. Test: jreisner@r2propertymanagement.com → `deliverable` / `accepted_email` / `acceptAll: yes` / score 90 → we map it to `catch_all`.

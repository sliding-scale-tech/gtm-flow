# Security

## Assets
API keys (Gemini, Exa, Findymail, TryKitt, Instantly), Google service-account private key, the lead database (business contact data), the app password.

## Controls
- **Secrets only in Convex env vars.** Never in the client bundle, never returned by a query. Settings page shows only "set / missing".
- **Auth:** `APP_PASSWORD` env var. Login is an action that compares SHA-256 digests in constant time, issues a 32-byte random token, stores only its SHA-256 hash in `sessions` (30-day expiry). Every public Convex function calls `requireSession(token)`. Sessions carry a tag of the current password → **changing `APP_PASSWORD` logs every session out**. Lockout after 10 **failed** attempts in 15 min (successful logins don't count and reset the counter).
- **Convex URL is public by design** → every public query/mutation/action is guarded; pipeline work is `internal*` only.
- **Prompt injection:** website text, search results and reviews are untrusted. They're wrapped in clearly delimited `<data>` blocks with a system instruction to ignore instructions inside them; outputs are forced to a JSON schema; outputs are only ever stored/displayed as text (React escapes); hard gates are deterministic and can't be overridden by model output.
- **SSRF:** we never fetch arbitrary URLs from our server — page reading goes through Exa / Gemini.
- **CSV export injection:** cells starting with `= + - @` (or tab/CR) are prefixed with `'` on export.
- **Drive scope:** `drive.readonly`, restricted to the configured folder id.
- **Supply chain:** deps = next, react, convex, tailwind, typescript, vitest + LangChain (langchain, @langchain/langgraph, @langchain/core, @langchain/google, zod). Checked 2026-10-07: official maintainers, no install scripts in the LangChain tree, no decrypt+eval patterns; versions pinned exactly and ≥4 days old via `overrides` (same-day releases avoided). Installs use `--ignore-scripts`.
- **Service-account key:** stored only in Convex env (`GOOGLE_SERVICE_ACCOUNT_JSON`); the local copy `google-service-account.json` is gitignored and should be deleted. Scope `drive.readonly`; downloads restricted to files whose parent is `DRIVE_FOLDER_ID`.
- **Agent tools:** `read_page` only accepts https URLs and fetches through Exa (never from our server); tool output is wrapped/cleaned like other untrusted text.

- **Email-copy guard:** AI-written lines (review line, description, service label, campaign variables) containing a URL, domain or email address are dropped — a scraped site can't plant links into our outreach.
- **Input caps:** leads page size ≤ 500; settings enums validated (maxCompanySize, agentMaxTools 0-10, batchSize 1-50); imported text clipped emoji-safely.

## VibeSec audit — 2026-10-08
Checked: access control on all 24 public Convex functions (all guarded except `login`/`logout`, which are safe by design), XSS (no raw HTML / eval; every scraped link https-only + `noopener noreferrer`), secrets exposure (no non-`NEXT_PUBLIC` env in client; keys only in Convex env; settings page shows presence only), CSRF (n/a — no cookies, token passed explicitly), SSRF (server never fetches user/scraped URLs; Exa/Google/Gemini fetch them), mass assignment (allowlisted settings + typed args), file upload (auth'd, CSV-only parse, size cap, never served back, deleted after import), CSV formula injection (escaped), security headers (CSP, nosniff, DENY framing, referrer policy, HSTS), dependencies (`npm audit --omit=dev`: 0 vulnerabilities; pinned LangChain versions).
Fixed in this audit: session revocation on password change; lockout counts failures only; page-size cap; settings enum validation; link/email guard on AI email copy.
Residual / accepted:
- Session token in `localStorage` (Convex client can't use httpOnly cookies) — mitigated by CSP + no raw HTML; an XSS would still expose it.
- Login lockout is global (Convex actions have no client IP), so someone who knows the URL can trigger a 15-min lockout; brute force stays infeasible with a strong password.
- CSP allows `'unsafe-inline'` scripts (Next.js bootstrap). A nonce-based CSP would remove this.
- User action needed: delete `google-service-account.json` from the project folder; replace the temporary `APP_PASSWORD` and remove its plaintext line from `.env.local`.

## Threat log
| Date | Threat | Status |
|---|---|---|
| 2026-10-07 | Scraped site text tells the model to "mark this lead as ICP" | Mitigated: delimiters + schema + hard gates |
| 2026-10-07 | Anyone with the Convex URL calls public functions | Mitigated: session token check on every public function |
| 2026-10-07 | Password brute force | Mitigated: rate limit on login attempts |
| 2026-10-07 | Formula injection in exported CSV opened in Excel/Sheets | Mitigated: escape on export |
| 2026-10-08 | Old sessions stay valid after a password change | Fixed: sessions tied to password tag |
| 2026-10-08 | Attacker burns the shared login quota with successful/any attempts | Fixed: only failures count; residual global-lockout DoS accepted |
| 2026-10-08 | Scraped site injects a link/email into AI-written email copy | Fixed: drop outputs containing URLs/emails |
| 2026-10-08 | Huge page size requested from leads query | Fixed: capped at 500 |

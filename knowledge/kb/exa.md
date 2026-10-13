# Exa API (api.exa.ai)
Researched: 2026-10-07 · Sources: https://exa.ai/docs/reference/search , https://exa.ai/docs/reference/get-contents , https://exa.ai/docs/reference/rate-limits , https://exa.ai/docs/reference/livecrawling-contents , https://exa.ai/pricing , https://exa.ai/docs/reference/search-api-guide-for-coding-agents
(docs.exa.ai 308-redirects to exa.ai/docs. Pages read via a summarizing fetcher; verify field names with a live call.)

## What we use it for
Find companies/people and pull page text (company sites, subpages) for lead enrichment, then feed the text to Gemini.

## Endpoints & shapes
- Base `https://api.exa.ai`. Auth: `x-api-key: $EXA_API_KEY` or `Authorization: Bearer $EXA_API_KEY` (both documented).
- `POST /search` body:
  - `query` (req); `type`: `instant` | `fast` | `auto` (default) | `deep-lite` | `deep` | `deep-reasoning`
  - `numResults` 1-100 (default 10); `includeDomains` / `excludeDomains` (max 1200 each, wildcards/paths ok); `startPublishedDate` / `endPublishedDate` (ISO 8601); `userLocation` ("US" or {country,latitude,longitude})
  - `category`: `company`, `publication`, `news`, `personal site`, `financial report`, `people`. **No "linkedin profile" in the current enum**; use `people`.
  - `contents`: `text` (bool | {maxCharacters, verbosity: compact|standard|full}), `highlights` (bool | {query,maxCharacters}), `summary` ({query, schema}), `extras` ({links,imageLinks,codeBlocks,...}), `maxAgeHours` (-1..720), `subpages` (0-100), `subpageTarget`
  - Synthesis extras: `outputSchema`, `objective`, `systemPrompt`, `stream`
```json
{"query":"B2B SaaS payroll startups Germany","type":"auto","numResults":10,"category":"company",
 "contents":{"text":{"maxCharacters":3000},"highlights":true}}
```
Response:
```json
{"requestId":"...","results":[{"title":"","url":"","publishedDate":"","author":"","text":"","highlights":[""],"summary":"","entities":[{"type":"company","id":"","properties":{}}]}],
 "costDollars":{"total":0.007,"search":{"neural":0,"keyword":0},"contents":{"text":0}},"searchTime":245,"output":{"content":{},"grounding":[]}}
```
- `POST /contents` body: `urls` (1-100) OR `ids` (1-100, from prior search); `text` (bool | {maxCharacters 1-1,000,000, includeHtmlTags, verbosity, includeSections/excludeSections}); `highlights`; `summary`; `extras`; `maxAgeHours` (-1..720; omit = cache if available else fetch; 0 = always fresh; -1 = cache only); `livecrawlTimeout` ms (1-90000, default 10000); `subpages` (0-100); `subpageTarget` (string or array, e.g. "about", "team"). Old `livecrawl` ("always|never|fallback|preferred") is deprecated: always -> maxAgeHours 0, never -> -1.
```json
{"urls":["https://acme.com"],"text":{"maxCharacters":4000},"subpages":3,"subpageTarget":["about","team"],"maxAgeHours":168}
```
Response: `{requestId, results[], statuses:[{id, status:"success"|"error", source:"cached"|"crawled", error:{tag, httpStatusCode}}], costDollars, searchTime}`. Per-URL failures appear in `statuses`, not as HTTP errors: always check `statuses`.

## Pricing (re-checked 2026-10-13, exa.ai/pricing)
- Search: instant $4/1k; fast/auto $7/1k; deep $12–15/1k. 10 results included; beyond that $1/1k results.
- Contents: $1/1k pages. Summaries add $1/1k pages. Answer $5/1k. Free tier: $10 credits/month.
- Actual cost is in `costDollars` on /search and /contents responses (documented in both schemas). Live observation: auto search with 5 text results = $0.007 flat.

## Limits & gotchas
- QPS per team (all keys): /search 10, deep variants 5, /contents 100. 429 -> honor `Retry-After` if present, else exponential backoff. Adding $1,000 credits within 30 days gives 25 QPS for 90 days.
- Latency: instant ~250ms, auto ~1s, deep-reasoning 12-40s. Budget Convex action timeouts accordingly.
- Fresh crawls wait up to 10s by default; raise `livecrawlTimeout` (12-15s) for slow sites.
- Prefer `highlights` for cheap relevance snippets; cap `text.maxCharacters` to limit LLM tokens.
- Plain fetch works in Convex V8 actions.

## UNCONFIRMED
- Restrictions when `category` is `company` / `people` (older docs said some filters such as date and excludeDomains are unsupported; not stated in pages read).
- Whether the old `linkedin profile` category value is still accepted.
- Whether subpages are billed as separate pages.
- Max `numResults` per search type / plan (docs say 1-100).

## Live-verified 2026-10-07
- `/contents` with `subpages` + `subpageTarget` returns subpages under `results[i].subpages[]`; homepage + 4 subpages billed $0.005 (`costDollars.total`). Failed crawl → `results: []`, `statuses[].error.tag` e.g. `CRAWL_EMPTY_CONTENT`, cost $0.
- `/search` auto, 3 results with text → `costDollars.total` 0.007.

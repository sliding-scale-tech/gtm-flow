# Knowledge index

Standing rule: **no library or API gets used without a research pass logged in `knowledge/kb/` first.** Add a row here when a pass is done; re-research if a file is older than ~3 months or an API misbehaves.

| Topic | File | Researched | Notes |
|---|---|---|---|
| Gemini API (REST) | kb/gemini-genai.md | 2026-10-07 | generateContent + responseJsonSchema; verify schema field + tool key casing on first live call |
| Exa | kb/exa.md | 2026-10-07 | /search, /contents (statuses[]), costDollars in response |
| Findymail | kb/findymail.md | 2026-10-07 | not-found shape unconfirmed |
| TryKitt | kb/trykitt.md | 2026-10-07, live 2026-10-08 | `x-api-key`; flat body; status in `validity`; cost in `credits.jobCredits` |
| AI Ark | kb/ai-ark.md | 2026-10-08 | **REMOVED 2026-10-09** (found 0 emails in WY/NH tests; free key 5 req/min). Kept for reference only |
| Instantly v2 | kb/instantly.md | 2026-10-07 | verify = verified/invalid + catch_all flag; /leads/add bulk 1000 |
| Convex | kb/convex.md | 2026-10-07 | |
| Google Drive (service account) | kb/google-drive-api.md | 2026-10-07 | |
| Next.js | kb/next-js.md | 2026-10-07 | |
| Tailwind | kb/tailwind.md | 2026-10-07 | |
| Vitest | kb/vitest.md | 2026-10-07 | |
| LangGraph.js + Gemini | kb/langgraph.md | 2026-10-07 | createAgent (langchain v1) + ChatGoogle (@langchain/google); createReactAgent deprecated; recursionLimit default 25; externalPackages likely not needed (no live deploy yet) |

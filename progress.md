# Progress

## Done (2026-10-07)
- Docs, CLAUDE.md rules (authoritative files, subagent model choice), knowledge/kb research passes for all libraries/APIs.
- Convex backend on the **gtm-flow dev deployment** (whimsical-raccoon-814): schema, auth, settings/prompts (versioned), ingest (Drive + upload), pipeline tick + sweeper cron, all 8 stages, Instantly push, prompt test.
- Dashboard (Next 16): login, overview, new run (Drive / upload), runs list, live run page (funnel, costs, controls, drop reasons), leads grid + drawer (override / re-run / copy), push modal, prompts editor, settings.
- Tests: 10 vitest unit tests pass; `tsc` clean; `next build` passes.
- Live test with real Gemini + Exa: 9-row WV test run → clean rules, chain, place_id + domain dedupe, domain via Exa, site read, ICP classify, owner found (Blackwell PM → Patrick Blood, Founder), go decision; leads then wait for FINDYMAIL_API_KEY as designed. Total spend $0.083.

## Pending / reminders
- [x] Phase A (cost cuts): quota/credit error handling, deny categories, website text trimming, token logging. [ ] Deploy to prod + run `npx convex run settings:addDenyCategories` on dev and prod.
- [x] Phase B analysis scoped: Exa instant vs auto test (~$0.45), pre-check prompt test (~$0.25). [ ] User approval needed before running Phase B tests.
- **FL.csv run errors:** Gemini spending cap hit, Exa credits exhausted. Leads are blocked. User must raise Gemini monthly spending cap / add Exa credits, then press **Retry** on the run page.
- [x] TryKitt + Instantly live (2 valid emails found on real leads). [ ] Add FINDYMAIL_API_KEY → Resume: Broad Management + Park Place go straight to Findymail (TryKitt step saved, not re-paid).
- [x] Google Drive connected — NEW folder 1nMVri2… → by_state (52 CSVs, 107,257 rows total; identical to property_managers.csv). Delete the local `google-service-account.json` copy (gitignored).
- [x] LangGraph research agent live (VA/TX tests: correct rejections, owners found with LinkedIn, ~$0.003–0.03 per lead).
- [x] reviews.csv imported (173,337 named 5★ reviews, 65,547 companies). Re-import from Settings if the file changes.
- [ ] Decide max company size (default up to 200 employees; Bay PMG ~146 staff / 5 states and Broad Management pass at that setting).
- [ ] TX = 31,144 new leads ≈ $250–930 research for the whole file — run in chunks or raise budget deliberately.
- [ ] Cost lever: TX has ~9k real-estate agent/agency rows; the agent rejects them (~$0.008 each). Consider deny-listing "real estate agent" if spend matters.
- [ ] User changes APP_PASSWORD (temporary one is noted in .env.local).
- [ ] Vercel deploy: build command `npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`, env CONVEX_DEPLOY_KEY; set the same Convex env vars on the prod deployment.
- [ ] Prices in Settings: confirm Findymail and Instantly per-credit cost for the user's plans (defaults are estimates).
- [ ] After a 5k run: compare emails/5k vs the 1,000 target and tune gates.
- [x] Cost cuts 2 (2026-10-13): research agent trimmed (~$0.028 -> ~$0.020/lead), eval pricing fix, `evalsNode:exaType` test run (instant ~equal to auto on owner hits, $0.004 vs $0.007/call). [ ] User decides whether to switch `exaSearchType` to `instant`. Flash-lite agent and pre-check rejected (see decisions.md).

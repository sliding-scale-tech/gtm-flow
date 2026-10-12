# Memory (cross-session)

## Where we left off
- 2026-10-07: Phases 0–6 built and deployed to the Convex dev deployment the user connected (online, NOT local). Gemini + Exa keys set by user and live-tested. Findymail/TryKitt/Instantly + Drive service account come last (user's choice). See progress.md for the open checklist.

## Things to remember
- The user wants simple-word questions with choices.
- Ponytail + caveman skills are installed project-only (`.claude/skills`), markdown only, no hooks.
- Subagent model rule lives in CLAUDE.md (haiku / sonnet / opus by task).
- The BitScale reference doc is `BitScale_Enrichment_Grid_Current_Configuration.docx`; sample input `WV.csv`.
- Convex: use the online gtm-flow project (`npx convex dev`), never a local/anonymous backend — user's explicit choice.
- Drive: new folder 1nMVri2IQO6otdqepzdrKBazzFaOqTYC7, DRIVE_FOLDER_ID = its by_state subfolder. property_managers.csv = same data combined.
- Test run `e2e-test.csv` (9 rows) on dev is paused waiting for FINDYMAIL_API_KEY — good first live test of the email stages.
- **Never run TryKitt or Instantly in tests** (costs money) — user rule 2026-10-08. Test the email waterfall only with the faked-provider unit tests; ask before resuming runs that reach the email stage.

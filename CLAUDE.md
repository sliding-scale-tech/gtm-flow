# GTM Flow — Project Instructions

## Rules

### Authoritative context — read first

Before doing anything else in this project, load and treat ONLY the following files as your authoritative context. Do not read, assume, or infer from any other .md file in the repo unless I explicitly point you to one.

Read these, in this order:

1. CLAUDE.md — project-specific instructions and conventions
2. prd.md — what we're building: features, scope, success criteria (≥1,000 usable emails per 5k Google Maps rows)
3. architecture.md — what's actually built vs planned ([x]/[ ] markers), folder structure, the LLM usage boundary rule (Gemini only for judgment/text generation; cleaning rules, dedupe, email selection and cost math stay deterministic code)
4. decisions.md — dated log of every architectural decision and why it was made
5. phases.md — phase-by-phase build plan, status, dependencies
6. progress.md — current status: done, pending, open reminders
7. memory.md — cross-session context on where we left off
8. security.md — security considerations: prompt injection (scraped website text and reviews are untrusted input), API-key handling, data ownership, threat log
9. knowledge/index.md — index of which library/tool has a research pass and when
10. knowledge/kb/*.md — next-js, convex, tailwind, vitest, gemini-genai, exa, findymail, trykitt, instantly, google-drive-api — the standing rule is that no library gets used without a research pass logged here first
11. docs/superpowers/specs/2026-10-07-gtm-flow-design.md — the approved design spec
12. docs/superpowers/plans/2026-10-07-gtm-flow.md — the implementation plan/checklist for that spec

### Subagents — spawn as needed, pick the model by task

Spawn subagents freely when they help (parallel research, independent build tasks, reviews). Pick the model the task is optimized for:

- **haiku** — fast, cheap, mechanical work: file/code search, npm registry and supply-chain lookups, listing/summarizing docs, simple renames and boilerplate.
- **sonnet** — the default for real work: API/doc research passes for knowledge/kb, implementing a well-specified module or UI page, writing tests, fixing ordinary bugs.
- **opus** — hard reasoning: architecture and design decisions, tricky debugging, security review, final code review of the full pipeline, prompt design for the Gemini agents.

Give each agent full context (it starts cold), a narrow scope, and the files it owns. Never let two parallel agents edit the same file. Review agent output before relying on it.

Treat architecture.md and decisions.md as ground truth over anything you might infer from the code itself — if they conflict with what you find in source, flag the conflict rather than trusting the code silently. Follow the standing rule in knowledge/index.md: before using any library not already covered in knowledge/kb/, do a research pass and write it there before writing code that uses it.

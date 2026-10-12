# Next.js
Researched: 2026-10-07 · Version: next 16.4.0 (engines node >=20.9.0) · Sources: https://nextjs.org/docs/app/api-reference/cli/create-next-app, https://nextjs.org/docs/app/getting-started/server-and-client-components, https://nextjs.org/docs/app/guides/environment-variables, https://nextjs.org/docs/app/api-reference/file-conventions/proxy

## What we use it for
App Router UI on Vercel; talks to Convex from client components via `convex/react`.

## Key APIs / setup (minimal examples)
```bash
npx create-next-app@latest gtm-flow --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
```
Documented flags: `--ts`, `--tailwind`, `--eslint`, `--app`, `--src-dir` (negate via `--no-src-dir`), `--import-alias`, `--use-npm`, `--yes`. The recommended defaults already equal TS + ESLint + Tailwind + no src/ + App Router (+ Cache Components, AGENTS.md). The repo already has content (knowledge/), so scaffold in a temp dir and move files if the CLI refuses.
- Middleware: not needed. In Next 16 `middleware.ts` is deprecated and renamed `proxy.ts` (Node runtime); skip it.
- Client components: `"use client"` at file top for hooks/state/browser APIs; providers (Convex) must be client components wrapping `{children}` in a server `layout.tsx`. Props server to client must be serializable. Layouts/pages are server components by default.
- Env: only `NEXT_PUBLIC_*` reaches the browser, inlined at `next build` (must be a static `process.env.NEXT_PUBLIC_X` reference). `.env.local` is gitignored by the template.
- Vercel: set env vars per environment in the project settings; changing a NEXT_PUBLIC_ value needs a rebuild. With Convex use build command `npx convex deploy --cmd 'npm run build'` (see convex.md).

## Limits & gotchas
- Secrets (service-account key) live in Convex env, never NEXT_PUBLIC_.
- Cache Components is part of the 16 recommended defaults; choose "customize settings" if undesired.

## UNCONFIRMED
- Non-interactive flag to disable Cache Components / AGENTS.md (only generic `--no-*` is documented).
- Vercel dashboard UI steps not fetched from official docs.

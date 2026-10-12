# Vitest
Researched: 2026-10-07 · Version: vitest 5.0.3 (engines node ^22.12.0 || ^24.0.0 || >=26; vite peer ^6.4 || ^7 || ^8) · Sources: https://vitest.dev/config/ (engines from `npm view`)

## What we use it for
Unit tests for pure TS helpers in convex/lib (CSV parsing, JWT helpers, etc.).

## Key APIs / setup (minimal examples)
```bash
npm i -D vitest
```
```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["convex/lib/**/*.test.ts"] },
});
```
```ts
// convex/lib/csv.test.ts
import { it, expect } from "vitest";
it("works", () => expect(1 + 1).toBe(2));
```
Run: `npx vitest run` (one-shot; `npx vitest` = watch). package.json: `"test": "vitest run"`. Node's global `crypto.subtle` and `fetch` exist, so the Drive JWT helper can be unit tested without mocks.

## Limits & gotchas
- Needs Node 22.12+ (or 24+); Next.js alone only needs 20.9. Check `node -v`.
- Keep convex/lib files free of `_generated` imports so they run outside Convex.
- `VITEST_SKIP_INSTALL_CHECKS=1` disables the missing-dependency install prompt.

## UNCONFIRMED
- Default `test.include` glob in v5 not verified (set explicitly above).

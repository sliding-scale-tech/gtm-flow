# Tailwind CSS
Researched: 2026-10-07 · Version: tailwindcss 4.3.3, @tailwindcss/postcss 4.3.3 (major v4) · Sources: https://tailwindcss.com/docs/installation/framework-guides/nextjs, https://tailwindcss.com/docs/dark-mode

## What we use it for
Styling for the Next.js UI.

## Key APIs / setup (minimal examples)
```bash
npm install tailwindcss @tailwindcss/postcss postcss    # create-next-app --tailwind does this for you
```
```js
// postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```
```css
/* app/globals.css (imported in app/layout.tsx) */
@import "tailwindcss";
```
No tailwind.config.js needed in v4.

Dark mode: the default `dark:` variant follows `prefers-color-scheme`. For a manual toggle:
```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```
then toggle `class="dark"` on `<html>` (persist in localStorage, set before paint to avoid flash). Alternative: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.

## Limits & gotchas
- v4 is CSS-first config (`@theme`, `@custom-variant`), not a JS config file.
- `postcss` must be installed alongside the plugin.

## UNCONFIRMED
- Browser support floor for v4 not checked.

# S07 — Web shell and home

> **Status:** todo · **Depends on:** S00, S01 · **Effort:** ~1.5 days
> **Owner:** — · **Branch:** `slice/S07-web-shell`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §11 first.

## Why this slice exists

This is the face of the guide. It establishes the visual language, the layout, the data-loading
boundary, and the base-path handling that every other page depends on.

## Goal

- A distinctive, editorial design system with light/dark support.
- A shared layout with header, footer, skip link, SEO, and canonical URLs.
- A base-path-safe `url()` helper for GitHub Pages.
- A validated data-loading layer for `snapshot`, `benchmarks`, and `scores`.
- A data-driven home page: free now, latest changes, top picks.

## Non-goals

- No filterable directory or compare view. S08.
- No changes/methodology/health pages. S09.
- No client-side data fetching.
- No external fonts or analytics.

## Inputs and contracts

- `data/snapshot.json`, `data/scores.json`, `data/benchmarks.json`, `data/events.jsonl`.
- Astro `base` from `BASE_PATH`.
- Shared schemas from `@omg/shared`.

If `data/` is not ready, develop against a temporary `data/` copy from fixtures, but do not commit
fixture data as production data. The final PR must build from a real S02/S06 ingest.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `apps/web/src/layouts/Base.astro` | Head, nav, footer, skip link |
| Create | `apps/web/src/components/Header.astro` | Nav with active state |
| Create | `apps/web/src/components/Footer.astro` | Sources, methodology, repo |
| Create | `apps/web/src/components/FreeBadge.astro` | Five kinds + uncertain |
| Create | `apps/web/src/components/Section.astro` | Consistent section header |
| Create | `apps/web/src/components/Stat.astro` | Big numeral + label |
| Create | `apps/web/src/lib/url.ts` | Base-path helper |
| Create | `apps/web/src/lib/data.ts` | Zod-validated data access |
| Create | `apps/web/src/lib/format.ts` | Currency, tokens, dates, labels |
| Create | `apps/web/src/pages/index.astro` | Home |
| Create | `apps/web/src/styles/global.css` | Tokens + base styles |
| Create | `apps/web/src/env.d.ts` | Astro + `?raw` module declarations |
| Create | `apps/web/test/url.test.ts` | Base path cases |
| Modify | `apps/web/astro.config.mjs` | `@data` alias + fs allow |
| Modify | `apps/web/tsconfig.json` | Path mapping |

## Implementation steps

### 1. Write the failing `url()` test

```ts
import { describe, expect, it } from "vitest";
import { url } from "../src/lib/url";

describe("url", () => {
  it("prefixes the base path once", () => {
    expect(url("/models", "/repo")).toBe("/repo/models");
    expect(url("/", "/repo")).toBe("/repo/");
  });
  it("handles root base", () => {
    expect(url("/models", "/")).toBe("/models");
  });
  it("does not double-prefix", () => {
    expect(url("/repo/models", "/repo")).toBe("/repo/models");
  });
  it("preserves query strings", () => {
    expect(url("/models?free=limited-time", "/repo")).toBe("/repo/models?free=limited-time");
  });
});
```

Run: `pnpm vitest apps/web/test/url.test.ts`. Expected: module not found.

### 2. Implement `url.ts`

```ts
export function url(path: string, base = import.meta.env.BASE_URL): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (b && (p === b || p.startsWith(`${b}/`) || p.startsWith(`${b}?`))) return p;
  return b ? `${b}${p}` : p || "/";
}
```

Note: `import.meta.env.BASE_URL` may be `/` or `/repo/`. Handle both.

### 3. Configure the data alias

`apps/web/astro.config.mjs`:

```js
import { fileURLToPath } from "node:url";

const dataDir = fileURLToPath(new URL("../../data", import.meta.url));

export default defineConfig({
  // ...
  vite: {
    plugins: [tailwindcss()],
    resolve: { alias: { "@data": dataDir } },
    server: { fs: { allow: ["../.."] } },
  },
});
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@data/*": ["../../data/*"] }
  }
}
```

### 4. Implement `data.ts`

`apps/web/src/env.d.ts`:

```ts
/// <reference types="astro/client" />

declare module "*?raw" {
  const content: string;
  export default content;
}
```

Then:

```ts
import snapshotJson from "@data/snapshot.json";
import scoresJson from "@data/scores.json";
import benchmarksJson from "@data/benchmarks.json";
import eventsRaw from "@data/events.jsonl?raw";
import { SnapshotSchema, ScoresFileSchema, BenchmarksFileSchema, ChangeEventSchema } from "@omg/shared";

export function loadData() {
  const snapshot = SnapshotSchema.parse(snapshotJson);
  const scores = ScoresFileSchema.parse(scoresJson);
  const benchmarks = BenchmarksFileSchema.parse(benchmarksJson);
  const events = eventsRaw.split("\n").filter(Boolean).map((l) => ChangeEventSchema.parse(JSON.parse(l)));
  return { snapshot, scores, benchmarks, events };
}
```

- Sort events newest first.
- Throw a readable error naming the file and the Zod issue if validation fails.
- Do not silently fall back to empty data.

### 5. Build the design system

`global.css`:

```css
@import "tailwindcss";

@theme {
  --color-paper: #f7f5ef;
  --color-ink: #161513;
  --color-muted: #6b665c;
  --color-line: #ded9cc;
  --color-accent: #c2410c;
  --color-good: #15803d;
  --color-warn: #b45309;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", "Cascadia Mono", monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-paper: #141311;
    --color-ink: #f2efe7;
    --color-muted: #a39d90;
    --color-line: #312e28;
    --color-accent: #fb923c;
  }
}
```

Add base styles: `body { background: var(--color-paper); color: var(--color-ink); }`,
`font-variant-numeric: tabular-nums` on data elements, visible `:focus-visible` outlines, and
`@media (prefers-reduced-motion: reduce)`.

Design rules:

- Large editorial numerals for stats.
- Hairline borders, no heavy shadows.
- Accent used only for free/warning signals.
- Tables use `border-collapse`, right-aligned numbers, monospace for prices.
- Max content width ~1120 px; comfortable line length for prose.

### 6. Build `Base.astro`

- `<!doctype html>`, `lang="en"`.
- `<meta name="viewport">`, title, description, canonical, OG tags.
- Skip link: `<a href="#main" class="skip">Skip to content</a>`.
- Header with links: Models, Changes, Compare, Methodology.
- Active link styling based on `Astro.url.pathname`.
- Footer: data sources, **required Artificial Analysis attribution link** when its data is used,
  "not affiliated with OpenCode", GitHub link, last updated.
- `<main id="main">` slot.
- No client JS.

### 7. Build the home page

Sections:

1. **Hero:** "Which model should you run in OpenCode?" Subtitle: "Free-model tracker and buyer's
   guide. Updated daily." Big stat: number of no-subscription free models; secondary: number of
   models tracked; last updated date.
2. **Free right now:** cards for up to 6 `freeNow` models. Each card: name, provider, free kind,
   context, one-line caveat. Link to all.
3. **Latest changes:** last 5 events with date, summary, link.
4. **Best value:** one card per use case showing the top non-unrated model, its tier, score, and
   modeled agentic cost. If no data, show "insufficient data".
5. **How we score:** short paragraph linking to `/methodology`.
6. **Source note:** link to `/health`.

Data derivations live in `apps/web/src/lib/home.ts` and are unit-tested if non-trivial.

### 8. Verify

```bash
pnpm build
pnpm exec astro check
```

Open the build at 360, 768, and 1280 px. Tab through the page. Check contrast in both themes.

### 9. Commit

`feat: add editorial site shell and data-driven home page`

## Acceptance checklist

- [ ] `url()` passes all base-path tests.
- [ ] `data.ts` validates all three JSON files and the event log.
- [ ] Home renders real counts from `data/snapshot.json`.
- [ ] Free cards use `free.kind` and show caveats; `uncertain` is visibly marked.
- [ ] Latest changes renders zero-state gracefully.
- [ ] No external fonts, analytics, or client JS.
- [ ] Keyboard navigation works; skip link is first.
- [ ] Contrast ≥ 4.5:1 in light and dark.
- [ ] Works at 360 px with no horizontal scroll.
- [ ] `astro check` and `pnpm build` pass.

## Handoff notes

- S08 uses `url()` and `data.ts`; do not create a second data loader.
- S09 uses `events` from `data.ts`; do not re-parse the JSONL in the page.
- Keep `FreeBadge.astro` as the single source of free-kind labels. S08 imports it.
- If the visual direction needs a logo, use `assets/icon.svg` or a simple wordmark; do not add an
  image-heavy hero.
- The home page is static. Do not add a "refresh" button.

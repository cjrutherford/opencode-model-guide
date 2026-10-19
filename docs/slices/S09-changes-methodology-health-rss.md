# S09 — Changes, methodology, health, and RSS

> **Status:** todo · **Depends on:** S07, S04, S05, S06 · **Effort:** ~1.5 days
> **Owner:** — · **Branch:** `slice/S09-changes-methodology-health-rss`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §10–§11 first.

## Why this slice exists

A tracker earns trust by showing its work: what changed, how scores are computed, which sources are
healthy, and what is missing. This slice publishes the audit trail and the feed subscribers use.

## Goal

- `/changes`: a human-readable event timeline with type filters.
- `/methodology`: formulas, weights, tiers, sources, and limitations.
- `/health`: source status, counts, unmatched benchmarks, conflicts.
- `/feed.xml`: valid RSS for recent events.
- `robots.txt` and sitemap integration.

## Non-goals

- No notification delivery. S10 sends ntfy.
- No historical charts beyond the event list.
- No admin UI for editing data.
- No comments or user submissions.

## Inputs and contracts

- `loadData()` from S07: `snapshot`, `scores`, `benchmarks`, `events`.
- `modelHref()` from S08.
- `buildFeed(events, { site, base }): string` in `apps/web/src/lib/feed.ts`.
- Event types: `model_added`, `free_started`, `free_ended`, `price_changed`, `deprecated`,
  `source_failed`.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `apps/web/src/pages/changes.astro` | Timeline |
| Create | `apps/web/src/pages/methodology.astro` | Formulas + weights |
| Create | `apps/web/src/pages/health.astro` | Source + data health |
| Create | `apps/web/src/pages/feed.xml.ts` | RSS endpoint |
| Create | `apps/web/src/pages/robots.txt.ts` | Sitemap reference |
| Create | `apps/web/src/lib/feed.ts` | Pure feed builder |
| Create | `apps/web/src/lib/health.ts` | Staleness + counts |
| Create | `apps/web/src/lib/labels.ts` | Event/free/tier labels |
| Create | `apps/web/test/feed.test.ts` | XML + escaping |
| Create | `apps/web/test/health.test.ts` | Staleness |
| Modify | `apps/web/src/layouts/Base.astro` | Add RSS alternate link |
| Modify | `apps/web/astro.config.mjs` | Sitemap already added in S00 |

## Implementation steps

### 1. Write the failing feed test

```ts
import { describe, expect, it } from "vitest";
import { buildFeed } from "../src/lib/feed";

const events = [
  {
    id: "free_started:opencode/example:2026-10-19",
    type: "free_started",
    at: "2026-10-19T13:00:00.000Z",
    modelKey: "opencode/example",
    summary: "Example <script> is now free & unlimited.",
    data: {},
    notify: true,
  },
];

it("emits absolute links and escapes XML", () => {
  const xml = buildFeed(events, { site: "https://example.github.io", base: "/repo" });
  expect(xml).toContain("<link>https://example.github.io/repo/models/opencode--example/</link>");
  expect(xml).toContain("&lt;script&gt;");
  expect(xml).not.toContain("<script>");
});

it("handles zero events", () => {
  const xml = buildFeed([], { site: "https://example.github.io", base: "/" });
  expect(xml).toContain("<channel>");
  expect(xml).not.toContain("<item>");
});
```

Run: `pnpm vitest apps/web/test/feed.test.ts`. Expected: module not found.

### 2. Implement `feed.ts`

- RSS 2.0 with `<channel>`: title, link, description, language, lastBuildDate.
- Last 100 events, newest first.
- Each `<item>`: title (`summary` truncated to 140 chars), link to model page, guid (event id,
  `isPermaLink="false"`), pubDate (RFC 822), description (full summary + type label).
- Absolute links: `new URL(url(path, base), site).toString()`.
- `escapeXml`: replace `&`, `<`, `>`, `"`, `'`; strip control characters.
- `lastBuildDate`: newest event date, or now.
- No CDATA unless necessary; escaped text is safer.

### 3. Implement `labels.ts`

- `FREE_KIND_LABELS`: `open-free` → "Free", `limited-time` → "Free · limited time",
  `subscription-included` → "Included with Go", `trial` → "Free · trial terms", `paid` → "Paid".
- `EVENT_LABELS`: `free_started` → "Free", `free_ended` → "No longer free",
  `price_changed` → "Price change", `deprecated` → "Deprecated", `model_added` → "New model",
  `source_failed` → "Source issue".
- `TIER_LABELS` and `CONFIDENCE_LABELS` (`high` ≥ 0.75, `medium` ≥ 0.45, `low` < 0.45).

Use these in all pages. Do not duplicate strings.

### 4. Build `/changes`

- Read `events` newest first.
- Filter chips: All, Free, Price, Deprecated, New, Source. Map to event types.
- Group by UTC date with a sticky date label.
- Each row: time, event badge, summary, model link, and a compact before/after for price changes.
- Free starts and ends get the accent color; source failures get a warning color.
- Zero state: "No changes recorded yet. The first baseline is in place; new changes will appear
  here."
- Query param `?type=free_started` for shareable filtered views.
- Show the RSS link with `<link rel="alternate" type="application/rss+xml">` in the head.

### 5. Build `/methodology`

Sections:

1. **What this is:** scope (Console + Go), what is measured vs modeled.
2. **Free taxonomy:** the five kinds and flags, in plain language.
3. **Cost formula:** the exact formula from design §8, with a worked example.
4. **Profiles:** table from `COST_PROFILES`.
5. **Go effective cost:** formula, full-utilization caveat.
6. **Quality:** benchmark table, weights from `USE_CASE_WEIGHTS`, percentile method, confidence.
7. **Tiers:** thresholds.
8. **Name matching:** exact/alias/fuzzy and the 0.85 threshold.
9. **What we do not measure:** token efficiency from real runs, subjective quality, gateway
   differences, regional latency.
10. **Sources:** URLs, cadence, last successful fetch.
11. **Version:** `METHODOLOGY_VERSION = "1.0"` and a short change log.

Every formula should be copy-pasteable and match the code. Add a test that imports the constants
and asserts the rendered weights match? At minimum, generate the tables from constants so they cannot
drift.

### 6. Build `/health`

- Source table: ID, URL, status (ok/failed), last fetched, duration, item count, error.
- Staleness: `now - fetchedAt > 48h` → warning; `> 7d` → error.
- Counts: models, free now, zero marginal, benchmark results, resolved, unmatched, score coverage.
- Unmatched benchmark names: list with source and date, link to the alias file on GitHub.
- Conflicts: model, field, values, resolution.
- "Data files" list with generatedAt.
- Zero state for no unmatched names: "All benchmark names resolved."

### 7. Build `feed.xml.ts` and `robots.txt.ts`

```ts
import type { APIRoute } from "astro";
import { loadData } from "../lib/data";
import { buildFeed } from "../lib/feed";

export const GET: APIRoute = ({ site }) => {
  const { events } = loadData();
  const body = buildFeed(events, {
    site: site?.toString() ?? "https://example.github.io",
    base: import.meta.env.BASE_URL,
  });
  return new Response(body, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
```

`robots.txt.ts` returns:

```
User-agent: *
Allow: /
Sitemap: ${new URL("sitemap-index.xml", site)}
```

### 8. Add the feed link to `Base.astro`

```html
<link rel="alternate" type="application/rss+xml" title="OpenCode Model Guide changes" href={url("/feed.xml")} />
```

### 9. Verify

```bash
pnpm build
```

Check:

- `apps/web/dist/feed.xml` parses with `fast-xml-parser`.
- `/changes?type=free_started` filters.
- `/health` shows at least one unmatched name from the real benchmark run.
- `/methodology` tables match the constants.
- `robots.txt` has an absolute sitemap URL.

### 10. Commit

`feat: add change log, methodology, health, and rss`

## Acceptance checklist

- [ ] Feed is valid XML and passes an RSS validator.
- [ ] Feed escapes `<`, `>`, `&`, quotes, and handles zero events.
- [ ] Feed links are absolute and include the Pages base path.
- [ ] `/changes` filters by event type via URL and handles zero events.
- [ ] `/methodology` tables are generated from constants, not hand-copied.
- [ ] `/health` shows source status, staleness, unmatched names, and conflicts.
- [ ] `robots.txt` references the sitemap.
- [ ] All pages have unique titles and descriptions.
- [ ] No client JS is added.
- [ ] No broken internal links.

## Handoff notes

- S10 sends ntfy independently; it must not call the feed builder.
- If you add an event type, update `EVENT_LABELS`, the `/changes` filters, and the feed description.
- The feed is a public contract. Keep the URL `/feed.xml` stable.
- Health data comes from `snapshot.sources` and `benchmarks.sources`; do not make a network call
  at build time.
- Do not list unmatched names as errors unless the adapter returned zero rows. Some gaps are normal.

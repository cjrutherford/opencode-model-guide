# S08 — Models directory, detail, and compare

> **Status:** done · **Depends on:** S07, S02, S06 · **Effort:** ~3 days
> **Owner:** CJ Rutherford · **Branch:** `slice/S08-models-compare`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §7–§11 first.

## Why this slice exists

This is the core utility of the guide: browse every model, filter to what you need, inspect the
evidence, and compare finalists side by side.

## Goal

- A filterable, sortable model directory with URL state.
- A static detail page for every model with price, cost, benchmarks, free terms, and provenance.
- A four-model comparison view with shareable URLs.
- Honest empty/unknown states everywhere.

## Non-goals

- No live data or client-side fetching.
- No user accounts, saved comparisons, or persistence beyond the URL.
- No charts library. Use CSS bars and simple SVG if needed.
- No editorial reviews.

## Inputs and contracts

- `loadData()` from `apps/web/src/lib/data.ts`.
- `url()` from `apps/web/src/lib/url.ts`.
- `FreeBadge.astro` from S07.
- `snapshot.models`, `scores.scores`, `benchmarks.results`, `events`.
- Model keys are stable; route params use `slugify(key)`.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `apps/web/src/components/ModelTable.tsx` | Client island |
| Create | `apps/web/src/components/ModelCard.astro` | Mobile list item |
| Create | `apps/web/src/components/PriceTable.astro` | List + tiers |
| Create | `apps/web/src/components/ScoreBar.astro` | Score + tier + confidence |
| Create | `apps/web/src/components/Provenance.astro` | Sources + conflicts |
| Create | `apps/web/src/components/FreeTimeline.astro` | Events for one model |
| Create | `apps/web/src/lib/filters.ts` | Parse/serialize query |
| Create | `apps/web/src/lib/models.ts` | Indexes, joins, labels |
| Create | `apps/web/src/pages/models/index.astro` | Directory |
| Create | `apps/web/src/pages/models/[id].astro` | Detail |
| Create | `apps/web/src/pages/compare.astro` | Compare |
| Create | `apps/web/test/filters.test.ts` | Query parsing |
| Create | `apps/web/test/models.test.ts` | Joins and slugs |

## Implementation steps

### 1. Write failing filter tests

```ts
import { describe, expect, it } from "vitest";
import { parseFilters, serializeFilters } from "../src/lib/filters";

it("parses filters and coerces numbers", () => {
  expect(parseFilters("?free=limited-time&sort=cost-asc&maxCost=1&minContext=200000")).toEqual({
    free: "limited-time",
    sort: "cost-asc",
    maxCost: 1,
    minContext: 200000,
  });
});

it("round-trips without empty values", () => {
  expect(serializeFilters({ free: "open-free", sort: "score-desc" }))
    .toBe("?free=open-free&sort=score-desc");
});

it("ignores unknown values", () => {
  expect(parseFilters("?free=bogus&sort=nope")).toEqual({});
});
```

### 2. Implement `filters.ts`

```ts
export type Sort = "name" | "context" | "cost-asc" | "cost-desc" | "score-desc" | "release-desc";

export interface Filters {
  q?: string;
  free?: FreeKind | "free-now" | "zero-marginal";
  provider?: "opencode" | "opencode-go";
  minContext?: number;
  maxCost?: number;
  tier?: "S" | "A" | "B" | "C" | "D" | "unrated";
  sort?: Sort;
}
```

- `free=free-now` means `freeNow` (no subscription).
- `free=zero-marginal` includes `subscription-included`.
- `maxCost` filters on the `agentic-pr` modeled cost.
- Unknown enum values are dropped.
- `serializeFilters` omits defaults and empty values; stable key order.

### 3. Implement `models.ts`

- `byKey: Map<string, ModelRecord>`.
- `scoreByKey: Map<string, ScoreRecord>`.
- `slugToKey: Map<string, string>`.
- `benchmarksByKey: Map<string, BenchmarkResult[]>` (resolved only).
- `eventsByKey: Map<string, ChangeEvent[]>`.
- `freeNow(model)` helper.
- `topByUseCase(useCase)` helper: highest score with tier ≠ unrated.
- `agenticCost(model)` helper: `score.cost.profiles["agentic-pr"]`.
- `modelHref(model)` = `url(`/models/${slugify(key)}/`)`.

### 4. Build `ModelTable.tsx`

Props:

```ts
interface Row {
  key: string;
  href: string;
  name: string;
  provider: string;
  freeKind: FreeKind;
  freeFlags: string[];
  freeStatus?: "confirmed" | "uncertain";
  context: number;
  agenticCost: number | null;
  quickCost: number | null;
  tier: string;
  score: number | null;
  releaseDate?: string;
}
```

Behavior:

- Initialize state from `window.location.search` on mount.
- Controls: search (name/id), free kind, provider, min context, max agentic cost, tier, sort.
- Use `useMemo` for filtering and sorting.
- Update the URL with `history.replaceState` after each change (no reload).
- Show result count and a "Clear filters" button.
- Table columns: Model, Free, Context, Agentic task, Tier, Released.
- Below 640 px, render cards instead of the table, using the same rows.
- Empty state: "No models match. Clear filters."
- Accessible: `<caption class="sr-only">`, `<th scope="col">`, sortable headers as buttons with
  `aria-sort`, focus rings.

Do not fetch data. Do not use a chart library.

### 5. Build `/models`

- `loadData()`, build rows, pass to the island.
- SEO title/description: "OpenCode model comparison: prices, context, and free tiers".
- A short intro above the table explaining modeled costs and the `free` filter.
- A legend for free kinds.

### 6. Build `/models/[id]`

`getStaticPaths`:

```ts
export function getStaticPaths() {
  const { snapshot } = loadData();
  return snapshot.models.map((m) => ({
    params: { id: slugify(m.key) },
    props: { key: m.key },
  }));
}
```

Sections:

1. **Header:** name, provider, availability, free badge, one-line "best for" if a use case is S/A.
2. **Facts:** context, max output, release date, modalities, capabilities.
3. **Pricing:** input/output/cache/tiers/context-over-200k. Use `PriceTable.astro`.
4. **Cost per task:** three profile cards. If `pricingKnown === false`, show "Price not published".
5. **Measured cost:** if a resolved SWE-bench result has `costPerTaskUsd`, show it separately with
   "Measured on SWE-bench (mini-SWE-agent)".
6. **Quality:** benchmark table (raw value, percentile, date, source, harness) and four `ScoreBar`s.
7. **Free timeline:** events for this model, plus `free.since`, flags, privacy, regions.
8. **Provenance:** sources with fetchedAt, conflicts with resolution, "last seen".
9. **Related:** same family or provider, three links.

Add JSON-LD `Product`/`SoftwareApplication`? Use a conservative `Dataset`/`WebPage` JSON-LD. Do not
claim ratings. Include `dateModified`.

### 7. Build `/compare`

- Parse `?models=slug,slug,...`; cap at 4; ignore unknown slugs.
- Picker: a `<select>` per slot, or a searchable list. Keep it simple: four selects populated from
  all models, with "Add model" and "Remove".
- On change, update the URL with `history.replaceState`.
- Comparison table rows: provider, free kind, availability, context, max output, input, output,
  cache read, agentic task, quick edit, long-context task, agentic tier, frontend tier, long-context
  tier, confidence.
- Highlight the best value in each row when numeric and comparable.
- Empty state: "Pick up to four models to compare."
- No client-side data fetching; the island receives all rows.

### 8. Write page tests

- `filters.test.ts` from step 1.
- `models.test.ts`: slug round-trip, `topByUseCase` ignores unrated, `agenticCost` handles null.
- Add a build assertion in CI: count generated HTML files under `dist/models/` equals
  `snapshot.models.length`.

### 9. Verify

```bash
pnpm build
find apps/web/dist/models -name index.html | wc -l
```

Spot-check four pages: a free limited-time model, a paid frontier model, a Go model, and a model with
no benchmarks.

### 10. Commit

`feat: add model directory, detail pages, and comparison`

## Acceptance checklist

- [x] Every model has a static detail page at a stable slug.
- [x] Filters and sort survive reload via URL.
- [x] Compare handles 0–4 models and unknown slugs.
- [x] Missing prices show "not published"; missing scores show "insufficient data".
- [x] Free kind and `uncertain` status are visible on cards, table, and detail.
- [x] Measured and modeled costs are visually distinct.
- [x] Every benchmark row shows source and date.
- [x] Table is keyboard accessible and has `aria-sort`.
- [x] No `NaN`, `undefined`, or `Infinity` in rendered output.
- [x] Mobile layout works at 360 px.
- [x] No runtime data fetching.

## Handoff notes

- S09 links to model pages; use `modelHref()` from `models.ts`.
- Keep route params as slugs; do not expose raw keys with slashes.
- If a model has `pricingKnown: false`, do not sort it as `$0` in cost sorts. Put unknown values last.
- The compare view may grow into a saved feature later; keep the URL format stable.
- Do not add a client-side search index. The full row set is small enough to filter in memory.

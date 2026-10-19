# S03 — Free classification and docs parsing

> **Status:** todo · **Depends on:** S01, S02 · **Blocks:** S04, S06, S08 · **Effort:** ~2 days
> **Owner:** — · **Branch:** `slice/S03-free-classification`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §4–§5 and §7 first.

## Why this slice exists

The catalog knows prices; it does not know *why* a model is free, whether the offer is temporary,
whether the provider trains on your data, or what a Go subscription actually includes. Those answers
live in the official docs. This slice turns that prose into structured evidence and classifies every
model honestly.

## Goal

- Parse the Console and Go docs: free list, pricing tables, plan prices, privacy table, endpoint IDs.
- Classify every model into `paid`, `open-free`, `limited-time`, `subscription-included`, or `trial`.
- Populate free flags, privacy, and Go subscription limits.
- Add docs-only models that are live but missing from models.dev (for example, Jev).
- Record conflicts between docs, models.dev, and live availability.
- Write the enriched `data/snapshot.json`.

## Non-goals

- No benchmark data. S05 owns that.
- No change events. S04 owns that.
- No editorial interpretation beyond the documented terms.

## Inputs and contracts

- `data/snapshot.json` from S02.
- `normalizeModelName` from `@omg/shared`.
- `classifyFree(models, evidence, ctx): ModelRecord[]`.
- `parseConsoleDocs(html): DocsEvidence` and `parseGoDocs(html): DocsEvidence`.

Docs URLs:

- `https://opencode.ai/v2/docs/console/models/`
- `https://opencode.ai/v2/docs/console/go/`

The rendered HTML has stable ids:

- Console: `h3#free-models`, `h2#pricing`, `h2#privacy`, endpoint table with
  headers `Model | Model ID | Endpoint`.
- Go: `h2#usage-limits`, `[data-plan-panel="go"] table`, `[data-plan-panel="go-plus"] table`,
  `h2#privacy`, endpoint table with headers `Model | Model ID | Endpoint`.

Prefer header-based table detection over positional selectors. Docs markup can change.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `packages/ingest/src/sources/opencodeDocs.ts` | Cheerio parsers + evidence types |
| Create | `packages/ingest/src/freeClassify.ts` | Pure classification |
| Create | `packages/ingest/test/opencodeDocs.test.ts` | Parser tests |
| Create | `packages/ingest/test/freeClassify.test.ts` | Classification tests |
| Create | `packages/ingest/test/fixtures/console-docs.html` | Trimmed real page |
| Create | `packages/ingest/test/fixtures/go-docs.html` | Trimmed real page |
| Modify | `packages/ingest/src/run.ts` | Add fetch + classify stage |
| Modify | `packages/ingest/package.json` | Add `cheerio` |
| Modify | `data/snapshot.json` | Enriched output |

## Implementation steps

### 1. Write failing parser tests

```ts
it("parses the console free list with terms", () => {
  const ev = parseConsoleDocs(consoleHtml);
  expect(ev.freeModels).toContainEqual(expect.objectContaining({
    name: "DeepSeek V4.1 Flash Free",
    limitedTime: true,
    training: "none",
  }));
  expect(ev.freeModels).toContainEqual(expect.objectContaining({
    name: "Big Pickle",
    stealth: true,
  }));
});

it("parses Go plan prices and per-model limits", () => {
  const ev = parseGoDocs(goHtml);
  expect(ev.planPrices).toEqual({ go: 10, goPlus: 40 });
  const glm = ev.prices.find((p) => p.name === "GLM-5.3");
  expect(glm).toMatchObject({ input: 1.4, output: 4.4, cacheRead: 0.26, monthlyLimitUsd: 15 });
  const free = ev.prices.find((p) => p.name === "Beam Free");
  expect(free).toMatchObject({ free: true, unlimited: true, limitedTime: true });
});
```

Run: `pnpm vitest packages/ingest/test/opencodeDocs.test.ts`. Expected: module not found.

### 2. Implement `opencodeDocs.ts`

Use `cheerio.load(html)`.

**Console free list:** select `#free-models` (or the heading containing "Free models"), then the
next `ul`, then `li`. For each item:

- `name`: text before the first ` is ` / ` is available `.
- `limitedTime`: text includes "limited time".
- `stealth`: text includes "stealth".
- `training`: "does not use your data for model training" → `"none"`; "may be used to improve" →
  `"may-train"`; otherwise `"unknown"`.
- `retentionDays`: parse `retained for N days` or "zero-retention" → `0`.
- `regionsExcluded`: parse the region sentence if present; split on commas; trim.
- `notes`: the full item text.

**Tables:** find tables by header text:

- Console pricing: `Model | Input | Output | Cached Read | Cached Write`. Values are `Free`, `$x`,
  `~~$x~~`, `-`. Normalize:
  - `Free` → `0`
  - `$1.40` → `1.4`
  - `-` → `undefined`
  - strip `~~`, `**`, commas.
- Go pricing: same plus `Monthly limit`. Values: `$60`, `Unlimited`, `~~$15~~ **$60**`.
  Capture `monthlyLimitUsd` and `unlimited`.
- Plan table: `Plan | Price | Included usage`; parse `Go` → 10, `Go Plus` → 40.
- Privacy table: `Model | Model training | Data retention`. `Not used` → `none`, `Yes` → `may-train`,
  `0 days` → 0, `30 days` → 30, `Not ZDR` → `undefined` with note.
- Endpoint tables: `Model | Model ID`; collect `{ name, id, group }`.

Return:

```ts
interface DocsEvidence {
  consoleFree: DocsFreeEntry[];
  consolePrices: DocsPriceEntry[];
  goPrices: DocsPriceEntry[];
  goPrivacy: DocsPrivacyEntry[];
  endpoints: Array<{ name: string; id: string; group: "console" | "go" }>;
  planPrices: { go: number; goPlus: number };
  sources: SourceRef[];
  warnings: string[];
}
```

If a required table is missing, push a warning and return what parsed. Do not throw unless the page
contains none of the expected sections (likely a blocked/changed page).

### 3. Write failing classification tests

```ts
it("classifies a zero-price limited-time model", () => {
  const m = classifyOne(baseModel({ input: 0, output: 0 }), {
    freeEntry: { name: "X Free", limitedTime: true, training: "none" },
  });
  expect(m.free.kind).toBe("limited-time");
  expect(m.free.flags).toContain("limited-time");
  expect(m.privacy?.training).toBe("none");
});

it("classifies a Go paid model as subscription-included", () => {
  const m = classifyOne(goModel({ input: 1.4, output: 4.4 }), {
    price: { monthlyLimitUsd: 15 },
    plan: "go",
  });
  expect(m.free.kind).toBe("subscription-included");
  expect(m.subscription).toMatchObject({ plan: "go", monthlyUsd: 10, includedUsageUsd: 15 });
});

it("marks docs-free but deprecated models uncertain", () => {
  const m = classifyOne(baseModel({ availability: "deprecated" }), {
    freeEntry: { name: "Old Free", limitedTime: true, training: "none" },
  });
  expect(m.free.status).toBe("uncertain");
  expect(m.conflicts.some((c) => c.field === "free.kind")).toBe(true);
});
```

### 4. Implement `freeClassify.ts`

Name resolution:

1. Normalize docs names and catalog names with `normalizeModelName`.
2. Exact normalized match wins.
3. Otherwise try the endpoint table ID match.
4. Otherwise leave the docs entry unmatched and add a warning. Do not fuzzy-match here; S05 handles
   benchmark fuzzy matching. For docs, wrong attribution is worse than a visible gap.

Classification:

- Start from S02's provisional `free.kind`.
- If the model is in the Console free list:
  - `limitedTime` → `limited-time`; add a `trial` flag too if training is `may-train` or a region
    restriction applies.
  - else if trial-only wording, training is `may-train`, or a region restriction applies → `trial`
  - else → `open-free`
  - flags: `trial` (when applicable), `limited-time`, `stealth`, `trains-on-data`,
    `zero-retention`, `region-restricted`, `feedback-program`.
- Else if the model is in the Go free rows (price `Free` or `Unlimited`):
  - `limitedTime` → `limited-time`; add `trial` if training is `may-train`.
  - else if trial-only wording or training is `may-train` → `trial`
  - else → `open-free`
  - flags: `trial` (when applicable), `limited-time`, `unlimited`, `zero-retention`.
- Else if provider is `opencode-go` and price > 0:
  - `subscription-included`
  - flags: `usage-limited`
  - `subscription = { plan, monthlyUsd, includedUsageUsd: monthlyLimitUsd }`.
- Else if price is zero but not in docs:
  - `open-free` with `free.status = "uncertain"` and a warning.
- Else `paid`.

Add `free.since`: preserve from the previous snapshot if the model was already free; otherwise set
to the current date. S04 can also infer this from history, but S03 is the first classifier.

Privacy:

- Go privacy table match → `{ training, retentionDays, notes }`.
- Console free-list text → training/retention.
- Missing → `{ training: "unknown" }`.

Docs-only models:

- For every endpoint entry whose ID is live but absent from the snapshot, create a minimal
  `ModelRecord`:
  - `provider` from the endpoint group (`console` → `opencode`, `go` → `opencode-go`).
  - `name` from the endpoint table.
  - `pricing` from the docs pricing table if matched. If the docs say `Free`, set
    `pricingKnown: true` with zero prices. Otherwise, if no price is published, set
    `pricingKnown: false` and zero placeholders; never present the placeholders as a real price.
  - `free` from the docs free list; otherwise `paid` if price > 0; otherwise `open-free` with
    `status: "uncertain"` only if the docs free list mentions it. If neither, exclude the model and
    add a warning. Never invent a free classification.
  - `limits: { context: 0, output: 0 }` with a warning that metadata is incomplete.
- Exclude live IDs `test` and IDs ending in `-backup`.

Conflicts:

- docs says free but models.dev price > 0 → conflict on `pricing.input`, resolution `preferred`
  (models.dev price wins), `free.status = "uncertain"`. **Do not zero the models.dev price.** The UI
  shows the price and an unconfirmed free claim; the cost model uses the published price.
- docs says free but `availability === "deprecated"` → conflict on `free.kind`, resolution
  `unresolved`, `free.status = "uncertain"`.
- docs price differs from models.dev by more than 0.001 → conflict on `pricing`, models.dev wins.
- endpoint lists a model that models.dev marks deprecated → S02 already records availability; keep it.

### 5. Integrate into `run.ts`

Add a stage after S02 normalization:

```ts
const evidence = mergeDocsEvidence(
  parseConsoleDocs(await fetchText("opencode.console-docs", consoleUrl)),
  parseGoDocs(await fetchText("opencode.go-docs", goUrl))
);
const models = classifyFree(normalized, evidence, {
  now,
  previous,
  planPrices: evidence.planPrices,
});
```

Add the two docs `SourceRef`s and `SourceStatus` entries. If a docs fetch fails, keep the previous
free classifications and mark the source `ok: false`; do not abort (S10 treats docs as required for
deploy but the local ingest should still produce a snapshot).

### 6. Run the real ingest and inspect

```bash
pnpm ingest
pnpm validate:data
node - <<'NODE'
const s = require("./data/snapshot.json");
const free = s.models.filter((m) => m.free.kind !== "paid");
console.log("free kinds", Object.groupBy(free, (m) => m.free.kind));
console.log("uncertain", free.filter((m) => m.free.status === "uncertain").map((m) => m.key));
console.log("go subscription", s.models.filter((m) => m.subscription).length);
NODE
```

Expected:

- 14–15 Console free models, including `jev-1.13-free` if it is live.
- Go free models: `longcat-2.5-preview-free`, `beam-free`, `minimax-m3.1-flash-free`.
- Go paid models have `subscription.plan === "go"` and `includedUsageUsd > 0`.
- At least one `uncertain` model where docs and models.dev disagree.
- No model with a docs-only record has a fabricated price.

### 7. Commit

`feat: classify free models and parse subscription terms from docs`

## Acceptance checklist

- [ ] Parser tests pass against trimmed real HTML fixtures.
- [ ] Free list names and terms match the live docs at implementation time.
- [ ] All five free kinds are exercised by tests.
- [ ] Go plan prices (10/40) and per-model monthly limits are parsed.
- [ ] Privacy training/retention is populated where docs publish it.
- [ ] Docs-only live models are either added with `pricingKnown: false` or reported as gaps; none are
      silently dropped.
- [ ] Conflicts are recorded, not overwritten.
- [ ] `free.since` is preserved across runs.
- [ ] `data/snapshot.json` validates.

## Handoff notes

- S04 should emit free events from `free.kind` and `free.status`, not from docs text.
- S06 must treat `pricingKnown: false` as "cost unknown", not `$0`.
- S08 should show `free.status === "uncertain"` prominently; this is where the guide earns trust.
- If the docs page structure changes, update the fixtures and header-based selectors. Do not add a
  brittle nth-child selector.
- Keep docs parsing in `packages/ingest`; do not import cheerio into the web app.

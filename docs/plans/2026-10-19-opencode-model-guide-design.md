# OpenCode Model Guide — Design

> **Status:** Accepted · **Date:** 2026-10-19 · **Owner:** cjrutherford
>
> This document is the canonical design. Per-slice implementation instructions live in
> [`docs/slices/`](../slices/README.md). The ordered implementation plan lives in
> [`2026-10-19-opencode-model-guide-implementation.md`](./2026-10-19-opencode-model-guide-implementation.md).

## Summary

**OpenCode Model Guide** is a public, statically generated buyer's guide for models you can
actually use in OpenCode. It does three things:

1. Tracks which models are free, how they are free, and when that changes.
2. Rates models on quality and economics using public benchmarks plus modeled cost per task.
3. Notifies people when a free model appears, disappears, or changes terms.

The first release covers **OpenCode-native models only**: OpenCode Console (pay-as-you-go) and
OpenCode Go / Go Plus (subscription). External providers remain in the data model but are out of
scope for v1.

## 1. Problem

OpenCode's model catalog is large and changes constantly. The free tier is especially volatile:
models appear as stealth previews, become free for a limited time, and are later deprecated.
The existing information is spread across:

- the models.dev catalog that OpenCode itself consumes,
- two live model endpoints (Console and Go),
- two documentation pages with free-list notes, privacy terms, and plan limits,
- public benchmark leaderboards that use different names and harnesses.

There is no single place that answers: *what is free right now, what does it really cost me, and
is it any good for coding?* This project builds that place.

## 2. Goals and non-goals

### Goals

- Show every OpenCode-native model with price, context, capabilities, availability, and free status.
- Distinguish four kinds of "free" and show the caveats that come with each.
- Rank models per use case using public benchmarks, with visible sources, dates, and confidence.
- Model cost per task under realistic token profiles, including cache reads and tiered pricing.
- Compute effective cost per task for Go and Go Plus subscriptions.
- Detect and publish changes daily, with an RSS feed and ntfy push.
- Run entirely on GitHub infrastructure: Actions for the pipeline, Pages for hosting, no server.

### Non-goals for v1

- User accounts, saved watchlists, or personalized recommendations.
- Crowd-sourced reviews, Reddit/YouTube aggregation, or editorial reviews.
- External providers (OpenRouter, NVIDIA, etc.). The schema supports them; the UI does not show them yet.
- Our own model eval harness. This is the headline v2 feature.
- Real-time updates. Daily cadence is enough.
- Price-drop alerts for paid models beyond the change log.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Coverage | OpenCode Console + Go / Go Plus | Authoritative, bounded, and directly useful |
| Artifact | Public static site on GitHub Pages | Free, fast, no server, shareable |
| Pipeline | GitHub Actions, daily 13:00 UTC | Zero infrastructure; data commits keep schedules alive |
| Notifications | RSS/Atom + ntfy | No accounts; push to phone; trivial to automate |
| v1 quality data | Public benchmarks + price modeling | Ships quickly and honestly |
| v2 quality data | Own eval harness + local usage telemetry | Fills the token-efficiency gap |
| Stack | Astro + TypeScript + Tailwind | Static-first, minimal JS, easy GitHub Pages deploy |
| Storage | Committed JSON snapshots + append-only event log | Auditable, diffable, no database |
| Scoring | Per-use-case composites, no single opaque score | Avoids false precision |

## 4. What "free" means

"Free" collapses four different economic and legal situations. The UI never collapses them.

| Kind | Definition | Example | UI label |
|---|---|---|---|
| `open-free` | $0 list price, no subscription required | Big Pickle | **Free** |
| `limited-time` | $0 list price, docs say the offer is temporary | DeepSeek V4.1 Flash Free | **Free · limited time** |
| `subscription-included` | $0 marginal cost, but a paid plan is required | GLM-5.3 on Go | **Included with Go** |
| `trial` | $0 access with data logging or regional restrictions | Nemotron free endpoints | **Free · trial terms** |
| `paid` | Normal per-token pricing | Claude Sonnet 5 | **Paid** |

`trial` is its own kind. Flags add specifics such as `trains-on-data`, `region-restricted`, or
`limited-time`. A model has exactly one `kind` and any number of `flags`.

### Classification rules

1. Start with `paid`.
2. If input and output list prices are both zero, the model is free.
3. If the Console or Go docs describe the offer as limited-time, set `kind = "limited-time"`.
4. If the offer is trial-only, data is used for training, or access is region-restricted, set
   `kind = "trial"` (unless the offer is also limited-time, in which case use `limited-time` and
   add the `trial` flag).
5. Otherwise set `kind = "open-free"`.
6. If the provider is `opencode-go` and the model has non-zero list prices, set
   `kind = "subscription-included"`.
7. Never classify from the `-free` suffix alone. Use price, docs, and live availability.
8. If sources disagree, keep the best-supported value, set `free.status = "uncertain"`, and record
   a `Conflict`. The UI shows an "unconfirmed" marker.

Flags: `trial`, `zero-retention`, `trains-on-data`, `region-restricted`, `stealth`,
`feedback-program`, `unlimited`, `usage-limited`, `status-conflict`.

### Derived values

- `freeNow` = `kind` is `open-free`, `limited-time`, or `trial`. No subscription required.
- `zeroMarginalCost` = `freeNow` or `kind === "subscription-included"`.

The home page defaults to `freeNow`. The Go subscription value is a separate view.

## 5. Sources

| Source | URL | Fields | Authority | Cadence |
|---|---|---|---|---|
| models.dev | `https://models.dev/api.json` | name, family, limits, capabilities, pricing, status, release date | High for metadata and list price | Daily |
| Console models | `https://opencode.ai/inference/v1/models` | live model IDs | High for availability | Daily |
| Go models | `https://opencode.ai/inference/go/v1/models` | live model IDs | High for availability | Daily |
| Console docs | `https://opencode.ai/v2/docs/console/models/` | free-list notes, privacy, pricing table | High for free terms and privacy | Daily |
| Go docs | `https://opencode.ai/v2/docs/console/go/` | plan prices, included usage, per-model limits, estimated requests, privacy | High for subscription economics | Daily |
| SWE-bench | `https://www.swebench.com/` | resolved %, instance cost, instance calls, harness, date | High for agentic coding | Weekly |
| LMArena | HF datasets-server, `lmarena-ai/leaderboard-dataset` | Elo/score for text, webdev, agent, document | High for human preference | Weekly |
| Aider polyglot | `aider/website/_data/polyglot_leaderboard.yml` | pass rate, seconds per case, cost | Medium (single harness) | Weekly |
| Terminal-Bench | `https://www.tbench.ai/leaderboard` | agentic terminal score | Medium; optional in v1 | Weekly |
| Artificial Analysis | `https://artificialanalysis.ai/api/v2/language/models/free` | intelligence, coding, agentic indices; pricing; speed | High; free API key required; attribution required | Weekly |

Source priority when fields overlap:

1. Official docs for free terms, privacy, and subscription limits.
2. models.dev for metadata and list price.
3. Live endpoints for availability.
4. Benchmarks for quality only; never for price.

Every model carries `sources[]`. Every conflict is recorded, not silently overwritten.

### Known source quirks

- models.dev contains 232 providers; only `opencode` and `opencode-go` are in scope.
- Many models are marked `deprecated` in models.dev while still listed in the docs. That is a
  real conflict and should surface as `availability = "deprecated"` plus `free.status = "uncertain"`.
- SWE-bench publishes multiple leaderboards and harnesses. Compare `mini-SWE-agent` runs only.
- LMArena does not have a config named `coding`. Use `webdev`, `agent`, `text`, and `document`.
- Aider's YAML is a list of historical runs. Take the latest run per model, not every row.
- Artificial Analysis: use the free-tier `/api/v2/language/models/free` endpoint, not the Pro
  `/api/v2/language/models` endpoint. The free tier is rate-limited (currently 100 requests/day;
  the daily job uses 1–2) and requires attribution. If `AA_API_KEY` is absent, skip it and lower
  confidence; do not fail the build. See [`docs/setup-secrets.md`](../setup-secrets.md).

## 6. Architecture

```
GitHub Actions · daily 13:00 UTC (and manual dispatch)
┌──────────────────────────────────────────────────────────────────────────┐
│ fetch → normalize → classify free → snapshot → diff → benchmarks → score │
│                                                              ↓           │
│ validate → build Astro → deploy GitHub Pages → notify (RSS + ntfy)       │
└──────────────────────────────────────────────────────────────────────────┘
        ↓ committed                         ↓ served
   data/*.json, events.jsonl          https://<owner>.github.io/<repo>/
```

### Repository layout

```
apps/web/                 Astro site
packages/shared/          Zod schemas, types, constants, IDs
packages/ingest/          source adapters, normalization, free classification, diff
packages/scoring/         benchmark adapters, aliases, cost model, scoring
packages/notify/          ntfy sender, notification state
data/
  snapshot.json           current normalized catalog
  benchmarks.json         resolved benchmark results
  scores.json             computed scores and costs
  events.jsonl            append-only change log
  sources.json            source health
  aliases.json            manual benchmark name → model key mappings
  notify-state.json       sent event IDs
  history/YYYY-MM-DD.json compact daily snapshots
scripts/validate-data.ts  schema + invariant checks
.github/workflows/        ci.yml, ingest.yml
docs/                     design, plan, slices
```

### Pipeline stages

1. **Fetch** each source with a 20 s timeout, one retry, and a descriptive User-Agent.
2. **Normalize** into `ModelRecord[]` using models.dev as the spine.
3. **Classify** free status using docs evidence and pricing.
4. **Snapshot** to `data/snapshot.json`, preserving `firstSeen`.
5. **Diff** against the previous snapshot; append events and a daily history file.
6. **Ingest benchmarks** and resolve names to model keys.
7. **Score** quality, cost, and confidence; write `data/scores.json`.
8. **Validate** all data files and invariants.
9. **Build** the static site from committed data only (no network at build time).
10. **Deploy** to GitHub Pages.
11. **Notify** with one summary per run.

A failure in a required source aborts before deploy. A failure in an optional source records
`ok: false`, keeps the last good values, and alerts without blocking the deploy.

## 7. Data model

All schemas are defined with Zod in `packages/shared/src/schema.ts` and exported as TypeScript
types. `SCHEMA_VERSION = 1`. Breaking changes bump the version and require a migration note.

```ts
type ProviderId = "opencode" | "opencode-go";
type FreeKind = "paid" | "open-free" | "limited-time" | "subscription-included" | "trial";
type Availability = "live" | "deprecated" | "unlisted" | "unknown";

interface SourceRef {
  id: "models.dev" | "opencode.models" | "opencode-go.models"
    | "opencode.console-docs" | "opencode.go-docs";
  url: string;
  fetchedAt: string;       // ISO 8601
  fields?: string[];
}

interface Conflict {
  field: string;
  values: Array<{ source: string; value: unknown }>;
  resolution: "preferred" | "unresolved";
  note?: string;
}

interface Pricing {
  currency: "USD";
  unit: "per_1m_tokens";
  pricingKnown: boolean;             // false when no source publishes a price
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  tiers?: Array<{
    minInputTokens: number;
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  }>;
  contextOver200k?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

interface SubscriptionInfo {
  plan: "go" | "go-plus";
  monthlyUsd: number;
  includedUsageUsd: number;          // the model's monthly limit at list prices
  estimatedRequestsPerMonth?: number;
  notes?: string;
}

interface FreeInfo {
  kind: FreeKind;
  flags: string[];
  since?: string;                    // first date observed free
  note?: string;
  status?: "confirmed" | "uncertain";
  regionsExcluded?: string[];
}

interface ModelRecord {
  key: string;                       // `${provider}/${id}`
  provider: ProviderId;
  id: string;
  name: string;
  family?: string;
  releaseDate?: string;
  modalities: { input: string[]; output: string[] };
  capabilities: {
    toolCall: boolean;
    reasoning: boolean;
    attachment: boolean;
    structuredOutput: boolean;
    temperature: boolean;
  };
  limits: { context: number; output: number; input?: number };
  pricing: Pricing;
  subscription?: SubscriptionInfo;
  free: FreeInfo;
  availability: Availability;
  privacy?: {
    training: "none" | "may-train" | "unknown";
    retentionDays?: number;
    notes?: string;
  };
  sources: SourceRef[];
  conflicts: Conflict[];
  firstSeen: string;
  lastSeen: string;
}

interface Snapshot {
  schemaVersion: 1;
  generatedAt: string;
  models: ModelRecord[];
  sources: SourceStatus[];
}

interface BenchmarkResult {
  benchmark:
    | "swe-bench-verified"
    | "swe-bench-multilingual"
    | "lmarena-webdev"
    | "lmarena-agent"
    | "lmarena-text"
    | "lmarena-document"
    | "aider-polyglot"
    | "terminal-bench"
    | "artificial-analysis";
  metric: "percent" | "elo" | "score";
  value: number;
  modelNameRaw: string;
  modelKey?: string;
  match: "exact" | "alias" | "fuzzy" | "unmatched";
  matchConfidence: number;           // 0–1
  date: string;
  sourceUrl: string;
  harness?: string;
  costPerTaskUsd?: number;           // when the source publishes it
  tokensPerTask?: number;            // when the source publishes it
  meta?: Record<string, number | string | null>;
}

interface ScoreRecord {
  modelKey: string;
  benchmarks: Partial<Record<BenchmarkResult["benchmark"], {
    percentile: number;
    value: number;
    date: string;
  }>>;
  useCases: Record<string, {
    score: number | null;
    tier: "S" | "A" | "B" | "C" | "D" | "unrated";
    confidence: number;              // 0–1
  }>;
  cost: {
    profiles: Record<string, number | null>;
    goEffective?: Record<string, number | null>;
  };
}

interface ScoresFile {
  schemaVersion: 1;
  generatedAt: string;
  scores: ScoreRecord[];
}

interface ChangeEvent {
  id: string;                        // `${type}:${modelKey}:${YYYY-MM-DD}`
  type:
    | "model_added"
    | "free_started"
    | "free_ended"
    | "price_changed"
    | "deprecated"
    | "source_failed";
  at: string;
  modelKey: string;
  summary: string;
  data: Record<string, unknown>;
  notify: boolean;                   // false for bootstrap events
}
```

## 8. Cost model

### List price per task

For a profile with `inputTokens`, `cachedInputTokens`, and `outputTokens`:

```
billableInput = inputTokens - cachedInputTokens
cacheReadPrice = pricing.cacheRead ?? pricing.input
cost =
  billableInput * pricing.input / 1_000_000
  + cachedInputTokens * cacheReadPrice / 1_000_000
  + outputTokens * pricing.output / 1_000_000
```

Rules:

- If `cacheWrite` applies, add `cacheWriteTokens * cacheWrite / 1e6`. v1 profiles do not model writes.
- If `inputTokens` exceeds a tier's `minInputTokens`, apply that tier's prices to the whole request.
  This matches the common "over 200K" vendor convention and is documented on the methodology page.
- If `contextOver200k` exists and `inputTokens > 200_000`, use those prices.
- If the model is `open-free` or `limited-time`, cost is `$0`; the UI still shows the paid equivalent
  when useful for comparison.
- If `pricing.pricingKnown` is false, cost is `null` and the UI shows "price not published".
- All values are USD and rounded for display only; store full precision.

### Profiles

| ID | Label | Input | Cached input | Output |
|---|---|---:|---:|---:|
| `quick-edit` | Quick edit | 12,000 | 8,000 | 1,500 |
| `agentic-pr` | Agentic PR | 120,000 | 90,000 | 8,000 |
| `long-context` | Long-context task | 400,000 | 250,000 | 6,000 |

These are deliberately simple and adjustable in the UI. They are *modeled*, not measured, and the
UI labels them as such.

### Go / Go Plus effective cost

OpenCode publishes a monthly included-usage limit per model at list prices. The effective
multiplier at full utilization is:

```
effectiveTaskCost = listTaskCost * monthlyPlanUsd / includedUsageUsd
effectiveRequests = includedUsageUsd / listTaskCost
```

Show both "at full utilization" and the raw included-usage value. If the user does not exhaust the
plan, the real cost is higher; the methodology page says so. `estimatedRequestsPerMonth` from the
docs is used as a cross-check.

### Cost sources

- SWE-bench publishes `instance_cost` and `instance_calls` for `mini-SWE-agent` runs. Store these
  as `costPerTaskUsd` and show them as "measured on SWE-bench" alongside the modeled profiles.
- Do not mix measured and modeled numbers in one column without labeling.

## 9. Quality model

### Benchmarks and use cases

Weights are versioned in `packages/shared/src/constants.ts`.

| Use case | SWE-bench | Terminal-Bench | LMArena agent | LMArena webdev | LMArena text | LMArena document | Aider | AA Coding |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Agentic coding | 0.30 | 0.10 | 0.20 | — | — | — | 0.10 | 0.30 |
| Everyday edits | 0.15 | — | — | 0.25 | 0.15 | — | 0.25 | 0.20 |
| Frontend | — | — | — | 0.60 | 0.20 | — | 0.20 | — |
| Long context | 0.30 | — | — | — | 0.30 | 0.40 | — | — |

Long-context ranking also requires `limits.context >= 200_000`. Context is a gate, not a score.

**Post-v1 calibration (S12, 2026-10-20):** the Artificial Analysis Coding Index is now part of the
agentic-coding and everyday-edits composites. The AA Agentic and Intelligence indices remain
supplemental. This replaced the v1 weights above after the original composite could not rate any
agentic model: every SWE-bench/Aider row was over 180 days old, and confidence used the oldest date.

The AA key remains optional. Without it, the AA rows are absent and agentic/everyday confidence is
lower; the affected models stay unrated rather than receiving substitute scores.

### Normalization

- Convert each benchmark's raw value to a percentile within the set of models present in that
  benchmark: `(lower + 0.5 * equal) / (n - 1) * 100`, with ties averaged.
- Do not mix harnesses. SWE-bench uses `mini-SWE-agent` only.
- A use-case score is the weighted average of available percentiles, renormalized by the sum of
  available weights.
- Confidence = `Σ(weight × freshness(benchmark date))`, where freshness is 1.0 for ≤ 30 days,
  0.8 for ≤ 90, 0.5 for ≤ 180, and 0.2 otherwise. Clamp to `[0, 1]`. Each benchmark's freshness
  affects only its own contribution; a stale result does not veto fresh evidence.
- If available weight < 0.5 or confidence < 0.3, tier is `unrated` and the UI shows "insufficient data".

### Tiers

| Tier | Percentile |
|---|---:|
| S | ≥ 90 |
| A | ≥ 75 |
| B | ≥ 50 |
| C | ≥ 25 |
| D | < 25 |

Tiers are derived from the composite percentile. Raw scores, dates, and sources are always shown.

### Name resolution

Benchmark names are messy. Resolution order:

1. Exact canonical key or exact normalized name.
2. Manual alias in `data/aliases.json`.
3. Normalized token match (lowercase, strip org prefixes, dates, `preview`, `instruct`, `free`,
   punctuation) with a similarity threshold of 0.85.
4. Otherwise `unmatched`.

Never guess silently. Unmatched entries appear on `/health`, and fuzzy matches show a confidence
badge on the model page.

## 10. Change detection and notifications

### Events

| Event | Trigger |
|---|---|
| `model_added` | Key present now, absent in the previous snapshot |
| `free_started` | `freeNow` or `zeroMarginalCost` becomes true, or kind changes to `limited-time` |
| `free_ended` | Was free, now `paid` or `availability === "deprecated"` |
| `price_changed` | Any input/output/cache/tier price changes |
| `deprecated` | Availability changes to `deprecated` |
| `source_failed` | A required source fails |

Event IDs are deterministic: `${type}:${modelKey}:${YYYY-MM-DD}`. Duplicate events for the same
model and day merge into one. The log is append-only and sorted by `at`.

On the very first run there is no previous snapshot. Do **not** emit hundreds of `model_added`
notifications. Write a baseline history file and set `notify: false` on bootstrap events.

### RSS

- Generate `/feed.xml` at build time from `data/events.jsonl`, newest first, last 100 events.
- Include title, link to the model page, publication date, and a short summary.
- Escape XML properly. Validate in tests with a parser.

### ntfy

- One summary per run, not one per model.
- Payload example: `3 new free models · 1 free offer ended` with a link to `/changes`.
- Headers: `Title`, `Tags`, `Click`, `Priority`.
- Topic from the `NTFY_TOPIC` secret. Never commit it.
- Track sent event IDs in `data/notify-state.json` for idempotency.
- On source failure, send a separate high-priority alert, deduped per source per day.

## 11. Site

### Pages

| Route | Content |
|---|---|
| `/` | Free now, latest changes, top picks, link to methodology |
| `/models` | Filterable table: search, free kind, provider, context, price, tier |
| `/models/[id]` | Price table, modeled costs, benchmark provenance, free timeline, privacy, sources, conflicts |
| `/compare` | Up to four models side by side, shareable URL |
| `/changes` | Event timeline with type filters |
| `/methodology` | Formulas, weights, source dates, confidence, known gaps |
| `/health` | Source status, counts, unmatched benchmarks, conflicts |
| `/feed.xml` | RSS feed |

### Design principles

- Editorial, data-first, not a generic dashboard. Large numerals, tabular data, restrained color.
- Free status is the loudest signal; confidence is the second.
- Every number has a source and a date on hover or in an adjacent line.
- No dark patterns, no fake precision, no "AI score" without a breakdown.
- Mobile-first tables: horizontal scroll with sticky first column; cards below 640 px.
- Accessibility: semantic landmarks, visible focus, 4.5:1 contrast, table captions, reduced motion.
- Minimal client JS: only the model table and compare view are islands.
- Footer credits every data source and includes the required Artificial Analysis attribution link
  whenever its data is displayed.

### URL state

Filters and comparison selections live in query params (`?free=limited-time&sort=cost`). This makes
views shareable and keeps the site static.

### GitHub Pages

Astro is configured with `site` and `base` from environment variables. Use a `url()` helper for all
internal links. The deploy workflow uses `actions/configure-pages` outputs for `origin` and
`base_path`.

## 12. Automation

### Workflows

**`ci.yml`** — on pull request and push to `main`:

1. Checkout, setup Node 22 and pnpm.
2. `pnpm install --frozen-lockfile`.
3. `pnpm typecheck`.
4. `pnpm test`.
5. `pnpm validate:data`.
6. `pnpm build`.

**`ingest.yml`** — daily at 13:00 UTC and manual dispatch:

1. Checkout, setup Node and pnpm, install.
2. `pnpm ingest` (fetch, normalize, classify, snapshot, diff).
3. `pnpm score` (benchmarks, cost, composites).
4. `pnpm validate:data`.
5. Commit changed `data/` files with `[skip ci]`.
6. Configure Pages, build, upload artifact, deploy.
7. `pnpm notify` with `NTFY_TOPIC`, then commit `data/notify-state.json`.

Secrets: `NTFY_TOPIC` and optional `AA_API_KEY`. Setup, rotation, and troubleshooting are in
[`docs/setup-secrets.md`](../setup-secrets.md).

Permissions: `contents: write`, `pages: write`, `id-token: write`.
Concurrency: one `pages` group, no cancel-in-progress.

### Failure policy

- Required sources: models.dev, at least one live models endpoint, Console docs. Failure aborts the
  run before deploy.
- Optional sources: Go docs, benchmark sources, Artificial Analysis. Failure records `ok: false`,
  keeps last good data, and alerts.
- If no data changed, skip the data commit and skip deploy unless manually dispatched.
- Scheduled workflows can be disabled after 60 days of repository inactivity; daily data commits
  prevent that.

## 13. Testing

- **Unit:** schema validation, free classification, cost formulas, percentile math, event IDs,
  alias matching, URL helpers.
- **Fixtures:** trimmed real payloads for models.dev, both model endpoints, docs HTML, SWE-bench
  JSON, LMArena rows, Aider YAML. No network in tests.
- **Golden:** snapshot normalization and diff output against fixture pairs.
- **Data validation:** `pnpm validate:data` enforces uniqueness, non-negative prices, source
  presence, free-kind consistency, and referential integrity.
- **Build:** every model page must generate; `astro check` must pass.
- **Accessibility:** keyboard-only pass, contrast check, Lighthouse ≥ 95 on `/` and `/models`.
- **Notifications:** mock fetch; verify summary text, dedupe, and no-op behavior.

Definition of done for every slice: tests pass, typecheck passes, build passes, data validates,
and the slice file's acceptance checklist is complete.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Benchmark name matching produces false positives | Alias table, 0.85 threshold, confidence badge, unmatched queue |
| Docs HTML changes and breaks parsing | Fixture tests, loud failure, last-good values, `/health` staleness |
| Benchmarks are stale or incomparable | Source date on every score, harness pinning, confidence penalty |
| "Free" is ambiguous | Four kinds plus flags; never infer from suffix |
| Repo growth from daily data | Commit normalized native-scope data only (~hundreds of KB/day) |
| GitHub Actions schedule disabled | Daily data commits keep the repo active |
| GitHub Pages base path breaks links | `url()` helper, `configure-pages` outputs, link test |
| Rate limits or source downtime | Timeouts, retry, optional-source policy, source health |
| Artificial Analysis quota exhausted | 1–2 requests/day, cache in `benchmarks.json`, skip on 429, `/health` |
| Price tiers modeled incorrectly | One documented convention, unit tests, methodology page |
| Notifications become noise | One summary per run, free events only by default, dedupe |

## 15. Roadmap

v1 is delivered as twelve slices. See the [slice tracker](../slices/README.md) for status and
dependencies.

```
S00 foundation
 └─ S01 contracts
     ├─ S02 catalog ingest
     │   ├─ S03 free classification
     │   └─ S04 change detection
     ├─ S05 benchmarks
     │   └─ S06 cost & scoring
     └─ S07 web shell
         ├─ S08 models & compare
         └─ S09 changes, methodology, health, RSS
             └─ S10 CI/CD, Pages, ntfy
                 └─ S11 docs, accessibility, launch
```

### v2 candidates

- Own eval harness: fixed coding tasks, test-verified pass rate, tokens, latency, real cost per
  solved task.
- Local usage telemetry: read the OpenCode SQLite database, report personal cost and token
  efficiency per model.
- External providers: OpenRouter, NVIDIA, and other gateways, with a "gateway vs direct" comparison.
- Historical price charts and per-model alert subscriptions.
- Terminal-Bench and LiveBench adapters.
- Per-model "last verified" checks against the live endpoint.

## 16. Decisions and defaults

These are settled:

- GitHub repository: **`cjrutherford/opencode-model-guide`** (public).
- Pages URL: **`https://cjrutherford.github.io/opencode-model-guide/`**.
- Daily run at **13:00 UTC**.
- ntfy.sh with a random, unguessable topic stored in the `NTFY_TOPIC` GitHub secret.
- Artificial Analysis uses the free-tier API with `AA_API_KEY` stored as a GitHub secret. It is
  optional: if absent, skip and lower confidence.
- No custom domain in v1.
- Editorial reviews are out of scope; LMArena is the human-preference signal.

Setup instructions live in [`docs/setup-secrets.md`](../setup-secrets.md). The only remaining owner
actions are creating the remote repository, enabling Pages, and entering the two secrets.

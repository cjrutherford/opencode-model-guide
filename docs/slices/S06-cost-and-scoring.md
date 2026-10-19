# S06 — Cost model and scoring

> **Status:** todo · **Depends on:** S01, S05 · **Blocks:** S08, S09 · **Effort:** ~2 days
> **Owner:** — · **Branch:** `slice/S06-cost-and-scoring`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §8–§9 first.

## Why this slice exists

Prices per million tokens are not comparable across models with different token appetites, cache
behavior, and subscription limits. Benchmarks are not comparable across harnesses and scales. This
slice turns both into defensible, per-use-case numbers with confidence.

## Goal

- Compute modeled cost per task for three profiles.
- Handle cache pricing, tiered pricing, and `contextOver200k`.
- Compute Go / Go Plus effective cost at full utilization.
- Normalize benchmark values to percentiles.
- Produce per-use-case scores, tiers, and confidence.
- Write `data/scores.json`.

## Non-goals

- No measured eval runs. v2.
- No single overall score. The output is per use case.
- No UI.

## Inputs and contracts

- `data/snapshot.json`, `data/benchmarks.json`.
- `COST_PROFILES`, `USE_CASE_WEIGHTS`, `TIER_THRESHOLDS`, `FRESHNESS` from `@omg/shared`.
- Output `ScoresFile`:

```ts
interface ScoresFile {
  schemaVersion: 1;
  generatedAt: string;
  scores: ScoreRecord[];
}
```

- `taskCost` returns `number | null`. `null` means "price not published", never `$0`.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `packages/scoring/src/cost.ts` | Pricing math |
| Create | `packages/scoring/src/percentile.ts` | Percentile + ties |
| Create | `packages/scoring/src/score.ts` | Use-case composites |
| Create | `packages/scoring/src/run.ts` | Root CLI: benchmarks + scores |
| Create | `packages/scoring/test/cost.test.ts` | Hand-checked math |
| Create | `packages/scoring/test/percentile.test.ts` | Ties, n=1 |
| Create | `packages/scoring/test/score.test.ts` | Confidence, gates, tiers |
| Create | `data/scores.json` | Generated |

## Implementation steps

### 1. Write failing cost tests

```ts
const pricing = {
  currency: "USD" as const,
  unit: "per_1m_tokens" as const,
  pricingKnown: true,
  input: 3,
  output: 15,
  cacheRead: 0.3,
};

it("prices cached input correctly", () => {
  const cost = taskCost(pricing, {
    inputTokens: 120_000,
    cachedInputTokens: 90_000,
    outputTokens: 8_000,
  });
  expect(cost).toBeCloseTo(0.3 * 30_000 / 1e6 + 0.3 * 90_000 / 1e6 + 15 * 8_000 / 1e6, 10);
});

it("falls back to input price when cacheRead is missing", () => {
  const p = { ...pricing, cacheRead: undefined };
  const cost = taskCost(p, { inputTokens: 10_000, cachedInputTokens: 5_000, outputTokens: 1_000 });
  expect(cost).toBeCloseTo(3 * 10_000 / 1e6 + 15 * 1_000 / 1e6, 10);
});

it("returns null when the price is unknown", () => {
  expect(taskCost({ ...pricing, pricingKnown: false }, { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 })).toBeNull();
});

it("applies the 200K tier to the whole request", () => {
  const p = { ...pricing, contextOver200k: { input: 6, output: 22.5, cacheRead: 0.6 } };
  const cost = taskCost(p, { inputTokens: 250_000, cachedInputTokens: 0, outputTokens: 1_000 });
  expect(cost).toBeCloseTo(6 * 250_000 / 1e6 + 22.5 * 1_000 / 1e6, 10);
});

it("computes Go effective cost at full utilization", () => {
  expect(goEffectiveCost(0.6, 10, 15)).toBeCloseTo(0.4, 10);
  expect(goEffectiveCost(0.6, 10, 0)).toBeNull();
});
```

### 2. Implement `cost.ts`

```ts
export interface TokenProfile {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export function taskCost(pricing: Pricing, profile: TokenProfile): number | null;
export function goEffectiveCost(listCost: number | null, planUsd: number, includedUsageUsd: number): number | null;
export function formatUsd(value: number | null): string;
```

Algorithm:

1. If `!pricing.pricingKnown`, return `null`.
2. Clamp `cached = min(max(cachedInputTokens, 0), inputTokens)`.
3. Choose the price book:
   - If `inputTokens > 200_000` and `pricing.contextOver200k` exists, use it.
   - Else if `pricing.tiers` has an entry with `minInputTokens <= inputTokens`, use the highest such
     tier for the whole request.
   - Else use `pricing`.
4. `cacheRead = book.cacheRead ?? book.input`.
5. `billable = inputTokens - cached`.
6. Return `(billable * book.input + cached * cacheRead + outputTokens * book.output) / 1_000_000`.

`formatUsd`: `$0` for 0; `<$0.0001` for tiny positive; 2 significant decimals for < $1; 2 decimals
for ≥ $1.

### 3. Implement `percentile.ts`

```ts
export function percentileRank(value: number, all: number[]): number;
```

- Sort a copy ascending.
- `lower = count(v < value)`, `equal = count(v === value)`.
- If `all.length <= 1`, return 50.
- Return `((lower + (equal - 1) / 2) / (all.length - 1)) * 100`.
- Clamp to `[0, 100]`.

Tests: `[1,2,3]` → 0/50/100; ties `[1,1,1]` → 50 for all; duplicates average.

### 4. Implement `score.ts`

```ts
export interface ScoreInput {
  snapshot: Snapshot;
  benchmarks: BenchmarksFile;
  now: string;
}

export function scoreModels(input: ScoreInput): ScoreRecord[];
```

Algorithm:

1. Group resolved benchmark results by `benchmark`. Only include results with `modelKey`.
2. For each group, compute the value list and percentile per model. If a model has multiple results
   in one benchmark (different harnesses), keep the newest and log a warning.
3. For each model and use case:
   - `availableWeight = 0`, `weighted = 0`, `dates: string[] = []`.
   - For each `[benchmark, weight]` in `USE_CASE_WEIGHTS[useCase]`:
     - if the model has that benchmark percentile, add.
   - If `availableWeight === 0` → `{ score: null, tier: "unrated", confidence: 0 }`.
   - `rawScore = weighted / availableWeight`.
   - `ageDays = (now - min(dates)) / 86400000`.
   - `freshness` from `FRESHNESS`.
   - `confidence = availableWeight * freshness`.
   - Long-context gate: if `useCase === "long-context"` and `model.limits.context < 200_000`,
     `{ score: null, tier: "unrated", confidence }`.
   - `tier`: `unrated` if `availableWeight < 0.5 || confidence < 0.3`; else first threshold where
     `rawScore >= min`.
4. Cost:
   - For each profile, `taskCost(model.pricing, COST_PROFILES[id])`.
   - If `model.subscription` with `includedUsageUsd > 0` and `monthlyUsd > 0`, compute
     `goEffective` per profile.
5. Return one `ScoreRecord` per model, sorted by key.

Do not round stored values. Round only in the UI.

### 5. Implement `run.ts`

`packages/scoring/src/run.ts` is the root `pnpm score` entrypoint. It runs benchmark ingestion first,
then scoring:

```ts
import { runBenchmarks } from "./runBenchmarks";
import { readSnapshot } from "@omg/ingest"; // or a small local reader

const args = process.argv.slice(2);
if (!args.includes("--no-fetch")) {
  await runBenchmarks();
}
const snapshot = await readSnapshot();
const benchmarks = await readBenchmarks();
const scores = scoreModels({ snapshot, benchmarks, now: new Date().toISOString() });
await writeJsonAtomic("data/scores.json", { schemaVersion: 1, generatedAt: now, scores });
console.log(`scored ${scores.length} models`);
```

- `--no-fetch` uses the existing `data/benchmarks.json`; this is useful for iterating on scoring.
- Warn if a benchmark has fewer than 5 models; percentiles are noisy.
- Exit non-zero if the snapshot or benchmarks are unreadable.
- Do not fail if a model has no benchmarks; it gets `unrated`.
- If `@omg/ingest` is not a dependency of `@omg/scoring`, move `readSnapshot` into `@omg/shared`
  or implement a local 10-line reader. Prefer a local reader to avoid a package cycle.

### 6. Write scoring tests

- A model with only SWE-bench gets an `agentic-coding` score but `unrated` confidence if coverage < 0.5.
- A model with all four agentic benchmarks gets confidence near freshness.
- A model with a 100k context gets `long-context` tier `unrated`.
- A model with a 300k context and strong document/text benchmarks gets a tier.
- Stale benchmark dates lower confidence.
- A free model has cost 0 for all profiles.
- A `pricingKnown: false` model has `null` costs.
- A Go model has `goEffective` values and they are lower than list cost when `includedUsage > plan`.

### 7. Run and spot-check

```bash
pnpm ingest
pnpm score
pnpm validate:data
node - <<'NODE'
const s = require("./data/scores.json");
for (const key of ["opencode/kimi-k3", "opencode/deepseek-v4.1-flash-free", "opencode-go/glm-5.3"]) {
  console.log(key, JSON.stringify(s.scores.find((x) => x.modelKey === key), null, 2));
}
NODE
```

Hand-check one cost with a calculator. Ensure no `NaN`, `Infinity`, or scores > 100.

### 8. Commit

`feat: compute modeled costs and per-use-case scores`

## Acceptance checklist

- [ ] Cost tests match hand calculations to 10 decimals.
- [ ] Cache fallback, tiers, and `contextOver200k` are tested.
- [ ] Unknown prices produce `null`, not `$0`.
- [ ] Percentile ties and `n=1` are tested.
- [ ] Confidence reflects both coverage and freshness.
- [ ] Long-context gate works.
- [ ] Every model has a `ScoreRecord`, even if `unrated`.
- [ ] Free models cost 0; Go models have `goEffective` where data exists.
- [ ] `data/scores.json` validates and contains no `NaN`/`Infinity`.
- [ ] No single overall score is produced.

## Handoff notes

- S08 joins `scores.json` and `benchmarks.json` to show measured SWE-bench cost alongside modeled cost.
  Label them differently.
- Do not "fix" an unrated model by inventing a score. Show the gap.
- If weights change, bump the score version in the methodology page and note it in the tracker.
- The UI may let users adjust cost profiles in memory. It must not rewrite `scores.json`.

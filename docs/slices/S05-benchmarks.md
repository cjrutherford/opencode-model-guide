# S05 — Benchmark ingestion and name resolution

> **Status:** todo · **Depends on:** S01 · **Blocks:** S06, S09 · **Effort:** ~2 days
> **Owner:** — · **Branch:** `slice/S05-benchmarks`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §5 and §9 first.

## Why this slice exists

Quality is the other half of a buyer's guide. Public leaderboards have the data, but they use
different names, harnesses, and scales. This slice fetches the machine-readable sources, normalizes
them, and resolves benchmark entries to OpenCode model keys without guessing silently.

## Goal

- Ingest SWE-bench, LMArena, and Aider polyglot results.
- Optionally ingest Terminal-Bench and Artificial Analysis; never fail when absent.
- Resolve benchmark names to model keys with explicit confidence.
- Publish `data/benchmarks.json` with results, unmatched names, and source health.
- Keep a manual alias table for the long tail.

## Non-goals

- No scoring or cost modeling. S06 owns that.
- No scraping of arbitrary blog posts or reviews.
- No LiveBench in v1.
- No benchmark execution. That is v2.

## Inputs and contracts

- `data/snapshot.json` with model keys, names, and IDs.
- `normalizeModelName` from `@omg/shared`.
- Output `BenchmarksFile`:

```ts
interface BenchmarksFile {
  schemaVersion: 1;
  generatedAt: string;
  results: BenchmarkResult[];
  unmatched: string[];
  sources: SourceStatus[];
}
```

- Every result has `benchmark`, `metric`, `value`, `modelNameRaw`, `match`, `matchConfidence`,
  `date`, and `sourceUrl`. `modelKey` is present only when resolved.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `packages/scoring/src/benchmarks/sweBench.ts` | HTML + embedded JSON |
| Create | `packages/scoring/src/benchmarks/lmarena.ts` | HF datasets-server |
| Create | `packages/scoring/src/benchmarks/aider.ts` | YAML |
| Create | `packages/scoring/src/benchmarks/terminalBench.ts` | Returns `[]` + `skipped` |
| Create | `packages/scoring/src/benchmarks/aa.ts` | Optional; key-gated |
| Create | `packages/scoring/src/aliases.ts` | Load + match |
| Create | `packages/scoring/src/resolve.ts` | Exact/alias/fuzzy |
| Create | `packages/scoring/src/runBenchmarks.ts` | Orchestrator |
| Create | `packages/scoring/test/benchmarks.test.ts` | Adapter tests |
| Create | `packages/scoring/test/resolve.test.ts` | Resolution tests |
| Create | `packages/scoring/test/fixtures/swebench.html` | Trimmed real page |
| Create | `packages/scoring/test/fixtures/lmarena-webdev.json` | One page of rows |
| Create | `packages/scoring/test/fixtures/aider.yml` | 3 runs, 2 models |
| Create | `data/aliases.json` | Start with `{}` |
| Create | `data/benchmarks.json` | Generated |

## Implementation steps

### 1. Write failing adapter tests

```ts
it("parses SWE-bench verified mini-SWE-agent runs", () => {
  const results = parseSweBench(swebenchHtml);
  expect(results.length).toBeGreaterThan(0);
  expect(results.every((r) => r.harness === "mini-SWE-agent")).toBe(true);
  expect(results.every((r) => r.benchmark === "swe-bench-verified" || r.benchmark === "swe-bench-multilingual")).toBe(true);
  expect(results[0].costPerTaskUsd).toBeGreaterThan(0);
});

it("takes the latest Aider run per model", () => {
  const results = parseAider(aiderYaml);
  expect(results.filter((r) => r.modelNameRaw === "gpt-5")).toHaveLength(1);
});

it("paginates LMArena rows", async () => {
  const results = await parseLmarena({ fetch: fakePagedFetch, config: "webdev" });
  expect(results).toHaveLength(150);
});
```

### 2. Implement `sweBench.ts`

- Fetch `https://www.swebench.com/`.
- Extract the JSON inside:

```html
<script type="application/json" id="leaderboard-data"> ... </script>
```

Use a non-greedy regex over the script body, then `JSON.parse`. The payload is an array of
`{ name: "Verified" | "Multilingual" | ... , results: [...] }`.
- Keep `name` in `["Verified", "Multilingual"]`.
- Keep `result.agent === "mini-SWE-agent"` for comparability.
- Group by `model_display`; keep the newest `date`.
- Map:
  - `benchmark`: `Verified` → `swe-bench-verified`, `Multilingual` → `swe-bench-multilingual`
  - `metric`: `"percent"`
  - `value`: `resolved`
  - `costPerTaskUsd`: `instance_cost`
  - `harness`: `mini-SWE-agent`
  - `date`: `date`
  - `sourceUrl`: `https://www.swebench.com/`
- Record `instance_calls` in a `notes` field? The shared type does not have it. Put it in
  `tokensPerTask`? No, calls are not tokens. Skip it; S06 can use `costPerTaskUsd`.

### 3. Implement `lmarena.ts`

Dataset: `lmarena-ai/leaderboard-dataset`, split `latest`.

Configs and fields:

| Config | Metric | Field |
|---|---|---|
| `webdev` | `elo` | `rating` |
| `text` | `elo` | `rating` |
| `document` | `elo` | `rating` |
| `agent` | `score` | `score` |

Endpoint:

```
https://datasets-server.huggingface.co/rows
  ?dataset=lmarena-ai%2Fleaderboard-dataset
  &config=webdev
  &split=latest
  &offset=0
  &length=100
```

- Paginate by `offset` until `offset + length >= num_rows_total`.
- Each item is `{ row: {...} }`.
- `modelNameRaw = row.model_name`
- `date = row.leaderboard_publish_date`
- `sourceUrl = https://lmarena.ai/leaderboard`
- Benchmark IDs: `lmarena-webdev`, `lmarena-text`, `lmarena-document`, `lmarena-agent`.
- Fetch configs sequentially or with a small concurrency limit (2) to be polite.

### 4. Implement `aider.ts`

- Fetch
  `https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml`.
- Parse with `yaml`.
- Group by `model`; keep the newest `date`.
- Map `pass_rate_2` to `value`, metric `"percent"`, benchmark `"aider-polyglot"`.
- `harness = "aider-polyglot"`.
- Strip provider prefixes from `model` only for display; keep the raw name for resolution.

### 5. Optional adapters

- `terminalBench.ts`: return `{ results: [], status: "skipped", reason: "no stable machine-readable leaderboard in v1" }`.
- `aa.ts`: if `process.env.AA_API_KEY` is absent, return skipped. If present, fetch
  `https://artificialanalysis.ai/api/v2/data/llms/models` with header `x-api-key`, map
  `coding_index`/`intelligence_index` to `artificial-analysis`. Add a fixture when a real response is
  available; until then, keep the adapter defensive and excluded from acceptance.
- Both adapters must return a `SourceStatus`, never throw into the orchestrator.

### 6. Implement `aliases.ts` and `resolve.ts`

`data/aliases.json` shape:

```json
{
  "claude 4 6 opus": "opencode/claude-opus-4-6",
  "gpt 5 1 codex max": "opencode/gpt-5.1-codex-max"
}
```

Keys are `normalizeModelName(raw)`. Values are exact model keys.

Resolution:

```ts
export interface Resolution {
  modelKey?: string;
  match: "exact" | "alias" | "fuzzy" | "unmatched";
  confidence: number;
}

export function resolveModelName(
  raw: string,
  models: ModelRecord[],
  aliases: Record<string, string>
): Resolution;
```

Order:

1. Raw equals a key or ID → `exact`, confidence 1.
2. Normalized raw equals a normalized model name or ID → `exact`, confidence 1.
3. Alias hit → `alias`, confidence 1.
4. Token Dice similarity against every model name and ID. Best score ≥ 0.85 and at least 0.05 ahead
   of the runner-up → `fuzzy`, confidence = score.
5. Otherwise `unmatched`, confidence 0.

Dice coefficient:

```ts
2 * |A ∩ B| / (|A| + |B|)
```

on normalized token sets. Add a guard against short names (`gpt 5` vs `gpt 5 mini`): require the
token sets to have the same size or a score ≥ 0.9.

Never resolve a raw name to more than one model key.

### 7. Implement `runBenchmarks.ts`

Export `runBenchmarks(): Promise<BenchmarksFile>` and add a `main()` guard so it can run standalone
with `tsx packages/scoring/src/runBenchmarks.ts` during development. S06 calls the exported function
from the root `pnpm score` entrypoint.

- Read `data/snapshot.json` and `data/aliases.json`.
- Run adapters with `Promise.allSettled`.
- For each result, resolve; set `modelKey`, `match`, `matchConfidence`.
- Drop results for models not in the snapshot? No. Keep them with `modelKey` undefined and
  `match: "unmatched"` so `/health` can show gaps.
- Deduplicate by `benchmark + modelNameRaw + date`; keep the newest.
- Write `data/benchmarks.json` atomically.
- Log: `swe-bench: 42 rows, 31 resolved; lmarena: 120 rows, 88 resolved; aider: 60 rows, 44 resolved`.
- Exit non-zero only if all adapters fail or the snapshot is unreadable.

### 8. Seed aliases

Run the ingest, inspect `unmatched`, and add at least ten obvious aliases. Examples to check:

- `Claude 4.6 Opus` → the matching OpenCode ID
- `GPT 5.1 Codex Max` → `opencode/gpt-5.1-codex-max`
- `Gemini 3 Pro` / `Gemini 3.1 Pro`
- `DeepSeek V4 Pro`
- `Kimi K2.7 Code`
- `MiniMax M3`
- `Qwen3.8 Max`

Do not add an alias unless you are confident. A wrong alias is worse than an unmatched row.

### 9. Commit

`feat: ingest public coding benchmarks and resolve model names`

## Acceptance checklist

- [ ] Adapter tests pass with fixtures; no network.
- [ ] SWE-bench keeps only `mini-SWE-agent` and includes `costPerTaskUsd`.
- [ ] LMArena pagination works and all four configs map correctly.
- [ ] Aider keeps the latest run per model.
- [ ] Optional adapters return `skipped`, never throw.
- [ ] Resolution covers exact, alias, fuzzy, and unmatched with tests.
- [ ] At least 25 native models resolve to one or more benchmarks.
- [ ] `unmatched` is non-empty on a real run and visible to S09.
- [ ] `data/benchmarks.json` validates.
- [ ] No benchmark score is invented or interpolated.

## Handoff notes

- S06 computes percentiles **within each benchmark**, not across the whole file.
- Do not merge `swe-bench-verified` and `swe-bench-multilingual`; they are separate signals.
- LMArena configs are not interchangeable; keep the benchmark ID distinct.
- If a benchmark changes its page structure, update the fixture and parser together. A silent empty
  result is the worst outcome; assert a minimum row count in production and alert in S10.
- Keep the alias file human-edited. Do not auto-write fuzzy matches into it.

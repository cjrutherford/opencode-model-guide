# OpenCode Model Guide Implementation Plan

> **For the implementing agent:** Read the design first:
> [`2026-10-19-opencode-model-guide-design.md`](./2026-10-19-opencode-model-guide-design.md).
> Then read the slice file for the slice you are picking up in
> [`docs/slices/`](../slices/README.md). The slice file is authoritative for scope and acceptance.
> Update the tracker when you start, when you open a PR, and when you merge.

**Goal:** Build a public, statically generated guide and daily change tracker for OpenCode-native
models, with modeled cost per task, public-benchmark quality scores, RSS, and ntfy notifications.

**Architecture:** A GitHub Actions pipeline fetches models.dev, the two live OpenCode model endpoints,
the Console/Go docs, and public benchmark data; normalizes everything into committed JSON snapshots;
diffs those snapshots into an append-only event log; computes cost and quality scores; builds an Astro
site; deploys to GitHub Pages; and sends an ntfy summary. There is no server and no database.

**Tech stack:** Node 22, pnpm 10, TypeScript (strict), Astro 5, React 19 islands, Tailwind 4,
Zod 4, Vitest 3, tsx, cheerio, yaml, GitHub Actions, GitHub Pages.

---

## How to execute

- Work one slice per branch: `slice/S02-catalog-ingest`.
- Read the slice file, then the design section it references.
- Use TDD for logic. Write the failing test, run it, implement, run it, commit.
- Keep commits small. Suggested prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- Do not fetch the network in tests. Use the fixtures named in the slice.
- Do not edit `packages/shared/src/schema.ts` after S01 without a schema-change note in the PR and a
  tracker update. Other slices depend on it.
- Run the full gate before opening a PR:

```bash
pnpm typecheck
pnpm test
pnpm validate:data
pnpm build
```

- Update `docs/slices/README.md` in the same PR: status, branch, PR link, notes.

### Environment note

This sandbox has Node 22 but `pnpm` is not on `PATH`. It is installed at
`~/.local/share/pnpm/pnpm` (v10.33.2). Use:

```bash
export PATH="$HOME/.local/share/pnpm:$PATH"
pnpm --version   # 10.33.2
```

GitHub Actions uses `pnpm/action-setup@v4` instead.

### Slice map

| Slice | Title | Depends on | Parallel group |
|---|---|---|---|
| S00 | Repository foundation and CI | — | A |
| S01 | Shared contracts and fixtures | S00 | B |
| S02 | Catalog ingest | S01 | C |
| S03 | Free classification and docs parsing | S01, S02 | D |
| S04 | Change detection and event log | S02, S03 | D |
| S05 | Benchmark ingestion and name resolution | S01 | C |
| S06 | Cost model and scoring | S01, S05 | D |
| S07 | Web shell and home | S00, S01 | C |
| S08 | Models directory, detail, compare | S07, S02, S06 | E |
| S09 | Changes, methodology, health, RSS | S07, S04, S05, S06 | E |
| S10 | CI/CD, Pages, ntfy | S02–S06, S09 | F |
| S11 | Docs, accessibility, launch | all | G |

Parallel groups mean the slices can be worked concurrently **if file ownership is respected**.
The shared file risks are called out in each slice.

---

## Task S00: Repository foundation and CI

**Slice file:** [`S00-repo-foundation.md`](../slices/S00-repo-foundation.md)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` (generated),
  `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `.editorconfig`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`,
  `packages/shared/src/index.ts`
- Create: `packages/ingest/package.json`, `packages/ingest/tsconfig.json`,
  `packages/ingest/src/index.ts`
- Create: `packages/scoring/package.json`, `packages/scoring/tsconfig.json`,
  `packages/scoring/src/index.ts`
- Create: `packages/notify/package.json`, `packages/notify/tsconfig.json`,
  `packages/notify/src/index.ts`
- Create: `apps/web/package.json`, `apps/web/astro.config.mjs`, `apps/web/tsconfig.json`,
  `apps/web/src/pages/index.astro`, `apps/web/src/styles/global.css`
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Steps:**

1. Write `pnpm-workspace.yaml` with `apps/*` and `packages/*`.
2. Write the root `package.json` with scripts:
   `dev`, `build`, `typecheck`, `test`, `test:watch`, `ingest`, `score`, `notify`, `validate:data`.
   Pin `packageManager` to `pnpm@10.33.2` and `engines.node` to `>=22`.
3. Write `tsconfig.base.json` with `strict: true`, `target: ES2022`, `module: ESNext`,
   `moduleResolution: Bundler`, `noEmit: true`, `skipLibCheck: true`.
4. Create the four package stubs. Each has `"type": "module"`, a `typecheck` script, and a
   `src/index.ts` with a single export so the package is not empty.
5. Create the Astro app with the Tailwind integration and a minimal home page.
6. Add `vitest.config.ts` including `packages/**/*.test.ts` and `scripts/**/*.test.ts`.
7. Add `.github/workflows/ci.yml` running install, typecheck, test, validate, build on push/PR.
8. Run `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
9. Commit: `chore: scaffold workspace and ci`.

**Acceptance:**
- `pnpm --version` is 10.33.x.
- `pnpm typecheck` exits 0.
- `pnpm test` exits 0 (no tests yet is fine only if Vitest is configured with `passWithNoTests`).
- `pnpm build` produces `apps/web/dist/index.html`.
- CI workflow is valid YAML and references existing scripts.

---

## Task S01: Shared contracts and fixtures

**Slice file:** [`S01-shared-contracts.md`](../slices/S01-shared-contracts.md)

**Files:**
- Create: `packages/shared/src/schema.ts`
- Create: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/ids.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/test/schema.test.ts`
- Create: `packages/shared/test/ids.test.ts`
- Create: `packages/shared/test/fixtures/snapshot.sample.json`
- Create: `packages/shared/test/fixtures/benchmarks.sample.json`
- Create: `packages/shared/test/fixtures/events.sample.jsonl`

**Step 1: Write the failing schema test.**

```ts
import { describe, expect, it } from "vitest";
import { SnapshotSchema } from "../src/schema";
import fixture from "./fixtures/snapshot.sample.json";

describe("SnapshotSchema", () => {
  it("accepts the fixture", () => {
    expect(() => SnapshotSchema.parse(fixture)).not.toThrow();
  });

  it("rejects a negative price", () => {
    const bad = structuredClone(fixture);
    bad.models[0].pricing.input = -1;
    expect(() => SnapshotSchema.parse(bad)).toThrow();
  });

  it("rejects a duplicate model key", () => {
    const bad = structuredClone(fixture);
    bad.models.push(structuredClone(bad.models[0]));
    expect(() => SnapshotSchema.parse(bad)).toThrow();
  });
});
```

**Step 2: Run it.** `pnpm vitest packages/shared/test/schema.test.ts` → fails because
`schema.ts` does not exist.

**Step 3: Implement `schema.ts`.** Use the design's section 7 types. Add `.superRefine()` for:
unique `models[].key`, non-negative prices, `cachedInputTokens <= inputTokens` is enforced by the
cost layer not the schema, `key === `${provider}/${id}``, and at least one source per model.

**Step 4: Implement `constants.ts`.**

```ts
export const COST_PROFILES = {
  "quick-edit": { label: "Quick edit", inputTokens: 12_000, cachedInputTokens: 8_000, outputTokens: 1_500 },
  "agentic-pr": { label: "Agentic PR", inputTokens: 120_000, cachedInputTokens: 90_000, outputTokens: 8_000 },
  "long-context": { label: "Long-context task", inputTokens: 400_000, cachedInputTokens: 250_000, outputTokens: 6_000 },
} as const;

export const USE_CASE_WEIGHTS = {
  "agentic-coding": { "swe-bench-verified": 0.45, "terminal-bench": 0.20, "lmarena-agent": 0.20, "aider-polyglot": 0.15 },
  "everyday-edits": { "swe-bench-verified": 0.20, "lmarena-webdev": 0.25, "lmarena-text": 0.15, "aider-polyglot": 0.40 },
  "frontend": { "lmarena-webdev": 0.60, "lmarena-text": 0.20, "aider-polyglot": 0.20 },
  "long-context": { "swe-bench-verified": 0.30, "lmarena-text": 0.30, "lmarena-document": 0.40 },
} as const;
```

**Step 5: Implement `ids.ts`.**

```ts
export function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

export function slugify(key: string): string {
  return key.replace("/", "--").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

export function eventId(type: string, key: string, at: string): string {
  return `${type}:${key}:${at.slice(0, 10)}`;
}
```

**Step 6: Run the tests and typecheck.**
**Step 7: Commit:** `feat: add shared schemas, constants, and fixtures`.

**Acceptance:**
- Schema parses all three fixtures.
- Duplicate keys, negative prices, and missing sources are rejected.
- Cost profiles and use-case weights are exported.
- `modelKey`, `slugify`, and `eventId` are unit-tested.

---

## Task S02: Catalog ingest

**Slice file:** [`S02-catalog-ingest.md`](../slices/S02-catalog-ingest.md)

**Files:**
- Create: `packages/ingest/src/http.ts`
- Create: `packages/ingest/src/sources/modelsDev.ts`
- Create: `packages/ingest/src/sources/opencodeModels.ts`
- Create: `packages/ingest/src/normalize.ts`
- Create: `packages/ingest/src/snapshot.ts`
- Create: `packages/ingest/src/run.ts`
- Create: `packages/ingest/test/normalize.test.ts`
- Create: `packages/ingest/test/sources.test.ts`
- Create: `packages/ingest/test/fixtures/models-dev.sample.json`
- Create: `packages/ingest/test/fixtures/opencode-models.sample.json`
- Create: `packages/ingest/test/fixtures/opencode-go-models.sample.json`
- Create: `data/snapshot.json` (generated by the first run)

**Step 1: Write the failing normalize test.**

```ts
import { describe, expect, it } from "vitest";
import { normalizeCatalog } from "../src/normalize";
import modelsDev from "./fixtures/models-dev.sample.json";
import live from "./fixtures/opencode-models.sample.json";

const now = "2026-10-19T13:00:00.000Z";

it("maps a free model and marks it live", () => {
  const models = normalizeCatalog({ modelsDev, live, now, previous: null, goLive: null, sourceRefs: [] });
  const m = models.find((x) => x.id === "deepseek-v4.1-flash-free");
  expect(m?.free.kind).toBe("open-free");
  expect(m?.availability).toBe("live");
  expect(m?.pricing.input).toBe(0);
  expect(m?.firstSeen).toBe(now);
});
```

**Step 2: Run it and watch it fail.**
**Step 3: Implement `http.ts`.** `fetchJson` and `fetchText` with 20 s timeout, one retry,
`User-Agent: opencode-model-guide/1.0 (+https://github.com/<owner>/<repo>)`, and a `SourceError`.
**Step 4: Implement `modelsDev.ts`.** Fetch `https://models.dev/api.json`, select providers
`opencode` and `opencode-go`, map models to the shared input shape.
**Step 5: Implement `opencodeModels.ts`.** Fetch both live endpoints; return a `Set<string>` of IDs
and a `SourceStatus`.
**Step 6: Implement `normalize.ts`.** Rules:

- Key is `${provider}/${id}`.
- `availability`: `live` if in the endpoint, else `deprecated` if models.dev status is `deprecated`,
  else `unlisted`.
- `pricing`: copy input/output/cache/tiers from models.dev.
- `free.kind`: `paid` initially; `open-free` when both prices are 0; `subscription-included` for
  `opencode-go` with non-zero prices. S03 refines this.
- `subscription`: stub for Go models; S03 fills `monthlyUsd` and `includedUsageUsd`.
- `firstSeen`: preserve from the previous snapshot by key, else `now`.
- `lastSeen`: `now`.
- `conflicts`: empty in S02 except for `availability` disagreements.
- Sort models by key before writing.

**Step 7: Implement `snapshot.ts`.** Read the previous `data/snapshot.json` if present, write the
new one atomically (`write temp + rename`), and never lose `firstSeen`.
**Step 8: Implement `run.ts`.** `main()` wires fetch → normalize → write. Support `--fixtures <dir>`
for offline runs and `--dry-run`.
**Step 9: Run the real ingest once** to create `data/snapshot.json`. Inspect counts:
`opencode` should be ~128 models, `opencode-go` ~33, with 45 + 5 zero-price entries.
**Step 10: Commit:** `feat: ingest opencode catalog from models.dev and live endpoints`.

**Acceptance:**
- Tests pass without network.
- `pnpm ingest` writes a schema-valid `data/snapshot.json`.
- Every model has `sources[]` with at least models.dev.
- `firstSeen` is preserved across a second run.
- No secrets or API keys are required.

---

## Task S03: Free classification and docs parsing

**Slice file:** [`S03-free-classification.md`](../slices/S03-free-classification.md)

**Files:**
- Create: `packages/ingest/src/sources/opencodeDocs.ts`
- Create: `packages/ingest/src/freeClassify.ts`
- Create: `packages/ingest/test/freeClassify.test.ts`
- Create: `packages/ingest/test/opencodeDocs.test.ts`
- Create: `packages/ingest/test/fixtures/console-docs.html`
- Create: `packages/ingest/test/fixtures/go-docs.html`
- Modify: `packages/ingest/src/run.ts` (add the classify stage)

**Step 1: Write a failing test for the free-list parser.**

```ts
it("parses the console free list", () => {
  const evidence = parseConsoleDocs(consoleDocsHtml);
  expect(evidence.freeModels).toContainEqual(
    expect.objectContaining({ name: "DeepSeek V4.1 Flash Free", limitedTime: true })
  );
  expect(evidence.freeModels).toContainEqual(
    expect.objectContaining({ name: "Big Pickle", stealth: true })
  );
});
```

**Step 2: Implement `opencodeDocs.ts` with cheerio.** Extract:

- Console free-list entries: name, "limited time", "stealth", training, retention, regions.
- Console pricing table: model name, input, output, cache read, cache write, free/paid.
- Go pricing table: model, prices, monthly limit (strip `$`, `~~`, `**`).
- Go privacy table: training yes/no, retention days/ZDR.
- Go plan prices: `$10` and `$40`.

Return typed `DocsEvidence` with `sourceRefs` and `warnings`.

**Step 3: Implement `freeClassify.ts`.**

- Match docs model names to catalog IDs via normalized names and the `data/aliases.json` file.
- Apply the classification rules from design §4.
- Set `free.flags`: `limited-time`, `stealth`, `trains-on-data`, `zero-retention`,
  `region-restricted`, `unlimited`, `usage-limited`.
- Set `free.status = "confirmed"` when docs and price agree; `"uncertain"` when they conflict.
- Set `privacy` from the Go privacy table and Console notes.
- Attach `subscription` for Go models: `monthlyUsd` 10 or 40, `includedUsageUsd` from the table,
  `estimatedRequestsPerMonth` when present.
- Record conflicts for every disagreement (price, free status, availability).

**Step 4: Integrate.** Call `classifyFree(models, evidence)` after normalize, before snapshot write.
**Step 5: Run the real ingest.** Verify:

- Console free models: 14 names from the docs are present and not `paid`.
- Go free models: LongCat 2.5 Preview Free, Beam Free, MiniMax M3.1 Flash Free are `open-free`
  or `limited-time` with `subscription.plan = "go"`.
- Go paid models are `subscription-included` with a monthly limit.
- At least one deliberate conflict is visible (models.dev marks some docs-free models deprecated).

**Step 6: Commit:** `feat: classify free models from official docs and pricing`.

**Acceptance:**
- HTML fixture tests pass.
- Free kinds match design §4.
- Privacy and subscription fields are populated for Go models.
- Conflicts are recorded, not dropped.
- `data/snapshot.json` validates.

---

## Task S04: Change detection and event log

**Slice file:** [`S04-change-detection.md`](../slices/S04-change-detection.md)

**Files:**
- Create: `packages/ingest/src/diff.ts`
- Create: `packages/ingest/src/history.ts`
- Create: `packages/ingest/test/diff.test.ts`
- Create: `packages/ingest/test/history.test.ts`
- Create: `packages/ingest/test/fixtures/snapshot.prev.json`
- Create: `packages/ingest/test/fixtures/snapshot.next.json`
- Create: `data/events.jsonl`
- Create: `data/history/YYYY-MM-DD.json`
- Modify: `packages/ingest/src/run.ts` (add the diff stage)

**Step 1: Write the failing diff test.**

```ts
it("emits free_started when a paid model becomes limited-time free", () => {
  const events = diffSnapshots(prev, next, { now: "2026-10-19T13:00:00.000Z" });
  expect(events).toContainEqual(expect.objectContaining({
    type: "free_started",
    modelKey: "opencode/example-model",
    notify: true,
  }));
});

it("does not emit model_added on bootstrap", () => {
  const events = diffSnapshots(null, next, { now: "2026-10-19T13:00:00.000Z" });
  expect(events.filter((e) => e.type === "model_added")).toHaveLength(0);
});
```

**Step 2: Implement `diffSnapshots(prev, next, opts)`.**

- If `prev` is null, return `[]` and mark bootstrap.
- Compare by key. Emit `model_added` for new keys.
- `free_started` when `isFree(prev) === false && isFree(next) === true`, or kind changes to
  `limited-time`. `isFree` means `freeNow || subscription-included` for zero-marginal events; for
  notifications default to `freeNow` only.
- `free_ended` when `freeNow` goes true → false.
- `price_changed` when any price field differs (deep compare).
- `deprecated` when availability becomes `deprecated`.
- `source_failed` when a required source's `ok` flips to false.
- Event ID from `eventId(type, key, at)`; merge duplicates by ID.

**Step 3: Implement `history.ts`.** Write a compact daily snapshot:
`{ date, models: [{ key, pricing, free, availability }] }`. Keep 365 files; prune older.
**Step 4: Implement the event append.** Read existing `events.jsonl`, merge by ID, sort by `at`,
write atomically. Never rewrite historical events.
**Step 5: Run twice.** The first run bootstraps; the second run emits no duplicates.
**Step 6: Commit:** `feat: detect model and free-tier changes`.

**Acceptance:**
- Bootstrap emits zero notifications.
- Second identical run emits zero events.
- Each event type has a unit test.
- Event IDs are deterministic.
- `events.jsonl` is valid JSONL and sorted.

---

## Task S05: Benchmark ingestion and name resolution

**Slice file:** [`S05-benchmarks.md`](../slices/S05-benchmarks.md)

**Files:**
- Create: `packages/scoring/src/benchmarks/sweBench.ts`
- Create: `packages/scoring/src/benchmarks/lmarena.ts`
- Create: `packages/scoring/src/benchmarks/aider.ts`
- Create: `packages/scoring/src/benchmarks/terminalBench.ts` (optional stub)
- Create: `packages/scoring/src/benchmarks/aa.ts` (optional)
- Create: `packages/scoring/src/aliases.ts`
- Create: `packages/scoring/src/resolve.ts`
- Create: `packages/scoring/src/runBenchmarks.ts`
- Create: `packages/scoring/test/benchmarks.test.ts`
- Create: `packages/scoring/test/resolve.test.ts`
- Create: `packages/scoring/test/fixtures/swebench.html`
- Create: `packages/scoring/test/fixtures/lmarena-webdev.json`
- Create: `packages/scoring/test/fixtures/aider.yml`
- Create: `data/aliases.json` (start with `{}`)

**Step 1: Write the failing SWE-bench parser test.**

```ts
it("parses the embedded leaderboard JSON and keeps mini-SWE-agent runs", () => {
  const results = parseSweBench(swebenchHtml);
  expect(results.length).toBeGreaterThan(0);
  expect(results.every((r) => r.harness === "mini-SWE-agent")).toBe(true);
  expect(results[0]).toMatchObject({ benchmark: "swe-bench-verified" });
  expect(results[0].costPerTaskUsd).toBeGreaterThan(0);
});
```

**Step 2: Implement adapters.**

- **SWE-bench:** fetch `https://www.swebench.com/`, regex the
  `<script type="application/json" id="leaderboard-data">…</script>` block, JSON parse. Keep
  leaderboards `Verified` and `Multilingual`, `agent === "mini-SWE-agent"`, latest date per model.
  `value = resolved`, `costPerTaskUsd = instance_cost`.
- **LMArena:** use `https://datasets-server.huggingface.co/rows` with
  `dataset=lmarena-ai/leaderboard-dataset`, `config=webdev|agent|text|document`, `split=latest`,
  `length=100`, paginate by `offset`. Map `rating` for webdev/text/document and `score` for agent.
- **Aider:** fetch the YAML URL, parse with `yaml`, take the latest run per `model`, metric
  `pass_rate_2`.
- **Terminal-Bench:** return `[]` with a `skipped` source status in v1. Do not scrape.
- **Artificial Analysis:** if `AA_API_KEY` is set, fetch and map; otherwise return `[]` with
  `skipped`. Never fail the run.

**Step 3: Implement `aliases.ts` and `resolve.ts`.**

```ts
normalizeName("Claude 4.6 Opus") // "claude-4-6-opus"
normalizeName("claude-opus-4-6") // "claude-opus-4-6"
```

Resolution order: exact key/name → alias map → token similarity ≥ 0.85 → unmatched. Record
`match` and `matchConfidence`. Use a simple Dice coefficient over normalized tokens; no ML
dependency.

**Step 4: Implement `runBenchmarks.ts`.** Fetch all adapters in parallel with
`Promise.allSettled`, resolve names against `data/snapshot.json`, write `data/benchmarks.json`
with `results` and `unmatched`.
**Step 5: Run it and inspect `/unmatched`.** Add at least ten aliases manually for obvious misses.
**Step 6: Commit:** `feat: ingest public coding benchmarks and resolve model names`.

**Acceptance:**
- Fixture tests pass; no network.
- SWE-bench results include `costPerTaskUsd`.
- LMArena adapter handles all four configs.
- At least 25 native models resolve to ≥ 1 benchmark.
- Unmatched names are reported, never silently dropped.
- Optional sources cannot fail the run.

---

## Task S06: Cost model and scoring

**Slice file:** [`S06-cost-and-scoring.md`](../slices/S06-cost-and-scoring.md)

**Files:**
- Create: `packages/scoring/src/cost.ts`
- Create: `packages/scoring/src/percentile.ts`
- Create: `packages/scoring/src/score.ts`
- Create: `packages/scoring/src/run.ts`
- Create: `packages/scoring/test/cost.test.ts`
- Create: `packages/scoring/test/percentile.test.ts`
- Create: `packages/scoring/test/score.test.ts`
- Create: `data/scores.json` (generated)

**Step 1: Write the failing cost test.**

```ts
it("prices cached input correctly", () => {
  const cost = taskCost(
    { currency: "USD", unit: "per_1m_tokens", input: 3, output: 15, cacheRead: 0.3 },
    { inputTokens: 120_000, cachedInputTokens: 90_000, outputTokens: 8_000 }
  );
  expect(cost).toBeCloseTo(0.3 * 30_000 / 1e6 + 0.3 * 90_000 / 1e6 + 15 * 8_000 / 1e6, 10);
});
```

**Step 2: Implement `cost.ts`.**

- `taskCost(pricing, profile)` per design §8.
- Tier selection: highest `minInputTokens` ≤ `inputTokens`; apply to the whole request.
- `contextOver200k` when `inputTokens > 200_000`.
- `goEffectiveCost(listCost, planUsd, includedUsageUsd)`.
- `formatUsd` for display (`$0.0042`, `$1.23`).

**Step 3: Implement `percentile.ts`.** Ties averaged, denominator `n - 1`, return 0–100.
**Step 4: Implement `score.ts`.**

- Build benchmark percentiles per benchmark.
- For each use case, weighted average of available percentiles / available weight.
- Long-context gate: `limits.context >= 200_000`; otherwise `score: null`, tier `unrated`.
- Confidence = `availableWeight * freshness`.
- Tier thresholds from design §9.
- Cost per profile for every model; Go effective for Go models.

**Step 5: Implement `run.ts`.** Read `data/snapshot.json` + `data/benchmarks.json`, write
`data/scores.json` with one `ScoreRecord` per model. Call `runBenchmarks()` first unless `--no-fetch`
is passed.
**Step 6: Run it.** Spot-check five models by hand. Ensure no `NaN` and no score above 100.
**Step 7: Commit:** `feat: model cost per task and per-use-case scores`.

**Acceptance:**
- Cost tests match hand calculations to 10 decimals.
- Tier and percentile tests cover ties and small n.
- Missing benchmarks produce `null` + low confidence, not zero.
- Every model has a `ScoreRecord`, even if unrated.
- `data/scores.json` validates.

---

## Task S07: Web shell and home

**Slice file:** [`S07-web-shell.md`](../slices/S07-web-shell.md)

**Files:**
- Create: `apps/web/src/layouts/Base.astro`
- Create: `apps/web/src/components/Header.astro`, `Footer.astro`, `FreeBadge.astro`,
  `Section.astro`, `Stat.astro`
- Create: `apps/web/src/lib/url.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/format.ts`
- Create: `apps/web/src/pages/index.astro`
- Modify: `apps/web/src/styles/global.css`
- Create: `apps/web/test/url.test.ts`

**Step 1: Write the failing `url()` test.**

```ts
it("prefixes the base path exactly once", () => {
  expect(url("/models")).toBe("/repo/models");
  expect(url("/")).toBe("/repo/");
});
```

**Step 2: Implement `url.ts`.** Read `import.meta.env.BASE_URL`, normalize trailing slashes.
**Step 3: Implement `data.ts`.** Import `data/snapshot.json`, `data/scores.json`,
`data/benchmarks.json`; validate with Zod at build time; throw a readable error if missing.
**Step 4: Build the design system.** CSS variables for ink/paper/accent, light/dark, tabular
numerals, focus rings, reduced motion. Use a system sans + monospace stack. No external fonts.
**Step 5: Build `Base.astro`.** Meta, canonical, OG, skip link, header nav, footer with source
links, `lang="en"`.
**Step 6: Build the home page.** Sections: hero with current free count; "Free right now" (first 6,
link to all); "Latest changes" (last 5 events); "Best value" cards (top model per use case);
methodology link. All data from committed JSON.
**Step 7: Verify** at 360, 768, 1280 px; keyboard tab order; contrast.
**Step 8: Commit:** `feat: add site shell and data-driven home page`.

**Acceptance:**
- `pnpm build` succeeds.
- Home renders real counts from `data/snapshot.json`.
- `url()` works with `BASE_PATH=/` and `/repo`.
- No client JS on the home page except Astro's minimal runtime.
- Lighthouse accessibility ≥ 95.

---

## Task S08: Models directory, detail, and compare

**Slice file:** [`S08-models-and-compare.md`](../slices/S08-models-and-compare.md)

**Files:**
- Create: `apps/web/src/components/ModelTable.tsx`
- Create: `apps/web/src/components/PriceTable.astro`, `ScoreBar.astro`, `Provenance.astro`,
  `FreeTimeline.astro`
- Create: `apps/web/src/pages/models/index.astro`
- Create: `apps/web/src/pages/models/[id].astro`
- Create: `apps/web/src/pages/compare.astro`
- Create: `apps/web/test/filters.test.ts`

**Step 1: Write failing filter/URL tests.**

```ts
it("parses filters from a query string", () => {
  expect(parseFilters("?free=limited-time&sort=cost&maxPrice=1")).toMatchObject({
    free: "limited-time", sort: "cost", maxPrice: 1,
  });
});
```

**Step 2: Implement `ModelTable.tsx`.** Client island. Props: serialized rows with key, name,
provider, free kind, context, price, cost profiles, tiers. Controls: search, free kind, provider,
min context, max cost, sort. Sync to URL with `history.replaceState`. Accessible table with caption,
scope, and an empty state. No data fetching.
**Step 3: Build `/models`.** Server-render the page with the island and SEO copy.
**Step 4: Build `/models/[id]`.** `getStaticPaths` from snapshot. Sections: header + badges; pricing
table; modeled cost per task; SWE-bench measured cost when present; benchmark table with source and
date; use-case bars with confidence; free timeline; privacy; sources and conflicts; related models.
**Step 5: Build `/compare`.** Read `?models=a,b,c`; render up to four columns; a picker adds/removes
via URL; difference highlighting for price/context/score.
**Step 6: Verify** every model page builds; check a free model, a paid model, a Go model, and a
model with missing benchmarks.
**Step 7: Commit:** `feat: add model directory, detail pages, and comparison`.

**Acceptance:**
- All models have static pages.
- Filters and compare state survive reload via URL.
- Missing data renders "not measured" or "insufficient data", never `NaN` or `undefined`.
- Table is keyboard accessible and works at 360 px.
- No runtime fetch.

---

## Task S09: Changes, methodology, health, and RSS

**Slice file:** [`S09-changes-methodology-health-rss.md`](../slices/S09-changes-methodology-health-rss.md)

**Files:**
- Create: `apps/web/src/pages/changes.astro`
- Create: `apps/web/src/pages/methodology.astro`
- Create: `apps/web/src/pages/health.astro`
- Create: `apps/web/src/pages/feed.xml.ts`
- Create: `apps/web/src/lib/feed.ts`
- Create: `apps/web/test/feed.test.ts`

**Step 1: Write the failing feed test.**

```ts
it("escapes XML and emits absolute links", () => {
  const xml = buildFeed(events, "https://example.github.io/repo");
  expect(xml).toContain("<link>https://example.github.io/repo/models/opencode/example</link>");
  expect(xml).not.toContain("<script>");
});
```

**Step 2: Build `/changes`.** Group events by date, filter by type, link to model pages. Show
free starts/ends first.
**Step 3: Build `/methodology`.** Formulas, profile table, weights table, tier thresholds,
confidence, source list with URLs and dates, "what we do not measure" section.
**Step 4: Build `/health`.** Source status table, counts, last success, stale flags, unmatched
benchmark names, conflicts.
**Step 5: Build `feed.xml.ts`.** RSS 2.0, last 100 events, absolute links, XML escaping, correct
`Content-Type`. Use `@astrojs/sitemap` for `sitemap-index.xml`.
**Step 6: Commit:** `feat: add change log, methodology, health, and rss`.

**Acceptance:**
- `/feed.xml` parses as XML and passes a feed validator.
- Changes page handles zero events.
- Health page shows at least one unmatched benchmark name.
- Methodology numbers match the code constants.

---

## Task S10: CI/CD, GitHub Pages, and ntfy

**Slice file:** [`S10-cicd-pages-ntfy.md`](../slices/S10-cicd-pages-ntfy.md)

**Files:**
- Create: `.github/workflows/ingest.yml`
- Create: `packages/notify/src/ntfy.ts`
- Create: `packages/notify/src/state.ts`
- Create: `packages/notify/src/run.ts`
- Create: `packages/notify/test/ntfy.test.ts`
- Create: `data/notify-state.json`
- Modify: `.github/workflows/ci.yml`

**Step 1: Write the failing ntfy test.**

```ts
it("sends one summary and records sent event ids", async () => {
  const calls: Request[] = [];
  const state = await notify({
    events: [freeStarted("a"), freeStarted("b")],
    state: { sent: [] },
    topic: "test",
    fetch: async (req) => { calls.push(req as Request); return new Response("ok"); },
  });
  expect(calls).toHaveLength(1);
  expect(await calls[0].text()).toContain("2 new free models");
  expect(state.sent).toHaveLength(2);
});
```

**Step 2: Implement `ntfy.ts`.** POST to `https://ntfy.sh/${topic}` with `Title`, `Tags`, `Click`,
`Priority`. One summary per run. Separate high-priority source-failure alert.
**Step 3: Implement `state.ts`.** Read/write `data/notify-state.json`, keep the last 500 sent IDs.
**Step 4: Implement `run.ts`.** Filter unsent events; if none, exit 0 without sending. `--dry-run`
prints the payload.
**Step 5: Write `ingest.yml`.**

- Triggers: `schedule: 0 13 * * *`, `workflow_dispatch`.
- Permissions: contents write, pages write, id-token write.
- Concurrency: `pages`, `cancel-in-progress: false`.
- Steps: checkout, setup node/pnpm, install, ingest, score, validate, commit data if changed,
  configure pages, build with `SITE_URL`/`BASE_PATH`, upload artifact, deploy, notify.
- `NTFY_TOPIC` secret; optional `AA_API_KEY`.
- Commit message includes `[skip ci]`.

**Step 6: Test with `act` or a manual dispatch.** Verify the Pages URL, the feed, and one ntfy
message. Verify a no-change run sends nothing.
**Step 7: Commit:** `ci: add daily ingest, pages deploy, and ntfy notifications`.

**Acceptance:**
- CI is green on `main`.
- Manual dispatch deploys successfully.
- Data commit appears only when data changes.
- ntfy receives exactly one summary.
- A failed optional source does not block deploy; a failed required source does.
- Secrets are documented, never committed.

---

## Task S11: Docs, accessibility, and launch

**Slice file:** [`S11-docs-a11y-launch.md`](../slices/S11-docs-a11y-launch.md)

**Files:**
- Modify: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/sources.md`
- Create: `docs/launch-checklist.md`
- Modify: any UI files for a11y fixes

**Steps:**

1. Write `README.md`: what it is, screenshot placeholder, live URL, data sources, local setup,
   scripts, architecture summary, deployment, environment variables.
2. Write `CONTRIBUTING.md`: slice workflow, branch naming, test gate, schema-change rule,
   data-file ownership.
3. Write `docs/sources.md`: URLs, cadence, fields, failure policy, legal notes.
4. Write `docs/launch-checklist.md`: public repo, Pages enabled, secrets, first ingest, feed,
   ntfy, Lighthouse, mobile, link check.
5. Run an accessibility pass: keyboard only, 200% zoom, contrast, reduced motion, table captions.
6. Run a performance pass: no unused client JS, no external fonts, image dimensions, cache headers.
7. Verify all internal links with a small script or `astro check`.
8. Commit: `docs: add project docs and launch checklist`.

**Acceptance:**
- A new contributor can go from clone to running site using only the README.
- Every slice in the tracker is `done` or explicitly deferred.
- Lighthouse ≥ 95 for performance, accessibility, best practices, SEO on `/` and `/models`.
- No broken internal links.
- The live site shows current data and the feed updates.

---

## Final verification

```bash
export PATH="$HOME/.local/share/pnpm:$PATH"
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm validate:data
pnpm build
```

Expected: all exit 0. Then open `apps/web/dist/index.html` via a static server and spot-check:

- Home shows the current free count.
- A free model page shows the free kind, caveats, and a $0 cost.
- A paid model page shows modeled cost per task and benchmark provenance.
- A Go model page shows the effective subscription cost.
- `/changes` shows at least one event after a simulated diff.
- `/feed.xml` is valid XML.
- `/health` lists source status and unmatched benchmarks.

## Handoff

After S11, the project is ready for v2 work: the eval harness, local usage telemetry, and external
providers. Those are intentionally out of scope here. Do not add them opportunistically; open a new
design slice instead.

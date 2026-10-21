# S01 — Shared contracts and fixtures

> **Status:** todo · **Depends on:** S00 · **Blocks:** S02–S09 · **Effort:** ~1 day
> **Owner:** — · **Branch:** `slice/S01-shared-contracts`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §7–§10 first.

## Why this slice exists

Every pipeline stage and every page speaks the same data language. This slice defines that language
once, with runtime validation, so bad data fails at the boundary instead of rendering as `undefined`
on the site.

## Goal

- Zod schemas and inferred TypeScript types for snapshots, benchmarks, scores, and events.
  Include the file wrappers used on disk: `Snapshot`, `BenchmarksFile`, `ScoresFile`, and
  `ChangeEvent` (JSONL line).
- Shared constants: cost profiles, use-case weights, tier thresholds.
- Stable ID helpers: `modelKey`, `slugify`, `eventId`.
- Realistic fixtures for three model types: free, paid, and Go subscription.
- A data validator that checks files if present and enforces cross-file invariants.
- A schema freeze after merge.

## Non-goals

- No fetching, normalization, scoring, or UI.
- No external-provider types beyond `ProviderId`; v1 is `opencode` and `opencode-go`.
- No database or ORM.

## Inputs and contracts

This slice exports from `@omg/shared`:

```ts
export * from "./schema";
export * from "./constants";
export * from "./ids";
```

The design §7 types are the contract. Implement them literally; do not invent field names.

Important invariants:

- `ModelRecord.key === `${provider}/${id}``.
- Prices are non-negative numbers, USD per 1M tokens.
- `pricing.pricingKnown` may be `false` when no source publishes a price; consumers must show
  "unknown" rather than `$0`.
- `cachedInputTokens` is a subset of `inputTokens` (enforced by the cost layer, not the schema).
- A model has at least one `SourceRef`.
- `ChangeEvent.id === `${type}:${modelKey}:${at.slice(0, 10)}``.
- `BenchmarkResult.modelKey` is optional; unresolved results are allowed but must have
  `match: "unmatched"`.
- `BenchmarkResult.meta` is optional and only for supplemental source fields; the primary metric
  stays in `value`.
- `ScoreRecord.useCases` keys are the four use cases, but may be missing for unrated models.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `packages/shared/src/schema.ts` | Zod schemas + inferred types |
| Create | `packages/shared/src/constants.ts` | Profiles, weights, tiers |
| Create | `packages/shared/src/ids.ts` | ID and slug helpers |
| Create | `packages/shared/src/index.ts` | Re-exports |
| Create | `packages/shared/test/schema.test.ts` | Accept/reject cases |
| Create | `packages/shared/test/ids.test.ts` | Determinism |
| Create | `packages/shared/test/fixtures/snapshot.sample.json` | 3 models |
| Create | `packages/shared/test/fixtures/benchmarks.sample.json` | 2 resolved, 1 unmatched |
| Create | `packages/shared/test/fixtures/events.sample.jsonl` | 3 event types |
| Modify | `scripts/validate-data.ts` | Replace the S00 no-op |

## Implementation steps

### 1. Write failing schema tests

```ts
import { describe, expect, it } from "vitest";
import { SnapshotSchema } from "../src/schema";
import snapshot from "./fixtures/snapshot.sample.json";

describe("SnapshotSchema", () => {
  it("accepts the fixture", () => {
    expect(() => SnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("rejects negative prices", () => {
    const bad = structuredClone(snapshot);
    bad.models[0].pricing.input = -1;
    expect(() => SnapshotSchema.parse(bad)).toThrow(/nonnegative|greater than or equal/i);
  });

  it("rejects duplicate keys", () => {
    const bad = structuredClone(snapshot);
    bad.models.push(structuredClone(bad.models[0]));
    expect(() => SnapshotSchema.parse(bad)).toThrow(/duplicate/i);
  });

  it("rejects a key that does not match provider/id", () => {
    const bad = structuredClone(snapshot);
    bad.models[0].key = "opencode/wrong";
    expect(() => SnapshotSchema.parse(bad)).toThrow(/key/i);
  });
});
```

Run: `pnpm vitest packages/shared/test/schema.test.ts`. Expected: module not found.

### 2. Implement `schema.ts`

Follow design §7. Use `z.enum` for unions, `z.number().nonnegative()` for prices, `z.string().datetime()`
for timestamps, and `.strict()` on objects where extra fields would hide a producer bug.

Add cross-field validation with `.superRefine()` on `SnapshotSchema`:

```ts
const seen = new Set<string>();
for (const m of snapshot.models) {
  if (seen.has(m.key)) ctx.addIssue({ code: "custom", message: `duplicate model key: ${m.key}` });
  seen.add(m.key);
  if (m.key !== `${m.provider}/${m.id}`) {
    ctx.addIssue({ code: "custom", message: `model key mismatch: ${m.key}` });
  }
  if (m.sources.length === 0) {
    ctx.addIssue({ code: "custom", message: `model has no sources: ${m.key}` });
  }
}
```

Export `SCHEMA_VERSION = 1 as const`.

### 3. Implement `constants.ts`

```ts
export const COST_PROFILES = {
  "quick-edit": { label: "Quick edit", inputTokens: 12_000, cachedInputTokens: 8_000, outputTokens: 1_500 },
  "agentic-pr": { label: "Agentic PR", inputTokens: 120_000, cachedInputTokens: 90_000, outputTokens: 8_000 },
  "long-context": { label: "Long-context task", inputTokens: 400_000, cachedInputTokens: 250_000, outputTokens: 6_000 },
} as const;

export type CostProfileId = keyof typeof COST_PROFILES;

export const USE_CASE_WEIGHTS = {
  // Post-v1 calibration (S12): AA Coding Index added; see S12-agentic-coverage.md.
  "agentic-coding": { "swe-bench-verified": 0.3, "terminal-bench": 0.1, "lmarena-agent": 0.2, "aider-polyglot": 0.1, "artificial-analysis": 0.3 },
  "everyday-edits": { "swe-bench-verified": 0.15, "lmarena-webdev": 0.25, "lmarena-text": 0.15, "aider-polyglot": 0.25, "artificial-analysis": 0.2 },
  "frontend": { "lmarena-webdev": 0.6, "lmarena-text": 0.2, "aider-polyglot": 0.2 },
  "long-context": { "swe-bench-verified": 0.3, "lmarena-text": 0.3, "lmarena-document": 0.4 },
} as const;

export type UseCaseId = keyof typeof USE_CASE_WEIGHTS;

export const TIER_THRESHOLDS = [
  { tier: "S", min: 90 },
  { tier: "A", min: 75 },
  { tier: "B", min: 50 },
  { tier: "C", min: 25 },
  { tier: "D", min: 0 },
] as const;

export const FRESHNESS = [
  { maxDays: 30, factor: 1.0 },
  { maxDays: 90, factor: 0.8 },
  { maxDays: 180, factor: 0.5 },
  { maxDays: Infinity, factor: 0.2 },
] as const;
```

### 4. Implement `ids.ts`

```ts
export function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`;
}

export function slugify(key: string): string {
  return key
    .replace("/", "--")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function eventId(type: string, key: string, at: string): string {
  return `${type}:${key}:${at.slice(0, 10)}`;
}

export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(preview|free|instruct|stealth|contributor|unlimited|experimental)\b/g, " ")
    .replace(/\b(20\d{2}[-/]?\d{2}[-/]?\d{2})\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
```

Tests: idempotent, lowercase, stable across calls, handles dots, slashes, and suffixes.

### 5. Fixtures

`snapshot.sample.json`:

- `opencode/deepseek-v4.1-flash-free`: `open-free`, $0, 200k context, flags
  `["zero-retention"]`, one source, availability `live`.
- `opencode/kimi-k3`: `paid`, input 3, output 15, cacheRead 0.3, 256k context, tiers omitted.
- `opencode-go/glm-5.3`: `subscription-included`, input 1.4, output 4.4, cacheRead 0.26,
  `subscription: { plan: "go", monthlyUsd: 10, includedUsageUsd: 15 }`.

Give each a `firstSeen`, `lastSeen`, `sources`, and empty `conflicts`.

`benchmarks.sample.json`: two results with `modelKey` set and `match: "exact"`, one with
`match: "unmatched"` and no `modelKey`.

`events.sample.jsonl`: `model_added`, `free_started`, `free_ended`, each with deterministic IDs.

### 6. Implement `scripts/validate-data.ts`

- Read `data/snapshot.json`, `data/benchmarks.json`, `data/scores.json`, `data/events.jsonl` if
  they exist.
- Parse each with the matching schema.
- Cross-file checks:
  - Every `scores[].modelKey` exists in the snapshot.
  - Every `benchmarks.results[].modelKey`, when present, exists in the snapshot.
  - Every event's `modelKey` exists, except `source_failed`.
  - Every event ID is unique.
  - No model has `pricing.input < 0` or `pricing.output < 0`.
- Print a one-line summary per file and `data valid` on success.
- Exit 1 with a readable error on the first failure.
- If no data files exist, print `no data files yet` and exit 0 (keeps S00 CI green).

### 7. Verify

```bash
pnpm vitest packages/shared
pnpm typecheck
pnpm validate:data
```

### 8. Commit

`feat: add shared schemas, constants, fixtures, and data validation`

## Acceptance checklist

- [ ] All schemas parse the fixtures.
- [ ] Duplicate keys, negative prices, key mismatches, and missing sources are rejected.
- [ ] `constants.ts` matches design §8–§9 exactly.
- [ ] `eventId` is stable and includes the date.
- [ ] `validate-data.ts` exits 0 with no data files and with valid fixtures.
- [ ] `validate-data.ts` exits 1 on a deliberately corrupted snapshot.
- [ ] No runtime dependency beyond `zod` in `@omg/shared`.
- [ ] A "Schema freeze" note is added to the tracker.

## Handoff notes

- **Schema freeze:** after this merges, S02–S09 must not change field names or shapes without a
  tracker note and a version bump.
- If you find a missing field while implementing a later slice, add it now, not later.
- Keep fixtures small. They are for tests, not for the site. S07 uses `data/`, not these fixtures.
- The `Conflict.values` field is intentionally `unknown`; producers decide what to put there.

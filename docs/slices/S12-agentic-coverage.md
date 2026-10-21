# S12 — Agentic coverage calibration

> **Status:** in-progress · **Depends on:** S06, S11 · **Effort:** ~0.5 day
> **Owner:** CJ Rutherford · **Branch:** `slice/S12-agentic-coverage`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §9 and the
> [methodology page](../../apps/web/src/pages/methodology.astro) first.

## Why this slice exists

The v1 composite could not rate any model for agentic coding. The confidence formula used the
**oldest** benchmark date in a use case. Every available SWE-bench and Aider row was over 180 days
old, so even a model with fresh LMArena and Artificial Analysis evidence was capped at 0.16
confidence. The 0.30 tier gate was unreachable.

This slice fixes the calibration, not the presentation. It adds a fresh public coding signal that is
already ingested, and makes each benchmark's freshness affect only its own contribution.

## Goal

- Agentic-coding tiers are produced for models with enough fresh evidence.
- Everyday-edits tiers are produced for models with enough fresh evidence.
- A stale benchmark no longer vetoes fresh evidence in the same use case.
- The public methodology explains the new weights and confidence formula.
- No schema change, no new source adapter, no UI redesign.

## Non-goals

- No own eval harness, telemetry, or private benchmarks. That is v2.
- No new benchmark source or Terminal-Bench adapter.
- No overall score.
- No change to the free labels, cost model, or source cadence.
- No threshold change: coverage still requires 0.5 available weight and confidence still requires
  0.30.

## Decision

Artificial Analysis publishes coding, agentic, and intelligence indices. The agentic index is
semantically closest to agentic coding, but it covers fewer matched models than the coding index.
The coding index is a broad public coding composite and is already committed for more models. This
slice therefore:

1. Adds `artificial-analysis` (AA Coding Index) to the **agentic-coding** and **everyday-edits**
   composites.
2. Keeps the AA Agentic and Intelligence indices supplemental and visible on model pages.
3. Rebalances agentic and everyday weights so the AA coding signal is meaningful without dominating
   the benchmark-specific sources.
4. Replaces "freshness of the oldest benchmark" with "sum of each benchmark's weight times its own
   freshness."

The AA key remains optional. Without it, the AA rows are absent, coverage and confidence are lower,
and the affected models stay `unrated` rather than receiving invented scores.

### Weights

| Use case | SWE-bench Verified | Terminal-Bench | LMArena agent | LMArena webdev | LMArena text | LMArena document | Aider polyglot | AA Coding |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Agentic coding | 0.30 | 0.10 | 0.20 | — | — | — | 0.10 | 0.30 |
| Everyday edits | 0.15 | — | — | 0.25 | 0.15 | — | 0.25 | 0.20 |
| Frontend | — | — | — | 0.60 | 0.20 | — | 0.20 | — |
| Long context | 0.30 | — | — | — | 0.30 | 0.40 | — | — |

Each row still sums to 1.00.

### Confidence

```
confidence = Σ(weight × freshness(benchmark date))
```

The score remains `Σ(weight × percentile) / Σ(available weight)`. A missing benchmark reduces
available weight. A stale benchmark reduces only its own freshness contribution. Both the coverage
gate and the confidence gate still apply.

## Inputs and contracts

- `data/snapshot.json`, `data/benchmarks.json`.
- `USE_CASE_WEIGHTS` and `FRESHNESS` from `@omg/shared`.
- Output `data/scores.json` remains schema version 1.
- No new `BenchmarkId`, `SourceStatusId`, or schema field.

## Files

| Action | Path | Notes |
|---|---|---|
| Modify | `packages/shared/src/constants.ts` | Agentic and everyday weights |
| Modify | `packages/shared/test/constants.test.ts` | Lock the calibrated weights |
| Modify | `packages/scoring/src/score.ts` | Per-benchmark freshness |
| Modify | `packages/scoring/test/score.test.ts` | Fresh/stale mix and AA coverage |
| Modify | `apps/web/src/pages/methodology.astro` | Formula, freshness text, AA note |
| Modify | `apps/web/src/lib/methodology.ts` | Version 1.1 changelog |
| Modify | `apps/web/src/pages/index.astro` | AA description |
| Modify | `apps/web/test/health.test.ts` | New rated/coverage counts |
| Regenerate | `data/scores.json` | `pnpm score --no-fetch` |
| Modify | `README.md`, `docs/sources.md`, `docs/setup-secrets.md` | AA now contributes to two composites |
| Modify | `docs/plans/2026-10-19-opencode-model-guide-design.md` | Mark the v1 calibration superseded |
| Modify | `docs/slices/README.md` | Claim and record S12 |

## Implementation steps

1. Write a failing scoring test: a model with fresh LMArena agent + fresh AA coding and a stale
   SWE-bench row must be rated, with confidence equal to the sum of each benchmark's weighted
   freshness.
2. Run `pnpm vitest packages/scoring/test/score.test.ts` and confirm it fails against the oldest-date
   formula.
3. Change `useCaseScores` to accumulate `confidence` per benchmark instead of tracking one oldest
   date.
4. Update the agentic and everyday weights. Update constants tests to lock the new table.
5. Update the full-coverage, stale-data, and shared-evidence scoring tests for the new weights.
6. Update methodology version/changelog and the public explanation.
7. Regenerate scores with `pnpm tsx packages/scoring/src/run.ts --no-fetch`.
8. Update health counts and run the full gate.

## Acceptance checklist

- [ ] Agentic-coding has at least one rated model on the committed data.
- [ ] Everyday-edits has at least one rated model on the committed data.
- [ ] A stale benchmark no longer forces `unrated` when the remaining available weight and freshness
      clear both gates.
- [ ] Missing benchmarks still lower coverage and confidence; no benchmark is filled with zero.
- [ ] `USE_CASE_WEIGHTS` rows still sum to 1.00.
- [ ] No schema, source ID, or cost-model change.
- [ ] `data/scores.json` validates and contains no `NaN` or `Infinity`.
- [ ] Methodology version is 1.1 and explains AA's role and per-benchmark freshness.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm validate:data`, and `pnpm build` pass.
- [ ] Internal link check passes on the production-base build.

## Verification commands

```bash
pnpm typecheck
pnpm test
pnpm validate:data
pnpm build
BASE_PATH=/opencode-model-guide pnpm tsx scripts/check-links.ts
```

## Handoff notes

- The AA Coding Index is used for agentic coding because it has broader matched coverage than the AA
  Agentic Index. The agentic index remains supplemental; do not silently add both and double-count
  the same publisher.
- If AA is unavailable, agentic and everyday coverage drops. That is expected and honest. Do not
  lower the confidence gate to compensate.
- This is a methodology change, not a v2 feature slice. The v2 eval harness still requires its own
  design slice.

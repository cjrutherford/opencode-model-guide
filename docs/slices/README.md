# Slice Tracker

This is the single source of truth for implementation status. Every slice is a self-contained,
independently pickable unit of work. Pick one up, read its file, claim it here, and ship it.

- **Design:** [`docs/plans/2026-10-19-opencode-model-guide-design.md`](../plans/2026-10-19-opencode-model-guide-design.md)
- **Ordered plan:** [`docs/plans/2026-10-19-opencode-model-guide-implementation.md`](../plans/2026-10-19-opencode-model-guide-implementation.md)
- **Template:** [`SLICE_TEMPLATE.md`](./SLICE_TEMPLATE.md)

## Status legend

| Status | Meaning |
|---|---|
| `todo` | Not started; safe to claim |
| `in-progress` | Someone is working on it; check the owner/branch columns |
| `blocked` | Waiting on a dependency or decision; see notes |
| `review` | PR open and awaiting review |
| `done` | Merged and verified |
| `deferred` | Intentionally out of v1; do not start without a design update |

## Slices

| ID | Slice | Depends on | Status | Owner | Branch | PR | Notes |
|---|---|---|---|---|---|---|---|
| S00 | [Repository foundation and CI](./S00-repo-foundation.md) | — | `done` | CJ Rutherford | `slice/S00-repo-foundation` | [#1](https://github.com/cjrutherford/opencode-model-guide/pull/1) | Merged 2026-10-19; CI green |
| S01 | [Shared contracts and fixtures](./S01-shared-contracts.md) | S00 | `done` | CJ Rutherford | `slice/S01-shared-contracts` | [#2](https://github.com/cjrutherford/opencode-model-guide/pull/2) | Merged 2026-10-19; schema v1 frozen |
| S02 | [Catalog ingest](./S02-catalog-ingest.md) | S01 | `done` | CJ Rutherford | `slice/S02-catalog-ingest` | [#3](https://github.com/cjrutherford/opencode-model-guide/pull/3) | Merged 2026-10-19; 161 models in `data/snapshot.json` |
| S03 | [Free classification and docs parsing](./S03-free-classification.md) | S01, S02 | `done` | CJ Rutherford | `slice/S03-free-classification` | [#4](https://github.com/cjrutherford/opencode-model-guide/pull/4) | Merged in `678684e`; local CI parity green |
| S04 | [Change detection and event log](./S04-change-detection.md) | S02, S03 | `done` | CJ Rutherford | `slice/S04-change-detection` | [#5](https://github.com/cjrutherford/opencode-model-guide/pull/5) | Merged in `1b8f9d5`; CI green; 138 tests |
| S05 | [Benchmarks and name resolution](./S05-benchmarks.md) | S01 | `done` | CJ Rutherford | `slice/S05-benchmarks` | [#6](https://github.com/cjrutherford/opencode-model-guide/pull/6) | Merged in `38838ad`; 99 model keys resolved; 1,041 results |
| S06 | [Cost model and scoring](./S06-cost-and-scoring.md) | S01, S05 | `done` | CJ Rutherford | `slice/S06-cost-and-scoring` | [#7](https://github.com/cjrutherford/opencode-model-guide/pull/7) | Merged in `225e491`; 163 scores; 51 free; 26 Go |
| S07 | [Web shell and home](./S07-web-shell.md) | S00, S01 | `done` | CJ Rutherford | `slice/S07-web-shell` | [#8](https://github.com/cjrutherford/opencode-model-guide/pull/8) | Merged in `9f751a5`; shell + home; 13 live free |
| S08 | [Models, detail, and compare](./S08-models-and-compare.md) | S07, S02, S06 | `done` | CJ Rutherford | `slice/S08-models-compare` | [#9](https://github.com/cjrutherford/opencode-model-guide/pull/9) | Merged in `25cc387`; 163 detail pages; URL filters; 4-model compare; 233 tests |
| S09 | [Changes, methodology, health, RSS](./S09-changes-methodology-health-rss.md) | S07, S04, S05, S06 | `done` | CJ Rutherford | `slice/S09-changes-methodology-health-rss` | [#10](https://github.com/cjrutherford/opencode-model-guide/pull/10) | 169 pages; 247 tests; feed, health, methodology, changes |
| S10 | [CI/CD, Pages, ntfy](./S10-cicd-pages-ntfy.md) | S02–S06, S08, S09 | `done` | CJ Rutherford | `slice/S10-cicd-pages-ntfy` | [#11](https://github.com/cjrutherford/opencode-model-guide/pull/11) | Pages live; daily ingest; 267 tests; ntfy state |
| S11 | [Docs, accessibility, launch](./S11-docs-a11y-launch.md) | all | `review` | CJ Rutherford | `slice/S11-docs-a11y-launch` | [#13](https://github.com/cjrutherford/opencode-model-guide/pull/13) | Docs, link check, a11y; 280 tests; final live checks after merge |

## Critical path

```
S00 → S01 → S02 → S03 → S04 → S09 → S10 → S11
              └→ S05 → S06 → S08 ↗
S00 → S01 → S07 ───────────────↗
```

The fastest path to a usable site is **S00 → S01 → S02 → S07 → S08**, with the home and model
pages reading real catalog data. Notifications require S03/S04/S09/S10.

## Parallel groups

| Group | Slices | Notes |
|---|---|---|
| A | S00 | Nothing else can start |
| B | S01 | Nothing else can start |
| C | S02, S05, S07 | Independent packages; agree on fixture paths |
| D | S03, S04, S06 | S03/S04 share `packages/ingest/src/run.ts`; S06 can use fixture prices |
| E | S08, S09 | Both consume S07; different page files |
| F | S10 | Wiring only; wait for data + feed |
| G | S11 | Final pass |

## File ownership matrix

Use this to avoid merge conflicts. If you must edit a file owned by another slice, keep the diff
minimal and note it in the PR.

| Path | Owner | Notes |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts` | S00 | Coordinate before changing scripts |
| `.github/workflows/ci.yml` | S00 | S10 may extend, not replace |
| `.github/workflows/ingest.yml` | S10 | — |
| `packages/shared/**` | S01 | Schema freeze after merge |
| `packages/ingest/src/sources/modelsDev.ts`, `opencodeModels.ts`, `normalize.ts`, `snapshot.ts` | S02 | — |
| `packages/ingest/src/sources/opencodeDocs.ts`, `freeClassify.ts` | S03 | — |
| `packages/ingest/src/diff.ts`, `history.ts` | S04 | — |
| `packages/ingest/src/run.ts` | S02 | S03/S04 add one stage call each; rebase carefully |
| `packages/scoring/src/benchmarks/**`, `aliases.ts`, `resolve.ts` | S05 | — |
| `packages/scoring/src/cost.ts`, `percentile.ts`, `score.ts`, `run.ts` | S06 | — |
| `packages/notify/**` | S10 | — |
| `data/snapshot.json` | S02 (S03 enriches) | Generated; commit after ingest |
| `data/benchmarks.json` | S05 | Generated |
| `data/scores.json` | S06 | Generated |
| `data/events.jsonl`, `data/history/**` | S04 | Append-only |
| `data/aliases.json` | S05 | Manual edits welcome |
| `data/notify-state.json` | S10 | Generated |
| `apps/web/src/layouts/**`, `components/shell/**`, `styles/**`, `pages/index.astro` | S07 | — |
| `apps/web/src/pages/models/**`, `pages/compare.astro`, `components/ModelTable.tsx` | S08 | — |
| `apps/web/src/pages/changes.astro`, `methodology.astro`, `health.astro`, `pages/feed.xml.ts`, `lib/feed.ts` | S09 | — |
| `README.md`, `CONTRIBUTING.md`, `docs/sources.md`, `docs/launch-checklist.md` | S11 | — |
| `docs/setup-secrets.md` | S10 | Owner setup; update when secrets change |

## Schema freeze

**Frozen when S01 merges.** `packages/shared/src/schema.ts` is v1, `SCHEMA_VERSION = 1`. The design
did not define `SourceStatus`; S01 fixes it as
`{ id, url, ok, status: "ok"|"failed"|"skipped", fetchedAt, durationMs?, itemCount?, error?, reason?, required? }`
with `ok === (status === "ok")`. A change requires:

1. A note in this tracker under "Schema changes".
2. A `SCHEMA_VERSION` bump if the change is breaking.
3. Updates to fixtures and all producers/consumers in the same PR.
4. Approval from the slice owner most affected.

Rationale: S02–S09 all depend on the same shapes. Silent changes create broken builds and bad data.

## How to claim a slice

1. Check the status is `todo` and the dependencies are `done`.
2. Update the row: status `in-progress`, your name, branch `slice/SXX-short-name`, date in notes.
3. Commit that tracker update on the branch.
4. Read the slice file end to end before coding.
5. Open a PR when the acceptance checklist passes. Update status to `review` and add the PR link.
6. After merge, set status `done` and add a one-line note about anything the next slice should know.

## Definition of done

Every slice must satisfy all of these before `done`:

- [ ] The slice file's acceptance checklist is complete.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm validate:data` passes (when the slice produces or consumes data).
- [ ] `pnpm build` passes (when the slice touches the site).
- [ ] No secrets, tokens, or personal data are committed.
- [ ] The tracker row is updated.
- [ ] A short note is left for the next slice.

## Decisions and setup

| Decision | Value | Needed by | Status |
|---|---|---|---|
| GitHub repo owner/name | `cjrutherford/opencode-model-guide` (public) | S10 | decided |
| Pages URL / `SITE_URL` | `https://cjrutherford.github.io/opencode-model-guide/` | S10 | decided |
| ntfy server | `https://ntfy.sh` | S10 | decided |
| `NTFY_TOPIC` secret | Random, unguessable; generated at setup | S10 | process decided |
| Artificial Analysis key | Free-tier API key; optional; stored as `AA_API_KEY` | S05 | process decided |
| Daily run time | 13:00 UTC | S10 | decided |
| Custom domain | None | S11 | decided |

See [`docs/setup-secrets.md`](../setup-secrets.md) for how to obtain the Artificial Analysis key,
generate the ntfy topic, set both as GitHub repository secrets, verify them, and rotate them.

## Progress log

Append newest first. Keep it short.

| Date | Slice | Note |
|---|---|---|
| 2026-10-20 | S11 | Implementation complete; 280 tests; typecheck, data validation, default and production builds, link check, keyboard/360 px, and Lighthouse pass. PR [#13](https://github.com/cjrutherford/opencode-model-guide/pull/13). |
| 2026-10-20 | — | Fixed missing benchmark evidence for Go/Console twins and the Beam alias; PR [#12](https://github.com/cjrutherford/opencode-model-guide/pull/12) merged (`80ca7ae`). Rated models 78 → 96. |
| 2026-10-20 | S11 | Claimed; branch `slice/S11-docs-a11y-launch` based on `main` (S10 merged). |
| 2026-10-20 | S10 | Merged via PR [#11](https://github.com/cjrutherford/opencode-model-guide/pull/11) (`8e6eb3e`); CI green. First dispatch (run 39499478587) succeeded; Pages live; data commit `257c815` `[skip ci]`; 0 events, no notification. |
| 2026-10-20 | S10 | PR [#11](https://github.com/cjrutherford/opencode-model-guide/pull/11); CI green. 267 tests; typecheck, data validation, build, base-path build, and ntfy dry-run pass. First live dispatch pending. |
| 2026-10-20 | S10 | Implementation complete; 267 tests; typecheck, data validation, build, base-path build, and ntfy dry-run pass. PR and first live dispatch pending. |
| 2026-10-20 | S10 | Claimed; branch `slice/S10-cicd-pages-ntfy` based on `main` (S09 merged). |
| 2026-10-20 | S09 | Merged to `main` (`cef0519`) after PR [#10](https://github.com/cjrutherford/opencode-model-guide/pull/10); CI green. 247 tests; 169 pages; feed, health, methodology, and changes live. Documented exception: inline `/changes` filter script. |
| 2026-10-20 | S09 | PR [#10](https://github.com/cjrutherford/opencode-model-guide/pull/10); CI green. 247 tests; typecheck, data validation, build, base-path build, and browser checks pass. Pending review. |
| 2026-10-20 | S09 | Implementation complete; 247 tests; typecheck, data validation, build, base-path build, and browser checks pass. Pending PR. |
| 2026-10-20 | S09 | Claimed; branch `slice/S09-changes-methodology-health-rss` based on `main` (S08 merged). |
| 2026-10-20 | S08 | Merged to `main` (`25cc387`) after PR [#9](https://github.com/cjrutherford/opencode-model-guide/pull/9); CI green; 233 tests; 163 detail pages. |
| 2026-10-20 | S08 | Models directory, 163 static detail pages, and four-model compare implemented. URL-backed filters/sort, explicit unknown states, postbuild page assertions. 233 tests pass; typecheck, validate, and build pass. PR [#9](https://github.com/cjrutherford/opencode-model-guide/pull/9). |
| 2026-10-20 | S08 | Claimed; branch `slice/S08-models-compare` based on `main` (S07 merged). |
| 2026-10-20 | S07 | Merged to `main` (`9f751a5`) after PR [#8](https://github.com/cjrutherford/opencode-model-guide/pull/8); 215 tests passed. |
| 2026-10-20 | S07 | Web shell and data-driven home implemented: 13 live no-subscription free models, 163 models tracked, light/dark editorial layout, base-path-safe links, validated data layer. 215 tests pass; typecheck, validate, and build pass. |
| 2026-10-20 | S07 | Claimed; branch `slice/S07-web-shell` based on `main` (S06 merged). |
| 2026-10-20 | S06 | Merged to `main` (`225e491`) after PR [#7](https://github.com/cjrutherford/opencode-model-guide/pull/7); 194 tests passed. |
| 2026-10-20 | S05 | Merged to `main` (`38838ad`) after PR [#6](https://github.com/cjrutherford/opencode-model-guide/pull/6); 161 tests passed. |
| 2026-10-20 | S06 | Cost and scoring implemented: 163 score records, 51 free models at $0, 26 Go models with effective cost, no NaN/Infinity. 194 tests pass; validate and build pass. |
| 2026-10-20 | S06 | Claimed; branch `slice/S06-cost-and-scoring` based on `main` (S05 merged). |
| 2026-10-20 | S05 | Benchmarks ingested: 1,041 results, 605 unmatched names, 99 model keys resolved. 161 tests pass; validate and build pass. |
| 2026-10-20 | S05 | Claimed; branch `slice/S05-benchmarks` based on `main` (S04 merged). |
| 2026-10-20 | S04 | Merged to `main` (`1b8f9d5`). CI green; 138 tests; real ingest wrote the baseline history and zero events. |
| 2026-10-20 | S04 | Implemented diff, append-only event log, daily history, and run integration. 138 tests pass; real ingest ran twice with 163 models and 0 events; `data/history/2026-10-20.json` written. PR [#5](https://github.com/cjrutherford/opencode-model-guide/pull/5). |
| 2026-10-20 | S04 | Claimed; branch `slice/S04-change-detection` based on `main` (S03 merged). |
| 2026-10-20 | S03 | Merged to `main` (`678684e`). GitHub Actions could not start due to an account billing lock; local install, typecheck, 101 tests, validate, and build passed. |
| 2026-10-19 | S03 | Implemented docs parsers and classifier. Real ingest: 163 models, 5 sources; 17 limited-time, 34 open-free uncertain, 28 subscription-included; 101 tests pass. PR #4. |
| 2026-10-19 | S03 | Claimed; branch `slice/S03-free-classification` based on `main` (S02 merged). Added `cheerio` and trimmed real docs fixtures. |
| 2026-10-19 | S02 | Merged to `main` (`e96c79a`). `data/snapshot.json` has 161 models; S03 starts from this commit. |
| 2026-10-19 | S02 | Catalog ingest implemented; real snapshot has 161 models (128 + 33), 111 live, 50 zero-price, 23 tiered, 21 over-200k, 1 deprecated-but-live conflict. PR [#3](https://github.com/cjrutherford/opencode-model-guide/pull/3). |
| 2026-10-19 | S02 | Claimed; branch `slice/S02-catalog-ingest` based on `main` (S01 merged). |
| 2026-10-19 | S01 | Merged to `main` (`0abd0ef`). Schema v1 is frozen. S02 starts from this commit. |
| 2026-10-19 | S01 | Schemas, constants, IDs, fixtures, and `validate:data` implemented. PR [#2](https://github.com/cjrutherford/opencode-model-guide/pull/2). Root `typecheck` now also checks `scripts/` via `tsconfig.scripts.json`. |
| 2026-10-19 | S01 | Claimed; branch `slice/S01-shared-contracts` based on `main` (S00 merged). |
| 2026-10-19 | S00 | Merged to `main`. CI green after the GitHub Actions incident. S01 starts from this commit. |
| 2026-10-19 | S00 | Workspace, Astro shell, Vitest, and CI scaffolded; `.secrets` ignored and loaded by CLI scripts. PR [#1](https://github.com/cjrutherford/opencode-model-guide/pull/1). |
| 2026-10-19 | — | Public repo created; Pages enabled with GitHub Actions; workflow default permissions set to write. Secrets not set yet. |
| 2026-10-19 | — | Repo/owner, Pages URL, ntfy server, and AA key process decided. Setup instructions added. |
| 2026-10-19 | — | Design, plan, tracker, and slice files created. No implementation started. |

## Schema changes

| Date | Version | Change | PR |
|---|---|---|---|
| 2026-10-19 | 1 | Initial v1 schema: `Snapshot`, `BenchmarksFile`, `ScoresFile`, `ChangeEvent`, and `SourceStatus` (`id`, `url`, `ok`, `status`, `fetchedAt`, `durationMs?`, `itemCount?`, `error?`, `reason?`, `required?`) | [#2](https://github.com/cjrutherford/opencode-model-guide/pull/2) |

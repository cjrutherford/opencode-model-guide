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
| S00 | [Repository foundation and CI](./S00-repo-foundation.md) | — | `todo` | — | — | — | Critical path |
| S01 | [Shared contracts and fixtures](./S01-shared-contracts.md) | S00 | `todo` | — | — | — | Schema freeze after merge |
| S02 | [Catalog ingest](./S02-catalog-ingest.md) | S01 | `todo` | — | — | — | Owns `data/snapshot.json` |
| S03 | [Free classification and docs parsing](./S03-free-classification.md) | S01, S02 | `todo` | — | — | — | Touches `run.ts`; coordinate with S02/S04 |
| S04 | [Change detection and event log](./S04-change-detection.md) | S02, S03 | `todo` | — | — | — | Bootstraps without notifications |
| S05 | [Benchmarks and name resolution](./S05-benchmarks.md) | S01 | `todo` | — | — | — | Can run parallel with S02 |
| S06 | [Cost model and scoring](./S06-cost-and-scoring.md) | S01, S05 | `todo` | — | — | — | Needs S02 for real prices |
| S07 | [Web shell and home](./S07-web-shell.md) | S00, S01 | `todo` | — | — | — | Can start against fixtures |
| S08 | [Models, detail, and compare](./S08-models-and-compare.md) | S07, S02, S06 | `todo` | — | — | — | Largest UI slice |
| S09 | [Changes, methodology, health, RSS](./S09-changes-methodology-health-rss.md) | S07, S04, S05, S06 | `todo` | — | — | — | Feed depends on events |
| S10 | [CI/CD, Pages, ntfy](./S10-cicd-pages-ntfy.md) | S02–S06, S08, S09 | `todo` | — | — | — | Needs repo + secret |
| S11 | [Docs, accessibility, launch](./S11-docs-a11y-launch.md) | all | `todo` | — | — | — | Final gate |

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

## Schema freeze

After S01 merges, `packages/shared/src/schema.ts` is frozen for v1. A change requires:

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

## Open decisions

| Decision | Default | Needed by | Status |
|---|---|---|---|
| GitHub repo owner/name | `cjrutherford/opencode-model-guide` (proposed) | S10 | open |
| Pages URL / `SITE_URL` | Derived from repo | S10 | open |
| ntfy server | `https://ntfy.sh` | S10 | open |
| `NTFY_TOPIC` secret | Generated by owner | S10 | open |
| Artificial Analysis key | Optional; skip if absent | S05 | open |
| Daily run time | 13:00 UTC | S10 | defaulted |
| Custom domain | None | S11 | defaulted |

## Progress log

Append newest first. Keep it short.

| Date | Slice | Note |
|---|---|---|
| 2026-10-19 | — | Design, plan, tracker, and slice files created. No implementation started. |

## Schema changes

| Date | Version | Change | PR |
|---|---|---|---|
| — | 1 | Initial schema | — |

# S13 — Access-level top picks

> **Status:** done · **Depends on:** S08, S12 · **Effort:** ~0.5 day
> **Owner:** CJ Rutherford · **Branch:** `slice/S13-access-picks`
> **Merged:** `b2855e9` via [#15](https://github.com/cjrutherford/opencode-model-guide/pull/15)

## Why this slice exists

“Top picks right now” currently answers one question: which model has the highest
composite score in each use case. That hides the access decision. A free model, a
Go-included model, and a pay-as-you-go model can have different terms, costs, and
evidence even when they share a benchmark row.

This slice breaks each use-case pick into the three access paths users actually
choose between.

## Goal

- Show one top pick per use case for each access group:
  - **Free now** — `open-free`, `limited-time`, or `trial`.
  - **Included in Go** — `subscription-included`.
  - **Pay as you go** — `paid`.
- Consider live listings only. Deprecated and unlisted models do not win a
  “right now” pick.
- Keep the existing per-use-case score and tier. Access grouping changes only
  which candidates compete.
- Keep gaps visible: if a group has no rated model, show that instead of falling
  back to another group or a zero.
- Show Go’s effective agentic-PR cost when available; otherwise show the list
  cost with an explicit basis label.

## Non-goals

- No methodology or benchmark change.
- No new overall score.
- No change to free classification or price data.
- No ranking across access groups. The three lanes are separate picks.
- No watchlists or saved state.

## Ranking rule

Within each use case and access group, use the same rule as the current top pick:
highest composite percentile, then higher confidence, then model key for a stable
tie-break.

A model may appear in only one lane. The lanes are defined by the listing’s
`free.kind`; provider does not decide the lane. A free Go listing belongs to
**Free now**, while a subscription-included Go listing belongs to **Included in
Go**.

## Files

| Action | Path | Notes |
|---|---|---|
| Modify | `apps/web/src/lib/home.ts` | Group-aware `bestValueByUseCase` |
| Modify | `apps/web/src/pages/index.astro` | Three lanes per use-case card |
| Modify | `apps/web/test/home.test.ts` | Group, live-only, gap, and cost tests |
| Add | `docs/slices/S13-access-level-top-picks.md` | This slice |
| Modify | `docs/slices/README.md` | Claim and status |

## Acceptance checklist

- [ ] Each use case renders Free now, Included in Go, and Pay as you go.
- [ ] Free includes open-free, limited-time, and trial; excludes
      subscription-included and paid.
- [ ] Included in Go and Pay as you go exclude the other access kinds.
- [ ] Deprecated/unlisted models never win a lane.
- [ ] Unrated evidence produces an explicit empty lane.
- [ ] Go picks use `goEffective.agentic-pr` when present; others use
      `profiles.agentic-pr`.
- [ ] Empty lanes do not borrow a score from another group.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm validate:data`, `pnpm build`, and the
      internal link check pass.

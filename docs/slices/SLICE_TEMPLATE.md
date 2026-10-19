# Slice Template

Copy this file when adding a new slice. Keep the section order and remove the instructions in
italics.

```md
# SXX — Title

> **Status:** todo · **Depends on:** SXX · **Blocks:** SXX · **Effort:** ~N days
> **Owner:** — · **Branch:** `slice/SXX-short-name`
>
> Read the [design](...) and the [ordered plan](...) first. This file is authoritative for this
> slice's scope and acceptance.

## Why this slice exists

_One paragraph. What user-facing or pipeline capability does this unlock?_

## Goal

_A short bullet list of what is true when this slice is done._

## Non-goals

_What is explicitly not in this slice, to prevent scope creep._

## Inputs and contracts

_Upstream files, exported functions, data shapes. Link to the design section. State the exact
signatures this slice must provide or consume._

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `...` | ... |
| Modify | `...` | ... |

## Implementation steps

_Numbered, small steps. Use TDD for logic. Include exact commands and expected results._

1. Write a failing test in `...` that asserts `...`.
2. Run `pnpm vitest ...` and confirm it fails for the right reason.
3. Implement `...` with `...`.
4. Run the test and confirm it passes.
5. Commit: `...`.

## Acceptance checklist

- [ ] ...
- [ ] ...

## Verification commands

```bash
pnpm typecheck
pnpm test
pnpm validate:data
pnpm build
```

## Handoff notes

_What the next slice needs to know. Gotchas, intentional omissions, data quirks, follow-ups._
```

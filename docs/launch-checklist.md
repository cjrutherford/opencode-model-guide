# Launch checklist

Owner-facing actions for the public v1 launch. Implementation details live in the slice files and
[`README.md`](../README.md); this page records what is done, what still needs a human, and the
evidence for each claim.

## Owner actions

- [x] Create the public repository and push `main`.
- [x] Enable **Settings → Pages → Source: GitHub Actions**.
- [x] Set the `NTFY_TOPIC` repository secret (random, unguessable).
- [x] Set the optional `AA_API_KEY` repository secret (free-tier key).
- [x] Follow [`docs/setup-secrets.md`](../setup-secrets.md) for generation, verification, and
  rotation.
- [x] Run `ingest-and-deploy` manually once.
- [x] Confirm the live URL, `/feed.xml`, `/health`, and `/methodology` return 200.
- [ ] Subscribe to the feed and confirm one ntfy message on a simulated change. The summary and
  source-alert paths are covered by tests and the dry run; a real push still needs an event.
- [x] Add the live URL and a real screenshot to the README.
- [ ] Tag `v1.0.0` after this slice merges and the live checks pass.

## Verification

- [x] Lighthouse ≥ 95 for performance, accessibility, best practices, and SEO on `/` and `/models`.
  Desktop and mobile runs are recorded below.
- [x] Internal link check passes; `pnpm tsx scripts/check-links.ts` is part of CI after the
  production-base build.
- [x] No broken internal links in the built site.
- [x] Mobile at 360 px: no page-level horizontal scroll on home, models, changes, methodology,
  health, compare, or a model detail page.
- [x] Keyboard-only pass: skip link, header/navigation, mobile menu, model filters, sort buttons,
  free-kind links, compare controls, and footer links.
- [x] Screen-reader semantics: one `h1` per page, hierarchical headings, table captions and scoped
  headers, `aria-sort`, labeled controls, text equivalents for score bars, and text labels for free
  status (never color alone).
- [x] Data commit exists and uses `[skip ci]` (`257c815`).
- [x] Scheduled workflow is enabled and the first manual dispatch succeeded (run `39499478587`).
- [x] The post-launch benchmark-evidence fix is merged (PR
  [#12](https://github.com/cjrutherford/opencode-model-guide/pull/12)).

## Evidence

| Check | Result |
|---|---|
| Site | https://cjrutherford.github.io/opencode-model-guide/ |
| Feed | https://cjrutherford.github.io/opencode-model-guide/feed.xml |
| First workflow dispatch | `39499478587`, success, 7 minutes |
| First data commit | `257c815`, message includes `[skip ci]` |
| Build | 170 pages, 164 model detail pages |
| Data validation | `snapshot.json` 164 models, `benchmarks.json` 1,041 results, `scores.json` 164 records |
| Link check | 3,068 internal links in 170 files, 0 broken |
| Lighthouse, home mobile | 100 performance, 100 accessibility, 100 best practices, 100 SEO |
| Lighthouse, models mobile | 99–100 performance, 100 accessibility, 100 best practices, 100 SEO |
| Lighthouse, home desktop | 100 / 100 / 100 / 100 |
| Lighthouse, models desktop | 100 / 100 / 100 / 100 |
| Lighthouse, detail mobile | 100 / 100 / 100 / 100 |
| Lighthouse, compare mobile | 100 / 100 / 100 / 100 |
| Lighthouse, changes mobile | 100 / 100 / 100 / 100 |
| Bundle | `/models` and `/compare` are the only client islands; home and detail pages ship no client JS |
| Accessibility tree | Skip link first; labeled search/selects; sortable headers expose `aria-sort`; score bars have adjacent numeric text |
| 360 px overflow | `document.documentElement.scrollWidth === 360` on all checked pages; wide tables scroll inside their bordered container |

Lighthouse was run with Chrome headless, Lighthouse 12, default mobile emulation and
`--preset=desktop` for desktop. The local runs used the production base path
`/opencode-model-guide/`.

## Remaining owner actions

1. Subscribe to the feed in a reader and trigger one real change (or use a temporary event in a test
   run) to verify the ntfy summary on a phone.
2. Tag `v1.0.0` after the S11 PR is merged:
   ```bash
   git switch main
   git pull --ff-only
   git tag -a v1.0.0 -m "OpenCode Model Guide v1.0.0"
   git push origin v1.0.0
   ```
3. Re-check free terms monthly. Docs wording changes more often than prices.

## Deferred to v2

These are intentionally out of v1 and need a new design slice, not a drive-by PR:

- Own evaluation harness and local usage telemetry.
- External providers beyond OpenCode Console and Go / Go Plus.
- Terminal-Bench adapter until a stable machine-readable leaderboard exists.
- Historical charts beyond the append-only changes feed.
- A richer name-resolution or model-lineage model if provider listings diverge.

See §15 of the [design](../plans/2026-10-19-opencode-model-guide-design.md) for the full v2 list.

# S11 — Docs, accessibility, and launch

> **Status:** done · **Depends on:** all · **Effort:** ~1 day
> **Owner:** CJ Rutherford · **Branch:** `slice/S11-docs-a11y-launch`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §11–§13 first.

## Why this slice exists

A public guide needs to explain itself, be usable by keyboard and screen reader, survive a link
check, and let the next contributor ship without asking questions. This is the final quality gate,
not a victory lap.

## Goal

- README that takes a new contributor from clone to running site.
- CONTRIBUTING with the slice workflow and schema rule.
- `docs/sources.md` describing every source, cadence, and failure policy.
- `docs/launch-checklist.md` with the remaining owner actions.
- Accessibility and performance passes on the real site.
- Internal link check in CI.
- All tracker rows accurate.

## Non-goals

- No new features.
- No visual redesign unless a11y requires it.
- No v2 work (eval harness, local telemetry, external providers).

## Inputs and contracts

- The live site and the full pipeline.
- `docs/slices/README.md` as the status source.
- All previous slice files for accurate scripts and env vars.

## Files

| Action | Path | Notes |
|---|---|---|
| Modify | `README.md` | Project overview, setup, scripts, deploy |
| Create | `CONTRIBUTING.md` | Slice workflow, tests, schema rule |
| Create | `docs/sources.md` | Source catalog + legal notes |
| Create | `docs/launch-checklist.md` | Owner actions |
| Create | `scripts/check-links.ts` | Internal link check |
| Create | `scripts/check-links.test.ts` | Link parser test |
| Modify | `.github/workflows/ci.yml` | Run link check after build |
| Modify | `docs/slices/README.md` | Final statuses |

## Implementation steps

### 1. Write the README

Sections:

1. **What it is:** one paragraph, live URL, screenshot.
2. **What it tracks:** Console, Go, free kinds, scoring.
3. **Data sources:** link to `docs/sources.md`.
4. **Local development:** Node 22, pnpm 10, the sandbox PATH note, `pnpm install`, `pnpm dev`.
5. **Scripts:** `ingest`, `score`, `notify`, `validate:data`, `test`, `build`.
6. **Architecture:** one diagram, link to the design.
7. **Deployment:** Actions, Pages, secrets, `SITE_URL`/`BASE_PATH`.
8. **Freshness:** daily 13:00 UTC, how to force a run.
9. **Contributing:** link to `CONTRIBUTING.md` and the tracker.
10. **Disclaimer:** not affiliated with OpenCode; prices and terms change.

Use real commands. Do not claim a feature that does not exist.

### 2. Write CONTRIBUTING

- Pick a slice from `docs/slices/README.md`.
- Claim it in the tracker, branch `slice/SXX-short-name`.
- Read the slice file and the design section.
- TDD for logic; fixtures, no network.
- Run the gate: `pnpm typecheck && pnpm test && pnpm validate:data && pnpm build`.
- Schema freeze: no field changes without a tracker note and version bump.
- Data files are generated; do not hand-edit `snapshot.json`, `benchmarks.json`, `scores.json`, or
  `events.jsonl`. `aliases.json` is hand-edited.
- Commit style, PR checklist.

### 3. Write `docs/sources.md`

For each source:

- URL, cadence, fields used, authority, failure policy.
- Terms/legal note:
  - models.dev is an open catalog; keep attribution.
  - LMArena dataset is CC-BY-4.0; attribute.
  - SWE-bench leaderboard is public; cite the harness and date.
  - Aider YAML is public; cite the repo.
  - OpenCode docs are the source for free terms; quote sparingly and link.
- Rate limits and User-Agent policy.
- What to do when a source changes shape.

### 4. Write `docs/launch-checklist.md`

Owner actions:

- [x] Create public GitHub repo, push `main`.
- [x] Enable Pages with source "GitHub Actions".
- [x] Set `NTFY_TOPIC` secret (random, not guessable).
- [x] Optional: set `AA_API_KEY` (free-tier key).
- [x] Follow [`docs/setup-secrets.md`](../setup-secrets.md) for generation, verification, and rotation.
- [x] Run the workflow manually once.
- [x] Confirm the live URL, `/feed.xml`, `/health`, `/methodology`.
- [ ] Subscribe to the feed and confirm one ntfy message on a simulated change.
- [x] Add the live URL to the README.
- [ ] Tag `v1.0.0`.

Verification:

- [x] Lighthouse ≥ 95 on `/` and `/models`.
- [x] No broken internal links.
- [x] Mobile at 360 px.
- [x] Keyboard-only pass.
- [x] Accessibility-tree/screen-reader semantics pass on the model table and detail page.
- [x] Data commit exists and uses `[skip ci]`.
- [x] Scheduled workflow is enabled.

### 5. Implement the link checker

`scripts/check-links.ts`:

- Walk `apps/web/dist/**/*.html`.
- Extract `href` values.
- Ignore `http:`, `https:`, `mailto:`, `tel:`, `#`, and `data:`.
- Resolve relative and root-relative links against the file path and the `BASE_PATH`.
- For each internal link, strip the query/hash and check that a file exists:
  - `/repo/models/foo/` → `dist/models/foo/index.html`
  - `/repo/feed.xml` → `dist/feed.xml`
- Report the source file and target for each miss.
- Exit 1 on any miss.

Test the parser with a small HTML fixture and a temp directory. Add to CI after `pnpm build`:

```yaml
      - run: pnpm tsx scripts/check-links.ts
```

### 6. Accessibility pass

- Keyboard only: skip link, header, table filters, compare selects, footer.
- Focus visible on every interactive element; no `outline: none` without a replacement.
- Table: caption, `scope`, `aria-sort`, row headers where appropriate.
- Free status is not conveyed by color alone; use text.
- Charts/bars have text equivalents (`aria-label` or adjacent numbers).
- Contrast: 4.5:1 body, 3:1 large text and UI.
- 200% zoom: no clipped content.
- `prefers-reduced-motion`: no transitions that ignore it.
- Screen reader: model table headers announce correctly; detail page headings are hierarchical.
- Forms: labels for search and selects; error/empty states are announced.

### 7. Performance pass

- Home and detail pages ship zero client JS.
- `/models` and `/compare` are the only islands. Check the bundle:
  `du -sh apps/web/dist/_astro/*.js`.
- No external fonts, analytics, or third-party scripts.
- Images have dimensions and `alt`.
- Tables render fast with ~160 rows.
- Lighthouse on mobile and desktop.

### 8. Final tracker pass

- Set every completed slice to `done`.
- Add handoff notes for anything deferred.
- Record the live URL and first deploy date.
- Add a "v2 candidates" note pointing to the design §15.

### 9. Commit

`docs: add project docs, link check, and launch checklist`

## Acceptance checklist

- [x] README is accurate and complete for a new contributor.
- [x] CONTRIBUTING covers the slice workflow and schema freeze.
- [x] `docs/sources.md` lists every source with cadence and failure policy.
- [x] Launch checklist is complete and owner-actionable.
- [x] Internal link check passes and runs in CI.
- [x] Lighthouse ≥ 95 for performance, accessibility, best practices, SEO on `/` and `/models`.
- [x] Keyboard-only and accessibility-tree/screen-reader semantics passes complete.
- [x] No horizontal scroll at 360 px.
- [x] All tracker rows are accurate.
- [x] No v2 feature was added opportunistically.

## Result

Merged in PR [#13](https://github.com/cjrutherford/opencode-model-guide/pull/13) (`0283123`) and
deployed by run `39517351496`. The live site passes Lighthouse 100/100/100/100 on `/` and `/models`,
the link check covers 3,068 internal links, and all tracker rows are current. `v1.0.0` tagging and a
real ntfy delivery remain owner actions in the launch checklist.

## Handoff notes

- Live site: <https://cjrutherford.github.io/opencode-model-guide/>. First deploy: run
  `39499478587` on 2026-10-20.
- The project is now in maintenance mode. New model sources, eval harnesses, and external providers
  need a new design slice, not a drive-by PR.
- Keep the daily data commit. It is what keeps scheduled workflows alive.
- Re-check free terms monthly; docs wording changes more often than prices.
- If a source breaks, fix the adapter and add a fixture from the new markup. Do not disable the
  source silently.
- Console and Go listings of the same model share benchmark evidence by model ID. Free terms,
  availability, and costs remain per listing.
- Agentic and everyday-edit tiers are still often withheld because SWE-bench, Aider, and
  Terminal-Bench evidence is old or missing. That is a data-coverage limitation, not a rendering bug.

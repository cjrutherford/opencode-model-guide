<img src="assets/icon.svg" width="64" height="64" alt="">

# OpenCode Model Guide

A free-model tracker and buyer's guide for models available in **OpenCode Console** and
**OpenCode Go / Go Plus**.

The project tracks what is free, how it is free (limited-time, stealth, subscription-included, or
trial terms), what changed, and how models compare on quality and modeled cost per task. It is
designed to run entirely on GitHub: a daily Actions pipeline commits normalized data, builds an
Astro site, deploys to GitHub Pages, publishes an RSS feed, and sends an ntfy summary.

## Status

The static site, daily data pipeline, GitHub Pages deployment, RSS feed, and ntfy notification path
are implemented through S10. S11 covers launch documentation, accessibility, and final checks.

- [Design](docs/plans/2026-10-19-opencode-model-guide-design.md)
- [Implementation plan](docs/plans/2026-10-19-opencode-model-guide-implementation.md)
- [Slice tracker](docs/slices/README.md)
- [Repository, Pages, and secret setup](docs/setup-secrets.md)

## Planned sources

- [models.dev](https://models.dev) for metadata and list pricing
- OpenCode's live Console and Go model endpoints for availability
- OpenCode Console and Go docs for free terms, privacy, and subscription limits
- SWE-bench, LMArena, and Aider polyglot for quality
- Optional: Artificial Analysis and Terminal-Bench

## Local development

Node 22.22+ and pnpm 10 are required. In the T3 sandbox, pnpm is installed but not on `PATH`:

```bash
export PATH="$HOME/.local/share/pnpm:$PATH"
pnpm install
pnpm dev
```

Common commands:

```bash
pnpm typecheck       # TypeScript and Astro checks
pnpm test            # unit tests
pnpm test:watch      # tests in watch mode
pnpm build           # static site
pnpm validate:data   # validate committed data
pnpm ingest          # fetch and normalize sources
pnpm score           # compute costs and quality scores
pnpm notify          # send the ntfy summary
```

`notify` skips sending when `NTFY_TOPIC` is missing; the site can still build and deploy. Use
`pnpm notify --dry-run` to print the payload without sending it.

### Local secrets

Copy the example and fill in the two values:

```bash
cp .secrets.example .secrets
```

`.secrets` is gitignored and must never be committed. The CLI scripts above load it
automatically with Node's `--env-file-if-exists=.secrets`; GitHub Actions supplies the same values
as repository secrets instead. See [setup and secret rotation](docs/setup-secrets.md).

Tests do not read `.secrets`; adapters use fixtures and `vi.stubEnv` when they need an environment
value.

## Deployment

The site is published at **https://cjrutherford.github.io/opencode-model-guide/** from GitHub Pages.
The repository must use **Settings → Pages → Source: GitHub Actions**; there is no `gh-pages`
branch.

[`.github/workflows/ingest.yml`](.github/workflows/ingest.yml) runs daily at 13:00 UTC and on manual
dispatch. It:

1. ingests the catalog and benchmark sources;
2. computes scores and validates the committed data;
3. commits changed `data/` files with `[skip ci]`;
4. builds with `actions/configure-pages` values for `SITE_URL` and `BASE_PATH`;
5. deploys the artifact to Pages;
6. sends one ntfy summary and commits `data/notify-state.json`.

Scheduled runs skip the build and deploy when no data changed. A manual dispatch always deploys.
If a required source fails, the run stops before deploy and the failure alert uses `NTFY_TOPIC`.
If notification fails after deploy, the site remains live; the run fails visibly so the next run can
retry.

`NTFY_TOPIC` is required for notifications. `AA_API_KEY` is optional. Never commit either value;
see [repository, Pages, and secret setup](docs/setup-secrets.md) for creation, rotation, and
troubleshooting.

## Disclaimer

This project is not affiliated with OpenCode or Anomaly. Prices, free offers, and model availability
change frequently; every figure on the site will carry a source and a date.

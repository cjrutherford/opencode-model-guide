<img src="assets/icon.svg" width="64" height="64" alt="">

# OpenCode Model Guide

A free-model tracker and buyer's guide for models available in **OpenCode Console** and
**OpenCode Go / Go Plus**.

The project tracks what is free, how it is free (limited-time, stealth, subscription-included, or
trial terms), what changed, and how models compare on quality and modeled cost per task. It is
designed to run entirely on GitHub: a daily Actions pipeline commits normalized data, builds an
Astro site, deploys to GitHub Pages, publishes an RSS feed, and sends an ntfy summary.

## Status

Implementation is underway. S00 provides the pnpm workspace, Astro shell, Vitest, and the CI gate.

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

`ingest`, `score`, `notify`, and `validate:data` fail until their slices land. That is intentional.

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

## Disclaimer

This project is not affiliated with OpenCode or Anomaly. Prices, free offers, and model availability
change frequently; every figure on the site will carry a source and a date.

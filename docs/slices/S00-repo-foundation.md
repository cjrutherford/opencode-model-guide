# S00 — Repository foundation and CI

> **Status:** todo · **Depends on:** — · **Blocks:** S01, S07 · **Effort:** ~0.5 day
> **Owner:** — · **Branch:** `slice/S00-repo-foundation`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §6 and §12 first.

## Why this slice exists

Everything else needs a workspace, a type checker, a test runner, a build, and a CI gate. This
slice creates the smallest version of each so later slices can add code without debating tooling.

## Goal

- A pnpm workspace with `apps/web` and `packages/{shared,ingest,scoring,notify}`.
- Strict TypeScript everywhere.
- Vitest runs from the root.
- Astro builds a placeholder page.
- GitHub Actions runs typecheck, tests, data validation, and build on every PR.
- A new contributor can install and run with the README.

## Non-goals

- No schemas, ingest logic, scoring, or real UI. Those are later slices.
- No deployment workflow. S10 owns that.
- No custom domain, analytics, or fonts.

## Inputs and contracts

- Node 22, pnpm 10.
- Root scripts that every later slice relies on: `dev`, `build`, `typecheck`, `test`,
  `test:watch`, `ingest`, `score`, `notify`, `validate:data`.
- Package names: `@omg/shared`, `@omg/ingest`, `@omg/scoring`, `@omg/notify`, `@omg/web`.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `package.json` | Root scripts, dev deps, packageManager |
| Create | `pnpm-workspace.yaml` | `apps/*`, `packages/*` |
| Create | `tsconfig.base.json` | Strict shared compiler options |
| Create | `vitest.config.ts` | Root test include |
| Create | `.gitignore` | `node_modules`, `dist`, `.astro`, `.env*` |
| Create | `.nvmrc` | `22` |
| Create | `.editorconfig` | 2-space, LF |
| Create | `packages/shared/package.json` | `@omg/shared` |
| Create | `packages/shared/tsconfig.json` | Extends base |
| Create | `packages/shared/src/index.ts` | `export const SHARED_PACKAGE = "@omg/shared";` |
| Create | `packages/ingest/package.json` | `@omg/ingest` |
| Create | `packages/ingest/tsconfig.json` | Extends base |
| Create | `packages/ingest/src/index.ts` | Placeholder export |
| Create | `packages/scoring/package.json` | `@omg/scoring` |
| Create | `packages/scoring/tsconfig.json` | Extends base |
| Create | `packages/scoring/src/index.ts` | Placeholder export |
| Create | `packages/notify/package.json` | `@omg/notify` |
| Create | `packages/notify/tsconfig.json` | Extends base |
| Create | `packages/notify/src/index.ts` | Placeholder export |
| Create | `apps/web/package.json` | `@omg/web`, Astro, React, Tailwind |
| Create | `apps/web/astro.config.mjs` | Static output, site/base env |
| Create | `apps/web/tsconfig.json` | `astro/tsconfigs/strict` |
| Create | `apps/web/src/pages/index.astro` | Placeholder |
| Create | `apps/web/src/styles/global.css` | Tailwind import |
| Create | `.github/workflows/ci.yml` | Install, typecheck, test, validate, build |
| Modify | `README.md` | Setup and scripts |

## Implementation steps

### 1. Root workspace

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Root `package.json`:

```json
{
  "name": "opencode-model-guide",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.2",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --filter @omg/web dev",
    "build": "pnpm --filter @omg/web build",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "ingest": "tsx packages/ingest/src/run.ts",
    "score": "tsx packages/scoring/src/run.ts",
    "notify": "tsx packages/notify/src/run.ts",
    "validate:data": "tsx scripts/validate-data.ts"
  },
  "devDependencies": {
    "@types/node": "^22.18.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

The `ingest`, `score`, `notify`, and `validate:data` scripts will fail until their slices land.
That is expected; do not stub them with fake success.

### 2. TypeScript

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

Each package `tsconfig.json` extends `../../tsconfig.base.json` and includes `src/**/*.ts` and
`test/**/*.ts`. Its `package.json` has `"type": "module"` and
`"scripts": { "typecheck": "tsc -p tsconfig.json" }`.

### 3. Vitest

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
```

### 4. Astro app

`apps/web/package.json` dependencies: `astro`, `@astrojs/react`, `@astrojs/sitemap`, `react`,
`react-dom`, `tailwindcss`, `@tailwindcss/vite`, `zod`. Dev deps: `@types/react`,
`@types/react-dom`.

`apps/web/astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

const site = process.env.SITE_URL ?? "https://example.github.io";
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  site,
  base,
  output: "static",
  integrations: [react(), sitemap()],
  vite: { plugins: [tailwindcss()] },
});
```

`apps/web/src/styles/global.css`: `@import "tailwindcss";` plus a placeholder body style.
`apps/web/src/pages/index.astro`: minimal page with `<h1>OpenCode Model Guide</h1>`.

### 5. CI

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm validate:data
      - run: pnpm build
```

`validate:data` will fail until S01 creates the script. To keep CI green in S00, create
`scripts/validate-data.ts` with a temporary no-op that exits 0 and a comment:
`// Replaced by S01/S06; validates data files when they exist.` S01 replaces it.

### 6. Verify

```bash
export PATH="$HOME/.local/share/pnpm:$PATH"
pnpm install
pnpm typecheck
pnpm test
pnpm build
test -f apps/web/dist/index.html && echo "build ok"
```

Commit: `chore: scaffold workspace, astro app, and ci`.

## Acceptance checklist

- [ ] `pnpm install` succeeds and creates a lockfile.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm build` writes `apps/web/dist/index.html`.
- [ ] CI workflow is valid and runs the same commands as local.
- [ ] `.gitignore` excludes `node_modules`, `dist`, `.astro`, and `.env*`.
- [ ] README has setup, dev, build, and test commands, including the pnpm PATH note for this sandbox.

## Handoff notes

- S01 will replace the placeholder `scripts/validate-data.ts` and fill `packages/shared`.
- Do not add runtime dependencies to `packages/shared` beyond `zod`; it is imported by the browser
  build in S07.
- Keep `apps/web` free of data imports for now. S07 owns the data layer.
- The Astro `base` is `/` by default. S10 will set `SITE_URL` and `BASE_PATH` from Pages.

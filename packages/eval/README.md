# Free-model eval harness

This package runs the S14 local coding eval for free OpenCode models. It is deliberately separate
from the production composite score: eval results do not change composite scores, tiers, top picks,
confidence, or free-lane eligibility.

An attempt gets a clean repository, a fixed task prompt, and either:

- **agent**: a disposable container with shell/edit/read tools and access only to the egress proxy;
- **direct-patch**: one model response containing a unified diff, applied host-side.

Pass/fail comes from hidden tests, not the model's self-report. The committed result is
`data/evals.json`; local run workspaces are under `packages/eval/.runs/` and are gitignored.

## Requirements

- Docker with Linux containers.
- Node **22.22+** and pnpm **10.33.2** (this checkout uses `corepack pnpm`).
- A dedicated `OPENCODE_API_KEY` in `.secrets` for real attempts, even though every selected model
  is free. The key is injected by the proxy; it is never passed to the agent or test container.
  See `../../docs/setup-secrets.md`.

Build and corpus checks do not need the key. They do need the host toolchains used by
`pnpm eval:verify-corpus`: Node/`tsx`, Python 3, Go, and `patch`.

## Build the sandbox image

```bash
corepack pnpm eval:build-image
```

The image contains Node, Python, Go, `tsx`, OpenCode, `git`, and `patch`, and runs as a non-root
`eval` user. The command prints the image name, digest, and platform. Defaults:

- image: `omg-eval-sandbox:local`
- architecture: host `amd64`/`arm64`

Override with `OMG_EVAL_IMAGE`, `OMG_EVAL_ARCH`, or `OMG_EVAL_PLATFORM` when needed.

## Verify the corpus

```bash
corepack pnpm eval:verify-corpus
```

Every task must report `[public: pass, hidden: pass, solution: pass]`:

- the baseline fails the public tests and the hidden tests;
- the reference solution passes both;
- the hidden-test overlay is not visible in the public baseline.

The corpus is versioned in `corpus/` and frozen into each run. Do not edit hidden tests to make a
model pass; change the corpus deliberately and let its version change.

## Smoke runs

Use a smoke run before an official run. It exercises one free model on one task and does not write
`data/evals.json`:

```bash
corepack pnpm eval -- \
  --access free \
  --mode agent \
  --models opencode/mimo-v2.6-flash-free \
  --tasks ts-debounce \
  --repeats 1 \
  --retries 0 \
  --run-id smoke-agent-01 \
  --commit=false
```

Direct-patch uses the same result contract:

```bash
corepack pnpm eval -- \
  --access free \
  --mode direct-patch \
  --models opencode/mimo-v2.6-flash-free \
  --tasks ts-debounce \
  --repeats 1 \
  --retries 0 \
  --run-id smoke-patch-01 \
  --commit=false
```

Inspect `packages/eval/.runs/<run-id>/run.json`, `attempts/`, and `artifacts/`. A valid attempt
records status, tokens/latency (or explicit nulls when the provider did not report them), patch hash,
diff stats, test exit code, and a failure tail. Do not add smoke runs to `data/evals.json`.

## Official runs

The first official run is free-only and agent mode:

```bash
corepack pnpm eval -- \
  --access free \
  --mode agent \
  --models all-free \
  --tasks all \
  --repeats 1
```

At the current snapshot that is **10 unique Console free models × 12 tasks × 1 repeat = 120 planned
attempts**. `--commit` defaults to `true`, so a completed or partial run is merged into
`data/evals.json` newest-first. Run direct-patch as a separate mode and publish it separately:

```bash
corepack pnpm eval -- \
  --access free \
  --mode direct-patch \
  --models all-free \
  --tasks all \
  --repeats 1
```

`--models all-free` selects live Console free models from the committed snapshot and deduplicates Go
twins. It never adds a paid model. `--tasks all` selects the full 12-task corpus. Use explicit
`--models`/`--tasks` only for smoke or targeted runs.

## Resume

The runner records an attempt after it finishes. Resume skips terminal attempts and continues the
remaining plans:

```bash
corepack pnpm eval -- \
  --resume smoke-agent-01 \
  --mode agent \
  --models opencode/mimo-v2.6-flash-free \
  --tasks ts-debounce \
  --repeats 1 \
  --commit=false
```

The mode, repeat count, model set, and task set must match the stored run. The corpus prompt/repo
hashes and hidden-test command are checked again; if the corpus changed, resume fails instead of
mixing versions. To continue an official run, use the same `--models all-free --tasks all` values
and either omit `--commit` or set `--commit=true`.

Resume does not rerun `skipped` attempts. A run that hit its five-hour limit records the remaining
attempts as `skipped` with `run_timeout` and status `partial`; a new run is needed if those tasks
must be attempted.

## Status and failure behavior

| Status | Meaning |
|---|---|
| `passed` | The patch applied and hidden tests exited `0`. |
| `failed` | Hidden tests ran and failed. |
| `patch_failed` | The model output was not an applicable patch, or no patch was produced. |
| `error` | Harness/adapter/provider error, or a test-stage harness error. |
| `timeout` | The attempt hit its per-attempt timeout. |
| `skipped` | Not attempted, e.g. `model_not_found` or `run_timeout`. |

- A 401/403 from the provider aborts the run and does **not** commit a publishable result.
- A model-not-found response marks that model's remaining plans `skipped` and continues other
  models.
- Transient errors are retried `--retries` times (default `1`).
- The overall run timeout is five hours; remaining attempts become `run_timeout` skips.
- The hidden-test stage runs in a fresh `--network none` container with no secrets. It receives the
  clean repository, the patch, and the hidden overlay; the agent cannot alter the hidden tests.

## Data and artifacts

- `data/evals.json` is the committed v1 result file. It is atomically rewritten and sorted newest
  first. The shared schema validates unique IDs, references, status consistency, non-negative
  token/cost values, and exact summary recomputation.
- `packages/eval/.runs/<run-id>/run.json` is the frozen run record.
- `packages/eval/.runs/<run-id>/attempts/*.json` are per-attempt records.
- `packages/eval/.runs/<run-id>/artifacts/` contains captured patches and test logs.
- `data/evals.json` is not a database; there is no backend. Historical runs stay in the file and the
  current snapshot may no longer contain their model. `pnpm validate:data` warns about that; it does
  not fail the build.

Validate after a run:

```bash
corepack pnpm validate:data
```

## CI

- `.github/workflows/ci.yml` has a `corpus` job that builds the sandbox image and runs
  `pnpm eval:verify-corpus` without `OPENCODE_API_KEY`.
- `.github/workflows/eval.yml` is manual-only. It takes `mode`, `models`, `tasks`, `repeats`,
  `resume_run_id`, and `commit`; passes `OPENCODE_API_KEY` only to the eval step; uploads run
  artifacts; and commits `data/evals.json` with `[skip ci]` when `commit` is true.
- The eval workflow never runs on pull requests or forks.

## Security boundary

- The agent container is disposable, non-root, read-only at the root, size-capped tmpfs at
  `/workspace`, no Docker socket, no `.secrets`, and no route to the internet.
- It reaches only the dual-homed proxy, which injects the real key into allowlisted inference
  requests and logs no prompts, completions, bodies, or keys.
- The test container is a fresh `--network none` container with no secrets.
- The harness refuses secret-looking environment variable names for the agent container.
- Docker is a convenience boundary, not a hardened multi-tenant sandbox. Official runs happen on an
  ephemeral GitHub Actions VM; local runs are on a machine you are willing to expose to disposable
  containers.
- Rotate `OPENCODE_API_KEY` after the first official run and on any suspicion of exposure.

# S14 — Free-model eval harness

> **Status:** in-progress · **Depends on:** S13 · **Blocks:** S15 · **Effort:** ~6–9 days
> **Owner:** CJ Rutherford · **Branch:** `slice/S14-free-eval-harness`
>
> Read the [design](../plans/2026-10-21-s14-free-eval-harness-design.md) first. This file is
> authoritative for this slice's scope and acceptance.
>
> **Operational prerequisite:** the official runs require a dedicated `OPENCODE_API_KEY` in
> `.secrets` and GitHub Actions. The key is used only by the disposable agent container. Without it,
> PR 1 can merge and the empty `/evals` page can ship, but no model result may be published.
>
> **Design amendment (2026-10-22): free-tier client gate.** OpenCode's free tier rejects raw
> chat-completion requests that do not originate from its own client, even with a valid key and the
> expected headers. The approved option 1 therefore:
>
> - passes the dedicated key only to the disposable agent container, never to the test container or
>   the tunnel;
> - switches the agent from the custom `eval` provider to the built-in `opencode` provider;
> - routes the agent's HTTPS traffic through a dual-homed, allowlisted CONNECT tunnel that permits
>   only `opencode.ai` and its `models.opencode.ai` metadata host on port 443; the tunnel has no key
>   and sees no TLS bodies or headers;
> - keeps the existing HTTP inference proxy for the direct-patch tests, but defers a production
>   free-tier direct-patch run. Raw direct-patch is rejected by the same gate. A one-shot OpenCode
>   adapter is a follow-up; the CLI fails fast instead of publishing a broken run.
>
> This amendment supersedes the proxy-only key statements in the original design and in the
> step-by-step notes below.

## Why this slice exists

S13 exposed the free top-pick lanes, but three of the four lanes are empty because free models lack
public benchmark coverage. S14 adds a first-party, test-verified signal from the actual OpenCode
agent loop: fixed coding tasks, hidden tests, token/latency capture, and a public experimental
surface. It fills the evidence gap without pretending that a local 12-task run is a composite
score.

## Goal

- A repeatable `packages/eval` harness runs free OpenCode models through a disposable agent
  container with full shell access.
- The corpus has 12 versioned tasks: 6 TS/JS, 3 Python, 3 Go. Every task fails on its baseline and
  passes with a reference patch under hidden tests.
- The first official agent run covers all 10 unique live Console free models × 12 tasks × 1 repeat
  = 120 planned attempts.
- A direct-patch adapter follows the agent runner behind the same result contract and test stage; free-tier direct-patch is deferred by the 2026-10-22 amendment.
- `data/evals.json` is committed, schema-validated, and summary-validated.
- `/evals` publishes the latest agent and direct-patch runs with a task matrix, method, and
  limitations.
- Model pages show an experimental eval badge and result section when a run exists.
- Eval does not change composite scores, tiers, confidence, or home-page top picks.
- The agent container receives only the dedicated inference key, never repository secrets, and
  has no arbitrary internet beyond the allowlisted CONNECT tunnel.

## Non-goals

- Paid or Go-subscription models in the first run.
- Composite/use-case integration or eval-based top picks.
- Daily scheduling; the eval workflow is manual.
- Multi-repeat variance claims. The first run is one repeat; the page says so.
- Full transcripts or patches in git. They stay in run artifacts.
- Hidden tests, reference patches, or task metadata inside the agent workspace.
- Eval data in `/models` filters or `/health` source status in this slice.
- A generic benchmark-adapter framework; that is S15.

## Inputs and contracts

### Inputs

- `data/snapshot.json` and `SnapshotSchema`: live free model inventory, free kind, context, prices.
- `OPENCODE_API_KEY`: dedicated inference key, loaded from `.secrets` locally and Actions secrets
  in CI. Passed only to the disposable agent container; never to the test container or tunnel.
- `@opencode-ai/sdk`: pinned package for the host-side OpenCode server client.
- Docker Engine with the ability to create an internal network, a proxy container, and disposable
  agent/test containers.
- `packages/eval/corpus/corpus.json` and per-task `task.json`: corpus version, prompts, commands,
  timeouts, hashes.

### Contracts this slice provides

All eval types and pure summary helpers live in `packages/shared/src/evals.ts` and are exported
from `@omg/shared`.

```ts
type EvalMode = "agent" | "direct-patch";
type EvalStatus = "passed" | "failed" | "patch_failed" | "error" | "timeout" | "skipped";

interface EvalsFile { schemaVersion: 1; generatedAt: string; runs: EvalRun[] }
interface EvalRun { /* design §Result contract */ }
interface EvalModel { /* model snapshot at run start */ }
interface EvalTaskDescriptor { /* exact prompt/commands/hashes */ }
interface EvalAttempt { /* status, usage, patch, test result */ }
interface EvalModelSummary { /* counts, pass rate, tokens, cost, durations */ }

function summarizeEvalRun(run: EvalRun): EvalModelSummary[];
function wilson95(passed: number, completed: number): [number, number] | null;
```

Key harness interfaces:

```ts
interface EvalAdapter {
  readonly mode: EvalMode;
  run(input: AttemptInput): Promise<AdapterResult>;
}

interface AdapterResult {
  status: "completed" | "timeout" | "error";
  patch: string | null;
  usage: Usage | null;
  error?: string;
  transcriptPath?: string;
}
```

`AttemptInput` contains the model, task descriptor, attempt workspace, proxy URL, OpenCode config,
timeouts, and run ID. The agent adapter uses the OpenCode server; the direct-patch adapter uses the
proxy directly. Both feed the same patch/test/summary pipeline.

### Contracts this slice consumes

- `loadData()` in `apps/web/src/lib/data.ts` gains `evals: EvalsFile`.
- `validate:data` parses `data/evals.json` with `EvalsFileSchema` and recomputes summaries.
- Model pages match eval records by `modelKey`, falling back to the underlying `id`.
- Methodology version becomes `1.2` with an experimental eval disclosure; the composite formula is
  unchanged.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `docs/plans/2026-10-21-s14-free-eval-harness-design.md` | Design (this branch) |
| Create | `docs/slices/S14-free-eval-harness.md` | This file |
| Create | `packages/shared/src/evals.ts` | Eval schemas, constants, types, Wilson, summary |
| Modify | `packages/shared/src/index.ts` | Export eval contracts |
| Create | `packages/shared/test/evals.test.ts` | Schema/summary tests |
| Create | `packages/eval/package.json`, `tsconfig.json` | `@omg/eval` workspace |
| Create | `packages/eval/src/run.ts` | CLI orchestration, resume, commit |
| Create | `packages/eval/src/args.ts` | `parseArgs`, validation |
| Create | `packages/eval/src/models.ts` | Free-model selection and dedupe |
| Create | `packages/eval/src/corpus.ts` | Corpus manifest loader and validation |
| Create | `packages/eval/src/prompt.ts` | Render/hash exact prompt |
| Create | `packages/eval/src/patch.ts` | Capture/apply/size/path checks |
| Create | `packages/eval/src/usage.ts` | Normalize OpenCode token/cost metadata |
| Create | `packages/eval/src/testRunner.ts` | Hidden-test container |
| Create | `packages/eval/src/runStore.ts` | Run directory, attempt records, resume |
| Create | `packages/eval/src/dataFile.ts` | Atomic `data/evals.json` read/write |
| Create | `packages/eval/src/proxy.ts` | Allowlisted inference proxy |
| Create | `packages/eval/src/adapters/types.ts` | Shared adapter contract |
| Create | `packages/eval/src/adapters/agent.ts` | OpenCode SDK agent runner |
| Create | `packages/eval/src/adapters/directPatch.ts` | Prompt + diff-only adapter |
| Create | `packages/eval/src/sandbox/docker.ts` | Docker CLI helpers, networks, health |
| Create | `packages/eval/src/sandbox/agentContainer.ts` | Agent tmpfs workspace/server |
| Create | `packages/eval/src/sandbox/testContainer.ts` | No-network test container |
| Create | `packages/eval/src/verifyCorpus.ts` | Baseline/solution corpus gate |
| Create | `packages/eval/src/buildImage.ts` | Build/pin sandbox image |
| Create | `packages/eval/sandbox/Dockerfile` | Node 22.22.1, Python 3.14, Go 1.26.8 |
| Create | `packages/eval/sandbox/entrypoint.sh` | Wait-for-workspace sentinel |
| Create | `packages/eval/corpus/**` | 12 task fixtures |
| Create | `packages/eval/test/**` | Unit and Docker integration tests |
| Create | `packages/eval/README.md` | Local harness instructions |
| Create | `data/evals.json` | Empty file, then committed runs |
| Modify | `scripts/validate-data.ts` | Validate file, references, summaries |
| Create | `apps/web/src/pages/evals.astro` | Public eval page |
| Create | `apps/web/src/lib/evals.ts` | Latest run, badge, matrix helpers |
| Create | `apps/web/src/components/EvalBadge.astro` | Header badge |
| Create | `apps/web/src/components/EvalSection.astro` | Model-page result section |
| Create | `apps/web/src/components/EvalTaskMatrix.astro` | Accessible matrix |
| Modify | `apps/web/src/lib/data.ts` | Load `evals.json` |
| Modify | `apps/web/src/pages/models/[id].astro` | Badge + section |
| Modify | `apps/web/src/components/Header.astro` | `Evals` nav link |
| Modify | `apps/web/src/pages/methodology.astro` | Experimental eval disclosure |
| Modify | `apps/web/src/lib/methodology.ts` | Version 1.2 + changelog |
| Modify | `apps/web/src/lib/format.ts` | Pass-rate/duration helpers |
| Create | `apps/web/test/evals.test.ts` | Web helper tests |
| Create | `.github/workflows/eval.yml` | Manual agent/direct-patch run |
| Modify | `.github/workflows/ci.yml` | Corpus verifier job |
| Modify | `package.json`, `pnpm-lock.yaml` | `eval` scripts and SDK dependency |
| Modify | `.gitignore` | `packages/eval/.runs/` |
| Modify | `.secrets.example`, `docs/setup-secrets.md` | `OPENCODE_API_KEY` |
| Modify | `README.md`, `docs/sources.md` | Public docs |
| Modify | `docs/slices/README.md` | Tracker row, progress, ownership |

## Implementation steps

### PR 1 — Contracts, corpus, and harness

#### 1. Shared eval contracts and summary functions

1. Write failing tests in `packages/shared/test/evals.test.ts` for:
   - `EvalsFileSchema` accepts a valid run and rejects duplicate run/attempt IDs, unknown model/task
     references, invalid statuses, negative tokens/cost, and summary mismatches.
   - `summarizeEvalRun()` counts statuses, computes `completed = passed + failed`, pass rate,
     coverage, tokens/cost per solved, median/p95, and null handling.
   - `wilson95()` returns a bounded interval and `null` for zero completed attempts.
   - A run with `mode: "direct-patch"` and a run with `mode: "agent"` both validate.
2. Run `pnpm vitest packages/shared/test/evals.test.ts` and confirm the new tests fail.
3. Implement `packages/shared/src/evals.ts`; export from `packages/shared/src/index.ts`.
4. Run the test again; then run `pnpm test` and `pnpm typecheck`.
5. Commit: `feat(shared): add eval result contracts`.

#### 2. Free-model selector

1. Write failing tests in `packages/eval/test/models.test.ts`:
   - The current snapshot yields exactly 10 unique live Console free models.
   - `opencode-go/beam-free`, `opencode-go/longcat-2.5-preview-free`, and
     `opencode-go/minimax-m3.1-flash-free` do not produce separate runs.
   - Deprecated/unlisted/non-free models are excluded.
   - `--models key1,key2` selects a subset and fails on unknown/non-free keys.
   - Ordering is stable.
2. Implement `packages/eval/src/models.ts` using `SnapshotSchema` and `free.kind`.
3. Run `pnpm vitest packages/eval/test/models.test.ts` until green.
4. Commit: `feat(eval): select unique free models`.

#### 3. Corpus manifest and 12 task fixtures

Create `packages/eval/corpus/corpus.json` with `corpusVersion`, task index, and the 12 task IDs from
the design. For **each** task:

1. Create `repo/` with the starting code, a `TASK.md`, and public tests that fail for the intended
   reason.
2. Create `hidden/` with the main behavior plus at least three edge cases. Hidden tests must not be
   in `repo/`.
3. Create `solution.patch` that makes the hidden tests pass.
4. Create `task.json` with `id`, `language`, `version: 1`, exact `prompt`, `publicTestCommand`,
   `hiddenTestCommand`, `timeoutMs: 480000`, `expectedBaselineFailure`, and
   `referenceSolution: "solution.patch"`.
5. Add a loader test in `packages/eval/test/corpus.test.ts` for unique IDs, supported languages,
   required commands, no hidden/solution files in `repo/`, and corpus-version rules.
6. Implement `packages/eval/src/corpus.ts`.

Task table:

| ID | Language | Test command family |
|---|---|---|
| `ts-debounce` | TypeScript | `tsx --test` |
| `ts-lru` | TypeScript | `tsx --test` |
| `ts-router` | TypeScript | `tsx --test` |
| `ts-semver` | TypeScript | `tsx --test` |
| `js-csv` | JavaScript | `node --test` |
| `js-retry` | JavaScript | `node --test` |
| `py-intervals` | Python | `python3 -m unittest` |
| `py-template` | Python | `python3 -m unittest` |
| `py-ledger` | Python | `python3 -m unittest` |
| `go-workerpool` | Go | `go test ./...` |
| `go-jsonl` | Go | `go test ./...` |
| `go-ratelimit` | Go | `go test ./...` |

Commit after the loader and the first three tasks; commit in batches of tasks to keep reviews
manageable. Final commit: `feat(eval): add 12-task corpus`.

Amendment (2026-10-29, corpus `2026-10-29.1`): `ts-semver` v2 states the `-1/0/1` return
convention in the prompt and pins a numeric prerelease comparison in the public tests. The first
partial official run showed all four models returning a raw numeric difference (`-8`) where the
hidden test expected `-1`; the requirement was not discoverable from the task. No other task
changed.

#### 4. Corpus verifier

1. Write failing tests in `packages/eval/test/verifyCorpus.test.ts` using a tiny fixture:
   - baseline public tests fail;
   - baseline hidden tests fail;
   - reference patch passes hidden tests;
   - a missing/failing reference patch is rejected.
2. Implement `packages/eval/src/verifyCorpus.ts`.
3. Add root script `"eval:verify-corpus": "node --env-file-if-exists=.secrets --import tsx packages/eval/src/verifyCorpus.ts"`.
4. Run `pnpm eval:verify-corpus`; expected: 12/12 tasks report
   `baseline-public-fail`, `baseline-hidden-fail`, `solution-pass`.
5. Commit: `test(eval): verify corpus baseline and solutions`.

#### 5. Prompt, patch, and test runner

1. Write failing tests in `packages/eval/test/prompt.test.ts`, `patch.test.ts`, and
   `testRunner.test.ts`:
   - exact prompt rendering and stable SHA-256;
   - no hidden/solution content in `TASK.md`;
   - patch capture includes untracked files and ignores `.git`;
   - patch application rejects path traversal, binary patches, and oversized patches;
   - test results classify pass/fail/patch-failed/error/timeout;
   - output is capped at 4 KB and ANSI-stripped.
2. Implement `prompt.ts`, `patch.ts`, and `testRunner.ts`.
3. Integration test: use a fake adapter and one tiny task; assert a passing patch is recorded as
   `passed`, a failing patch as `failed`, an empty patch as `failed`, a malformed patch as
   `patch_failed`, and a sleeping test as `timeout`.
4. Run `pnpm vitest packages/eval/test` and the Docker integration test.
5. Commit: `feat(eval): capture patches and run hidden tests`.

#### 6. Sandbox image and containers

1. Create `packages/eval/sandbox/Dockerfile` with:
   - Node 22.22.1 checksum-verified;
   - Python 3.14;
   - Go 1.26.8 checksum-verified;
   - `git`, `bash`, `curl`, `ca-certificates`;
   - pinned `opencode-ai` and `tsx`;
   - non-root `eval` user.
2. Create `entrypoint.sh` that waits for `/workspace/.eval-ready`, removes the sentinel, and
   `exec`s OpenCode.
3. Implement `sandbox/docker.ts`, `agentContainer.ts`, and `testContainer.ts`:
   - create/remove the internal eval network;
   - start agent/test containers with tmpfs `/workspace` (512 MB), read-only root, non-root,
     cap-drop, pids/memory/cpu limits;
   - copy the workspace in after start; copy the agent workspace out before stop;
   - run tests with `--network none`;
   - always clean up in `finally`.
4. Write integration tests:
   - workspace tmpfs is populated and captured;
   - agent container has no `.secrets` or docker socket; with an explicit allowlist it may have the
     dedicated `OPENCODE_API_KEY`;
   - arbitrary outbound hosts fail; the proxy host resolves;
   - test container has no network and no key;
   - container cleanup leaves no `omg-eval-*` network/container.
5. Run `pnpm eval:build-image` and the Docker integration tests.
6. Commit: `feat(eval): add disposable sandbox containers`.

#### 7. Egress proxy

1. Write failing tests in `packages/eval/test/proxy.test.ts`:
   - only `POST /v1/chat/completions` and `GET /v1/models` are allowed;
   - other methods/paths/upstreams return 403/404;
   - incoming `Authorization`/cookies are stripped; the real key is injected;
   - request bodies and the key are never logged;
   - oversized bodies and too many concurrent requests are rejected;
   - SSE responses stream through.
2. Implement `packages/eval/src/proxy.ts` with Node built-ins and a `GET /health` local endpoint.
3. Start the proxy in a container on the internal network plus a bridge; confirm the agent network
   can reach `egress:8787` and cannot reach `https://example.com`.
4. Commit: `feat(eval): isolate model egress behind proxy`.
5. Amendment: the production agent does not use this HTTP proxy. It uses the allowlisted CONNECT
   tunnel in step 8. The HTTP proxy remains for direct-patch fixtures and tests.

#### 8. Agent adapter

1. Write failing tests in `packages/eval/test/agentAdapter.test.ts` with a fake local
   OpenAI-compatible server:
   - server starts, health check passes, session creates, prompt completes;
   - a tool-using fake response can edit the workspace;
   - token/cost metadata normalizes; missing usage stays null;
   - timeout copies the workspace out for diagnostics, kills the container, and records `timeout`;
   - a 401/403 aborts the run without a publishable result;
   - a model-not-found response marks the model's planned attempts skipped.
2. Implement `packages/eval/src/adapters/agent.ts` and `usage.ts`.
3. Generate the OpenCode config per attempt:
   - built-in `opencode` provider, model `opencode/<snapshot id>`;
   - `apiKey: "{env:OPENCODE_API_KEY}"`, supplied only in the agent container;
   - `small_model` set to the same model;
   - snapshots/sharing/autoupdate/LSP/webfetch/websearch/task tools disabled;
   - shell/edit/read/glob/grep allowed;
   - test-only custom `eval` provider for the fake OpenAI server.
4. Run the agent container with the key in its env, `HTTPS_PROXY` pointing at the CONNECT tunnel,
   and an allowlist that rejects every other secret-looking variable.
5. Run the fake-server integration test; no real key.
6. Commit: `feat(eval): run OpenCode agent in sandbox`.

#### 9. Direct-patch adapter

1. Write failing tests in `packages/eval/test/directPatch.test.ts`:
   - prompt includes the task and repo text under a size cap;
   - markdown fences/prose are rejected or stripped predictably;
   - valid unified diff applies and runs hidden tests;
   - malformed/oversized/path-traversal diffs are rejected;
   - usage is recorded, missing usage stays null.
2. Implement `packages/eval/src/adapters/directPatch.ts` through the proxy.
3. Run the same test-stage integration test with a known patch.
4. Commit: `feat(eval): add direct-patch adapter`.
5. Amendment: production free-tier direct-patch is deferred. The raw request is rejected by the
   same client gate. The adapter and its fake-provider tests remain; the CLI fails fast until a
   one-shot OpenCode adapter lands.

#### 10. CLI, run store, resume, and data writer

1. Write failing tests in `packages/eval/test/run.test.ts`:
   - argument validation (`--access free`, modes, model/task selection, repeats);
   - run directory creation and attempt records;
   - resume skips terminal attempts and completes missing ones;
   - planned attempts = models × tasks × repeats;
   - `--commit=false` writes no data file;
   - `--commit=true` writes `data/evals.json` atomically and sorts newest first;
   - duplicate run IDs fail unless resuming.
2. Implement `packages/eval/src/run.ts`, `args.ts`, `runStore.ts`, and `dataFile.ts`.
3. Create an empty `data/evals.json` with `schemaVersion: 1`, `generatedAt`, and `runs: []`.
4. Add root scripts:
   ```json
   "eval": "node --env-file-if-exists=.secrets --import tsx packages/eval/src/run.ts",
   "eval:build-image": "node --env-file-if-exists=.secrets --import tsx packages/eval/src/buildImage.ts",
   "eval:verify-corpus": "node --env-file-if-exists=.secrets --import tsx packages/eval/src/verifyCorpus.ts"
   ```
5. Run the fake-adapter suite and a one-task dry run with `--commit=false`.
6. Commit: `feat(eval): add resumable eval runner`.

#### 11. Data validation and CI

1. Add eval validation to `scripts/validate-data.ts`:
   - parse `EvalsFileSchema`;
   - unique run/attempt IDs, valid model/task references;
   - recompute summaries from attempts and fail on mismatch;
   - check nonnegative tokens/cost and status consistency;
   - warn, do not fail, when a historical run model is absent from the current snapshot.
2. Add failing validation tests in `scripts/validate-data.test.ts` or the shared eval tests.
3. Add a `corpus` job to `.github/workflows/ci.yml`:
   - checkout, install, build image, `pnpm eval:verify-corpus`, upload logs on failure.
   - No `OPENCODE_API_KEY`.
4. Add `eval.yml` with `workflow_dispatch` inputs and the dedicated key; see design §CI.
5. Commit: `ci(eval): validate corpus and publish manual runs`.

#### 12. Secrets and setup docs

1. Add `OPENCODE_API_KEY=` to `.secrets.example`.
2. Update `docs/setup-secrets.md`:
   - secret table, local `.secrets`, create/verify/rotate;
   - low budget; passed only to the disposable agent container;
   - troubleshooting for 401/403, 429, model-not-found, proxy unreachable.
3. Add `packages/eval/.runs/` to `.gitignore`.
4. Add `packages/eval/README.md` with local build/verify/smoke/resume commands.
5. Commit: `docs(eval): document dedicated inference key`.

#### 13. Real smoke run

1. Confirm `OPENCODE_API_KEY` is present without printing it:
   ```bash
   test -n "${OPENCODE_API_KEY:-$(grep -E '^OPENCODE_API_KEY=.+' .secrets | cut -d= -f2-)}" && echo present
   ```
2. Build the image and verify the corpus:
   ```bash
   pnpm eval:build-image
   pnpm eval:verify-corpus
   ```
3. Run one free model × one task, agent mode, no commit:
   ```bash
   pnpm eval -- \
     --access free \
     --mode agent \
     --models opencode/mimo-v2.6-flash-free \
     --tasks ts-debounce \
     --repeats 1 \
     --run-id smoke-agent-01 \
     --commit=false
   ```
   Expected: a valid attempt record, token/latency data or explicit nulls, a patch hash, and a
   hidden-test result.
4. Direct-patch remains deferred; do not run it against free-tier models yet.
5. Verify the agent container had only the dedicated key:
   ```bash
   if docker inspect <agent-container> --format '{{json .Config.Env}}' | grep -q OPENCODE_API_KEY; then
     echo "dedicated eval key present (expected)"
   else
     echo "dedicated eval key missing" >&2
     exit 1
   fi
   ```
6. Do not add smoke data to `data/evals.json`. Commit the harness only.

### PR 2 — Public surface and official runs

#### 14. Web helpers and `/evals`

1. Write failing tests in `apps/web/test/evals.test.ts` for:
   - latest agent/direct-patch run selection;
   - model badge labels (`Eval 7/12`, `Patch 8/12`);
   - pass rate/coverage formatting and null/empty states;
   - model matching by `modelKey` then `id`;
   - task matrix cell labels/status mapping.
2. Implement `apps/web/src/lib/evals.ts` and add `formatPassRate`, `formatDuration`, and
   `formatCount` to `format.ts`.
3. Modify `data.ts` to load and parse `evals.json`; add `evals` to `SiteData`.
4. Create `apps/web/src/pages/evals.astro`:
   - run header/provenance;
   - experimental/not-composite banner;
   - agent and direct-patch sections;
   - model summary tables;
   - task matrix;
   - method/limitations;
   - history;
   - honest empty state.
5. Create `EvalTaskMatrix.astro` with accessible table headers, captions, text labels, and
   horizontal scroll.
6. Run `pnpm vitest apps/web/test/evals.test.ts` and `pnpm build`.
7. Commit: `feat(web): add experimental evals page`.

#### 15. Model badges and section

1. Create `EvalBadge.astro` and `EvalSection.astro`.
2. Modify `apps/web/src/pages/models/[id].astro`:
   - badge near the model header when a run exists;
   - “Local eval” section with mode, pass rate, coverage, tokens/solved, median time, run date,
     corpus version, and “experimental; not in composite” note;
   - both modes when available; agent mode preferred for the badge;
   - historical/current-access note when needed.
3. Add `Evals` to `Header.astro`.
4. Add accessibility tests/checks: badge has an accessible name, matrix headers are scoped, color
   is not the only status signal.
5. Run `pnpm build`, `pnpm tsx scripts/check-links.ts` with `BASE_PATH=/opencode-model-guide`.
6. Commit: `feat(web): show experimental eval badges`.

#### 16. Methodology and docs

1. Update `apps/web/src/lib/methodology.ts` to `1.2` and add a changelog entry:
   “Added the experimental local eval surface; composite scoring is unchanged.”
2. Add a short “Experimental local evals” section to `methodology.astro` linking to `/evals`.
3. Add “Local eval” to `docs/sources.md`, explicitly not a public benchmark and not in the
   composite.
4. Update `README.md` with the `/evals` link and the experimental boundary.
5. Update `docs/slices/README.md` tracker row, progress, ownership, and schema-change note.
6. Commit: `docs(eval): document experimental eval methodology`.

#### 17. Official agent run

1. Confirm the key and budget. Do not print the key.
2. Run:
   ```bash
   pnpm eval -- \
     --access free \
     --mode agent \
     --models all-free \
     --tasks all \
     --repeats 1 \
     --run-id 2026-10-21-free-agent-01 \
     --commit
   ```
3. If interrupted, resume:
   ```bash
   pnpm eval -- --resume 2026-10-21-free-agent-01 --commit
   ```
4. Inspect the summary:
   - 10 models, 12 tasks, 120 planned/recorded attempts;
   - status counts add up;
   - pass rates have completed/taskCount;
   - errors/timeouts are visible;
   - no unknown usage is shown as zero.
5. Run `pnpm validate:data`.
6. Commit the data: `chore(eval): add free agent run`.
7. If the run is partial due to rate limits/timeouts, keep it partial and show coverage; do not
   fabricate missing attempts.

#### 18. Official direct-patch run

1. Run:
   ```bash
   pnpm eval -- \
     --access free \
     --mode direct-patch \
     --models all-free \
     --tasks all \
     --repeats 1 \
     --run-id 2026-10-21-free-patch-01 \
     --commit
   ```
2. Resume if needed; inspect the same integrity checks.
3. `pnpm validate:data`; commit `chore(eval): add free direct-patch run`.

#### 19. Build, deploy, and verify

1. Run the full gate:
   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @omg/web exec astro check
   pnpm typecheck
   pnpm test
   pnpm eval:verify-corpus
   pnpm validate:data
   pnpm build
   BASE_PATH=/opencode-model-guide pnpm tsx scripts/check-links.ts
   ```
2. Commit/push the branch; open the PR; link it in the tracker.
3. Merge after review. Trigger `ingest-and-deploy` or the normal deploy path.
4. Verify live:
   - `/evals` returns 200 and shows both modes or an honest partial/empty state;
   - one free model page shows the experimental badge and section;
   - `/methodology` shows version 1.2 and the eval disclosure;
   - no composite score/tier changed;
   - no key or secret appears in logs or page source.
5. Update the tracker row to `done` and add a one-line result note.

## Acceptance checklist

- [ ] Shared eval schemas, types, Wilson helper, and summary functions are implemented and tested.
- [ ] Free-model selection returns exactly 10 unique live Console free models; Go twins are deduped.
- [ ] The 12-task corpus passes the verifier: baseline public failure, baseline hidden failure,
      reference solution hidden pass.
- [ ] The agent container has full shell, only the dedicated eval key, no `.secrets`, no docker
      socket, no arbitrary internet, and a size-capped tmpfs workspace.
- [ ] The CONNECT tunnel allows only the OpenCode API and its `models.opencode.ai` metadata host on
      port 443, holds no key, and logs no bodies. The HTTP
      proxy used by direct-patch fixtures allows only inference endpoints.
- [ ] The test container runs hidden tests with `--network none` and no secrets.
- [ ] Agent and direct-patch adapters share the result contract and status classifier.
- [ ] A real one-model/one-task agent smoke run produces a valid record. Free-tier direct-patch is
      explicitly deferred to the one-shot adapter.
- [ ] `data/evals.json` validates; summaries recompute exactly; unknown usage stays null.
- [ ] `/evals` shows agent and direct-patch sections, task matrix, method, limitations, history, and
      an honest empty state.
- [ ] Model pages show the experimental badge/section only when a run exists.
- [ ] Eval does not change composite scores, tiers, confidence, or home-page top picks.
- [ ] `OPENCODE_API_KEY` is documented, present only in the agent container and the eval process,
      and absent from the test container, tunnel, and all logs.
- [ ] The official agent run (120 attempts) is committed and live; direct-patch is documented as
      deferred.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm eval:verify-corpus`, `pnpm validate:data`, `pnpm build`,
      and the link check pass.
- [ ] Tracker row, progress log, and handoff notes are updated.

## Verification commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @omg/web exec astro check
pnpm typecheck
pnpm test
pnpm eval:build-image
pnpm eval:verify-corpus
pnpm validate:data
pnpm build
BASE_PATH=/opencode-model-guide pnpm tsx scripts/check-links.ts
```

Live checks after deploy:

```bash
curl -fsS https://cjrutherford.github.io/opencode-model-guide/evals >/dev/null
curl -fsS https://cjrutherford.github.io/opencode-model-guide/methodology | grep -q '1.2'
```

## Handoff notes

- Eval is a separate evidence layer. Do not add it to `USE_CASE_WEIGHTS`, `Score`, tiers, or the S13
  top-pick logic in this slice.
- The official run is one repeat. Do not describe the pass rate as statistically stable; show
  `completed/taskCount` and the single-run caveat.
- The Go twins are duplicates of Console free models. If a future run includes Go, add an explicit
  access selection; do not silently double-count.
- `opencode/jev-1.13-free` has unknown context in the snapshot. Include it; record errors rather
  than excluding it silently.
- The agent workspace is a tmpfs. Copy it out **before** stopping the container; stopping destroys
  the tmpfs.
- The agent's only egress is the CONNECT tunnel to the OpenCode API and its metadata host. The dedicated key lives only
  in the disposable agent container and the eval process. Never pass it to the test container or
  the tunnel. Free-tier raw direct-patch is blocked by the client gate; use the one-shot OpenCode
  adapter when it lands.
- The official runs can take hours and may be rate-limited. Use `--resume`, publish partial runs
  with coverage, and do not fake missing attempts.
- If the key is delayed, merge the harness and empty `/evals` page, but do not publish results.
- S15 is the benchmark-adapter slice. Keep the external benchmark pipeline separate from this eval
  pipeline; do not share a composite score.

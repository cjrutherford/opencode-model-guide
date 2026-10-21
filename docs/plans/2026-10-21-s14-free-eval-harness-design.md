# S14 — Free-model eval harness design

> **Status:** design · **Date:** 2026-10-21 · **Depends on:** S13 · **Blocks:** S15
> **Branch:** `slice/S14-free-eval-harness`
>
> This design defines the first local, test-verified evaluation of free OpenCode models. It is
> deliberately separate from the public-benchmark composite. S14 ships the harness, a committed
> result snapshot, a public `/evals` page, and experimental eval badges on model pages.

## Why this slice exists

The public benchmark sources cover only part of the free catalog. After S13, the free top-pick
lanes for agentic, everyday, and long-context are empty because no live free model has enough
rated public evidence. The site can say “no rated free model” honestly, but it cannot answer the
more useful question: *what happens when a free model is asked to do a small, real coding task
with tools?*

S14 adds a first-party, test-verified signal for that question. It runs the actual OpenCode agent
loop against a fixed corpus in a disposable container, captures tokens and wall-clock time, and
runs hidden tests against the resulting patch. The result is an experimental free-model evidence
layer: useful, reproducible, and clearly not a replacement for the composite score.

## Goal

When S14 is done:

- The repository has a repeatable eval harness that runs free OpenCode models through the real
  agent loop on a fixed, versioned corpus.
- The first official run covers **all 10 unique live Console free models** on **12 tasks**
  (6 TS/JS, 3 Python, 3 Go), one repeat, for **120 planned agent attempts**.
- Every attempt is classified as passed, failed, patch-failed, errored, timed out, or skipped.
  Pass/fail is decided by hidden tests, not by model self-report.
- Results include task-level outcomes, token usage (when reported), wall-clock latency, patch
  hashes/diff stats, and test-output tails.
- A committed `data/evals.json` snapshot validates against a shared schema.
- `/evals` publishes the latest run with methodology and limitations; model pages show an
  experimental eval badge and a short result section for models that have a run.
- Eval results do **not** change composite scores, tiers, home-page top picks, or free-lane
  eligibility.
- The direct-patch adapter is implemented behind the same result contract, after the agent runner.
  Its first official run follows the agent run and is published as a separate mode.
- The corpus validates locally and in CI: baseline fails, reference solution passes hidden tests,
  and hidden tests fail on the baseline.
- A dedicated inference key exists and is isolated behind an allowlisted egress proxy. The agent
  container never sees the key.

## Non-goals

- **No paid or Go-subscription models in the first run.** The official run is free-only. The Go
  twins of free Console models are duplicates and are excluded by deduplication on the underlying
  model ID.
- **No composite integration.** Eval does not feed `USE_CASE_WEIGHTS`, `Score`, tiers, confidence,
  or S13 top picks. A separate design slice and promotion thresholds are required first.
- **No daily automation.** The eval workflow is manual. It is not part of the 13:00 UTC ingest.
- **No multi-repeat statistical claim.** The official run is one repeat. Results are directional;
  the page says so and shows coverage. Multi-repeat variance and promotion statistics are deferred.
- **No full transcripts in git.** Raw session logs are CI artifacts with short retention. The
  committed JSON contains summaries, hashes, and test-output tails only.
- **No arbitrary model set from the web.** Runs are selected by CLI/workflow inputs.
- **No hidden-test leakage into the agent workspace.** Hidden tests and reference solutions stay on
  the host and are copied only into the post-attempt test container.
- **No eval-based free-lane winners yet.** The empty free lanes remain honest until a later slice
  defines how eval evidence is promoted.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Access scope | Free only | User constraint: no paid spend. Fills the free-evidence gap first. |
| Model set | All 10 unique live Console free models | User choice. Deduplicate `opencode/*` and `opencode-go/*` twins by model `id`; prefer the Console listing. |
| Run shape | 10 models × 12 tasks × 1 repeat = 120 agent attempts | User choice. Broad free coverage now; variance work later. |
| Corpus | 6 TS/JS, 3 Python, 3 Go | Matches the languages this project and its users actually run. |
| Execution | Real OpenCode agent loop, full shell, disposable Docker container | Measures tool use and recovery, not just raw patch generation. |
| Isolation | Internal Docker network + allowlisted egress proxy + dedicated key | Agent gets a shell and model access, but no repository secrets and no arbitrary internet. |
| First adapter | Agent loop; direct-patch second | Agent mode is the realistic signal; direct-patch adds a cheaper baseline. |
| Public surface | Validated JSON + `/evals` + model-page badges | User choice. Transparent and useful without touching the composite. |
| Official repeats | 1 | User choice. Ship the first evidence layer before spending time on variance. |
| Cost | Free at run time | Report `$0` honestly; use tokens and wall-clock as the meaningful resource measures. |
| Composite | Unchanged | Eval remains experimental until promotion rules are designed and validated. |

## Model selection

As of 2026-10-21, the snapshot has 13 live free listings but only **10 unique Console free
models** once Go twins are deduplicated:

| Model key | Free kind | Context | Notes |
|---|---|---:|---|
| `opencode/beam-free` | `limited-time` | 1,048,576 | Go twin `opencode-go/beam-free` is a duplicate |
| `opencode/big-pickle` | `limited-time` | 200,000 | — |
| `opencode/deepseek-v4.1-flash-free` | `limited-time` | 200,000 | General/coding anchor |
| `opencode/glm-5.3-flash-free` | `limited-time` | 200,000 | Coding anchor |
| `opencode/jev-1.13-free` | `limited-time` | 0 (unknown) | Include; errors are data. Configure a conservative 32k context. |
| `opencode/longcat-2.5-preview-free` | `limited-time` | 1,000,000 | Go twin is a duplicate |
| `opencode/mimo-v2.6-flash-free` | `limited-time` | 200,000 | Current free frontend top pick |
| `opencode/minimax-m3.1-flash-free` | `limited-time` | 1,000,000 | Go twin is a duplicate |
| `opencode/nemotron-3.5-lightning-free` | `limited-time` | 262,144 | — |
| `opencode/nemotron-3.5-super-vl-free` | `limited-time` | 1,048,576 | Vision-language; text tasks still valid |

Selection rules:

1. Load the committed snapshot at run start.
2. Keep `availability === "live"` and `free.kind` in `open-free`, `limited-time`, `trial`.
3. Keep Console listings (`provider === "opencode"`). This prevents duplicate Go-endpoint runs and
   avoids requiring a Go subscription.
4. Deduplicate by underlying model `id`; if both Console and Go listings exist, prefer Console.
5. Freeze the selected model metadata in the run. A free model disappearing mid-run is recorded as
   an error/skip, not silently dropped.
6. `--models all-free` is the official default. `--models key1,key2` exists for smoke runs.
7. The run does not add new free models that appear after it starts. The next run picks them up.

The selected model metadata is snapshotted in the run, including name, provider, id, free kind,
context, and list prices. The run also records the snapshot generation time and file hash.

Free access is not unauthenticated: the inference endpoint returns `403` without a key. The run
therefore requires `OPENCODE_API_KEY`, even though all selected models are free. The key is owned by
the proxy container, never the agent.

## Corpus

### Task matrix

| ID | Language | Concept | Why it is here |
|---|---|---|---|
| `ts-debounce` | TypeScript | Trailing debounce with `cancel`/`flush` | Timers, state, edge cases |
| `ts-lru` | TypeScript | LRU cache eviction and refresh | Data-structure correctness |
| `ts-router` | TypeScript | Path matching, params, static precedence | Common app logic |
| `ts-semver` | TypeScript | Prerelease comparison | Parsing and comparison rules |
| `js-csv` | JavaScript | Quoted CSV with escaped quotes/newlines | State-machine parsing |
| `js-retry` | JavaScript | Async retry with backoff and abort | Async/error handling |
| `py-intervals` | Python | Merge overlapping/adjacent intervals | Sorting and boundaries |
| `py-template` | Python | `{{name}}` rendering with missing-key errors | String parsing and errors |
| `py-ledger` | Python | Ledger invariants and overdraft rejection | State and validation |
| `go-workerpool` | Go | Bounded worker pool with cancellation | Concurrency and errors |
| `go-jsonl` | Go | Streaming JSONL with malformed-line reporting | I/O and error handling |
| `go-ratelimit` | Go | Token bucket with refill and wait | Time and concurrency |

The split is intentionally small: each task is a single, self-contained bug or feature that a
competent developer can solve in roughly 5–15 minutes. No external dependencies and no network.

### Fixture layout

```text
packages/eval/corpus/
  corpus.json                 # corpus version, task index, created date
  ts-debounce/
    task.json                 # id, language, version, prompt, commands, timeout, hashes
    repo/                     # starting code and public failing tests
    hidden/                   # hidden tests, host-only
    solution.patch            # reference patch, host-only
  ...
```

`task.json` is the contract:

```json
{
  "id": "ts-debounce",
  "language": "ts",
  "version": 1,
  "prompt": "Fix the debounce utility described in TASK.md. ...",
  "publicTestCommand": "tsx --test test/public/*.test.ts",
  "hiddenTestCommand": "tsx --test test/hidden/*.test.ts",
  "timeoutMs": 480000,
  "expectedBaselineFailure": "trailing call was not debounced",
  "referenceSolution": "solution.patch"
}
```

Rules:

- The agent workspace contains only `repo/` plus a generated `TASK.md`. Hidden tests, the
  reference patch, and `task.json` never enter the agent container.
- Public tests fail on the baseline for the intended reason. The task stores an
  `expectedBaselineFailure` marker so the verifier can distinguish a real task from a broken setup.
- Hidden tests cover the main behavior plus at least three edge cases. They fail on the baseline
  and pass with `solution.patch`.
- The verifier runs all three checks: baseline public failure, baseline hidden failure, solution
  hidden pass. A task that does not satisfy all three is not accepted into the corpus.
- The corpus version changes when any task's prompt, repo, hidden tests, or commands change.
  Individual task versions also increment. Runs store the exact prompt, commands, prompt hash, and
  baseline repo hash, so old runs remain auditable.
- Tasks must be deterministic. Time-based tasks use injectable clocks or fake timers. No network,
  no package installs, no random seeds unless fixed.
- The reference patch is small and is not a hint to the model. It exists only for corpus validation.

### Toolchains

The sandbox is one pinned image for all three languages:

- Node.js 22.22.1, checksum-verified from the official tarball
- Python 3.14, matching the project's local Python runtime
- Go 1.26.8 from the official tarball, checksum-verified
- `git`, `bash`, `curl`, `ca-certificates`
- `opencode-ai` and `tsx` pinned globally

One image keeps the runner and cache simple. The exact image digest, platform, OpenCode version,
and toolchain versions are recorded in every run. Official runs use the amd64 CI image; local arm64
smoke runs are allowed but marked with their platform.

## Architecture

```text
┌──────────────────────────── host / CI runner ────────────────────────────┐
│                                                                          │
│  pnpm eval                                                               │
│    ├─ corpus loader + validator                                          │
│    ├─ free-model selector (snapshot)                                     │
│    ├─ attempt queue + resume state                                       │
│    ├─ agent adapter ── OpenCode SDK ── HTTP ──┐                           │
│    ├─ direct-patch adapter ── HTTP ───────────┤                           │
│    ├─ patch capture + test runner             │                           │
│    └─ summary writer ── data/evals.json       │                           │
│                                               │                           │
│  ┌──────────────── docker: eval network ──────┼───────────────────────┐   │
│  │                                            │                       │   │
│  │  agent container                           │   proxy container     │   │
│  │  opencode serve :4096  ── /v1/* ──────────►│   allowlist + key     │   │
│  │  /workspace (tmpfs, capped)                │   :8787 data plane    │   │
│  │  full shell, no secrets                    │   :8788 admin (local) │   │
│  │  internal network only                     │   dual-homed          │   │
│  └────────────────────────────────────────────┴───────────┬───────────┘   │
│                                                           │               │
│                                                https://opencode.ai       │
│                                                /inference/v1             │
│                                                                          │
│  test container (fresh, --network none, no secrets)                      │
│    clean repo + patch + hidden tests → hidden test command               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Attempt flow (agent mode)

1. Select the model, task, and repeat. Create a unique attempt ID and a host run directory.
2. Copy the task's `repo/` into a fresh host-side attempt workspace. Initialize a git baseline
   commit.
3. Render the exact prompt into `TASK.md`; hash the prompt and baseline tree.
4. Start the agent container with a size-capped `/workspace` tmpfs and the generated OpenCode
   config. Copy the baseline workspace into the tmpfs after the container starts, then signal the
   waiting entrypoint to start OpenCode.
5. Wait for the OpenCode server, create a session, and send the prompt with the selected model.
6. Let the agent read, edit, and run the public tests. Enforce the attempt timeout and the tmpfs
   size cap. The agent has full shell inside the container.
7. When the session ends, copy `/workspace` out of the running container to the host capture
   directory, then stop the container. Capture `git add -A` + `git diff` against the baseline.
   Record patch hash, diff stats, and usage. Copying before stop is required because `/workspace`
   is a tmpfs.
8. Create a clean test copy from `repo/`. Apply the patch. Copy `hidden/` over the test copy.
9. Run `hiddenTestCommand` in a fresh `--network none` container with no secrets. Record exit code
   and the last 4 KB of output.
10. Write the attempt record to the run directory. Continue with the next attempt.

### Attempt flow (direct-patch mode)

1. Build a prompt from the task prompt plus a size-capped text view of the baseline repo.
2. Ask for a unified diff only, with no prose and no markdown fences.
3. Send one request through the proxy. The adapter never sees the key.
4. Validate and size-cap the diff, apply it to a clean test copy, copy hidden tests, and run the
   same test stage.
5. Record the same attempt contract with `mode: "direct-patch"`.

Direct-patch does not use the agent server or the agent container. It still uses the isolated test
container and the proxy. It is implemented after the agent runner, behind the same
`EvalAdapter` interface and result schema.

## Sandbox and egress

### Agent container

- Base image: the pinned `omg-eval-sandbox` image.
- Working directory: `/workspace`, a size-capped tmpfs populated after container start. The
  baseline is copied in; the result is copied out. Untrusted code never gets a host bind mount.
- Root filesystem: read-only; writable `tmpfs` for `/workspace`, `/tmp`, and the eval user's home.
- User: non-root `eval` (UID 1000).
- Capabilities: `--cap-drop=ALL`, `--security-opt=no-new-privileges`.
- Limits: `--cpus=2`, `--memory=2g`, `--pids-limit=256`, `/workspace` tmpfs at 512 MB.
- Network: only the internal eval network. The container has no route to the internet.
- No Docker socket, no host home mount, no repository checkout, no `.secrets`.
- The container starts with a waiting entrypoint. The harness copies the baseline into
  `/workspace`, then signals the entrypoint to start OpenCode. It copies the workspace out before
  stopping the container, because stopping would discard the tmpfs.
- The OpenCode server binds inside the container. The host reaches it through a localhost-published
  port; implementation verifies this works with an internal network and falls back to a private
  control network if Docker port publishing requires it.
- The agent gets a full shell, edit, read, glob, and grep. Web fetch, web search, task/subagent, and
  LSP tools are disabled to reduce variability and exfiltration surface.
- The prompt tells the agent not to use the network. The sandbox enforces it; the prompt is not the
  control.

### Proxy container

- Runs the small Node proxy from `packages/eval/src/proxy.ts`.
- Data plane listens on the internal eval network at `:8787`; admin/statistics listens on
  `127.0.0.1:8788` inside the proxy container only.
- The proxy is dual-homed: internal eval network plus a normal bridge network for upstream access.
- It allows only:
  - `POST /v1/chat/completions`
  - `GET /v1/models` (provider discovery, if needed)
- It rejects every other path, method, and upstream host.
- It strips incoming `Authorization`, cookies, and forwarded headers, then injects the real key
  from `OPENCODE_API_KEY`.
- It streams SSE responses without buffering and enforces body-size, request-timeout, per-attempt
  request-count, and total-concurrency limits.
- It logs method, path, status, duration, and attempt ID only. It never logs prompts, completions,
  request bodies, or the key.
- The agent container gets a dummy key and the proxy base URL; the real key exists only in the
  proxy container's environment.
- The proxy's hard stop is the dedicated key's low budget, not the request cap alone.

### Test container

- Same image as the agent, fresh container per attempt.
- `--network none`.
- Size-capped `/workspace` tmpfs; the clean test copy is copied in after start. Read-only root;
  writable `tmpfs` for `/tmp` and home. No host bind mount.
- Non-root, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, CPU/memory/PID limits.
- No `OPENCODE_API_KEY`, no `.secrets`, no proxy access.
- Hidden tests are copied in after the patch is applied. The agent's changes to public tests cannot
  hide hidden-test failures.

### Threat model

The agent is untrusted code execution. Docker is a strong convenience boundary, not a hardened
multi-tenant sandbox. S14 assumes:

- The official runner is an ephemeral GitHub Actions VM.
- Local runs happen on a machine the owner is willing to expose to disposable containers.
- The eval key is dedicated, low-budget, rotatable, and never available to the agent.
- The workspace is disposable and size-capped.
- A container escape is a residual risk; the design does not claim otherwise.

## Result contract

All eval contracts live in `packages/shared` and use a separate `data/evals.json` file. The existing
snapshot, benchmark, score, and event schemas are unchanged.

### Top-level file

```ts
interface EvalsFile {
  schemaVersion: 1;
  generatedAt: string;      // ISO timestamp of the last write
  runs: EvalRun[];          // newest first
}
```

### Run

```ts
interface EvalRun {
  id: string;                       // e.g. "2026-10-21-free-agent-01"
  mode: "agent" | "direct-patch";
  status: "complete" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  harnessVersion: string;
  corpusVersion: string;
  snapshotGeneratedAt: string;
  snapshotSha256: string;
  opencodeVersion: string;
  sandbox: {
    image: string;
    digest: string;
    platform: string;
  };
  limits: {
    attemptTimeoutMs: number;
    runTimeoutMs: number;
    maxWorkspaceBytes: number;
  };
  access: "free";
  repeats: number;
  plannedAttempts: number;
  models: EvalModel[];
  tasks: EvalTaskDescriptor[];
  attempts: EvalAttempt[];
  summaries: EvalModelSummary[];
  notes?: string;
}
```

### Model and task descriptors

```ts
interface EvalModel {
  modelKey: string;
  name: string;
  provider: string;
  id: string;
  freeKind: "open-free" | "limited-time" | "trial";
  context: number;
  inputPrice: number;
  outputPrice: number;
}

interface EvalTaskDescriptor {
  id: string;
  language: "ts" | "js" | "python" | "go";
  version: number;
  prompt: string;                   // exact prompt the model saw
  promptSha256: string;
  repoSha256: string;
  publicTestCommand: string;
  hiddenTestCommand: string;
  timeoutMs: number;
}
```

### Attempt

```ts
type EvalStatus = "passed" | "failed" | "patch_failed" | "error" | "timeout" | "skipped";

interface EvalAttempt {
  id: string;                       // modelKey:taskId:repeat
  modelKey: string;
  taskId: string;
  repeat: number;
  status: EvalStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  testDurationMs: number | null;
  inputTokens: number | null;       // null = provider did not report usage
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  turns: number | null;
  toolCalls: number | null;
  patchSha256: string | null;
  diffLinesAdded: number | null;
  diffLinesRemoved: number | null;
  testExitCode: number | null;
  error: string | null;             // short, sanitized code/message
  failureOutput: string | null;     // last 4 KB, sanitized
}
```

`passed` means the patch applied and hidden tests exited 0. `failed` means the patch applied and
hidden tests exited non-zero. `patch_failed` means the patch did not apply. `error` covers
agent/model/server/measurement failures. `timeout` means the attempt limit was hit. `skipped`
means the attempt was not run because the model was unavailable, auth failed, or the run aborted.

### Summary

```ts
interface EvalModelSummary {
  modelKey: string;
  attempts: number;
  passed: number;
  failed: number;
  patchFailed: number;
  errored: number;
  timedOut: number;
  skipped: number;
  completed: number;                // passed + failed
  passRate: number | null;          // passed / completed; null if completed = 0
  passRateWilson95: [number, number] | null;
  totalTokens: number | null;       // null if any completed attempt has unknown usage
  tokensPerSolvedTask: number | null;
  costUsd: number | null;
  costPerSolvedTaskUsd: number | null;
  medianDurationMs: number | null;
  p95DurationMs: number | null;
}
```

Integrity rules:

- `completed = passed + failed`; all other statuses are reported separately.
- The badge and summary show both `passed/completed` and `completed/taskCount`. A model that
  completes one task and passes it must not look like a 100% model.
- `passRate` is never shown without `completed` and `taskCount`.
- `totalTokens` is null if any completed attempt lacks usage. Do not turn missing usage into zero.
- For free models, `costUsd` is 0 when usage is known, null when unknown. The page says “free at run
  time” and emphasizes tokens and wall-clock, not a misleading $0 cost-per-solved ranking.
- `summaries` are recomputed from attempts by a shared pure function. `validate:data` fails if the
  committed summary does not match.
- The Wilson interval is task-level and labeled as such. With one repeat it is not run-to-run
  variance. The page says “single run, directional.”
- No overall eval score, letter grade, or tier. The JSON has no composite field.

## Data and storage

- Committed: `data/evals.json` with runs newest first.
- Gitignored: `packages/eval/.runs/<run-id>/` containing raw session JSONL, patches, test logs, and
  resume state.
- CI artifacts: the run directory and a redacted log bundle, retained for 7 days.
- The committed attempt record includes only patch hash/diff stats and the last 4 KB of failed test
  output. Full patches and transcripts stay in the run directory/artifact.
- The writer updates the file atomically, sorts runs newest first, and keeps all runs. At 120
  attempts per run and two modes, the file remains small; retention can be revisited later.
- `pnpm validate:data` validates the new file, recomputes summaries, checks duplicate IDs and
  references, and warns when a historical run model is no longer in the current snapshot.

## Public surface

### `/evals`

A static page with two sections, one per mode:

- Header: “Free model evals — experimental,” run date/ID, corpus version, model count, task count,
  repeats, planned/recorded attempts, sandbox image/OpenCode version, and a prominent “not part of
  the composite tier” note.
- Model summary table: model, free kind, passed/completed, coverage, pass rate, errors/timeouts,
  tokens per solved task, median time, cost status. Sorted by completed attempts, then pass rate,
  then tokens per solved. No single overall score.
- Task matrix: tasks as rows, models as columns, cells Pass / Fail / Error / Timeout / Skipped.
  Text and accessible labels, not color alone. Horizontal scroll on narrow screens.
- Task detail: task ID, language, one-line description, per-task pass count. The exact prompt is
  available in a `<details>` block or linked from the run JSON.
- Method and limitations: corpus, agent loop, sandbox, hidden tests, one repeat, free-at-run-time
  cost, model behavior can change, no composite impact, no statistical significance claim.
- History: previous runs summarized by date/mode/coverage. The latest run is detailed. Separate run
  pages are not required in S14.
- If no run exists: an honest empty state, not fake data.

### Model pages

- Add a small experimental `EvalBadge` near the model header when a run exists:
  - Agent mode: `Eval 7/12` (passed/total tasks)
  - Direct-patch only: `Patch 8/12`
  - The badge links to `/evals#agent` or `/evals#direct-patch`.
- Add a “Local eval” section with mode, pass rate, completed/total, tokens per solved, median time,
  run date, corpus version, and the “experimental; not in composite” note.
- If both modes exist, show both; the header badge uses agent mode first.
- Historical runs remain visible with a “run when free; current access changed” note if the model's
  current status differs.
- No eval badge for models without a run.

### Navigation and docs

- Add “Evals” to the site navigation.
- Add a short “Experimental local evals” section to `/methodology`, link to `/evals`, and bump the
  public methodology version to `1.2` with a changelog entry. The composite formula is unchanged.
- Add a “Local eval” section to `docs/sources.md`: first-party experimental source, manual cadence,
  free-only first run, not a public benchmark, not in the composite.
- Update `README.md` with the new surface.
- Add the eval key to `docs/setup-secrets.md`, `.secrets.example`, and the workflow secret list.

## Cost and token accounting

- Usage is normalized from OpenCode assistant message metadata. The implementation verifies the
  exact fields against the pinned SDK version and falls back to provider usage when necessary.
- `totalTokens = inputTokens + outputTokens`. Cached input and reasoning tokens are diagnostic and
  are not double-counted.
- `costUsd` is provider-reported when available; otherwise it is computed from the run's snapshotted
  list prices. For free models with known usage, cost is 0. Unknown usage yields null.
- The agent's model requests go through the proxy; the proxy injects the key. The harness records
  attempt-level request counts if the proxy exposes them.
- The run records attempt and run timeouts, workspace cap, and request caps. The dedicated key's
  budget is the hard financial stop.

## Failure handling and resume

- The runner writes an attempt record after every attempt. `--resume <run-id>` skips terminal
  attempts and continues.
- Model not found: mark all of that model's planned attempts `skipped` with `model_not_found`;
  continue with other models.
- Auth failure (401/403): abort before writing a publishable run. Do not commit a misleading result.
- 429: respect `Retry-After`, retry with bounded exponential backoff and jitter, then record
  `error` with `rate_limited` if exhausted. The run can resume later.
- 5xx/network: bounded retries, then `error`.
- Attempt timeout: kill the container, capture any patch for diagnostics, mark `timeout`; a timed-out
  attempt cannot pass.
- Patch apply failure: `patch_failed`; continue.
- Hidden-test harness failure: `error` with a harness-bug marker; do not count it as a model failure.
  If harness errors dominate, stop and fix the harness.
- Run timeout: stop launching attempts, mark remaining as `skipped` with `run_timeout`, status
  `partial`.
- Cleanup runs in `finally`: stop containers, remove the attempt network, remove the temporary
  workspace, keep the run directory/artifacts.

## Validation and testing

### Unit tests (no API key, no Docker)

- Model selector: exactly 10 unique Console free models, Go twins deduped, deprecated/unlisted
  excluded, explicit subset selection, stable ordering.
- Corpus loader: unique IDs, valid languages/commands, prompt hashes, no hidden/solution files in
  `repo/`, corpus version rules.
- Prompt renderer: exact prompt, hash stable, `TASK.md` content, no hidden-test leakage.
- Patch capture: includes untracked files, ignores `.git`, size cap, hash/diff stats.
- Patch application: clean apply, context mismatch, path traversal/binary rejection, size cap.
- Status classifier: passed/failed/patch_failed/error/timeout/skipped.
- Usage normalizer: sums messages, handles null/cached/reasoning fields, never turns unknown into 0.
- Summary: counts, pass rate, coverage, Wilson interval, tokens/cost per solved, median/p95,
  null handling.
- Schema: duplicate IDs/references, summary mismatch, missing task/model, invalid status, negative
  tokens/cost, run status consistency.
- Proxy allowlist: only allowed methods/paths, auth stripping/injection, no body logging, size and
  concurrency caps.
- Web helpers: badge labels, pass-rate formatting, missing-run behavior, model matching by key/id.

### Integration tests (Docker, no API key)

- A fake `EvalAdapter` returns a known passing patch, a known failing patch, an empty patch, a
  malformed patch, and a timeout. Run the full attempt pipeline against one tiny task and assert
  status, patch hash, test exit code, and summary.
- Corpus verifier: for each task, baseline public failure, baseline hidden failure, reference
  solution hidden pass. This is a CI gate.
- Test container: `--network none`, no secrets, correct exit codes, output cap.
- Agent container smoke: workspace tmpfs is populated, server starts, shell works, non-root/read-only
  constraints hold, proxy is reachable and arbitrary hosts are not. Use a fake local model endpoint;
  no real key needed.

### End-to-end smoke (real key, one attempt)

- One free model × one task × one repeat, agent mode. Verify a real OpenCode session, token capture,
  patch capture, hidden-test run, and valid `data/evals.json` record. This is the merge gate for the
  harness before the official run.
- One direct-patch request against the same task, no agent container. Verify diff extraction, apply,
  test, and record.

### Official runs (operational)

1. Agent mode: all 10 free models × 12 tasks × 1 repeat = 120 attempts.

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

2. Direct-patch mode: same matrix, one request per attempt, after the agent adapter is stable.

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

3. Commit `data/evals.json`, validate, build, deploy, and verify `/evals` and one model badge live.

The official runs are resumable. A partial run can be published with its status and coverage, but
the page must say “partial.” A run with an auth failure or harness-wide failure is not published as
a model result.

## CI and operations

### `eval.yml`

- `workflow_dispatch` only. No schedule, no PR trigger.
- Inputs: `mode` (`agent`/`direct-patch`), `models` (default `all-free`), `tasks` (default `all`),
  `repeats` (default 1), optional `resume_run_id`, `commit` (default true).
- Permissions: `contents: write` for the data commit; no Pages permission unless the workflow
  deploys directly.
- Secret: `OPENCODE_API_KEY` passed only to the proxy container. The agent container never receives
  it.
- Steps: checkout, install, build sandbox image, validate corpus, run eval, validate data, commit
  `data/evals.json` with `[skip ci]` if changed, upload run artifacts. Optionally dispatch the
  existing ingest/deploy workflow after the commit.
- Job timeout: 360 minutes. The run itself has a shorter timeout and resume support.
- The workflow never runs against fork PRs or untrusted branches.

### `ci.yml`

- Keep the existing typecheck/test/validate/build gates.
- Add a Docker-backed corpus verification job without `OPENCODE_API_KEY`.
- Add unit tests for the eval packages to the normal test suite. Do not make the normal test suite
  require Docker or a real key.

### `docs/setup-secrets.md`

- Add `OPENCODE_API_KEY` to the secret table and local `.secrets` instructions.
- Explain: dedicated eval key, low budget, proxy-only, never in the agent container, rotate after
  the first official run and on suspicion.
- Add a verification step that runs one smoke attempt and checks the key is not present in the
  agent container environment or logs.
- Add troubleshooting rows for 401/403, 429, model-not-found, proxy unreachable, and missing key.

## Promotion boundary

Eval remains experimental until a separate design defines and validates promotion. That future
design must answer:

- How many independent runs and repeats are required?
- How stable must model rankings be across runs?
- How are task-level results mapped to use-case evidence without inventing an overall score?
- How are errors, timeouts, and missing usage handled in confidence?
- How does eval combine with public benchmarks without double-counting?
- What is the rollback rule if a model changes behavior?

Until then:

- No composite weight, tier, confidence, or top-pick change.
- No “best free model” claim based on eval.
- No eval badge styled as a tier or score.
- No eval data in `/models` filters unless a later slice adds it explicitly.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Free models are rate-limited or flaky | Low coverage, noisy results | Per-model concurrency 1, bounded retries, resumable runs, report errors separately, publish coverage |
| Free model endpoints require an auth key | Run blocked | Dedicated key, proxy-only, documented setup, smoke test before the official run |
| Agent cannot use tools reliably | Low pass rates | That is the measured behavior; report it, do not hand-hold models |
| Model IDs change or disappear | Broken comparability | Freeze model metadata per run; snapshot date/hash; historical runs remain labeled |
| Hidden tests leak into workspace | Invalid results | Hidden tests live outside `repo/`, are copied only after patch capture, and are overwritten after patch apply |
| Patch is malformed or malicious | Test failure or container abuse | Size/path/binary checks, apply on host, run in no-network test container |
| Sandbox escape | Host compromise | Ephemeral runner, no secrets in agent, cap-drop/non-root/read-only, dedicated key; documented residual risk |
| Proxy key leakage | Spend/abuse | Key only in proxy env, localhost-only admin, no body logging, low budget, rotation |
| Token usage not reported | Missing efficiency data | Nullable fields, usage coverage, no zero-fill, page shows “usage unavailable” |
| One repeat overstates confidence | Misleading ranking | Show n, coverage, Wilson interval labeled task-level, “single run, directional,” no tier |
| Eval accidentally enters composite | Methodology drift | Separate schema/file/page, explicit non-goals, validation forbids eval fields in scores |
| Run exceeds CI time | Partial run | 360-minute job cap, per-attempt timeout, run timeout, resume, publish partial with warning |

## Implementation shape

S14 is large enough to deliver in two reviewable PRs:

### PR 1 — Contracts, corpus, and harness

- Shared eval schemas/constants and pure summary functions.
- Corpus with 12 tasks, hidden tests, reference patches, and the verifier.
- Model selector, prompt renderer, patch capture/apply, test runner, usage normalizer.
- Sandbox image, proxy, Docker orchestration.
- Agent adapter, then direct-patch adapter.
- CLI with `--access free`, `--models`, `--tasks`, `--repeats`, `--mode`, `--resume`, `--commit`.
- Unit tests, Docker integration tests, smoke run.
- `data/evals.json` empty state and validation.
- `eval.yml`, CI corpus job, secrets docs.

### PR 2 — Public surface and first official run

- `/evals` page, model-page badge/section, navigation, format helpers.
- Methodology 1.2 section/changelog, sources/README docs.
- Agent official run (120 attempts), direct-patch official run (120 attempts).
- Validate, build, deploy, verify live `/evals` and a model badge.
- Update the slice tracker with coverage/results.

The agent runner is implemented and smoke-tested before the direct-patch adapter. The first
official run is agent mode; the direct-patch official run follows when the adapter is stable.

## Acceptance checklist (for the eventual slice)

- [ ] Shared eval schemas and pure summary functions are exported and tested.
- [ ] The 12-task corpus passes the verifier: baseline public failure, baseline hidden failure,
      reference solution hidden pass.
- [ ] Free-model selection returns exactly 10 unique live Console free models and excludes Go twins.
- [ ] The agent container has full shell, no repository secrets, no arbitrary internet, and no
      direct access to the real inference key.
- [ ] The proxy allows only the inference endpoints, injects the key, and logs no bodies.
- [ ] The test container runs hidden tests with no network and no secrets.
- [ ] Agent and direct-patch attempts share the result contract and status classifier.
- [ ] A real one-model/one-task smoke run produces a valid record with tokens, latency, patch hash,
      and hidden-test result.
- [ ] `data/evals.json` validates and summaries recompute exactly.
- [ ] `/evals` renders the run, task matrix, method, limitations, and history; empty state is honest.
- [ ] Model pages show the experimental badge/section only for models with runs.
- [ ] Eval does not change composite scores, tiers, or home-page top picks.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm validate:data`, `pnpm build`, and the link check pass.
- [ ] `OPENCODE_API_KEY` is documented, stored only in `.secrets`/Actions, and absent from the agent
      container and all logs.
- [ ] The official agent run and direct-patch run are committed, validated, and live.
- [ ] Tracker row and progress log are updated.

## Open questions for implementation

These do not block design approval; they are verified during implementation:

1. Exact OpenCode SDK message fields for input/output/cached/reasoning tokens and cost.
2. Whether Docker can publish the agent server port while the container is only on an internal
   network; if not, use a private control network.
3. Exact pinned `opencode-ai` version and config keys for disabling autoupdate, snapshots, sharing,
   LSP, and extra tools.
4. Which of the 10 free models actually support tool calling well enough to complete any task;
   failures are results, not blockers.
5. Rate-limit behavior of each free model; the run is resumable.
6. Direct-patch output reliability; malformed diffs are `error`, not silent failures.
7. Whether the first official run should run agent and direct-patch back-to-back or on separate
   days; the data model supports either.

## Handoff to S15

S14 deliberately stops at experimental evidence. The next benchmark-adapter slice should:

- Keep the public-benchmark pipeline and the local eval pipeline separate.
- Add the chosen public benchmark to `BENCHMARK_IDS`, source status, adapters, weights, and
  methodology with the existing S05/S06 patterns.
- Not use eval results to fill missing benchmark coverage or change tiers.
- Reuse the eval page's provenance/limitations style for any new experimental surface.

The likely S15 candidate is the Terminal-Bench adapter already stubbed in
`packages/ingest/src/sources/terminalBench.ts`, but the adapter choice is not settled by this
design. S14's contract is intentionally generic enough that direct-patch results can coexist with
future external benchmark adapters without sharing a score.

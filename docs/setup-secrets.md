# Setup: repository, Pages, and secrets

This is the owner setup checklist for the live pipeline and the manual eval workflow. It covers the
three GitHub Actions secrets the project uses:

| Secret | Required | Used by | Purpose |
|---|---|---|---|
| `NTFY_TOPIC` | Yes, for notifications | `pnpm notify` | Random ntfy.sh topic for push notifications |
| `AA_API_KEY` | Optional | `pnpm score` (Artificial Analysis adapter) | Free-tier Artificial Analysis API key |
| `OPENCODE_API_KEY` | Yes, for eval runs | `pnpm eval` (manual `eval.yml` workflow) | Dedicated low-budget OpenCode inference key; proxy-only |

Everything else is derived at runtime: `SITE_URL` and `BASE_PATH` come from
`actions/configure-pages`, and `GITHUB_TOKEN` is provided by Actions.

> **Never commit any secret.** Use GitHub repository secrets, not repository variables.
> Variables are not masked and can be exposed in logs; secrets are masked.

## Local `.secrets` file

For local runs, copy the tracked example and fill in the values you need:

```bash
cp .secrets.example .secrets
```

`.secrets` is gitignored. The CLI scripts (`pnpm ingest`, `pnpm score`, `pnpm notify`, `pnpm eval`,
`pnpm eval:build-image`, `pnpm eval:verify-corpus`, and `pnpm validate:data`) load it automatically
with Node's `--env-file-if-exists=.secrets`, then fall back to the process environment. GitHub
Actions never has the file; it supplies the same values as repository secrets.

Do not add the file to git, even temporarily. Tests do not read `.secrets`; they use fixtures and
`vi.stubEnv`.

## 1. Create the repository

From the project root:

```bash
gh auth status
gh repo create cjrutherford/opencode-model-guide --public --source=. --remote=origin --push
git remote -v
```

The repository must be **public** for free GitHub Pages.

## 2. Enable GitHub Pages

Use the GitHub CLI:

```bash
gh api -X PUT repos/cjrutherford/opencode-model-guide/pages \
  -f build_type=workflow
```

Or in the browser: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Do not create a `gh-pages` branch. The workflow uploads an artifact and deploys it with
`actions/deploy-pages`.

The expected site URL is:

```
https://cjrutherford.github.io/opencode-model-guide/
```

The workflow computes `SITE_URL` and `BASE_PATH` from `actions/configure-pages`; you do not set them
as secrets.

## 3. Generate and set `NTFY_TOPIC`

The topic is the only thing protecting your notifications. Anyone who knows it can subscribe to
your messages and publish to the same topic. Use a long random value, not the project name.

Generate one:

```bash
openssl rand -hex 16
```

Copy the output. Then set the secret interactively so it does not land in your shell history:

```bash
gh secret set NTFY_TOPIC
# paste the value when prompted
```

Or use the browser: **Settings → Secrets and variables → Actions → New repository secret**, name
`NTFY_TOPIC`, paste the value.

### Test the topic

Subscribe in the ntfy app or at `https://ntfy.sh/<topic>`. Then publish a test message without
echoing the topic:

```bash
read -rs NTFY_TOPIC
printf 'OpenCode Model Guide test\n' | curl -sS -d @- "https://ntfy.sh/$NTFY_TOPIC"
unset NTFY_TOPIC
```

If the message arrives, the topic and network path are good. The production pipeline sends one
summary per run, not one message per model.

### If the secret is missing

`pnpm notify` logs a warning and exits `0` in normal runs. The site still deploys. In `--dry-run`
mode it exits `1` so setup mistakes are visible. This is intentional: notifications should not block
the guide from publishing.

## 4. Obtain and set `AA_API_KEY`

Artificial Analysis provides a free API for model benchmarks. The free tier is enough for this
project; a Pro or Commercial plan is not required.

### 4.1 Create an account and key

1. Go to **https://artificialanalysis.ai/login** and sign in or create an account.
2. Open **API key management**. The Data API docs link to it as “Get a key”:
   **https://artificialanalysis.ai/api-key-management-redirect**.
   If the redirect does not resolve, open your account/organization settings and find **API keys**.
3. Keys belong to an **organization**. If prompted, create or select one. The free tier is
   available without a paid plan.
4. Create a key named something like `opencode-model-guide-ci`.
5. Copy the key immediately. Treat it as a password; do not paste it into an issue, chat, or commit.

### 4.2 Verify the key locally

Use `read` so the key is not echoed or saved in shell history:

```bash
read -rs AA_API_KEY
curl -sS "https://artificialanalysis.ai/api/v2/language/models/free" \
  -H "x-api-key: $AA_API_KEY" \
  | head -c 400
unset AA_API_KEY
```

Expected: a JSON object with `"tier": "free"`, `"pagination"`, and a `"data"` array. A `401` means
the key is missing, wrong, or revoked. A `403` usually means you called the Pro endpoint
`/api/v2/language/models` instead of the free endpoint `/api/v2/language/models/free`.

### 4.3 Set the GitHub secret

```bash
gh secret set AA_API_KEY
# paste the key when prompted
```

Or use the browser: **Settings → Secrets and variables → Actions → New repository secret**, name
`AA_API_KEY`, paste the key.

### 4.4 How the pipeline uses it

`ingest.yml` passes the secret to the scoring step:

```yaml
- run: pnpm score
  env:
    AA_API_KEY: ${{ secrets.AA_API_KEY }}
```

The adapter in `packages/scoring/src/benchmarks/aa.ts`:

- calls only the free-tier endpoint `https://artificialanalysis.ai/api/v2/language/models/free`;
- paginates with `?page=N` while `pagination.has_more` is true;
- maps the coding index to the primary `artificial-analysis` benchmark result;
- stores intelligence, agentic, coding, and index-version values in `meta`;
- returns `skipped` when `AA_API_KEY` is absent, and never fails the build.

If the key is absent, the site still builds. Artificial Analysis rows are missing, agentic and
everyday confidence is lower, and `/health` shows the source as skipped. Models that no longer clear
the coverage or confidence gate stay unrated; do not lower the gate to hide the missing source.

### 4.5 Rate limits and attribution

- The current free tier is **100 requests per day** (some older docs mention 1,000). The daily job
  uses **1–2 requests**, so the quota is ample. Do not call the API from the browser or on every
  page view; data is cached in `data/benchmarks.json`.
- Responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. A `429`
  means the daily quota is exhausted; do not retry aggressively.
- **Attribution is required.** The site footer and `/methodology` page must credit and link to
  **https://artificialanalysis.ai/**. The API terms also apply:
  [Terms of Use](https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf) and
  [Data Platform Terms](https://artificialanalysiscdn.com/legal/ProDataPlatformTerms.pdf).
- The free tier does not include the full per-benchmark evaluation set, context window, or provider
  breakdown. Those are Pro/Commercial fields. The adapter does not depend on them.

## 5. Obtain and set `OPENCODE_API_KEY`

The eval harness runs only free models, but the inference endpoint still requires authentication.
`OPENCODE_API_KEY` is a **dedicated** inference key. Do not reuse the key from your interactive
editor: revoking the eval key must not sign you out, and the eval key must have a low budget.

### 5.1 Create a dedicated, low-budget key

1. Sign in to **https://opencode.ai/console**. The older **https://opencode.ai/auth** page also
   reaches key creation. If the console uses **service accounts**, create or select a dedicated
   service account first; keys created inside it are easier to revoke without affecting your own
   login.
2. Open **Keys** (or **API keys**) and create a key named something like
   `opencode-model-guide-eval`.
3. Set the lowest budget or credit limit the account supports before running the harness. The
   runner selects only free models and uses `--access free`, but the budget is the hard financial
   stop if free terms change or a retry follows an unexpected path.
4. Copy the key immediately. Treat it as a password; do not paste it into an issue, chat, or commit.

### 5.2 Verify the key locally

Use `read` so the key is not echoed or saved in shell history:

```bash
read -rs OPENCODE_API_KEY
curl -sS https://opencode.ai/inference/v1/models \
  -H "Authorization: Bearer $OPENCODE_API_KEY" \
  | head -c 400
unset OPENCODE_API_KEY
```

Expected: a JSON list containing live model IDs, including the current free models. A `401` means
the key is missing, wrong, or revoked. A `403` means the key is valid but lacks access to the
endpoint or account. A `429` means you are rate limited.

### 5.3 Add it to local `.secrets`

After `cp .secrets.example .secrets`, append the value without echoing it:

```bash
read -rs OPENCODE_API_KEY
if grep -q '^OPENCODE_API_KEY=' .secrets; then
  echo "OPENCODE_API_KEY already present; edit .secrets to replace it"
else
  printf 'OPENCODE_API_KEY=%s\n' "$OPENCODE_API_KEY" >> .secrets
fi
unset OPENCODE_API_KEY
```

Confirm it is present without printing it:

```bash
test -n "$(grep -E '^OPENCODE_API_KEY=.+' .secrets | cut -d= -f2-)" && echo present
```

### 5.4 Set the GitHub secret

```bash
gh secret set OPENCODE_API_KEY
# paste the key when prompted
```

Or use the browser: **Settings → Secrets and variables → Actions → New repository secret**, name
`OPENCODE_API_KEY`, paste the key.

### 5.5 How the eval workflow uses it

`.github/workflows/eval.yml` is manual-only. It passes the secret only to the `pnpm eval` step:

```yaml
- run: pnpm eval -- ...
  env:
    OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
```

The host runner gives it to the egress proxy. The proxy strips the agent's dummy authorization,
injects the real key, and forwards only the allowed inference endpoints. The agent and hidden-test
containers never receive it. The test container has no network; the agent container has no route to
the internet except the proxy.

The key is **not** used by the daily ingest pipeline. If it is absent, `pnpm eval` stops before
starting a model attempt. `pnpm eval:build-image` and `pnpm eval:verify-corpus` do not need it.

### 5.6 Verify the sandbox boundary

Build the image, verify the corpus, and run one free model on one task without committing data:

```bash
corepack pnpm eval:build-image
corepack pnpm eval:verify-corpus
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

Expected: a valid attempt record with tokens/latency or explicit nulls, a patch hash, and a
hidden-test result. The run directory is under `packages/eval/.runs/`; smoke data is not added to
`data/evals.json`.

The Docker integration tests assert that the agent and test containers have no
`OPENCODE_API_KEY`, no `.secrets`, and no Docker socket:

```bash
corepack pnpm exec vitest run packages/eval/test/docker.integration.test.ts
```

The harness also refuses to start an agent container with a secret-looking environment variable. If
you want to inspect a live attempt, run the smoke in one terminal and inspect the container before
it exits:

```bash
docker inspect \
  "$(docker ps -q --filter label=omg-eval-role=agent | head -n1)" \
  --format '{{json .Config.Env}}'
```

The output must not contain `OPENCODE_API_KEY` or any other secret value.

## 6. Verify the setup

```bash
gh secret list
gh workflow run ingest-and-deploy.yml
gh run watch
```

A manual dispatch always builds and deploys. Scheduled runs skip the build and deploy when no data
changed; they still run `pnpm notify`, which exits without sending when there are no unsent events.
Sent event IDs are tracked in the committed `data/notify-state.json` file, not in Actions cache.

Then check:

- The run completes and the Pages URL loads.
- `https://cjrutherford.github.io/opencode-model-guide/feed.xml` returns RSS.
- `https://cjrutherford.github.io/opencode-model-guide/health` shows `AA_API_KEY` as present or
  skipped, and source status for the day.
- A test ntfy message arrives when a free-model change is simulated.
- `gh run view --log` does not print any secret value.

After the smoke run, dispatch the eval workflow with one model and one task, or run the same
selection locally. `gh secret list` should show `OPENCODE_API_KEY`; the run log must not print it.

## 7. Rotation and revocation

### ntfy topic

1. Generate a new topic with `openssl rand -hex 16`.
2. `gh secret set NTFY_TOPIC` and paste the new value.
3. Update your subscriptions in the ntfy app.
4. The old topic still exists on ntfy.sh until it expires; stop publishing to it immediately.

### Artificial Analysis key

1. In API key management, regenerate or create a new key.
2. Regenerating revokes the old key immediately.
3. `gh secret set AA_API_KEY` and paste the new key.
4. Run the workflow once to confirm scoring still works. If it fails with `401`, the secret was not
   updated or the key was revoked.

### OpenCode eval key

1. Rotate this key after the first official eval run, and immediately on any suspicion of exposure.
2. In OpenCode Console key management, revoke the old key and create a replacement.
3. Update local `.secrets` and `gh secret set OPENCODE_API_KEY`.
4. Run the one-model smoke again. If it fails with `401` or `403`, the new key is not active or does
   not have access; do not continue an official run until the smoke passes.

The eval key is intentionally separate from `NTFY_TOPIC` and `AA_API_KEY`; rotating one must not
affect the other workflows.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401` from OpenCode inference | Key is wrong, revoked, or the secret is empty | Recreate the key, update `.secrets` and the GitHub secret, rerun the smoke |
| `403` from OpenCode inference | Key lacks access to the inference endpoint or account | Check the account/service-account key and budget; do not switch to a paid model |
| `429` from OpenCode inference | Rate limit, concurrency, or a provider-side cap | Wait for the reset; keep the proxy request/concurrency caps; retry with resume |
| `model_not_found` in an attempt | Model was removed, renamed, or is no longer free | The run marks that model's remaining attempts skipped; refresh the snapshot and inspect the run |
| Proxy unreachable / `egress:8787` connection error | Proxy container or forwarder failed to start | Inspect the proxy container and Docker networks; rerun. There is no direct-internet fallback |
| `OPENCODE_API_KEY is missing` | Key absent from `.secrets` and the environment | Add it to `.secrets` or the eval workflow secret; build/verify do not need it |
| Agent container contains the key | A caller passed it in the environment | Stop the run and rotate the key; the harness should refuse secret-looking env names |
| `data/evals.json` validation fails | Summary mismatch, duplicate ID, or invalid status/reference | Do not hand-edit; rerun the attempt with `--resume` (or regenerate the run) and validate again |
| `401 Invalid/missing API key` from Artificial Analysis | AA key is wrong, revoked, or empty | Regenerate and re-set `AA_API_KEY` |
| `403` from Artificial Analysis | Using the Pro endpoint with a free key | Use `/api/v2/language/models/free` |
| `429` from Artificial Analysis | Daily quota exhausted | Wait for the reset; the job needs only 1–2 requests/day |
| No ntfy message | Missing/wrong `NTFY_TOPIC`, or no `notify: true` events | Check the secret, subscribe to the topic, inspect `/changes` |
| Duplicate ntfy message after a run | Notification sent but `data/notify-state.json` was not committed | The workflow commits it after notify; check the run log |
| Pages 404 for assets | Wrong `BASE_PATH` | Confirm Pages uses GitHub Actions and the workflow passes `configure-pages` outputs |
| Secret not available in a fork PR | GitHub does not pass secrets to fork workflows | Expected; ingest runs on `main`/`schedule`, not untrusted PRs |
| `AA_API_KEY` shows skipped on `/health` | Secret not set or adapter saw an empty value | Set the secret and re-run |

## 9. What not to do

- Do not put any secret in `README.md`, `docs/`, a workflow file, or a commit.
- Do not use repository variables for secrets.
- Do not print a key in a debug step; mask it if you must reference it (`::add-mask::`).
- Do not pass `OPENCODE_API_KEY` to the agent container, test container, Docker build arguments, or
  the browser. Only the proxy needs it.
- Do not use paid models or raise the eval budget to make a failing free-model run pass.
- Do not call the Artificial Analysis API from client-side code.
- Do not commit a `.env` or `.secrets` file. `.gitignore` excludes both; use the local `.secrets`
  file for local runs and repository secrets in Actions.
- Do not commit `packages/eval/.runs/`; it contains local attempt artifacts.
- Do not use a guessable ntfy topic such as `opencode-model-guide`.

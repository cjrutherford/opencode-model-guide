# Setup: repository, Pages, and secrets

This is the owner setup checklist for the live pipeline. It covers the two GitHub Actions secrets
the project uses:

| Secret | Required | Used by | Purpose |
|---|---|---|---|
| `NTFY_TOPIC` | Yes, for notifications | `pnpm notify` | Random ntfy.sh topic for push notifications |
| `AA_API_KEY` | Optional | `pnpm score` (Artificial Analysis adapter) | Free-tier Artificial Analysis API key |

Everything else is derived at runtime: `SITE_URL` and `BASE_PATH` come from
`actions/configure-pages`, and `GITHUB_TOKEN` is provided by Actions.

> **Never commit either secret.** Use GitHub repository secrets, not repository variables.
> Variables are not masked and can be exposed in logs; secrets are masked.

## Local `.secrets` file

For local runs, copy the tracked example and fill in the same two values:

```bash
cp .secrets.example .secrets
```

`.secrets` is gitignored. The CLI scripts (`pnpm ingest`, `pnpm score`, `pnpm notify`, and
`pnpm validate:data`) load it automatically with Node's `--env-file-if-exists=.secrets`, then fall
back to the process environment. GitHub Actions never has the file; it supplies the same values as
repository secrets.

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

If the key is absent, the site still builds. Artificial Analysis rows are missing, the confidence
on affected use cases is lower, and `/health` shows the source as skipped.

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

## 5. Verify the setup

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
- `gh run view --log` does not print either secret value.

## 6. Rotation and revocation

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

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Invalid/missing API key` | Key is wrong, revoked, or the secret is empty | Regenerate the key and re-set `AA_API_KEY` |
| `403` from Artificial Analysis | Using the Pro endpoint with a free key | Use `/api/v2/language/models/free` |
| `429` from Artificial Analysis | Daily quota exhausted | Wait for the reset; the job needs only 1–2 requests/day |
| No ntfy message | Missing/wrong `NTFY_TOPIC`, or no `notify: true` events | Check the secret, subscribe to the topic, inspect `/changes` |
| Duplicate ntfy message after a run | Notification sent but `data/notify-state.json` was not committed | The workflow commits it after notify; check the run log |
| Pages 404 for assets | Wrong `BASE_PATH` | Confirm Pages uses GitHub Actions and the workflow passes `configure-pages` outputs |
| Secret not available in a fork PR | GitHub does not pass secrets to fork workflows | Expected; ingest runs on `main`/schedule, not untrusted PRs |
| `AA_API_KEY` shows skipped on `/health` | Secret not set or adapter saw an empty value | Set the secret and re-run |

## 8. What not to do

- Do not put either secret in `README.md`, `docs/`, a workflow file, or a commit.
- Do not use repository variables for secrets.
- Do not print the key in a debug step; mask it if you must reference it (`::add-mask::`).
- Do not call the Artificial Analysis API from client-side code.
- Do not commit a `.env` or `.secrets` file. `.gitignore` excludes both; use the local `.secrets`
  file for local runs and repository secrets in Actions.
- Do not use a guessable ntfy topic such as `opencode-model-guide`.

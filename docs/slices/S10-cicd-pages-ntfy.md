# S10 — CI/CD, GitHub Pages, and ntfy

> **Status:** review · **Depends on:** S02–S06, S09 · **Blocks:** S11 · **Effort:** ~1 day
> **Owner:** CJ Rutherford · **Branch:** `slice/S10-cicd-pages-ntfy`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §10 and §12 first.

## Why this slice exists

This is what makes the project a tracker instead of a snapshot. It runs the pipeline daily, commits
the data, deploys the site, and pushes one summary when something changes.

## Goal

- A daily `ingest.yml` workflow with manual dispatch.
- Correct permissions, concurrency, and data-commit behavior.
- GitHub Pages deployment with the right `SITE_URL` and `BASE_PATH`.
- ntfy notifications with one summary per run and idempotent state.
- Separate, deduped alerts for required-source failures.
- Secrets documented and never committed.

## Non-goals

- No custom domain.
- No matrix builds or multi-environment deploys.
- No email/Discord delivery.
- No self-hosted ntfy unless the owner asks.

## Inputs and contracts

- Working `pnpm ingest`, `pnpm score`, `pnpm validate:data`, `pnpm build`.
- `data/events.jsonl` with `notify: true` events.
- `data/notify-state.json` with `{ "sent": string[] }`.
- `NTFY_TOPIC` secret; optional `AA_API_KEY`.
- GitHub repo is public; Pages source is "GitHub Actions".

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `.github/workflows/ingest.yml` | Daily pipeline |
| Create | `packages/notify/src/ntfy.ts` | Pure sender |
| Create | `packages/notify/src/state.ts` | Sent-ID store |
| Create | `packages/notify/src/run.ts` | CLI |
| Create | `packages/notify/test/ntfy.test.ts` | Mock fetch |
| Create | `packages/notify/test/state.test.ts` | Dedupe + cap |
| Create | `data/notify-state.json` | `{ "sent": [] }` |
| Modify | `.github/workflows/ci.yml` | Add `astro check` |
| Modify | `README.md` | Secrets + Pages setup |
| Modify | `docs/setup-secrets.md` | Keep setup instructions in sync |

## Implementation steps

### 1. Write the failing ntfy test

```ts
import { describe, expect, it } from "vitest";
import { notify } from "../src/ntfy";

function event(id: string, type: string, summary = "Example is now free.") {
  return { id, type, at: "2026-10-19T13:00:00.000Z", modelKey: "opencode/example", summary, data: {}, notify: true };
}

it("sends one summary and records sent ids", async () => {
  const requests: Request[] = [];
  const result = await notify({
    events: [event("free_started:a", "free_started"), event("free_ended:b", "free_ended")],
    state: { sent: [] },
    topic: "test-topic",
    site: "https://example.github.io/repo",
    fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return new Response("ok");
    },
  });
  expect(requests).toHaveLength(1);
  expect(await requests[0].text()).toContain("2 changes");
  expect(result.state.sent).toHaveLength(2);
});

it("does nothing with no unsent events", async () => {
  let called = false;
  const result = await notify({
    events: [], state: { sent: [] }, topic: "t", site: "https://example.github.io",
    fetch: async () => { called = true; return new Response("ok"); },
  });
  expect(called).toBe(false);
  expect(result.sent).toBe(0);
});

it("does not resend an event already in state", async () => {
  let called = false;
  await notify({
    events: [event("free_started:a", "free_started")],
    state: { sent: ["free_started:a"] },
    topic: "t",
    site: "https://example.github.io",
    fetch: async () => { called = true; return new Response("ok"); },
  });
  expect(called).toBe(false);
});
```

Run: `pnpm vitest packages/notify/test/ntfy.test.ts`. Expected: module not found.

### 2. Implement `ntfy.ts`

```ts
export interface NotifyOptions {
  events: ChangeEvent[];
  state: { sent: string[] };
  topic: string;
  site: string;       // absolute, including base path
  fetch: typeof fetch;
  dryRun?: boolean;
}

export async function notify(opts: NotifyOptions): Promise<{ sent: number; state: { sent: string[] } }>;
```

Behavior:

- Filter to `event.notify === true` and `!state.sent.includes(event.id)`.
- If none, return `{ sent: 0, state }` without calling fetch.
- Group counts: free started, free ended, price changes, deprecated, new models, source failures.
- Body example:

```
2 free models added · 1 free offer ended
- DeepSeek V4.1 Flash Free is now free (limited time).
- MiniMax M3.1 Flash Free is now free (limited time).
- GLM-5.3 is no longer free.

https://example.github.io/repo/changes
```

- POST to `${server}/${topic}` (default `https://ntfy.sh`), body as plain text.
- Normalize `site` by trimming a trailing slash before building `${site}/changes`.
- Headers:
  - `Title`: `OpenCode Model Guide — N changes`
  - `Tags`: `sparkles` if free started, `warning` if free ended/source failure, `money` for price
    changes; join with commas.
  - `Priority`: `high` if source failure or free ended, else `default`.
  - `Click`: `${site}/changes`
- If `dryRun`, print the body and headers; do not call fetch and do not mutate state.
- Add `topic` to headers only via URL; never log the full URL.
- If the response is not ok, throw with status and a truncated body.

### 3. Implement `state.ts`

```ts
export interface NotifyState { sent: string[] }

export async function readState(path = "data/notify-state.json"): Promise<NotifyState>;
export async function writeState(state: NotifyState, path = "data/notify-state.json"): Promise<void>;
export async function mergeSent(state: NotifyState, ids: string[]): Promise<NotifyState>;
```

- Missing file → `{ sent: [] }`.
- Cap at the last 500 IDs, newest last.
- Dedupe.
- Write atomically.

### 4. Implement `run.ts`

```ts
const dryRun = process.argv.includes("--dry-run");
const topic = process.env.NTFY_TOPIC;
if (!topic) {
  console.error("NTFY_TOPIC is not set");
  process.exit(dryRun ? 1 : 0); // missing secret is not a data failure
}
const events = await readEvents();
const state = await readState();
const site = process.env.SITE_URL ?? "https://example.github.io";
const result = await notify({ events, state, topic, site, fetch, dryRun });
if (!dryRun && result.sent > 0) await writeState(result.state);
console.log(`notified ${result.sent} events`);
```

- If `NTFY_TOPIC` is missing, exit 0 with a warning in normal runs; the site still deploys.
- In `--dry-run`, exit 1 if the topic is missing so setup mistakes are visible.

### 5. Write `ingest.yml`

```yaml
name: ingest-and-deploy
on:
  schedule:
    - cron: "0 13 * * *"
  workflow_dispatch:
permissions:
  contents: write
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  update:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm ingest
        env:
          AA_API_KEY: ${{ secrets.AA_API_KEY }}
      - run: pnpm score
        env:
          AA_API_KEY: ${{ secrets.AA_API_KEY }}
      - run: pnpm validate:data
      - name: Commit data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if [ -n "$(git status --porcelain data)" ]; then
            git add data
            git commit -m "chore(data): daily ingest [skip ci]"
            git push
          else
            echo "no data changes"
          fi
      - id: pages
        uses: actions/configure-pages@v5
      - run: pnpm build
        env:
          SITE_URL: ${{ steps.pages.outputs.origin }}
          BASE_PATH: ${{ steps.pages.outputs.base_path }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: apps/web/dist }
      - id: deploy
        uses: actions/deploy-pages@v4
      - run: pnpm notify
        env:
          NTFY_TOPIC: ${{ secrets.NTFY_TOPIC }}
          SITE_URL: ${{ steps.pages.outputs.origin }}${{ steps.pages.outputs.base_path }}
      - name: Commit notify state
        run: |
          if [ -n "$(git status --porcelain data/notify-state.json)" ]; then
            git add data/notify-state.json
            git commit -m "chore(data): notify state [skip ci]"
            git push
          fi
      - if: failure()
        run: |
          if [ -n "$NTFY_TOPIC" ]; then
            curl -sS -H "Title: OpenCode Model Guide — pipeline failed" \
              -H "Priority: high" -H "Tags: rotating_light" \
              -d "The daily ingest failed. See $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
              "https://ntfy.sh/$NTFY_TOPIC"
          fi
        env:
          NTFY_TOPIC: ${{ secrets.NTFY_TOPIC }}
```

Notes:

- `contents: write` is required for the data commit.
- `[skip ci]` prevents the push from retriggering CI.
- The failure step needs `if: failure()` and runs only if a previous step failed.
- `deploy-pages` requires Pages to be enabled with source "GitHub Actions".
- If `AA_API_KEY` is absent, the secret is empty and the adapter skips.

### 6. Add `astro check` to CI

In `ci.yml`, after install:

```yaml
      - run: pnpm --filter @omg/web exec astro check
```

Add `@astrojs/check` and `typescript` to `apps/web` dev dependencies. If `astro check` is too slow,
keep it; correctness matters more than a minute.

### 7. Enable Pages and set secrets

```bash
gh repo view --json nameWithOwner
gh api -X PUT "repos/cjrutherford/opencode-model-guide/pages" -f build_type=workflow
gh secret set NTFY_TOPIC        # paste a random topic when prompted
gh secret set AA_API_KEY        # optional; paste the free-tier key when prompted
gh secret list
```

- Generate a long random ntfy topic, e.g. `openssl rand -hex 16`. Anyone who knows it can read the
  notifications; treat it as a shared secret.
- Do not use a guessable topic.
- Do not use `--body` for secrets; it can land in shell history. Use the interactive prompt or the
  GitHub UI.
- The workflow uses `ntfy.sh` by default. If self-hosting later, add `NTFY_SERVER` env and pass it
  through.
- Full instructions, including how to obtain the Artificial Analysis key, rotate both secrets, and
  troubleshoot `401`/`403`/`429`: [`docs/setup-secrets.md`](../setup-secrets.md).

### 8. Test

```bash
pnpm notify --dry-run
gh workflow run ingest-and-deploy.yml
gh run watch
```

Verify:

- The run completes and the Pages URL loads.
- `feed.xml` is reachable.
- Exactly one ntfy message arrives.
- A second dispatch with no data changes sends no notification.
- The data commit is present and uses `[skip ci]`.
- A deliberately broken required source fails the run before deploy and sends the failure alert.

### 9. Commit

`ci: add daily ingest, pages deploy, and ntfy notifications`

## Acceptance checklist

- [ ] `ci.yml` is green on `main` (PR CI runs first; check `main` after merge).
- [ ] `ingest.yml` is valid and manual dispatch works (first live dispatch after merge).
- [ ] Pages deploys at the expected URL with correct assets (no 404s under the base path).
- [ ] Data commits happen only when data changes and include `[skip ci]` (verify on dispatch).
- [x] ntfy sends exactly one summary per run; source failures use separate high-priority alerts.
- [x] No events → no notification.
- [x] Rerunning the same events does not resend them; state caps at the newest 500 IDs.
- [x] Required-source failure aborts before the snapshot write and deploy; the workflow failure step
  sends a high-priority alert.
- [x] Optional-source failure does not block deploy; Go docs are optional and benchmark adapters
  degrade to existing data.
- [x] `NTFY_TOPIC` and `AA_API_KEY` are secrets, never committed.
- [x] `pnpm notify --dry-run` prints the payload without sending.

## Handoff notes

- If Pages returns 404 for assets, check `BASE_PATH`: it must match the repository path exactly,
  with a leading slash and no trailing slash.
- The `SITE_URL` for ntfy must include the base path; the feed uses `site` plus `base` separately.
- Do not add a second scheduled workflow that also commits `data/`; it will race.
- If the repo is private, Pages requires a paid plan. The project assumes public.
- If ntfy is blocked in CI, the deploy still succeeds; fix the topic or switch servers. Do not
  swallow a non-2xx response silently.
- If notify succeeds but the state commit fails, the next run may resend one summary. This is
  preferable to losing a notification; keep the failure visible in the run log.
- `notify` sends one change summary plus one high-priority alert per unsent `source_failed` event.
  State dedupes by event ID, so a source failure is not replayed on later runs. The workflow failure
  step is the backstop when ingest aborts before an event is written.
- `runIngest` aborts on a failed required source before writing the snapshot. Go docs are optional;
  the models.dev and live model endpoints are treated as required.
- `NTFY_SERVER` is supported by `pnpm notify` for local or self-hosted testing but is not wired into
  the workflow yet.
- Scheduled runs skip build/deploy when no data changed; manual dispatch always deploys. The notify
  step still runs so a previous notification failure can recover.

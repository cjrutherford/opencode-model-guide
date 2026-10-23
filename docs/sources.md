# Sources

This page is the source inventory for OpenCode Model Guide. It records what each source contributes,
how often it is fetched, how failures are handled, and the attribution or legal constraints that
apply. The rendered evidence for a specific model is on its detail page; source health for the latest
run is at [`/health`](https://cjrutherford.github.io/opencode-model-guide/health).

The pipeline is intentionally narrow: OpenCode Console, OpenCode Go / Go Plus, and public benchmark
sources. It does not scrape arbitrary gateways or collect local telemetry. A separate first-party
local eval harness is documented below; it is manual, experimental, and not a public benchmark or a
composite input.

## Priority when sources overlap

1. **Official OpenCode docs** for free terms, privacy, retention, regions, and subscription limits.
2. **models.dev** for metadata, context limits, capabilities, release dates, and list prices.
3. **Live OpenCode endpoints** for whether a model is currently listed.
4. **Benchmarks** for quality only. They never determine a price.

Every model keeps a `sources[]` array, and disagreements are recorded as conflicts rather than
silently overwritten. Unknown or stale values are shown as `unconfirmed` or `Insufficient data`.

## Ingestion sources

| Source | URL | Fields used | Authority | Cadence | Required? |
|---|---|---|---|---|---|
| models.dev | `https://models.dev/api.json` | name, family, context/output limits, capabilities, pricing and tiers, status, release date | High for metadata and list price | Every daily run | Yes |
| Console models | `https://opencode.ai/inference/v1/models` | live Console model IDs | High for current availability | Every daily run | Yes |
| Go models | `https://opencode.ai/inference/go/v1/models` | live Go model IDs | High for current availability | Every daily run | Yes |
| Console docs | `https://opencode.ai/v2/docs/console/models/` | free-list entries, limited-time/trial terms, privacy, retention, regions, list prices | Highest for Console free terms | Every daily run | Yes |
| Go docs | `https://opencode.ai/v2/docs/console/go/` | plan prices, included usage, per-model limits, estimated requests, privacy | Highest for Go economics | Every daily run | No |

### models.dev

- The adapter reads only the `opencode` and `opencode-go` providers. If either provider entry is
  missing, the whole models.dev source fails rather than guessing.
- Prices are per one million tokens. Context-over-200k pricing and input tiers are preserved when
  published.
- The catalog is open data; keep the models.dev attribution and link in the footer, methodology, and
  model provenance. Do not copy the entire catalog into documentation.

### Live OpenCode endpoints

- The two endpoints answer a narrow question: is this model currently listed? They do not publish
  free terms, privacy, or prices.
- A successful response with zero IDs is treated as a source failure, not as “all models removed.”
- Both endpoints are treated as required by the current implementation. A failure aborts the run
  before the snapshot is written. This is stricter than the design’s “at least one live endpoint”
  wording; changing it would be a separate slice with tests for partial availability.

### OpenCode docs

- Console and Go docs are parsed with Cheerio. The parser extracts free-list notes, plan prices,
  included usage, per-model limits, privacy/training language, retention, and excluded regions.
- Console docs are required. If they fail, the run aborts before writing the snapshot.
- Go docs are optional. If they fail, Go models keep their previous free/subscription classification
  where available, the source shows as failed on `/health`, and the rest of the site deploys.
- Wording is quoted sparingly. Link to the docs instead of reproducing pages.

## Benchmark sources

Benchmark adapters run during `pnpm score` on every daily run. Public benchmarks publish on their own
weekly or irregular cadence, so the committed result date is shown with every score.

| Source | URL | Benchmarks / fields | Authority | Failure policy |
|---|---|---|---|---|
| SWE-bench | `https://www.swebench.com/` | Verified and Multilingual resolved %, instance cost, harness, date | High for agentic coding; compare `mini-SWE-agent` rows only | Optional adapter; failure records `failed` and other sources continue |
| LMArena | `https://lmarena.ai/leaderboard`, dataset `lmarena-ai/leaderboard-dataset` | text, webdev, agent, document Elo/score | High for human preference | Optional; paginated per config, partial errors recorded, other configs continue |
| Aider polyglot | [Aider leaderboard YAML](https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml) | pass rate, date, model name | Medium; a single harness | Optional; latest row per model, failure recorded |
| Artificial Analysis | `https://artificialanalysis.ai/api/v2/language/models/free` | coding, intelligence, and agentic indices; tier; version | High, but free API key required | Optional; no key → `skipped`; HTTP/quota errors → `failed`; agentic/everyday confidence is lowered |
| Terminal-Bench | `https://www.tbench.ai/leaderboard` | terminal-agent score | Medium; no stable machine-readable table in v1 | Listed but `skipped`, with a reason, until a stable adapter exists |

If **every** benchmark adapter returns no rows, `pnpm score` fails and the workflow stops. If one or
more adapters fail while others return rows, the run writes the available rows, records the failed
source status, and the affected benchmarks may show “Insufficient data.” Previous benchmark rows are
not merged back automatically; the source status and date make the gap visible.

### SWE-bench

- Uses the public leaderboard embedded JSON.
- Restricts comparisons to the `mini-SWE-agent` harness so different agent scaffolds are not mixed.
- Uses the leaderboard’s date and instance cost when published.
- Cite the harness and date whenever the score is shown.

### LMArena

- Uses the Hugging Face datasets-server rows for `webdev`, `agent`, `text`, and `document`. There is
  no separate `coding` config; do not invent one.
- Elo is used for text/webdev/document; the agent config publishes a score.
- The dataset is licensed **CC-BY-4.0**. Attribute LMArena and the dataset, and preserve the source
  date when displaying a rating.

### Aider polyglot

- Parses the public YAML leaderboard. It is a list of historical runs, so the adapter keeps the most
  recent row per model.
- Aider is a single harness and should not be treated as a universal coding score.
- Cite the Aider repository and leaderboard in methodology/provenance.

### Artificial Analysis

- Optional. Requires `AA_API_KEY`; without it the source is `skipped` and agentic/everyday confidence
  is lower. Do not lower the confidence gate to compensate.
- The free-tier endpoint is fetched once per run (with pagination) and the derived coding index is
  committed into `data/benchmarks.json`. Do not republish the full API payload.
- The **AA Coding Index** is part of the agentic-coding and everyday-edits composites. The AA Agentic
  and Intelligence indices are stored in `meta` and remain supplemental. Do not add both the coding
  and agentic indices to one composite without a new calibration note; that would double-count the
  same publisher.
- Attribution is required. Check the current Artificial Analysis terms before adding fields or
  increasing request volume.
- `429`/quota errors are recorded as failed for the run; the next daily run retries.

### Terminal-Bench

- The public leaderboard does not expose a stable machine-readable table. The adapter returns a
  `skipped` status with the reason instead of fabricating rows.
- Adding an adapter is a v2 candidate and needs its own design note.

## Local eval (first-party, not a public benchmark)

S14 adds a separate local eval harness in `packages/eval`. It is not an ingestion source, does not
feed `data/scores.json`, and is never part of a composite, tier, confidence score, top pick, or
free-lane eligibility decision.

| Item | Value |
|---|---|
| Corpus | 12 fixed tasks: 6 TypeScript/JavaScript, 3 Python, 3 Go |
| Modes | `agent` (OpenCode agent loop with shell/read/edit), then `direct-patch` (one unified diff) |
| Pass/fail | Hidden tests, applied after the attempt is captured; the model's self-report is not evidence |
| First official run | Live Console free models only, one repeat |
| Output | `data/evals.json` (schema v1), validated and committed |
| Cadence | Manual only via the eval workflow or local CLI; no daily schedule |
| Public surface | `/evals`, plus an experimental badge and local-eval section on model pages |

- Hidden tests, reference solutions, and task metadata stay host-side. They are overlaid only in the
  post-attempt test stage and are never present in the agent workspace.
- The agent runs in a disposable container with a size-capped tmpfs workspace and no arbitrary
  internet. It receives the dedicated `OPENCODE_API_KEY` so native OpenCode can satisfy the
  free-tier client gate, and its HTTPS traffic reaches only `opencode.ai` and its `models.opencode.ai` metadata host on port 443 through an allowlisted
  CONNECT tunnel. The tunnel holds no key.
- The test container runs with no network and no secrets. Neither container receives the
  repository's `.secrets`, and the test container never receives the inference key.
- A run can be `complete`, `partial`, or `failed`. Missing attempts are shown as “Not run,” not as
  failures or zero tokens. Unknown usage stays `null`.
- `data/evals.json` keeps the model's free label at run time. If current access differs, the model
  page shows the run-time label and the current access separately.
- The first run is one repeat. The task-level Wilson interval is directional, not a run-to-run
  confidence interval. Do not present a local pass rate as a public leaderboard result.
- Do not publish transcripts, captured patches, hidden tests, reference solutions, or the raw run
  directory. Only the validated aggregate record belongs in git.

## HTTP, rate limits, and User-Agent

The shared HTTP helper in `packages/ingest/src/http.ts`:

- sends `User-Agent: opencode-model-guide/1.0 (+https://github.com/cjrutherford/opencode-model-guide)`;
- uses a 20-second timeout per request;
- retries once after 500 ms on a 5xx response or a network error;
- does not retry other 4xx responses;
- records a `SourceError` with the source ID and URL.

The project makes one daily pass, not a crawl loop. LMArena is the largest request set because it
pages four configurations; it uses small page delays and a hard page cap. Artificial Analysis is
limited to one paginated pass. Do not add parallel hammering or scheduled retries.

## Name resolution

Benchmark names rarely match catalog keys exactly. `data/aliases.json` maps known benchmark names to
model keys. Resolution order is exact key/name, alias, conservative fuzzy match, then unmatched.

Unmatched names stay in `data/benchmarks.json` and appear on `/health`; they are not silently dropped.
Changing an alias requires a test and evidence (the benchmark row plus the catalog model). The fuzzy
threshold and confidence penalty are documented on `/methodology`.

Console and Go can list the same underlying model under different keys. Quality evidence is shared by
model ID so both listings show the same benchmark rows and scores; percentiles are computed once per
underlying result, so a provider twin does not inflate the ranking population. Free terms,
availability, and modeled costs remain per listing.

## Legal and attribution notes

- **models.dev** — open catalog; keep attribution and a link. Do not imply endorsement.
- **LMArena** — dataset licensed CC-BY-4.0; attribute LMArena and the dataset, and link to the source.
- **SWE-bench** — public leaderboard; cite the harness and date. Do not present a score without the
  harness context.
- **Aider** — public repository data; cite the Aider project and leaderboard URL.
- **Artificial Analysis** — free API with attribution requirements; keep the key secret, do not
  redistribute the raw payload, and re-check terms before expanding usage.
- **OpenCode docs** — the authoritative source for free terms and privacy. Quote only short phrases,
  link to the page, and do not copy full tables into the repository.
- **Terminal-Bench** — public leaderboard; cited but not ingested in v1.
- **Local eval corpus** — first-party prompts, fixtures, and hidden tests. Do not republish captured
  patches, transcripts, hidden tests, or reference solutions. Local eval results are not a public
  benchmark and must not be attributed to a third-party publisher.

The project is not affiliated with OpenCode or Anomaly. Prices and offers change; always show the
source date and the `unconfirmed` state when sources disagree.

## When a source changes shape

1. Capture a trimmed real payload as a fixture (no credentials, no full page dumps).
2. Add a failing parser test that reflects the new markup.
3. Update the adapter and keep the source status/error path intact.
4. Run the full gate and check `/health` for the source row.
5. If the source is no longer usable, mark it `skipped` with a reason and open a design note. Do not
   disable it silently or replace it with guessed data.

Source failures are visible on `/health`; required-source failures stop the workflow before deploy and
send a high-priority alert. Optional failures are recorded and the site remains deployable with the
data it has.

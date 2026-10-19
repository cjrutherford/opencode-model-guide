# S04 — Change detection and event log

> **Status:** todo · **Depends on:** S02, S03 · **Blocks:** S09, S10 · **Effort:** ~1 day
> **Owner:** — · **Branch:** `slice/S04-change-detection`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §10 first.

## Why this slice exists

A tracker without a change log is just a table. This slice turns daily snapshots into an auditable,
append-only stream of events that powers `/changes`, the RSS feed, and ntfy notifications.

## Goal

- Diff consecutive snapshots into deterministic events.
- Keep an append-only `data/events.jsonl`.
- Write compact daily history files.
- Bootstrap without notifying about the entire existing catalog.
- Dedupe reruns and same-day duplicates.
- Detect required-source failures.

## Non-goals

- No sending notifications. S10 owns delivery.
- No historical price charts. The history files enable them later.
- No backfilling of events before the first snapshot.

## Inputs and contracts

- Previous and current `Snapshot` from `data/snapshot.json`.
- `eventId`, `ChangeEventSchema` from `@omg/shared`.
- `isFreeNow(model)` helper, exported from `packages/ingest/src/diff.ts` for reuse:
  `free.kind` is `open-free`, `limited-time`, or `trial`.
- `isZeroMarginal(model)` = `isFreeNow(model) || free.kind === "subscription-included"`.

Free events are about **no-subscription free** (`isFreeNow`). A Go model becoming
`subscription-included` is not a "new free model" push. It is still visible in the changelog if its
price changes.

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `packages/ingest/src/diff.ts` | Pure diff |
| Create | `packages/ingest/src/history.ts` | Daily compact snapshot |
| Create | `packages/ingest/src/events.ts` | Append/merge JSONL |
| Create | `packages/ingest/test/diff.test.ts` | Event cases |
| Create | `packages/ingest/test/events.test.ts` | Dedupe/append |
| Create | `packages/ingest/test/history.test.ts` | Prune |
| Create | `packages/ingest/test/fixtures/snapshot.prev.json` | Baseline |
| Create | `packages/ingest/test/fixtures/snapshot.next.json` | Changes |
| Create | `data/events.jsonl` | Created on first real run |
| Create | `data/history/YYYY-MM-DD.json` | Created on first real run |
| Modify | `packages/ingest/src/run.ts` | Add diff + history stage |

## Implementation steps

### 1. Write failing diff tests

```ts
const now = "2026-10-19T13:00:00.000Z";

it("emits free_started when a paid model becomes free", () => {
  const events = diffSnapshots(prev, next, { now });
  expect(events).toContainEqual(expect.objectContaining({
    type: "free_started",
    modelKey: "opencode/example-model",
    notify: true,
  }));
});

it("emits free_ended when a free model becomes paid", () => {
  const events = diffSnapshots(prev, next, { now });
  expect(events).toContainEqual(expect.objectContaining({
    type: "free_ended",
    modelKey: "opencode/old-free",
    notify: true,
  }));
});

it("emits price_changed with before/after values", () => {
  const events = diffSnapshots(prev, next, { now });
  const e = events.find((x) => x.type === "price_changed");
  expect(e?.data).toMatchObject({ before: { input: 1 }, after: { input: 0.8 } });
});

it("does not emit model_added on bootstrap", () => {
  expect(diffSnapshots(null, next, { now })).toEqual([]);
});

it("does not emit events for an identical snapshot", () => {
  expect(diffSnapshots(next, next, { now })).toEqual([]);
});

it("emits source_failed when a required source goes down", () => {
  const events = diffSnapshots(prevWithHealthySources, nextWithFailedSource, { now });
  expect(events).toContainEqual(expect.objectContaining({
    type: "source_failed",
    modelKey: "system/models.dev",
    notify: true,
  }));
});
```

### 2. Implement `diff.ts`

```ts
export interface DiffOptions { now: string; requiredSources?: string[]; }

export function diffSnapshots(
  prev: Snapshot | null,
  next: Snapshot,
  opts: DiffOptions
): ChangeEvent[];
```

Rules:

- `prev === null` → return `[]`. Bootstrap is a separate state, not 128 `model_added` events.
- Build maps by key. Never rely on array order.
- `model_added`: key in next, not in prev. `notify = isFreeNow(nextModel)`.
- `free_started`: `!isFreeNow(prevModel) && isFreeNow(nextModel)`. `notify = true`.
  Also emit when `free.kind` changes to `limited-time` from another free kind? No; that's a terms
  change. Add a `data.termsChanged: true` event of type `free_started` only if `since` changes?
  Keep v1 simple: only paid → free transitions.
- `free_ended`: `isFreeNow(prevModel) && (!isFreeNow(nextModel) || nextModel.availability === "deprecated")`.
  `notify = true`.
- `price_changed`: compare `pricing` deep-equal after removing `undefined` keys. Include
  `before` and `after` snapshots of the price fields. `notify = false`.
- `deprecated`: `prev.availability !== "deprecated" && next.availability === "deprecated"`.
  `notify = isFreeNow(nextModel)`.
- `source_failed`: required source `ok` true → false. `modelKey = "system/<sourceId>"`,
  `notify = true`, `data: { source, error }`.
- Sort by `at`, then `type`, then `modelKey`.
- Set `id = eventId(type, modelKey, now)`. Merge duplicates by ID: first occurrence wins.
- `summary` is human-readable and used by RSS/ntfy. Examples:
  - `"DeepSeek V4.1 Flash Free is now free (limited time)."`
  - `"GLM-5.3 is no longer free."`
  - `"Kimi K3 input price changed from $3.00 to $2.50 per 1M tokens."`

### 3. Implement `events.ts`

```ts
export async function appendEvents(events: ChangeEvent[], path = "data/events.jsonl"): Promise<ChangeEvent[]>;
export async function readEvents(path = "data/events.jsonl"): Promise<ChangeEvent[]>;
```

- Read existing lines; ignore blank lines.
- Parse and validate each with `ChangeEventSchema`.
- Merge new events by ID; existing events are never rewritten.
- Sort all events by `at` ascending before writing.
- Write atomically (`tmp` + rename).
- Return the merged list.

### 4. Implement `history.ts`

```ts
export async function writeHistory(snapshot: Snapshot, dir = "data/history"): Promise<string>;
export async function pruneHistory(dir = "data/history", keepDays = 365): Promise<string[]>;
```

History record:

```json
{
  "date": "2026-10-19",
  "generatedAt": "...",
  "models": [
    { "key": "opencode/kimi-k3", "pricing": { "...": 0 }, "free": { "kind": "paid" }, "availability": "live" }
  ]
}
```

- File name is `YYYY-MM-DD.json` in UTC.
- Overwrite the same day's file; do not create duplicates.
- Prune files older than `keepDays` by filename date.

### 5. Integrate into `run.ts`

After writing the new snapshot:

```ts
const prev = previous; // read before ingest
const events = diffSnapshots(prev, snapshot, { now, requiredSources: REQUIRED_SOURCES });
await appendEvents(events);
await writeHistory(snapshot);
await pruneHistory();
```

- `REQUIRED_SOURCES = ["models.dev", "opencode.models", "opencode.console-docs"]`.
- If `prev` is null, log `bootstrap: baseline written, 0 events`.
- Do not delete or rewrite `events.jsonl` on bootstrap.

### 6. Run twice

```bash
pnpm ingest   # first run: bootstrap, 0 events
pnpm ingest   # second run: 0 events if nothing changed
wc -l data/events.jsonl
```

Then simulate a change in a fixture and run the unit tests. Do not mutate the real snapshot by hand.

### 7. Commit

`feat: detect model, free-tier, price, and source changes`

## Acceptance checklist

- [ ] Bootstrap emits zero events and still writes a history file.
- [ ] A second identical run emits zero events.
- [ ] `free_started` and `free_ended` use `isFreeNow`, not `isZeroMarginal`.
- [ ] Price changes include before/after values.
- [ ] Source failures are deduped per source per day.
- [ ] Event IDs are deterministic and unique.
- [ ] `events.jsonl` is sorted, valid JSONL, append-only.
- [ ] History prunes at 365 days.
- [ ] No notification code lives in this slice.

## Handoff notes

- S09 reads `events.jsonl` directly for `/changes` and the feed. Do not add a second event source.
- S10 should send only events with `notify: true`; the changelog shows everything.
- The first real deployment will have a baseline but no events. That is correct. The first new free
  model after launch produces the first notification.
- If you need to force a fresh baseline, delete `data/snapshot.json` and `data/history/` but **not**
  `events.jsonl`.

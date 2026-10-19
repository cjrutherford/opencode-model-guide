# S02 — Catalog ingest

> **Status:** todo · **Depends on:** S01 · **Blocks:** S03, S04, S06, S08 · **Effort:** ~1.5 days
> **Owner:** — · **Branch:** `slice/S02-catalog-ingest`
>
> Read the [design](../plans/2026-10-19-opencode-model-guide-design.md) §5–§7 first.

## Why this slice exists

This is the spine of the guide: a normalized, validated snapshot of every OpenCode-native model,
with prices, limits, capabilities, availability, and provenance. Everything else enriches or renders
this snapshot.

## Goal

- Fetch models.dev and both live OpenCode model endpoints.
- Normalize `opencode` and `opencode-go` into one `ModelRecord[]`.
- Mark availability from the live endpoints.
- Preserve `firstSeen` across runs.
- Record source health and availability conflicts.
- Write a schema-valid `data/snapshot.json`.

## Non-goals

- No free classification from docs. S02 sets a provisional `free.kind`; S03 refines it.
- No benchmark data. S05 owns that.
- No event diffing. S04 owns that.
- No UI.

## Inputs and contracts

- `SnapshotSchema`, `ModelRecordSchema`, `SourceStatusSchema` from `@omg/shared`.
- `modelKey(provider, id)` from `@omg/shared`.
- `data/snapshot.json` from a previous run is the source for `firstSeen`.
- Provider IDs are exactly `"opencode"` and `"opencode-go"`.

Sources:

- `https://models.dev/api.json`
- `https://opencode.ai/inference/v1/models`
- `https://opencode.ai/inference/go/v1/models`

## Files

| Action | Path | Notes |
|---|---|---|
| Create | `packages/ingest/src/http.ts` | Timeout, retry, UA, typed errors |
| Create | `packages/ingest/src/sources/modelsDev.ts` | Filter to native providers |
| Create | `packages/ingest/src/sources/opencodeModels.ts` | Both live endpoints |
| Create | `packages/ingest/src/normalize.ts` | Pure function; no network |
| Create | `packages/ingest/src/snapshot.ts` | Read previous, atomic write |
| Create | `packages/ingest/src/run.ts` | CLI orchestration |
| Create | `packages/ingest/test/normalize.test.ts` | Core mapping |
| Create | `packages/ingest/test/snapshot.test.ts` | firstSeen preservation |
| Create | `packages/ingest/test/fixtures/models-dev.sample.json` | 4 models across 2 providers |
| Create | `packages/ingest/test/fixtures/opencode-models.sample.json` | Live IDs |
| Create | `packages/ingest/test/fixtures/opencode-go-models.sample.json` | Live Go IDs |
| Create | `data/snapshot.json` | Generated |

## Implementation steps

### 1. Write failing normalization tests

```ts
const ctx = {
  now: "2026-10-19T13:00:00.000Z",
  previous: null,
  live: new Set(["deepseek-v4.1-flash-free", "kimi-k3"]),
  goLive: new Set(["glm-5.3"]),
  sourceRefs: [],
};

it("maps a zero-price model as open-free and live", () => {
  const models = normalizeCatalog(modelsDevFixture, ctx);
  const m = byId(models, "deepseek-v4.1-flash-free");
  expect(m.free.kind).toBe("open-free");
  expect(m.availability).toBe("live");
  expect(m.pricing.input).toBe(0);
  expect(m.firstSeen).toBe(ctx.now);
});

it("marks a model absent from live and deprecated as deprecated", () => {
  const m = byId(normalizeCatalog(modelsDevFixture, ctx), "old-model");
  expect(m.availability).toBe("deprecated");
});

it("marks a model absent from live and not deprecated as unlisted", () => {
  const m = byId(normalizeCatalog(modelsDevFixture, ctx), "hidden-model");
  expect(m.availability).toBe("unlisted");
});

it("preserves firstSeen from the previous snapshot", () => {
  const previous = snapshotWith({ key: "opencode/deepseek-v4.1-flash-free", firstSeen: "2026-09-01T00:00:00.000Z" });
  const m = byId(normalizeCatalog(modelsDevFixture, { ...ctx, previous }), "deepseek-v4.1-flash-free");
  expect(m.firstSeen).toBe("2026-09-01T00:00:00.000Z");
  expect(m.lastSeen).toBe(ctx.now);
});
```

Run: `pnpm vitest packages/ingest/test/normalize.test.ts`. Expected: module not found.

### 2. Implement `http.ts`

```ts
export class SourceError extends Error {
  constructor(public source: string, message: string, public cause?: unknown) {
    super(`[${source}] ${message}`);
  }
}

export async function fetchJson<T>(source: string, url: string, init?: RequestInit): Promise<T>;
export async function fetchText(source: string, url: string, init?: RequestInit): Promise<string>;
```

- 20 s `AbortSignal.timeout(20_000)`.
- One retry after 500 ms on network error or 5xx.
- `User-Agent: opencode-model-guide/1.0 (+https://github.com/cjrutherford/opencode-model-guide)`.
- Do not retry 4xx.
- Return parsed JSON or throw `SourceError`.

### 3. Implement `sources/modelsDev.ts`

Fetch the full document. Select only `payload.opencode` and `payload["opencode-go"]`. Return:

```ts
interface ModelsDevProvider {
  id: "opencode" | "opencode-go";
  name: string;
  doc?: string;
  models: Record<string, ModelsDevModel>;
}
```

Do not filter by `status`; keep deprecated models so the diff can report deprecations.

### 4. Implement `sources/opencodeModels.ts`

Fetch both endpoints. Each returns `{ object: "list", data: [{ id: string, ... }] }`. Return
`{ live: Set<string>, goLive: Set<string>, sources: SourceStatus[] }`.

If one endpoint fails, that is a required-source failure. Throw; S10 decides whether to abort.

### 5. Implement `normalize.ts`

Signature:

```ts
export interface NormalizeContext {
  now: string;
  previous: Snapshot | null;
  live: Set<string>;
  goLive: Set<string>;
  sourceRefs: SourceRef[];
}

export function normalizeCatalog(
  providers: ModelsDevProvider[],
  ctx: NormalizeContext
): ModelRecord[];
```

Rules:

- Iterate `opencode` then `opencode-go`, sorted by key at the end.
- `availability`:
  - in the matching live set → `"live"`
  - else if `model.status === "deprecated"` → `"deprecated"`
  - else → `"unlisted"`
- If models.dev says deprecated but the model is live, set `availability: "live"` and add a
  `Conflict` for `availability` with both values, `resolution: "preferred"`.
- `pricing`: map `cost.input`, `cost.output`, `cost.cache_read`, `cost.cache_write`, and set
  `pricingKnown: true`. Map `cost.tiers[].tier.size` to `minInputTokens`. Map
  `cost.context_over_200k` to `contextOver200k`.
- `free.kind`:
  - `input === 0 && output === 0` → `"open-free"`
  - provider `opencode-go` and not zero → `"subscription-included"`
  - else `"paid"`
- `free.flags`: `[]` in S02. `free.status`: `"confirmed"` only when the live endpoint agrees.
- `privacy`: `{ training: "unknown" }` unless S03 fills it.
- `subscription`: omitted; S03 fills it for Go models.
- `capabilities`: map `tool_call`, `reasoning`, `attachment`, `structured_output`, `temperature`;
  default `false`.
- `modalities`: map input/output arrays; default `["text"]`.
- `limits`: `{ context, output, input? }`; default `0`.
- `releaseDate`: `release_date`.
- `sources`: models.dev plus the relevant live endpoint, with `fetchedAt: now`.
- `firstSeen`: previous model with the same key, else `now`.
- `lastSeen`: `now`.
- `conflicts`: availability conflicts only.

### 6. Implement `snapshot.ts`

```ts
export async function readSnapshot(path = "data/snapshot.json"): Promise<Snapshot | null>;
export async function writeSnapshotAtomic(snapshot: Snapshot, path = "data/snapshot.json"): Promise<void>;
```

- Return `null` if the file does not exist.
- Validate with `SnapshotSchema` on read; throw a readable error if invalid.
- Write to `${path}.tmp`, then `rename`.
- Ensure `data/` exists.

### 7. Implement `run.ts`

```ts
async function main() {
  const args = parseArgs(process.argv.slice(2)); // --fixtures <dir>, --dry-run
  const previous = args.dryRun ? null : await readSnapshot();
  const fetched = await fetchSources(args.fixtures);
  const models = normalizeCatalog(fetched.providers, {
    now: new Date().toISOString(),
    previous,
    live: fetched.live,
    goLive: fetched.goLive,
    sourceRefs: fetched.sourceRefs,
  });
  const snapshot = { schemaVersion: 1, generatedAt: new Date().toISOString(), models, sources: fetched.sources };
  SnapshotSchema.parse(snapshot);
  if (!args.dryRun) await writeSnapshotAtomic(snapshot);
  console.log(`ingested ${models.length} models from ${snapshot.sources.length} sources`);
}
```

`--fixtures <dir>` reads `models-dev.sample.json`, `opencode-models.sample.json`, and
`opencode-go-models.sample.json` from that directory instead of the network. This is for tests and
offline development, not for CI.

### 8. Run the real ingest

```bash
pnpm ingest
pnpm validate:data
```

Expected: `opencode` ~128 models, `opencode-go` ~33; total ~161. `data/snapshot.json` is created.

Inspect:

```bash
node -e 'const s=require("./data/snapshot.json"); console.log(s.models.length); console.log(s.models.filter(m=>m.free.kind!=="paid").length)'
```

### 9. Commit

`feat: ingest opencode catalog from models.dev and live endpoints`

## Acceptance checklist

- [ ] Tests pass with no network.
- [ ] `data/snapshot.json` validates.
- [ ] Every model has `sources[]` with models.dev and the relevant live endpoint.
- [ ] `availability` is `live`, `deprecated`, or `unlisted` and matches the live sets.
- [ ] Deprecated-but-live conflicts are recorded.
- [ ] `firstSeen` is preserved on a second run; `lastSeen` advances.
- [ ] Tier and `contextOver200k` prices are mapped.
- [ ] `pnpm ingest --dry-run` does not write.
- [ ] No API key is required.

## Handoff notes

- S03 will mutate `free`, `privacy`, and `subscription` on the same records. Keep `normalize.ts`
  pure and do not bake docs parsing into it.
- S04 needs `data/snapshot.json` to exist; run the real ingest before starting S04.
- Do not drop deprecated models; they are required for `deprecated` and `free_ended` events.
- `opencode` and `opencode-go` IDs overlap. Always key by provider.
- If models.dev adds a tier shape, extend the mapper and add a fixture; do not silently ignore it.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  SnapshotSchema,
  type Snapshot,
  type SourceRef,
  type SourceStatus,
} from "@omg/shared";

import { normalizeCatalog } from "./normalize";
import { readSnapshot, writeSnapshotAtomic } from "./snapshot";
import {
  MODELS_DEV_URL,
  fetchModelsDev,
  parseModelsDev,
  type ModelsDevProvider,
} from "./sources/modelsDev";
import {
  OPENCODE_GO_MODELS_URL,
  OPENCODE_MODELS_URL,
  fetchLiveModels,
  parseLiveIds,
} from "./sources/opencodeModels";

export interface IngestArgs {
  fixtures: string | null;
  dryRun: boolean;
}

interface FetchedCatalog {
  providers: ModelsDevProvider[];
  live: Set<string>;
  goLive: Set<string>;
  sources: SourceStatus[];
}

const MODEL_SOURCE_IDS = ["models.dev", "opencode.models", "opencode-go.models"] as const;

export function parseArgs(argv: string[]): IngestArgs {
  let fixtures: string | null = null;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--fixtures") {
      const dir = argv[index + 1];
      if (!dir) throw new Error("--fixtures requires a directory");
      fixtures = dir;
      index += 1;
    } else if (arg && arg.startsWith("--fixtures=")) {
      fixtures = arg.slice("--fixtures=".length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return { fixtures, dryRun };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function okStatus(
  id: SourceStatus["id"],
  url: string,
  itemCount: number,
  fetchedAt: string,
): SourceStatus {
  return {
    id,
    url,
    ok: true,
    status: "ok",
    fetchedAt,
    itemCount,
    required: true,
  };
}

function toRefs(sources: SourceStatus[]): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const source of sources) {
    if ((MODEL_SOURCE_IDS as readonly string[]).includes(source.id)) {
      refs.push({
        id: source.id as SourceRef["id"],
        url: source.url,
        fetchedAt: source.fetchedAt,
      });
    }
  }
  return refs;
}

export async function fetchSources(fixtures: string | null): Promise<FetchedCatalog> {
  if (fixtures) {
    const fetchedAt = new Date().toISOString();
    const [modelsDevRaw, liveRaw, goRaw] = await Promise.all([
      readJson(join(fixtures, "models-dev.sample.json")),
      readJson(join(fixtures, "opencode-models.sample.json")),
      readJson(join(fixtures, "opencode-go-models.sample.json")),
    ]);

    const providers = parseModelsDev(modelsDevRaw);
    const live = parseLiveIds(liveRaw);
    const goLive = parseLiveIds(goRaw);
    const modelCount = providers.reduce(
      (total, provider) => total + Object.keys(provider.models).length,
      0,
    );

    return {
      providers,
      live,
      goLive,
      sources: [
        okStatus("models.dev", MODELS_DEV_URL, modelCount, fetchedAt),
        okStatus("opencode.models", OPENCODE_MODELS_URL, live.size, fetchedAt),
        okStatus("opencode-go.models", OPENCODE_GO_MODELS_URL, goLive.size, fetchedAt),
      ],
    };
  }

  const [modelsDev, liveModels] = await Promise.all([fetchModelsDev(), fetchLiveModels()]);
  return {
    providers: modelsDev.providers,
    live: liveModels.live,
    goLive: liveModels.goLive,
    sources: [modelsDev.source, ...liveModels.sources],
  };
}

export async function runIngest(args: IngestArgs): Promise<Snapshot> {
  const previous = args.dryRun ? null : await readSnapshot();
  const fetched = await fetchSources(args.fixtures);
  const now = new Date().toISOString();

  const models = normalizeCatalog(fetched.providers, {
    now,
    previous,
    live: fetched.live,
    goLive: fetched.goLive,
    sourceRefs: toRefs(fetched.sources),
  });

  const snapshot: Snapshot = {
    schemaVersion: 1,
    generatedAt: now,
    models,
    sources: fetched.sources,
  };

  SnapshotSchema.parse(snapshot);

  if (!args.dryRun) await writeSnapshotAtomic(snapshot);

  console.log(
    `${args.dryRun ? "dry-run: would ingest" : "ingested"} ${models.length} models from ${snapshot.sources.length} sources`,
  );

  return snapshot;
}

async function main(): Promise<void> {
  await runIngest(parseArgs(process.argv.slice(2)));
}

const invokedDirectly =
  process.argv[1] !== undefined && /(?:^|[/\\])run\.ts$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

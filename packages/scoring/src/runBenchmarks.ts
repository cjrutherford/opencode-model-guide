import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { readSnapshot } from "@omg/ingest";
import {
  BenchmarksFileSchema,
  type BenchmarkId,
  type BenchmarkResult,
  type BenchmarksFile,
  type SourceStatus,
  type SourceStatusId,
} from "@omg/shared";

import { loadAliases } from "./aliases";
import { fetchAa, AA_FREE_URL } from "./benchmarks/aa";
import { fetchAider, AIDER_URL } from "./benchmarks/aider";
import {
  LMARENA_CONFIG_IDS,
  LMARENA_SOURCE_URL,
  fetchLmarenaConfig,
} from "./benchmarks/lmarena";
import { fetchSweBench, SWE_BENCH_URL } from "./benchmarks/sweBench";
import {
  terminalBenchAdapter,
  TERMINAL_BENCH_URL,
} from "./benchmarks/terminalBench";
import {
  failedStatus,
  okStatus,
  type AdapterResult,
  type RawBenchmarkResult,
} from "./benchmarks/types";
import { resolveModelName } from "./resolve";

export const DEFAULT_BENCHMARKS_PATH = "data/benchmarks.json";

interface AdapterTask {
  id: SourceStatusId;
  url: string;
  run: () => Promise<AdapterResult>;
}

const BENCHMARK_SOURCE: Partial<Record<BenchmarkId, SourceStatusId>> = {
  "swe-bench-verified": "swe-bench",
  "swe-bench-multilingual": "swe-bench",
  "lmarena-webdev": "lmarena",
  "lmarena-agent": "lmarena",
  "lmarena-text": "lmarena",
  "lmarena-document": "lmarena",
  "aider-polyglot": "aider-polyglot",
  "terminal-bench": "terminal-bench",
  "artificial-analysis": "artificial-analysis",
};

const SOURCE_LABELS: Partial<Record<SourceStatusId, string>> = {
  "swe-bench": "swe-bench",
  lmarena: "lmarena",
  "aider-polyglot": "aider",
  "terminal-bench": "terminal-bench",
  "artificial-analysis": "artificial-analysis",
};

async function fetchAllLmarena(): Promise<AdapterResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const results: RawBenchmarkResult[] = [];
  const errors: string[] = [];

  for (const config of LMARENA_CONFIG_IDS) {
    try {
      const outcome = await fetchLmarenaConfig(config);
      results.push(...outcome.results);
      if (outcome.error) {
        errors.push(`${config}: ${outcome.error}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${config}: ${reason}`);
    }
  }

  if (errors.length === 0) {
    return {
      results,
      status: okStatus(
        "lmarena",
        LMARENA_SOURCE_URL,
        results.length,
        startedAt,
        fetchedAt,
      ),
    };
  }

  const status = failedStatus(
    "lmarena",
    LMARENA_SOURCE_URL,
    errors.join("; "),
    startedAt,
    fetchedAt,
  );
  status.itemCount = results.length;
  return { results, status };
}

function compareRaw(left: RawBenchmarkResult, right: RawBenchmarkResult): number {
  if (left.benchmark !== right.benchmark) {
    return left.benchmark < right.benchmark ? -1 : 1;
  }
  if (left.modelNameRaw !== right.modelNameRaw) {
    return left.modelNameRaw < right.modelNameRaw ? -1 : 1;
  }
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  return 0;
}

function dedupe(results: RawBenchmarkResult[]): RawBenchmarkResult[] {
  const best = new Map<string, RawBenchmarkResult>();
  for (const result of results) {
    const key = `${result.benchmark}\u0000${result.modelNameRaw}`;
    const existing = best.get(key);
    if (existing && existing.date >= result.date) continue;
    best.set(key, result);
  }
  return [...best.values()].sort(compareRaw);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function logResolved(
  sources: SourceStatus[],
  results: BenchmarkResult[],
): void {
  const counts = new Map<SourceStatusId, { rows: number; resolved: number }>();
  for (const result of results) {
    const source = BENCHMARK_SOURCE[result.benchmark];
    if (!source) continue;
    const count = counts.get(source) ?? { rows: 0, resolved: 0 };
    count.rows += 1;
    if (result.modelKey) count.resolved += 1;
    counts.set(source, count);
  }

  const parts: string[] = [];
  for (const status of sources) {
    const label = SOURCE_LABELS[status.id] ?? status.id;
    const count = counts.get(status.id) ?? { rows: 0, resolved: 0 };
    parts.push(`${label}: ${count.rows} rows, ${count.resolved} resolved`);
  }
  console.log(parts.join("; "));
}

export async function runBenchmarks(): Promise<BenchmarksFile> {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    throw new Error("data/snapshot.json is missing; run pnpm ingest first");
  }
  const aliases = await loadAliases();
  const now = new Date().toISOString();

  const tasks: AdapterTask[] = [
    { id: "swe-bench", url: SWE_BENCH_URL, run: fetchSweBench },
    { id: "lmarena", url: LMARENA_SOURCE_URL, run: fetchAllLmarena },
    { id: "aider-polyglot", url: AIDER_URL, run: fetchAider },
    {
      id: "terminal-bench",
      url: TERMINAL_BENCH_URL,
      run: async () => terminalBenchAdapter(now),
    },
    {
      id: "artificial-analysis",
      url: AA_FREE_URL,
      run: () => fetchAa({ now }),
    },
  ];

  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const rawResults: RawBenchmarkResult[] = [];
  const sources: SourceStatus[] = [];

  settled.forEach((outcome, index) => {
    const task = tasks[index]!;
    if (outcome.status === "fulfilled") {
      rawResults.push(...outcome.value.results);
      sources.push(outcome.value.status);
    } else {
      sources.push(
        failedStatus(
          task.id,
          task.url,
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
          Date.now(),
          now,
        ),
      );
    }
  });

  if (rawResults.length === 0) {
    throw new Error("all benchmark adapters returned no rows");
  }

  const resolved: BenchmarkResult[] = dedupe(rawResults).map((raw) => {
    const resolution = resolveModelName(raw.modelNameRaw, snapshot.models, aliases);
    if (resolution.modelKey) {
      return {
        ...raw,
        modelKey: resolution.modelKey,
        match: resolution.match,
        matchConfidence: resolution.confidence,
      };
    }
    return {
      ...raw,
      match: "unmatched",
      matchConfidence: 0,
    };
  });

  const unmatched = [
    ...new Set(
      resolved
        .filter((result) => result.match === "unmatched")
        .map((result) => result.modelNameRaw),
    ),
  ].sort();

  const file: BenchmarksFile = {
    schemaVersion: 1,
    generatedAt: now,
    results: resolved,
    unmatched,
    sources,
  };

  BenchmarksFileSchema.parse(file);
  await writeJsonAtomic(DEFAULT_BENCHMARKS_PATH, file);
  logResolved(sources, resolved);

  return file;
}

async function main(): Promise<void> {
  const file = await runBenchmarks();
  console.log(
    `wrote ${DEFAULT_BENCHMARKS_PATH}: ${file.results.length} results, ${file.unmatched.length} unmatched names`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && /(?:^|[/\\])runBenchmarks\.ts$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

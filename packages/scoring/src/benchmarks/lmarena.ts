import { fetchJson } from "@omg/ingest";
import type { BenchmarkId, MetricType } from "@omg/shared";

import type { JsonFetcher, RawBenchmarkResult } from "./types";

export const LMARENA_SOURCE_URL = "https://lmarena.ai/leaderboard";
export const LMARENA_DATASET_URL =
  "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset";

export type LmarenaConfig = "webdev" | "agent" | "text" | "document";

interface ConfigInfo {
  benchmark: BenchmarkId;
  metric: MetricType;
  field: "rating" | "score";
}

export const LMARENA_CONFIGS: Record<LmarenaConfig, ConfigInfo> = {
  webdev: { benchmark: "lmarena-webdev", metric: "elo", field: "rating" },
  agent: { benchmark: "lmarena-agent", metric: "score", field: "score" },
  text: { benchmark: "lmarena-text", metric: "elo", field: "rating" },
  document: { benchmark: "lmarena-document", metric: "elo", field: "rating" },
};

export const LMARENA_CONFIG_IDS = Object.keys(LMARENA_CONFIGS) as LmarenaConfig[];

interface LmarenaRow {
  model_name?: unknown;
  rating?: unknown;
  score?: unknown;
  category?: unknown;
  leaderboard_publish_date?: unknown;
}

interface LmarenaPage {
  rows?: unknown;
  num_rows_total?: unknown;
}

export interface LmarenaConfigResult {
  results: RawBenchmarkResult[];
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pageUrl(config: LmarenaConfig, offset: number, length: number): string {
  const params = new URLSearchParams({
    dataset: "lmarena-ai/leaderboard-dataset",
    config,
    split: "latest",
    offset: String(offset),
    length: String(length),
  });
  return `https://datasets-server.huggingface.co/rows?${params.toString()}`;
}

export async function parseLmarena(options: {
  fetch: JsonFetcher;
  config: LmarenaConfig;
  pageSize?: number;
  pageDelayMs?: number;
  onPageError?: (error: unknown, offset: number) => void;
}): Promise<RawBenchmarkResult[]> {
  const info = LMARENA_CONFIGS[options.config];
  const pageSize = options.pageSize ?? 100;
  const results: RawBenchmarkResult[] = [];

  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let pages = 0;

  while (offset < total && pages < 200) {
    let payload: LmarenaPage;
    try {
      payload = (await options.fetch(
        pageUrl(options.config, offset, pageSize),
      )) as LmarenaPage;
    } catch (error) {
      if (options.onPageError) {
        options.onPageError(error, offset);
        break;
      }
      throw error;
    }

    const rows = Array.isArray(payload?.rows) ? (payload.rows as Array<{ row?: LmarenaRow }>) : [];
    if (rows.length === 0) break;
    pages += 1;

    for (const item of rows) {
      const row = item?.row;
      if (!row || typeof row !== "object") continue;
      if (typeof row.model_name !== "string" || row.model_name.trim().length === 0) {
        continue;
      }
      if (typeof row.category === "string" && row.category !== "overall") {
        continue;
      }
      const value = row[info.field];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const date = row.leaderboard_publish_date;
      if (typeof date !== "string" || date.length === 0) continue;

      results.push({
        benchmark: info.benchmark,
        metric: info.metric,
        value,
        modelNameRaw: row.model_name.trim(),
        date,
        sourceUrl: LMARENA_SOURCE_URL,
        harness: "LMArena",
      });
    }

    if (typeof payload.num_rows_total === "number" && Number.isFinite(payload.num_rows_total)) {
      total = payload.num_rows_total;
    } else {
      total = offset + rows.length;
    }
    offset += rows.length;

    if (options.pageDelayMs && offset < total) {
      await delay(options.pageDelayMs);
    }
  }

  return results.sort((left, right) =>
    left.modelNameRaw < right.modelNameRaw
      ? -1
      : left.modelNameRaw > right.modelNameRaw
        ? 1
        : 0,
  );
}

export async function fetchLmarenaConfig(
  config: LmarenaConfig,
): Promise<LmarenaConfigResult> {
  let pageError: string | undefined;
  const fetcher: JsonFetcher = async (url) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fetchJson("lmarena", url);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          const message = error instanceof Error ? error.message : String(error);
          await delay(message.includes("429") ? 30_000 : 1_000 * (attempt + 1));
        }
      }
    }
    throw lastError;
  };

  const results = await parseLmarena({
    fetch: fetcher,
    config,
    pageDelayMs: config === "text" ? 1_500 : 200,
    onPageError: (error, offset) => {
      pageError = `page at offset ${offset}: ${describe(error)}`;
    },
  });

  if (!pageError && results.length === 0) {
    pageError = `LMArena ${config} returned no rows`;
  }

  return { results, error: pageError };
}

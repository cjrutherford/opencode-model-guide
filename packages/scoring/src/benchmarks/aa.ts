import { fetchJson } from "@omg/ingest";

import {
  failedStatus,
  okStatus,
  skippedStatus,
  type AdapterResult,
  type JsonFetcher,
  type RawBenchmarkResult,
} from "./types";

export const AA_FREE_URL =
  "https://artificialanalysis.ai/api/v2/language/models/free";
export const AA_SOURCE_URL = "https://artificialanalysis.ai/";

interface AaModel {
  name?: unknown;
  evaluations?: unknown;
}

interface AaPage {
  tier?: unknown;
  intelligence_index_version?: unknown;
  pagination?: { has_more?: unknown };
  data?: unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseAaPage(
  payload: AaPage,
  opts: { date: string },
): RawBenchmarkResult[] {
  if (!Array.isArray(payload?.data)) {
    throw new Error("Artificial Analysis response has no data array");
  }

  const tier = stringOrNull(payload.tier);
  const intelligenceIndexVersion = numberOrNull(payload.intelligence_index_version);
  const results: RawBenchmarkResult[] = [];

  for (const raw of payload.data as AaModel[]) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) continue;

    const evaluations =
      raw.evaluations && typeof raw.evaluations === "object"
        ? (raw.evaluations as Record<string, unknown>)
        : {};
    const coding = numberOrNull(
      evaluations.artificial_analysis_coding_index,
    );
    if (coding === null) continue;

    results.push({
      benchmark: "artificial-analysis",
      metric: "score",
      value: coding,
      modelNameRaw: raw.name.trim(),
      date: opts.date,
      sourceUrl: AA_SOURCE_URL,
      harness: "AA Coding Index",
      meta: {
        intelligence: numberOrNull(
          evaluations.artificial_analysis_intelligence_index,
        ),
        agentic: numberOrNull(
          evaluations.artificial_analysis_agentic_index,
        ),
        coding,
        intelligenceIndexVersion,
        tier,
      },
    });
  }

  return results;
}

export async function fetchAa(options: {
  apiKey?: string;
  fetch?: JsonFetcher;
  now?: string;
} = {}): Promise<AdapterResult> {
  const fetchedAt = options.now ?? new Date().toISOString();
  const apiKey = options.apiKey ?? process.env.AA_API_KEY;

  if (!apiKey) {
    return {
      results: [],
      status: skippedStatus(
        "artificial-analysis",
        AA_FREE_URL,
        "AA_API_KEY is not set",
        fetchedAt,
      ),
    };
  }

  const startedAt = Date.now();
  const fetcher: JsonFetcher =
    options.fetch ??
    ((url, init) =>
      fetchJson("artificial-analysis", url, {
        ...init,
        headers: { ...init?.headers, "x-api-key": apiKey },
      }));

  try {
    const date = fetchedAt.slice(0, 10);
    const results: RawBenchmarkResult[] = [];

    let page = 1;
    let hasMore = true;
    while (hasMore && page <= 100) {
      const payload = (await fetcher(`${AA_FREE_URL}?page=${page}`)) as AaPage;
      results.push(...parseAaPage(payload, { date }));
      hasMore = payload?.pagination?.has_more === true;
      if (hasMore && (!Array.isArray(payload?.data) || payload.data.length === 0)) {
        break;
      }
      page += 1;
    }

    if (results.length === 0) {
      return {
        results: [],
        status: failedStatus(
          "artificial-analysis",
          AA_FREE_URL,
          "no models with a coding index",
          startedAt,
          fetchedAt,
          false,
        ),
      };
    }

    return {
      results,
      status: okStatus(
        "artificial-analysis",
        AA_FREE_URL,
        results.length,
        startedAt,
        fetchedAt,
        false,
      ),
    };
  } catch (error) {
    return {
      results: [],
      status: failedStatus(
        "artificial-analysis",
        AA_FREE_URL,
        error instanceof Error ? error.message : String(error),
        startedAt,
        fetchedAt,
        false,
      ),
    };
  }
}

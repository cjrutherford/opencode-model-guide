import { fetchText } from "@omg/ingest";
import type { BenchmarkId } from "@omg/shared";

import {
  failedStatus,
  okStatus,
  type AdapterResult,
  type RawBenchmarkResult,
} from "./types";

export const SWE_BENCH_URL = "https://www.swebench.com/";

const BOARD_IDS: Record<string, BenchmarkId> = {
  Verified: "swe-bench-verified",
  Multilingual: "swe-bench-multilingual",
};

interface SweBenchRow {
  agent?: unknown;
  model_display?: unknown;
  name?: unknown;
  resolved?: unknown;
  instance_cost?: unknown;
  date?: unknown;
}

interface SweBenchBoard {
  name?: unknown;
  results?: unknown;
}

function rowName(row: SweBenchRow): string | null {
  for (const candidate of [row.model_display, row.name]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function rowDate(row: SweBenchRow): string | null {
  return typeof row.date === "string" && row.date.length > 0 ? row.date : null;
}

export function parseSweBench(html: string): RawBenchmarkResult[] {
  const match = /<script[^>]*\bid=["']leaderboard-data["'][^>]*>([\s\S]*?)<\/script>/i.exec(
    html,
  );
  if (!match) {
    throw new Error("SWE-bench leaderboard-data script was not found");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(match[1]!);
  } catch (error) {
    throw new Error(
      `SWE-bench leaderboard JSON is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!Array.isArray(payload)) {
    throw new Error("SWE-bench leaderboard JSON is not an array");
  }

  const best = new Map<string, RawBenchmarkResult>();

  for (const board of payload as SweBenchBoard[]) {
    if (!board || typeof board !== "object") continue;
    const benchmark = typeof board.name === "string" ? BOARD_IDS[board.name] : undefined;
    if (!benchmark || !Array.isArray(board.results)) continue;

    for (const raw of board.results as SweBenchRow[]) {
      if (!raw || typeof raw !== "object") continue;
      if (raw.agent !== "mini-SWE-agent") continue;
      if (typeof raw.resolved !== "number" || !Number.isFinite(raw.resolved)) continue;

      const modelNameRaw = rowName(raw);
      const date = rowDate(raw);
      if (!modelNameRaw || !date) continue;

      const key = `${benchmark}|${modelNameRaw}`;
      const existing = best.get(key);
      if (existing && existing.date >= date) continue;

      const result: RawBenchmarkResult = {
        benchmark,
        metric: "percent",
        value: raw.resolved,
        modelNameRaw,
        date,
        sourceUrl: SWE_BENCH_URL,
        harness: "mini-SWE-agent",
      };

      if (
        typeof raw.instance_cost === "number" &&
        Number.isFinite(raw.instance_cost) &&
        raw.instance_cost >= 0
      ) {
        result.costPerTaskUsd = raw.instance_cost;
      }

      best.set(key, result);
    }
  }

  return [...best.values()].sort((left, right) => {
    if (left.benchmark !== right.benchmark) {
      if (left.benchmark === "swe-bench-verified") return -1;
      if (right.benchmark === "swe-bench-verified") return 1;
      return left.benchmark < right.benchmark ? -1 : 1;
    }
    return left.modelNameRaw < right.modelNameRaw
      ? -1
      : left.modelNameRaw > right.modelNameRaw
        ? 1
        : 0;
  });
}

export async function fetchSweBench(): Promise<AdapterResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();

  try {
    const html = await fetchText("swe-bench", SWE_BENCH_URL);
    const results = parseSweBench(html);
    if (results.length === 0) {
      return {
        results: [],
        status: failedStatus(
          "swe-bench",
          SWE_BENCH_URL,
          "no mini-SWE-agent rows found",
          startedAt,
          fetchedAt,
        ),
      };
    }
    return {
      results,
      status: okStatus("swe-bench", SWE_BENCH_URL, results.length, startedAt, fetchedAt),
    };
  } catch (error) {
    return {
      results: [],
      status: failedStatus(
        "swe-bench",
        SWE_BENCH_URL,
        error instanceof Error ? error.message : String(error),
        startedAt,
        fetchedAt,
      ),
    };
  }
}

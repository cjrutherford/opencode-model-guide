import { fetchText } from "@omg/ingest";
import { parse } from "yaml";

import {
  failedStatus,
  okStatus,
  type AdapterResult,
  type RawBenchmarkResult,
} from "./types";

export const AIDER_URL =
  "https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml";

interface AiderRow {
  model?: unknown;
  date?: unknown;
  pass_rate_2?: unknown;
}

function dateString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

export function parseAider(yamlText: string): RawBenchmarkResult[] {
  const payload: unknown = parse(yamlText);
  if (!Array.isArray(payload)) {
    throw new Error("Aider leaderboard YAML is not an array");
  }

  const best = new Map<string, RawBenchmarkResult>();

  for (const raw of payload as AiderRow[]) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.model !== "string" || raw.model.trim().length === 0) continue;
    if (
      typeof raw.pass_rate_2 !== "number" ||
      !Number.isFinite(raw.pass_rate_2)
    ) {
      continue;
    }

    const modelNameRaw = raw.model.trim();
    const date = dateString(raw.date);
    if (!date) continue;

    const existing = best.get(modelNameRaw);
    if (existing && existing.date >= date) continue;

    best.set(modelNameRaw, {
      benchmark: "aider-polyglot",
      metric: "percent",
      value: raw.pass_rate_2,
      modelNameRaw,
      date,
      sourceUrl: AIDER_URL,
      harness: "aider-polyglot",
    });
  }

  return [...best.values()].sort((left, right) =>
    left.modelNameRaw < right.modelNameRaw
      ? -1
      : left.modelNameRaw > right.modelNameRaw
        ? 1
        : 0,
  );
}

export async function fetchAider(): Promise<AdapterResult> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();

  try {
    const yamlText = await fetchText("aider-polyglot", AIDER_URL);
    const results = parseAider(yamlText);
    if (results.length === 0) {
      return {
        results: [],
        status: failedStatus(
          "aider-polyglot",
          AIDER_URL,
          "no Aider polyglot rows found",
          startedAt,
          fetchedAt,
        ),
      };
    }
    return {
      results,
      status: okStatus(
        "aider-polyglot",
        AIDER_URL,
        results.length,
        startedAt,
        fetchedAt,
      ),
    };
  } catch (error) {
    return {
      results: [],
      status: failedStatus(
        "aider-polyglot",
        AIDER_URL,
        error instanceof Error ? error.message : String(error),
        startedAt,
        fetchedAt,
      ),
    };
  }
}

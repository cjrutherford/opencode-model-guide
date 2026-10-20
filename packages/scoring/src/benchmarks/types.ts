import type {
  BenchmarkId,
  MetricType,
  SourceStatus,
  SourceStatusId,
} from "@omg/shared";

export interface RawBenchmarkResult {
  benchmark: BenchmarkId;
  metric: MetricType;
  value: number;
  modelNameRaw: string;
  date: string;
  sourceUrl: string;
  harness?: string;
  costPerTaskUsd?: number;
  tokensPerTask?: number;
  meta?: Record<string, number | string | null>;
}

export interface AdapterResult {
  results: RawBenchmarkResult[];
  status: SourceStatus;
}

export type JsonFetcher = (url: string, init?: RequestInit) => Promise<unknown>;

export function okStatus(
  id: SourceStatusId,
  url: string,
  itemCount: number,
  startedAt: number,
  fetchedAt: string,
  required = true,
): SourceStatus {
  return {
    id,
    url,
    ok: true,
    status: "ok",
    fetchedAt,
    durationMs: Math.max(0, Date.now() - startedAt),
    itemCount,
    required,
  };
}

export function failedStatus(
  id: SourceStatusId,
  url: string,
  error: string,
  startedAt: number,
  fetchedAt: string,
  required = true,
): SourceStatus {
  return {
    id,
    url,
    ok: false,
    status: "failed",
    fetchedAt,
    durationMs: Math.max(0, Date.now() - startedAt),
    error,
    required,
  };
}

export function skippedStatus(
  id: SourceStatusId,
  url: string,
  reason: string,
  fetchedAt: string,
): SourceStatus {
  return {
    id,
    url,
    ok: false,
    status: "skipped",
    fetchedAt,
    itemCount: 0,
    reason,
    required: false,
  };
}

import {
  USE_CASE_IDS,
  type BenchmarksFile,
  type Snapshot,
  type SourceStatus,
  type SourceStatusId,
  type UseCaseId,
} from "@omg/shared";

import type { SiteData } from "./data";
import { isFreeNow } from "./models";

export const SOURCE_WARNING_AFTER_HOURS = 48;
export const SOURCE_ERROR_AFTER_HOURS = 7 * 24;

export type StalenessLevel = "fresh" | "warning" | "error" | "unknown";

export interface Staleness {
  level: StalenessLevel;
  ageHours: number | null;
  label: string;
}

export interface SourceHealthRow {
  id: SourceStatusId;
  url: string;
  status: SourceStatus["status"];
  ok: boolean;
  fetchedAt: string;
  ageHours: number | null;
  staleness: Staleness;
  durationMs?: number;
  itemCount?: number;
  error?: string;
  reason?: string;
  required: boolean;
  kind: "catalog" | "benchmarks";
}

export interface UnmatchedBenchmarkRow {
  name: string;
  benchmark: string;
  date: string;
  sourceUrl: string;
}

export interface ConflictRow {
  modelKey: string;
  modelName: string;
  field: string;
  values: Array<{ source: string; value: unknown }>;
  resolution: "preferred" | "unresolved";
  note?: string;
}

export interface UseCaseCoverage {
  useCase: UseCaseId;
  rated: number;
  total: number;
  coverage: number;
}

export interface HealthData {
  sources: SourceHealthRow[];
  counts: {
    models: number;
    freeNow: number;
    zeroMarginal: number;
    benchmarkResults: number;
    resolvedBenchmarks: number;
    unmatchedBenchmarks: number;
    unmatchedNames: number;
    scoreRecords: number;
    ratedModels: number;
    conflicts: number;
  };
  useCases: UseCaseCoverage[];
  unmatched: UnmatchedBenchmarkRow[];
  conflicts: ConflictRow[];
  generatedAt: {
    snapshot: string;
    benchmarks: string;
    scores: string;
  };
}

function toTimestamp(value: string | Date): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Classify a source refresh by age. The page treats 48h as a warning and 7d as
 * an error so a silent daily-pipeline failure becomes visible.
 */
export function sourceStaleness(
  fetchedAt: string,
  now: string | Date = new Date(),
): Staleness {
  const fetched = toTimestamp(fetchedAt);
  const current = toTimestamp(now);
  if (!Number.isFinite(fetched) || !Number.isFinite(current)) {
    return { level: "unknown", ageHours: null, label: "Unknown fetch time" };
  }

  const ageHours = Math.max(0, (current - fetched) / 3_600_000);
  if (ageHours > SOURCE_ERROR_AFTER_HOURS) {
    return { level: "error", ageHours, label: "Older than 7 days" };
  }
  if (ageHours > SOURCE_WARNING_AFTER_HOURS) {
    return { level: "warning", ageHours, label: "Older than 48 hours" };
  }
  return { level: "fresh", ageHours, label: "Fresh" };
}

function sourceRow(
  source: SourceStatus,
  kind: SourceHealthRow["kind"],
  now: string | Date,
): SourceHealthRow {
  const staleness = sourceStaleness(source.fetchedAt, now);
  return {
    id: source.id,
    url: source.url,
    status: source.status,
    ok: source.ok,
    fetchedAt: source.fetchedAt,
    ageHours: staleness.ageHours,
    staleness,
    ...(source.durationMs !== undefined
      ? { durationMs: source.durationMs }
      : {}),
    ...(source.itemCount !== undefined ? { itemCount: source.itemCount } : {}),
    ...(source.error ? { error: source.error } : {}),
    ...(source.reason ? { reason: source.reason } : {}),
    required: source.required ?? false,
    kind,
  };
}

function benchmarkSources(
  benchmarks: BenchmarksFile,
  now: string | Date,
): SourceHealthRow[] {
  return benchmarks.sources.map((source) =>
    sourceRow(source, "benchmarks", now),
  );
}

function conflictRows(snapshot: Snapshot): ConflictRow[] {
  return snapshot.models.flatMap((model) =>
    model.conflicts.map((conflict) => ({
      modelKey: model.key,
      modelName: model.name,
      field: conflict.field,
      values: conflict.values,
      resolution: conflict.resolution,
      ...(conflict.note ? { note: conflict.note } : {}),
    })),
  );
}

function useCaseCoverage(data: SiteData): UseCaseCoverage[] {
  const total = data.scores.scores.length;
  return USE_CASE_IDS.map((useCase) => {
    const rated = data.scores.scores.filter(
      (score) => score.useCases[useCase]?.tier !== "unrated",
    ).length;
    return {
      useCase,
      rated,
      total,
      coverage: total > 0 ? rated / total : 0,
    };
  });
}

/**
 * Derive all `/health` data from committed snapshots. No network access is
 * allowed here; source failures and staleness are facts already recorded in the
 * data files.
 */
export function buildHealth(
  data: SiteData,
  now: string | Date = new Date(),
): HealthData {
  const sources = [
    ...data.snapshot.sources.map((source) =>
      sourceRow(source, "catalog", now),
    ),
    ...benchmarkSources(data.benchmarks, now),
  ];
  const unmatched = data.benchmarks.results
    .filter((result) => result.match === "unmatched")
    .map((result) => ({
      name: result.modelNameRaw,
      benchmark: result.benchmark,
      date: result.date,
      sourceUrl: result.sourceUrl,
    }))
    .sort((left, right) => {
      const name = left.name.localeCompare(right.name);
      return name !== 0 ? name : left.date.localeCompare(right.date);
    });
  const conflicts = conflictRows(data.snapshot);
  const ratedModels = data.scores.scores.filter((score) =>
    USE_CASE_IDS.some(
      (useCase) => score.useCases[useCase]?.tier !== "unrated",
    ),
  ).length;
  const resolvedBenchmarks = data.benchmarks.results.filter(
    (result) => result.match !== "unmatched",
  ).length;

  return {
    sources,
    counts: {
      models: data.snapshot.models.length,
      freeNow: data.snapshot.models.filter(isFreeNow).length,
      zeroMarginal: data.snapshot.models.filter(
        (model) => model.free.kind !== "paid",
      ).length,
      benchmarkResults: data.benchmarks.results.length,
      resolvedBenchmarks,
      unmatchedBenchmarks: data.benchmarks.results.length - resolvedBenchmarks,
      unmatchedNames: new Set(
        data.benchmarks.results
          .filter((result) => result.match === "unmatched")
          .map((result) => result.modelNameRaw),
      ).size,
      scoreRecords: data.scores.scores.length,
      ratedModels,
      conflicts: conflicts.length,
    },
    useCases: useCaseCoverage(data),
    unmatched,
    conflicts,
    generatedAt: {
      snapshot: data.snapshot.generatedAt,
      benchmarks: data.benchmarks.generatedAt,
      scores: data.scores.generatedAt,
    },
  };
}

import {
  BENCHMARK_IDS,
  USE_CASE_IDS,
  type BenchmarkId,
  type BenchmarkResult,
  type ChangeEvent,
  type ModelRecord,
  type RatedTier,
  type ScoreRecord,
  type Tier,
  type UseCaseId,
} from "@omg/shared";

import type { SiteData } from "./data";
import type { FilterRow } from "./filters";
import { BENCHMARK_LABELS } from "./format";
import { url } from "./url";

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isFreeNow(model: ModelRecord): boolean {
  return (
    model.availability === "live" &&
    (model.free.kind === "open-free" ||
      model.free.kind === "limited-time" ||
      model.free.kind === "trial")
  );
}

export function isZeroMarginal(model: ModelRecord): boolean {
  return model.free.kind !== "paid";
}

export interface ModelIndexes {
  byKey: Map<string, ModelRecord>;
  scoreByKey: Map<string, ScoreRecord>;
  slugToKey: Map<string, string>;
  benchmarksByKey: Map<string, BenchmarkResult[]>;
  eventsByKey: Map<string, ChangeEvent[]>;
}

export function buildModelIndexes(data: SiteData): ModelIndexes {
  const byKey = new Map(data.snapshot.models.map((model) => [model.key, model]));
  const scoreByKey = new Map(
    data.scores.scores.map((score) => [score.modelKey, score]),
  );
  const slugToKey = new Map(
    data.snapshot.models.map((model) => [slugify(model.key), model.key]),
  );
  const benchmarksByKey = new Map<string, BenchmarkResult[]>();
  const eventsByKey = new Map<string, ChangeEvent[]>();

  for (const result of data.benchmarks.results) {
    if (result.match === "unmatched" || !result.modelKey) continue;
    const rows = benchmarksByKey.get(result.modelKey) ?? [];
    rows.push(result);
    benchmarksByKey.set(result.modelKey, rows);
  }

  for (const event of data.events) {
    const rows = eventsByKey.get(event.modelKey) ?? [];
    rows.push(event);
    eventsByKey.set(event.modelKey, rows);
  }

  return { byKey, scoreByKey, slugToKey, benchmarksByKey, eventsByKey };
}

export interface RatedUseCase {
  useCase: UseCaseId;
  score: number;
  tier: RatedTier;
  confidence: number;
}

export function bestRatedUseCase(
  score: ScoreRecord | undefined,
): RatedUseCase | undefined {
  if (!score) return undefined;

  let best: RatedUseCase | undefined;
  for (const useCase of USE_CASE_IDS) {
    const candidate = score.useCases[useCase];
    if (
      !candidate ||
      candidate.tier === "unrated" ||
      candidate.score === null ||
      !Number.isFinite(candidate.score)
    ) {
      continue;
    }

    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score &&
        candidate.confidence > best.confidence)
    ) {
      best = {
        useCase,
        score: candidate.score,
        tier: candidate.tier,
        confidence: candidate.confidence,
      };
    }
  }

  return best;
}

export function topByUseCase(
  useCase: UseCaseId,
  scores: ScoreRecord[],
): ScoreRecord | undefined {
  let best: ScoreRecord | undefined;
  let bestScore: RatedUseCase | undefined;

  for (const record of scores) {
    const candidate = record.useCases[useCase];
    if (
      !candidate ||
      candidate.tier === "unrated" ||
      candidate.score === null ||
      !Number.isFinite(candidate.score)
    ) {
      continue;
    }

    if (
      !best ||
      !bestScore ||
      candidate.score > bestScore.score ||
      (candidate.score === bestScore.score &&
        candidate.confidence > bestScore.confidence) ||
      (candidate.score === bestScore.score &&
        candidate.confidence === bestScore.confidence &&
        record.modelKey < best.modelKey)
    ) {
      best = record;
      bestScore = {
        useCase,
        score: candidate.score,
        tier: candidate.tier,
        confidence: candidate.confidence,
      };
    }
  }

  return best;
}

export function profileCost(
  score: ScoreRecord | undefined,
  profile: "quick-edit" | "agentic-pr" | "long-context",
): number | null {
  const value = score?.cost.profiles[profile];
  return value !== undefined && value !== null && Number.isFinite(value)
    ? value
    : null;
}

export function agenticCost(score: ScoreRecord | undefined): number | null {
  return profileCost(score, "agentic-pr");
}

export interface ModelRow extends FilterRow {
  slug: string;
  href: string;
  freeFlags: string[];
  freeStatus?: "confirmed" | "uncertain";
  quickCost: number | null;
  tierUseCase?: UseCaseId;
  releaseDate?: string;
}

export function buildModelRow(
  model: ModelRecord,
  score: ScoreRecord | undefined,
): ModelRow {
  const best = bestRatedUseCase(score);
  const slug = slugify(model.key);

  return {
    key: model.key,
    slug,
    href: url(`/models/${slug}/`),
    name: model.name,
    provider: model.provider,
    availability: model.availability,
    freeKind: model.free.kind,
    freeFlags: model.free.flags,
    ...(model.free.status ? { freeStatus: model.free.status } : {}),
    freeNow: isFreeNow(model),
    zeroMarginal: isZeroMarginal(model),
    context: model.limits.context,
    agenticCost: agenticCost(score),
    quickCost: profileCost(score, "quick-edit"),
    tier: best?.tier ?? "unrated",
    score: best?.score ?? null,
    ...(best ? { tierUseCase: best.useCase } : {}),
    ...(model.releaseDate ? { releaseDate: model.releaseDate } : {}),
  };
}

export function buildModelRows(data: SiteData): ModelRow[] {
  const scores = new Map(
    data.scores.scores.map((score) => [score.modelKey, score]),
  );

  return data.snapshot.models
    .map((model) => buildModelRow(model, scores.get(model.key)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export interface CompareRow {
  key: string;
  slug: string;
  href: string;
  name: string;
  provider: ModelRecord["provider"];
  freeKind: ModelRecord["free"]["kind"];
  freeStatus?: "confirmed" | "uncertain";
  availability: ModelRecord["availability"];
  pricingKnown: boolean;
  context: number;
  output: number;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  agenticCost: number | null;
  quickCost: number | null;
  longContextCost: number | null;
  agenticTier: Tier;
  frontendTier: Tier;
  longContextTier: Tier;
  agenticConfidence: number | null;
  frontendConfidence: number | null;
  longContextConfidence: number | null;
  bestTier: Tier;
  bestConfidence: number | null;
}

export function tierFor(
  score: ScoreRecord | undefined,
  useCase: UseCaseId,
): Tier {
  return score?.useCases[useCase]?.tier ?? "unrated";
}

export function confidenceFor(
  score: ScoreRecord | undefined,
  useCase: UseCaseId,
): number | null {
  const value = score?.useCases[useCase];
  if (!value || value.tier === "unrated" || value.score === null) return null;
  return Number.isFinite(value.confidence) ? value.confidence : null;
}

export function buildCompareRow(
  model: ModelRecord,
  score: ScoreRecord | undefined,
): CompareRow {
  const best = bestRatedUseCase(score);
  const pricesKnown = model.pricing.pricingKnown;
  const slug = slugify(model.key);

  return {
    key: model.key,
    slug,
    href: url(`/models/${slug}/`),
    name: model.name,
    provider: model.provider,
    freeKind: model.free.kind,
    ...(model.free.status ? { freeStatus: model.free.status } : {}),
    availability: model.availability,
    pricingKnown: pricesKnown,
    context: model.limits.context,
    output: model.limits.output,
    inputPrice: pricesKnown ? model.pricing.input : null,
    outputPrice: pricesKnown ? model.pricing.output : null,
    cacheRead: pricesKnown ? (model.pricing.cacheRead ?? null) : null,
    cacheWrite: pricesKnown ? (model.pricing.cacheWrite ?? null) : null,
    agenticCost: agenticCost(score),
    quickCost: profileCost(score, "quick-edit"),
    longContextCost: profileCost(score, "long-context"),
    agenticTier: tierFor(score, "agentic-coding"),
    frontendTier: tierFor(score, "frontend"),
    longContextTier: tierFor(score, "long-context"),
    agenticConfidence: confidenceFor(score, "agentic-coding"),
    frontendConfidence: confidenceFor(score, "frontend"),
    longContextConfidence: confidenceFor(score, "long-context"),
    bestTier: best?.tier ?? "unrated",
    bestConfidence: best?.confidence ?? null,
  };
}

export function buildCompareRows(data: SiteData): CompareRow[] {
  const scores = new Map(
    data.scores.scores.map((score) => [score.modelKey, score]),
  );

  return data.snapshot.models
    .map((model) => buildCompareRow(model, scores.get(model.key)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export interface BenchmarkRow {
  benchmark: BenchmarkId;
  label: string;
  value: number;
  metric: BenchmarkResult["metric"];
  percentile: number;
  date: string;
  sourceUrl: string;
  harness?: string;
}

export function benchmarkRowsForModel(
  score: ScoreRecord | undefined,
  benchmarksByKey: Map<string, BenchmarkResult[]>,
): BenchmarkRow[] {
  if (!score) return [];
  const results = benchmarksByKey.get(score.modelKey) ?? [];
  const rows: BenchmarkRow[] = [];

  for (const benchmark of BENCHMARK_IDS) {
    const selected = score.benchmarks[benchmark];
    if (!selected) continue;

    const candidates = results.filter(
      (result) => result.benchmark === benchmark,
    );
    const result = candidates.find(
      (candidate) =>
        candidate.value === selected.value && candidate.date === selected.date,
    );

    if (!result) continue;

    rows.push({
      benchmark,
      label: BENCHMARK_LABELS[benchmark],
      value: selected.value,
      metric: result.metric,
      percentile: selected.percentile,
      date: selected.date,
      sourceUrl: result.sourceUrl,
      ...(result.harness ? { harness: result.harness } : {}),
    });
  }

  return rows;
}

export function sweBenchMeasuredCost(
  score: ScoreRecord | undefined,
  benchmarksByKey: Map<string, BenchmarkResult[]>,
): BenchmarkResult | undefined {
  if (!score) return undefined;
  return (benchmarksByKey.get(score.modelKey) ?? [])
    .filter(
      (result) =>
        result.benchmark === "swe-bench-verified" ||
        result.benchmark === "swe-bench-multilingual",
    )
    .filter(
      (result) =>
        result.costPerTaskUsd !== undefined &&
        Number.isFinite(result.costPerTaskUsd),
    )
    .sort((left, right) => right.date.localeCompare(left.date))[0];
}

export function relatedModels(
  model: ModelRecord,
  models: ModelRecord[],
  limit = 3,
): ModelRecord[] {
  return models
    .filter((candidate) => candidate.key !== model.key)
    .filter(
      (candidate) =>
        (model.family !== undefined && candidate.family === model.family) ||
        candidate.provider === model.provider,
    )
    .sort((left, right) => {
      const leftFamily =
        model.family !== undefined && left.family === model.family ? 0 : 1;
      const rightFamily =
        model.family !== undefined && right.family === model.family ? 0 : 1;
      return leftFamily - rightFamily || left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

export function modelHref(model: ModelRecord): string {
  return url(`/models/${slugify(model.key)}/`);
}

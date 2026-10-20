import {
  COST_PROFILES,
  COST_PROFILE_IDS,
  FRESHNESS,
  TIER_THRESHOLDS,
  USE_CASE_IDS,
  USE_CASE_WEIGHTS,
  type BenchmarkId,
  type BenchmarkResult,
  type BenchmarkScore,
  type BenchmarksFile,
  type CostProfileId,
  type ModelRecord,
  type ScoreRecord,
  type Snapshot,
  type Tier,
  type UseCaseId,
  type UseCaseScore,
} from "@omg/shared";

import { goEffectiveCost, taskCost } from "./cost";
import { percentileRank } from "./percentile";

export interface ScoreInput {
  snapshot: Snapshot;
  benchmarks: BenchmarksFile;
  now: string;
}

const LONG_CONTEXT_MIN = 200_000;
const MIN_RATED_COVERAGE = 0.5;
const MIN_RATED_CONFIDENCE = 0.3;
const DAY_MS = 86_400_000;

function dateValue(date: string): number {
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function newer(left: BenchmarkResult, right: BenchmarkResult): BenchmarkResult {
  return dateValue(right.date) > dateValue(left.date) ? right : left;
}

function freshnessFor(ageDays: number): number {
  for (const bucket of FRESHNESS) {
    if (ageDays <= bucket.maxDays) return bucket.factor;
  }
  return 0.2;
}

function tierFor(score: number): Tier {
  for (const threshold of TIER_THRESHOLDS) {
    if (score >= threshold.min) return threshold.tier;
  }
  return "unrated";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isFreeNow(model: ModelRecord): boolean {
  return (
    model.free.kind === "open-free" ||
    model.free.kind === "limited-time" ||
    model.free.kind === "trial"
  );
}

function costForModel(model: ModelRecord): {
  profiles: Record<CostProfileId, number | null>;
  goEffective?: Record<CostProfileId, number | null>;
} {
  const profiles = {} as Record<CostProfileId, number | null>;
  const free = isFreeNow(model);

  for (const profile of COST_PROFILE_IDS) {
    profiles[profile] = free ? 0 : taskCost(model.pricing, COST_PROFILES[profile]);
  }

  if (model.subscription && model.subscription.monthlyUsd > 0 && model.subscription.includedUsageUsd > 0) {
    const goEffective = {} as Record<CostProfileId, number | null>;
    for (const profile of COST_PROFILE_IDS) {
      goEffective[profile] = goEffectiveCost(
        profiles[profile],
        model.subscription.monthlyUsd,
        model.subscription.includedUsageUsd,
      );
    }
    return { profiles, goEffective };
  }

  return { profiles };
}

function benchmarkScores(
  benchmarks: BenchmarksFile,
  modelKeys: Set<string>,
): Map<string, Partial<Record<BenchmarkId, BenchmarkScore>>> {
  const grouped = new Map<BenchmarkId, Map<string, BenchmarkResult>>();

  for (const result of benchmarks.results) {
    if (!result.modelKey) continue;
    if (!modelKeys.has(result.modelKey)) {
      console.warn(
        `[score] ignoring ${result.benchmark} result for unknown model ${result.modelKey}`,
      );
      continue;
    }

    let group = grouped.get(result.benchmark);
    if (!group) {
      group = new Map();
      grouped.set(result.benchmark, group);
    }

    const existing = group.get(result.modelKey);
    if (existing) {
      console.warn(
        `[score] ${result.benchmark}: multiple results for ${result.modelKey}; keeping the newest`,
      );
      group.set(result.modelKey, newer(existing, result));
    } else {
      group.set(result.modelKey, result);
    }
  }

  const scores = new Map<string, Partial<Record<BenchmarkId, BenchmarkScore>>>();

  for (const [benchmark, group] of grouped) {
    const values = [...group.values()].map((result) => result.value);
    if (values.length < 5) {
      console.warn(
        `[score] ${benchmark} has only ${values.length} models; percentiles are noisy`,
      );
    }

    for (const [modelKey, result] of group) {
      let modelScores = scores.get(modelKey);
      if (!modelScores) {
        modelScores = {};
        scores.set(modelKey, modelScores);
      }
      modelScores[benchmark] = {
        percentile: percentileRank(result.value, values),
        value: result.value,
        date: result.date,
      };
    }
  }

  return scores;
}

function useCaseScores(
  model: ModelRecord,
  benchmarks: Partial<Record<BenchmarkId, BenchmarkScore>>,
  nowMs: number,
): Record<UseCaseId, UseCaseScore> {
  const useCases = {} as Record<UseCaseId, UseCaseScore>;

  for (const useCase of USE_CASE_IDS) {
    const weights = USE_CASE_WEIGHTS[useCase] as Partial<
      Record<BenchmarkId, number>
    >;
    let availableWeight = 0;
    let weighted = 0;
    let oldestMs = Number.POSITIVE_INFINITY;
    let invalidDate = false;

    for (const [benchmark, weight] of Object.entries(weights) as Array<
      [BenchmarkId, number]
    >) {
      const score = benchmarks[benchmark];
      if (!score) continue;

      availableWeight += weight;
      weighted += score.percentile * weight;

      const parsed = Date.parse(score.date);
      if (Number.isFinite(parsed)) {
        oldestMs = Math.min(oldestMs, parsed);
      } else {
        invalidDate = true;
      }
    }

    if (availableWeight === 0) {
      useCases[useCase] = { score: null, tier: "unrated", confidence: 0 };
      continue;
    }

    const rawScore = weighted / availableWeight;
    const ageDays =
      invalidDate || oldestMs === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(0, (nowMs - oldestMs) / DAY_MS);
    const confidence = clamp01(availableWeight * freshnessFor(ageDays));

    if (useCase === "long-context" && model.limits.context < LONG_CONTEXT_MIN) {
      useCases[useCase] = {
        score: null,
        tier: "unrated",
        confidence,
      };
      continue;
    }

    if (
      availableWeight < MIN_RATED_COVERAGE ||
      confidence < MIN_RATED_CONFIDENCE
    ) {
      useCases[useCase] = {
        score: rawScore,
        tier: "unrated",
        confidence,
      };
      continue;
    }

    useCases[useCase] = {
      score: rawScore,
      tier: tierFor(rawScore),
      confidence,
    };
  }

  return useCases;
}

export function scoreModels(input: ScoreInput): ScoreRecord[] {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`invalid score timestamp: ${input.now}`);
  }

  const modelKeys = new Set(input.snapshot.models.map((model) => model.key));
  const benchmarksByModel = benchmarkScores(input.benchmarks, modelKeys);

  // Console and Go list the same underlying model under different keys. Benchmark
  // evidence belongs to the model, while free terms and costs belong to the listing.
  // Share evidence by id so a Go listing is not unrated only because the benchmark
  // name resolved to the Console key. Percentiles are computed before this merge, so
  // a provider twin does not get counted twice in the ranking population.
  const benchmarksById = new Map<
    string,
    Partial<Record<BenchmarkId, BenchmarkScore>>
  >();
  for (const model of input.snapshot.models) {
    const own = benchmarksByModel.get(model.key);
    if (!own) continue;
    const shared = benchmarksById.get(model.id) ?? {};
    for (const [benchmark, score] of Object.entries(own) as Array<
      [BenchmarkId, BenchmarkScore]
    >) {
      if (!shared[benchmark]) shared[benchmark] = score;
    }
    benchmarksById.set(model.id, shared);
  }

  const scores = input.snapshot.models.map((model): ScoreRecord => {
    const benchmarks = benchmarksById.get(model.id) ?? {};
    const record: ScoreRecord = {
      modelKey: model.key,
      benchmarks,
      useCases: useCaseScores(model, benchmarks, nowMs),
      cost: costForModel(model),
    };
    return record;
  });

  return scores.sort((left, right) =>
    left.modelKey < right.modelKey
      ? -1
      : left.modelKey > right.modelKey
        ? 1
        : 0,
  );
}

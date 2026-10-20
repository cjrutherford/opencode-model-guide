import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COST_PROFILE_IDS,
  ScoresFileSchema,
  type BenchmarkId,
  type BenchmarkResult,
  type BenchmarksFile,
  type FreeKind,
  type ModelRecord,
  type Pricing,
  type ProviderId,
  type Snapshot,
  type SubscriptionInfo,
} from "@omg/shared";

import { scoreModels } from "../src/score";

const NOW = "2026-10-20T12:00:00.000Z";
const SOURCE_URL = "https://example.com/benchmark";

const basePricing: Pricing = {
  currency: "USD",
  unit: "per_1m_tokens",
  pricingKnown: true,
  input: 3,
  output: 15,
  cacheRead: 0.3,
};

function makeModel(options: {
  id: string;
  name?: string;
  provider?: ProviderId;
  free?: FreeKind;
  pricing?: Pricing;
  context?: number;
  subscription?: SubscriptionInfo;
}): ModelRecord {
  const provider = options.provider ?? "opencode";
  const pricing = options.pricing ?? basePricing;
  const model: ModelRecord = {
    key: `${provider}/${options.id}`,
    provider,
    id: options.id,
    name: options.name ?? options.id,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {
      toolCall: false,
      reasoning: false,
      attachment: false,
      structuredOutput: false,
      temperature: false,
    },
    limits: { context: options.context ?? 200_000, output: 10_000 },
    pricing,
    free: { kind: options.free ?? "paid", flags: [] },
    availability: "live",
    sources: [
      {
        id: "models.dev",
        url: "https://models.dev/api.json",
        fetchedAt: NOW,
      },
    ],
    conflicts: [],
    firstSeen: NOW,
    lastSeen: NOW,
  };
  if (options.subscription) model.subscription = options.subscription;
  return model;
}

function makeSnapshot(models: ModelRecord[]): Snapshot {
  return { schemaVersion: 1, generatedAt: NOW, models, sources: [] };
}

function makeBenchmark(
  modelKey: string,
  benchmark: BenchmarkId,
  value: number,
  date = NOW,
): BenchmarkResult {
  return {
    benchmark,
    metric: "percent",
    value,
    modelNameRaw: modelKey,
    modelKey,
    match: "exact",
    matchConfidence: 1,
    date,
    sourceUrl: SOURCE_URL,
  };
}

function makeBenchmarks(results: BenchmarkResult[]): BenchmarksFile {
  return {
    schemaVersion: 1,
    generatedAt: NOW,
    results,
    unmatched: [],
    sources: [],
  };
}

function scoreFor(scores: ReturnType<typeof scoreModels>, key: string) {
  const record = scores.find((candidate) => candidate.modelKey === key);
  if (!record) throw new Error(`missing score for ${key}`);
  return record;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scoreModels", () => {
  it("returns a record for every model, even without benchmarks", () => {
    const solo = makeModel({ id: "solo", name: "Solo" });
    const scores = scoreModels({
      snapshot: makeSnapshot([solo]),
      benchmarks: makeBenchmarks([]),
      now: NOW,
    });

    expect(scores).toHaveLength(1);
    const record = scoreFor(scores, "opencode/solo");
    expect(record.benchmarks).toEqual({});
    expect(record.useCases).toEqual({
      "agentic-coding": { score: null, tier: "unrated", confidence: 0 },
      "everyday-edits": { score: null, tier: "unrated", confidence: 0 },
      frontend: { score: null, tier: "unrated", confidence: 0 },
      "long-context": { score: null, tier: "unrated", confidence: 0 },
    });
    for (const profile of COST_PROFILE_IDS) {
      expect(record.cost.profiles[profile]).toBeGreaterThan(0);
    }
    expect(record).not.toHaveProperty("overall");
    expect(() =>
      ScoresFileSchema.parse({
        schemaVersion: 1,
        generatedAt: NOW,
        scores,
      }),
    ).not.toThrow();
  });

  it("scores a single benchmark but marks low coverage unrated", () => {
    const target = makeModel({ id: "swe" });
    const scores = scoreModels({
      snapshot: makeSnapshot([target]),
      benchmarks: makeBenchmarks([
        makeBenchmark(target.key, "swe-bench-verified", 100),
      ]),
      now: NOW,
    });

    const useCase = scoreFor(scores, target.key).useCases["agentic-coding"]!;
    expect(useCase.score).toBe(50);
    expect(useCase.tier).toBe("unrated");
    expect(useCase.confidence).toBeCloseTo(0.45, 10);
  });

  it("gives full coverage confidence when all four agentic benchmarks exist", () => {
    const target = makeModel({ id: "all-agentic" });
    const results = (
      [
        "swe-bench-verified",
        "terminal-bench",
        "lmarena-agent",
        "aider-polyglot",
      ] as BenchmarkId[]
    ).map((benchmark) => makeBenchmark(target.key, benchmark, 100));

    const useCase = scoreFor(
      scoreModels({
        snapshot: makeSnapshot([target]),
        benchmarks: makeBenchmarks(results),
        now: NOW,
      }),
      target.key,
    ).useCases["agentic-coding"]!;

    expect(useCase.score).toBe(50);
    expect(useCase.tier).toBe("B");
    expect(useCase.confidence).toBeCloseTo(1, 10);
  });

  it("gates long-context on a 200K context window", () => {
    const small = makeModel({ id: "small", context: 100_000 });
    const large = makeModel({ id: "large", context: 300_000 });
    const results = [small, large].flatMap((model, index) => {
      const value = index === 0 ? 0 : 100;
      return [
        makeBenchmark(model.key, "swe-bench-verified", value),
        makeBenchmark(model.key, "lmarena-text", value),
        makeBenchmark(model.key, "lmarena-document", value),
      ];
    });

    const scores = scoreModels({
      snapshot: makeSnapshot([small, large]),
      benchmarks: makeBenchmarks(results),
      now: NOW,
    });

    expect(scoreFor(scores, small.key).useCases["long-context"]).toEqual({
      score: null,
      tier: "unrated",
      confidence: 1,
    });
    expect(scoreFor(scores, large.key).useCases["long-context"]).toEqual({
      score: 100,
      tier: "S",
      confidence: 1,
    });
  });

  it("lowers confidence when benchmark dates are stale", () => {
    const target = makeModel({ id: "stale" });
    const staleDate = new Date(
      Date.parse(NOW) - 200 * 86_400_000,
    ).toISOString();
    const results = (
      [
        "swe-bench-verified",
        "terminal-bench",
        "lmarena-agent",
        "aider-polyglot",
      ] as BenchmarkId[]
    ).map((benchmark) => makeBenchmark(target.key, benchmark, 100, staleDate));

    const useCase = scoreFor(
      scoreModels({
        snapshot: makeSnapshot([target]),
        benchmarks: makeBenchmarks(results),
        now: NOW,
      }),
      target.key,
    ).useCases["agentic-coding"]!;

    expect(useCase.score).toBe(50);
    expect(useCase.tier).toBe("unrated");
    expect(useCase.confidence).toBeCloseTo(0.2, 10);
  });

  it("sets cost to zero for free models", () => {
    const openFree = makeModel({
      id: "open-free",
      free: "open-free",
      pricing: { ...basePricing, input: 0, output: 0, cacheRead: 0 },
    });
    const limited = makeModel({
      id: "limited",
      free: "limited-time",
      pricing: { ...basePricing, pricingKnown: false },
    });
    const scores = scoreModels({
      snapshot: makeSnapshot([openFree, limited]),
      benchmarks: makeBenchmarks([]),
      now: NOW,
    });

    for (const key of [openFree.key, limited.key]) {
      expect(scoreFor(scores, key).cost.profiles).toEqual({
        "quick-edit": 0,
        "agentic-pr": 0,
        "long-context": 0,
      });
    }
  });

  it("returns null costs when a paid model has no published price", () => {
    const target = makeModel({
      id: "unknown-price",
      pricing: { ...basePricing, pricingKnown: false },
    });
    const record = scoreFor(
      scoreModels({
        snapshot: makeSnapshot([target]),
        benchmarks: makeBenchmarks([]),
        now: NOW,
      }),
      target.key,
    );

    expect(record.cost.profiles).toEqual({
      "quick-edit": null,
      "agentic-pr": null,
      "long-context": null,
    });
    expect(record.cost.goEffective).toBeUndefined();
  });

  it("computes Go effective cost from included usage", () => {
    const target = makeModel({
      provider: "opencode-go",
      id: "glm",
      free: "subscription-included",
      subscription: {
        plan: "go",
        monthlyUsd: 10,
        includedUsageUsd: 20,
      },
    });
    const record = scoreFor(
      scoreModels({
        snapshot: makeSnapshot([target]),
        benchmarks: makeBenchmarks([]),
        now: NOW,
      }),
      target.key,
    );

    const list = record.cost.profiles;
    const effective = record.cost.goEffective!;
    for (const profile of COST_PROFILE_IDS) {
      expect(effective[profile]).toBeCloseTo(list[profile]! * 0.5, 10);
      expect(effective[profile]!).toBeLessThan(list[profile]!);
    }
  });

  it("keeps the newest result when a benchmark has duplicates", () => {
    const target = makeModel({ id: "duplicate" });
    const older = makeBenchmark(
      target.key,
      "swe-bench-verified",
      10,
      "2026-01-01T00:00:00.000Z",
    );
    const newer = makeBenchmark(
      target.key,
      "swe-bench-verified",
      20,
      "2026-02-01T00:00:00.000Z",
    );

    const record = scoreFor(
      scoreModels({
        snapshot: makeSnapshot([target]),
        benchmarks: makeBenchmarks([older, newer]),
        now: NOW,
      }),
      target.key,
    );

    expect(record.benchmarks["swe-bench-verified"]).toMatchObject({
      value: 20,
      date: newer.date,
    });
    expect(console.warn).toHaveBeenCalled();
  });

  it("assigns S through D from composite percentiles", () => {
    const values = [0, 25, 50, 75, 100];
    const models = values.map((_, index) => makeModel({ id: `m${index}` }));
    const results = models.flatMap((model, index) => {
      const value = values[index]!;
      return [
        makeBenchmark(model.key, "lmarena-webdev", value),
        makeBenchmark(model.key, "lmarena-text", value),
        makeBenchmark(model.key, "aider-polyglot", value),
      ];
    });

    const scores = scoreModels({
      snapshot: makeSnapshot(models),
      benchmarks: makeBenchmarks(results),
      now: NOW,
    });

    expect(scores.map((score) => score.useCases.frontend!.tier)).toEqual([
      "D",
      "C",
      "B",
      "A",
      "S",
    ]);
  });
});

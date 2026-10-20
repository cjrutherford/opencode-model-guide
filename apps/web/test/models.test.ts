import { describe, expect, it } from "vitest";

import type { ScoreRecord } from "@omg/shared";

import { loadData } from "../src/lib/data";
import {
  agenticCost,
  benchmarkRowsForModel,
  bestRatedUseCase,
  buildCompareRows,
  buildModelIndexes,
  buildModelRows,
  relatedModels,
  slugify,
  topByUseCase,
} from "../src/lib/models";

function score(overrides: Partial<ScoreRecord> = {}): ScoreRecord {
  return {
    modelKey: "opencode/example",
    benchmarks: {},
    useCases: {},
    cost: {
      profiles: {
        "quick-edit": 0.1,
        "agentic-pr": 0.4,
        "long-context": 1.2,
      },
    },
    ...overrides,
  };
}

describe("model joins", () => {
  it("builds a unique, reversible slug for every model", () => {
    const data = loadData();
    const indexes = buildModelIndexes(data);

    expect(indexes.slugToKey.size).toBe(data.snapshot.models.length);
    for (const model of data.snapshot.models) {
      expect(indexes.slugToKey.get(slugify(model.key))).toBe(model.key);
    }
  });

  it("builds one row per model and keeps free states explicit", () => {
    const data = loadData();
    const rows = buildModelRows(data);

    expect(rows).toHaveLength(data.snapshot.models.length);
    for (const row of rows) {
      expect(row.zeroMarginal).toBe(row.freeKind !== "paid");
      if (row.freeNow) {
        expect(["open-free", "limited-time", "trial"]).toContain(row.freeKind);
      }
    }
  });

  it("ignores unrated use cases and handles missing cost", () => {
    const record = score({
      useCases: {
        "agentic-coding": { score: null, tier: "unrated", confidence: 0.2 },
        frontend: { score: 80, tier: "A", confidence: 0.8 },
      },
    });

    expect(bestRatedUseCase(record)).toEqual({
      useCase: "frontend",
      score: 80,
      tier: "A",
      confidence: 0.8,
    });
    expect(topByUseCase("agentic-coding", [record])).toBeUndefined();
    expect(topByUseCase("frontend", [record])).toBe(record);
    expect(agenticCost(record)).toBe(0.4);
    expect(agenticCost(undefined)).toBeNull();
    expect(
      agenticCost(
        score({
          cost: {
            profiles: {
              "quick-edit": 0.1,
              "agentic-pr": null,
              "long-context": 1.2,
            },
          },
        }),
      ),
    ).toBeNull();
  });

  it("joins benchmark rows with source and date", () => {
    const data = loadData();
    const indexes = buildModelIndexes(data);
    const scored = data.scores.scores.find(
      (record) => Object.keys(record.benchmarks).length > 0,
    );

    expect(scored).toBeDefined();
    const rows = benchmarkRowsForModel(scored, indexes.benchmarksByKey);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.sourceUrl).toMatch(/^https?:\/\//);
      expect(row.date.length).toBeGreaterThan(0);
    }
  });

  it("keeps compare rows finite and complete", () => {
    const data = loadData();
    const rows = buildCompareRows(data);
    expect(rows).toHaveLength(data.snapshot.models.length);
    for (const row of rows) {
      expect(Number.isFinite(row.context)).toBe(true);
      expect(row.inputPrice === null || Number.isFinite(row.inputPrice)).toBe(
        true,
      );
      expect(row.agenticCost === null || Number.isFinite(row.agenticCost)).toBe(
        true,
      );
    }
  });

  it("returns related models without the current model", () => {
    const data = loadData();
    const model = data.snapshot.models[0]!;
    const related = relatedModels(model, data.snapshot.models);

    expect(related.length).toBeGreaterThan(0);
    expect(related.length).toBeLessThanOrEqual(3);
    expect(related.some((candidate) => candidate.key === model.key)).toBe(false);
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import benchmarks from "./fixtures/benchmarks.sample.json";
import snapshot from "./fixtures/snapshot.sample.json";
import {
  BenchmarkResultSchema,
  BenchmarksFileSchema,
  ChangeEventSchema,
  FreeKindSchema,
  ScoreRecordSchema,
  ScoresFileSchema,
  SnapshotSchema,
  SourceStatusSchema,
} from "../src/schema";

describe("SnapshotSchema", () => {
  it("accepts the fixture", () => {
    const parsed = SnapshotSchema.parse(snapshot);
    expect(parsed.models).toHaveLength(3);
    expect(parsed.models[0]?.key).toBe("opencode/deepseek-v4.1-flash-free");
  });

  it("rejects negative prices", () => {
    const bad = structuredClone(snapshot);
    bad.models[0]!.pricing.input = -1;
    expect(() => SnapshotSchema.parse(bad)).toThrow(/nonnegative|greater than or equal/i);
  });

  it("rejects duplicate keys", () => {
    const bad = structuredClone(snapshot);
    bad.models.push(structuredClone(bad.models[0]!));
    expect(() => SnapshotSchema.parse(bad)).toThrow(/duplicate/i);
  });

  it("rejects a key that does not match provider/id", () => {
    const bad = structuredClone(snapshot);
    bad.models[0]!.key = "opencode/wrong";
    expect(() => SnapshotSchema.parse(bad)).toThrow(/key/i);
  });

  it("rejects a model with no sources", () => {
    const bad = structuredClone(snapshot);
    bad.models[0]!.sources = [];
    expect(() => SnapshotSchema.parse(bad)).toThrow(/source/i);
  });

  it("rejects unknown top-level fields", () => {
    const bad = { ...structuredClone(snapshot), extra: true };
    expect(() => SnapshotSchema.parse(bad)).toThrow();
  });

  it("accepts an unpublished price when pricingKnown is false", () => {
    const unpublished = structuredClone(snapshot);
    unpublished.models[1]!.pricing.pricingKnown = false;
    unpublished.models[1]!.pricing.input = 0;
    unpublished.models[1]!.pricing.output = 0;
    expect(() => SnapshotSchema.parse(unpublished)).not.toThrow();
  });
});

describe("BenchmarksFileSchema", () => {
  it("accepts the fixture with resolved and unmatched results", () => {
    const parsed = BenchmarksFileSchema.parse(benchmarks);
    expect(parsed.results).toHaveLength(3);
    expect(parsed.unmatched).toEqual(["Mystery Model 2026-09"]);
  });

  it("rejects an unmatched result that carries a modelKey", () => {
    const bad = structuredClone(benchmarks);
    bad.results[2]!.modelKey = "opencode/kimi-k3";
    expect(() => BenchmarksFileSchema.parse(bad)).toThrow(/unmatched/i);
  });

  it("rejects a matched result without a modelKey", () => {
    const bad = structuredClone(benchmarks);
    delete (bad.results[1] as { modelKey?: string }).modelKey;
    expect(() => BenchmarkResultSchema.parse(bad.results[1])).toThrow(/modelKey/i);
  });
});

describe("ChangeEventSchema", () => {
  it("parses every line in the JSONL fixture", () => {
    const raw = readFileSync(new URL("./fixtures/events.sample.jsonl", import.meta.url), "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    expect(lines).toHaveLength(3);
    const parsed = lines.map((line) => ChangeEventSchema.parse(JSON.parse(line)));
    expect(parsed.map((event) => event.type)).toEqual([
      "model_added",
      "free_started",
      "free_ended",
    ]);
  });

  it("rejects an id that does not match type, model key, and date", () => {
    const bad = {
      id: "free_started:opencode/kimi-k3:1999-01-01",
      type: "free_started",
      at: "2026-10-19T13:00:00.000Z",
      modelKey: "opencode/kimi-k3",
      summary: "bad id",
      data: {},
      notify: true,
    };
    expect(() => ChangeEventSchema.parse(bad)).toThrow(/event id mismatch/i);
  });
});

describe("ScoresFileSchema", () => {
  const validScore = {
    modelKey: "opencode/kimi-k3",
    benchmarks: {
      "swe-bench-verified": {
        percentile: 72.5,
        value: 62.3,
        date: "2026-10-01",
      },
    },
    useCases: {
      "agentic-coding": { score: 71.2, tier: "B", confidence: 0.8 },
    },
    cost: {
      profiles: { "quick-edit": 0.04, "agentic-pr": 0.5, "long-context": 1.2 },
    },
  };

  it("accepts a partial score record", () => {
    expect(() => ScoreRecordSchema.parse(validScore)).not.toThrow();
  });

  it("rejects an unknown use case", () => {
    const bad = structuredClone(validScore);
    (bad.useCases as Record<string, unknown>)["made-up"] = {
      score: 1,
      tier: "A",
      confidence: 1,
    };
    expect(() => ScoreRecordSchema.parse(bad)).toThrow();
  });

  it("rejects duplicate score keys", () => {
    const file = {
      schemaVersion: 1,
      generatedAt: "2026-10-19T13:05:00.000Z",
      scores: [validScore, structuredClone(validScore)],
    };
    expect(() => ScoresFileSchema.parse(file)).toThrow(/duplicate score/i);
  });
});

describe("SourceStatusSchema", () => {
  it("rejects an ok/status mismatch", () => {
    const bad = {
      id: "models.dev",
      url: "https://models.dev/api.json",
      ok: true,
      status: "failed",
      fetchedAt: "2026-10-19T13:00:00.000Z",
    };
    expect(() => SourceStatusSchema.parse(bad)).toThrow(/status mismatch/i);
  });

  it("accepts a skipped optional source", () => {
    const skipped = {
      id: "artificial-analysis",
      url: "https://artificialanalysis.ai/",
      ok: false,
      status: "skipped",
      reason: "AA_API_KEY is not set",
      fetchedAt: "2026-10-19T13:00:00.000Z",
    };
    expect(() => SourceStatusSchema.parse(skipped)).not.toThrow();
  });
});

describe("FreeKindSchema", () => {
  it("keeps the four free labels distinct", () => {
    expect(FreeKindSchema.options).toEqual([
      "paid",
      "open-free",
      "limited-time",
      "subscription-included",
      "trial",
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  BENCHMARK_IDS,
  COST_PROFILE_IDS,
  COST_PROFILES,
  FRESHNESS,
  TIER_THRESHOLDS,
  USE_CASE_IDS,
  USE_CASE_WEIGHTS,
} from "../src/constants";

describe("cost profiles", () => {
  it("matches the design values", () => {
    expect(COST_PROFILE_IDS).toEqual(["quick-edit", "agentic-pr", "long-context"]);
    expect(COST_PROFILES["quick-edit"]).toEqual({
      label: "Quick edit",
      inputTokens: 12_000,
      cachedInputTokens: 8_000,
      outputTokens: 1_500,
    });
    expect(COST_PROFILES["agentic-pr"].inputTokens).toBe(120_000);
    expect(COST_PROFILES["long-context"].inputTokens).toBe(400_000);
  });

  it("keeps cached input within total input", () => {
    for (const profile of Object.values(COST_PROFILES)) {
      expect(profile.cachedInputTokens).toBeLessThanOrEqual(profile.inputTokens);
    }
  });
});

describe("use-case weights", () => {
  it("covers the four use cases and sums to one", () => {
    expect(USE_CASE_IDS).toEqual([
      "agentic-coding",
      "everyday-edits",
      "frontend",
      "long-context",
    ]);
    for (const weights of Object.values(USE_CASE_WEIGHTS)) {
      const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it("only references known benchmarks", () => {
    for (const weights of Object.values(USE_CASE_WEIGHTS)) {
      for (const benchmark of Object.keys(weights)) {
        expect(BENCHMARK_IDS).toContain(benchmark);
      }
    }
  });

  it("locks the post-v1 calibration weights", () => {
    expect(USE_CASE_WEIGHTS["agentic-coding"]).toEqual({
      "swe-bench-verified": 0.3,
      "terminal-bench": 0.1,
      "lmarena-agent": 0.2,
      "aider-polyglot": 0.1,
      "artificial-analysis": 0.3,
    });
    expect(USE_CASE_WEIGHTS["everyday-edits"]).toEqual({
      "swe-bench-verified": 0.15,
      "lmarena-webdev": 0.25,
      "lmarena-text": 0.15,
      "aider-polyglot": 0.25,
      "artificial-analysis": 0.2,
    });
  });
});

describe("tiers and freshness", () => {
  it("matches the design thresholds", () => {
    expect(TIER_THRESHOLDS.map(({ tier, min }) => [tier, min])).toEqual([
      ["S", 90],
      ["A", 75],
      ["B", 50],
      ["C", 25],
      ["D", 0],
    ]);
  });

  it("has monotonically decreasing freshness factors", () => {
    expect(FRESHNESS.map((entry) => entry.factor)).toEqual([1.0, 0.8, 0.5, 0.2]);
  });
});

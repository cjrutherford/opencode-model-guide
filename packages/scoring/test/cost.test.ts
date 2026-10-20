import { describe, expect, it } from "vitest";

import type { Pricing } from "@omg/shared";

import { formatUsd, goEffectiveCost, taskCost } from "../src/cost";

const pricing: Pricing = {
  currency: "USD",
  unit: "per_1m_tokens",
  pricingKnown: true,
  input: 3,
  output: 15,
  cacheRead: 0.3,
};

describe("taskCost", () => {
  it("prices cached input correctly", () => {
    const cost = taskCost(pricing, {
      inputTokens: 120_000,
      cachedInputTokens: 90_000,
      outputTokens: 8_000,
    });
    expect(cost).toBeCloseTo(
      3 * 30_000 / 1e6 + 0.3 * 90_000 / 1e6 + 15 * 8_000 / 1e6,
      10,
    );
  });

  it("falls back to input price when cacheRead is missing", () => {
    const withoutCacheRead = { ...pricing, cacheRead: undefined };
    const cost = taskCost(withoutCacheRead, {
      inputTokens: 10_000,
      cachedInputTokens: 5_000,
      outputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(3 * 10_000 / 1e6 + 15 * 1_000 / 1e6, 10);
  });

  it("returns null when the price is unknown", () => {
    const unknown = { ...pricing, pricingKnown: false };
    expect(
      taskCost(unknown, {
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
      }),
    ).toBeNull();
  });

  it("applies the 200K tier to the whole request", () => {
    const withTier = {
      ...pricing,
      contextOver200k: { input: 6, output: 22.5, cacheRead: 0.6 },
    };
    const cost = taskCost(withTier, {
      inputTokens: 250_000,
      cachedInputTokens: 0,
      outputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(6 * 250_000 / 1e6 + 22.5 * 1_000 / 1e6, 10);
  });

  it("uses the highest matching tier for the whole request", () => {
    const tiered: Pricing = {
      ...pricing,
      tiers: [
        { minInputTokens: 0, input: 3, output: 15, cacheRead: 0.3 },
        { minInputTokens: 200_000, input: 6, output: 22.5, cacheRead: 0.6 },
        { minInputTokens: 500_000, input: 9, output: 30, cacheRead: 0.9 },
      ],
    };
    const cost = taskCost(tiered, {
      inputTokens: 250_000,
      cachedInputTokens: 0,
      outputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(6 * 250_000 / 1e6 + 22.5 * 1_000 / 1e6, 10);
  });

  it("prefers contextOver200k over tiers", () => {
    const both: Pricing = {
      ...pricing,
      tiers: [
        { minInputTokens: 200_000, input: 6, output: 22.5, cacheRead: 0.6 },
      ],
      contextOver200k: { input: 7, output: 25, cacheRead: 0.7 },
    };
    const cost = taskCost(both, {
      inputTokens: 250_000,
      cachedInputTokens: 0,
      outputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(7 * 250_000 / 1e6 + 25 * 1_000 / 1e6, 10);
  });

  it("clamps cached input to the input token count", () => {
    const cost = taskCost(pricing, {
      inputTokens: 10_000,
      cachedInputTokens: 20_000,
      outputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(10_000 * 0.3 / 1e6 + 1_000 * 15 / 1e6, 10);
  });

  it("clamps negative cached input to zero", () => {
    const cost = taskCost(pricing, {
      inputTokens: 10_000,
      cachedInputTokens: -5_000,
      outputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(10_000 * 3 / 1e6 + 1_000 * 15 / 1e6, 10);
  });
});

describe("goEffectiveCost", () => {
  it("scales list cost by plan cost over included usage", () => {
    expect(goEffectiveCost(0.6, 10, 15)).toBeCloseTo(0.4, 10);
  });

  it("is lower than list cost when included usage exceeds the plan price", () => {
    expect(goEffectiveCost(1, 10, 20)).toBeCloseTo(0.5, 10);
  });

  it("returns null without included usage", () => {
    expect(goEffectiveCost(0.6, 10, 0)).toBeNull();
  });

  it("returns null without a list cost", () => {
    expect(goEffectiveCost(null, 10, 15)).toBeNull();
  });
});

describe("formatUsd", () => {
  it("formats zero", () => {
    expect(formatUsd(0)).toBe("$0");
  });

  it("flags tiny positive values", () => {
    expect(formatUsd(0.00001)).toBe("<$0.0001");
  });

  it("uses two significant digits below one dollar", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.5)).toBe("$0.50");
  });

  it("uses two decimals at or above one dollar", () => {
    expect(formatUsd(1.234)).toBe("$1.23");
  });

  it("shows an unknown price instead of zero", () => {
    expect(formatUsd(null)).toBe("price not published");
  });
});

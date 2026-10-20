import { describe, expect, it } from "vitest";

import { percentileRank } from "../src/percentile";

describe("percentileRank", () => {
  it("maps ordered values to 0, 50, and 100", () => {
    const all = [1, 2, 3];
    expect(percentileRank(1, all)).toBe(0);
    expect(percentileRank(2, all)).toBe(50);
    expect(percentileRank(3, all)).toBe(100);
  });

  it("averages ties", () => {
    const all = [1, 1, 1];
    expect(percentileRank(1, all)).toBe(50);
  });

  it("places duplicates at their average position", () => {
    const all = [1, 2, 2, 3];
    expect(percentileRank(1, all)).toBe(0);
    expect(percentileRank(2, all)).toBeCloseTo(50, 10);
    expect(percentileRank(3, all)).toBe(100);
  });

  it("returns 50 for a single value", () => {
    expect(percentileRank(42, [42])).toBe(50);
  });

  it("returns 50 for an empty set", () => {
    expect(percentileRank(42, [])).toBe(50);
  });

  it("clamps values outside the set", () => {
    const all = [1, 2, 3];
    expect(percentileRank(0, all)).toBe(0);
    expect(percentileRank(4, all)).toBe(100);
  });
});

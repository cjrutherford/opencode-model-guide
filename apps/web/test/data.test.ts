import { describe, expect, it } from "vitest";

import { loadData } from "../src/lib/data";

describe("loadData", () => {
  it("loads and validates the committed data files", () => {
    const data = loadData();

    expect(data.snapshot.models.length).toBeGreaterThan(0);
    expect(data.scores.scores).toHaveLength(data.snapshot.models.length);
    expect(data.benchmarks.results.length).toBeGreaterThan(0);
    expect(data.evals.schemaVersion).toBe(1);
    expect(data.evals.runs).toEqual(
      [...data.evals.runs].sort((left, right) =>
        right.startedAt.localeCompare(left.startedAt),
      ),
    );
    expect(data.events).toEqual(
      [...data.events].sort((left, right) => right.at.localeCompare(left.at)),
    );
  });
});

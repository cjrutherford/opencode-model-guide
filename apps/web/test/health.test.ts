import { describe, expect, it } from "vitest";

import { loadData } from "../src/lib/data";
import { buildHealth, sourceStaleness } from "../src/lib/health";

const NOW = "2026-10-20T12:00:00.000Z";

describe("sourceStaleness", () => {
  it("treats fetches within 48 hours as fresh", () => {
    expect(sourceStaleness("2026-10-19T12:00:00.000Z", NOW)).toMatchObject({
      level: "fresh",
      ageHours: 24,
    });
  });

  it("warns after 48 hours and errors after 7 days", () => {
    expect(sourceStaleness("2026-10-18T11:00:00.000Z", NOW)).toMatchObject({
      level: "warning",
      label: "Older than 48 hours",
    });
    expect(sourceStaleness("2026-10-12T11:00:00.000Z", NOW)).toMatchObject({
      level: "error",
      label: "Older than 7 days",
    });
  });

  it("returns an explicit unknown state for invalid dates", () => {
    expect(sourceStaleness("not-a-date", NOW)).toEqual({
      level: "unknown",
      ageHours: null,
      label: "Unknown fetch time",
    });
  });

  it("clamps future timestamps to zero age", () => {
    expect(sourceStaleness("2026-10-21T12:00:00.000Z", NOW)).toMatchObject({
      level: "fresh",
      ageHours: 0,
    });
  });
});

describe("buildHealth", () => {
  it("summarizes the committed snapshots without network access", () => {
    const data = loadData();
    const health = buildHealth(data, NOW);

    expect(health.counts.models).toBe(163);
    expect(health.counts.freeNow).toBe(13);
    expect(health.counts.zeroMarginal).toBe(79);
    expect(health.counts.benchmarkResults).toBe(1041);
    expect(health.counts.resolvedBenchmarks).toBe(400);
    expect(health.counts.unmatchedBenchmarks).toBe(641);
    expect(health.counts.unmatchedNames).toBe(603);
    expect(health.counts.scoreRecords).toBe(163);
    expect(health.counts.ratedModels).toBe(96);
    expect(health.counts.conflicts).toBe(8);
    expect(health.sources).toHaveLength(10);
    expect(health.sources.find((source) => source.id === "terminal-bench")).toMatchObject({
      status: "skipped",
      required: false,
    });
    expect(health.unmatched[0]).toMatchObject({
      name: expect.any(String),
      benchmark: expect.any(String),
      date: expect.any(String),
      sourceUrl: expect.any(String),
    });
    expect(health.conflicts[0]).toMatchObject({
      modelKey: expect.any(String),
      field: expect.any(String),
      resolution: expect.stringMatching(/preferred|unresolved/),
    });
    expect(health.useCases.find((row) => row.useCase === "frontend")).toMatchObject({
      rated: 94,
      total: 163,
    });
  });
});

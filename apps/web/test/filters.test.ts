import { describe, expect, it } from "vitest";

import type { FilterRow } from "../src/lib/filters";
import {
  applyFilters,
  parseCompare,
  parseFilters,
  serializeCompare,
  serializeFilters,
} from "../src/lib/filters";

function row(overrides: Partial<FilterRow> = {}): FilterRow {
  return {
    key: "opencode/example",
    name: "Example",
    provider: "opencode",
    availability: "live",
    freeKind: "paid",
    freeNow: false,
    zeroMarginal: false,
    context: 200_000,
    agenticCost: 0.4,
    tier: "A",
    score: 82,
    releaseDate: "2026-01-01",
    ...overrides,
  };
}

describe("parseFilters", () => {
  it("parses filters and coerces numbers", () => {
    expect(
      parseFilters(
        "?free=limited-time&sort=cost-asc&maxCost=1&minContext=200000",
      ),
    ).toEqual({
      free: "limited-time",
      sort: "cost-asc",
      maxCost: 1,
      minContext: 200_000,
    });
  });

  it("round-trips without empty values or the default sort", () => {
    expect(
      serializeFilters({ free: "open-free", sort: "score-desc" }),
    ).toBe("?free=open-free&sort=score-desc");
    expect(serializeFilters({})).toBe("");
    expect(serializeFilters({ q: "  ", sort: "name" })).toBe("");
  });

  it("ignores unknown values and invalid numbers", () => {
    expect(
      parseFilters(
        "?free=bogus&sort=nope&tier=Z&provider=nope&maxCost=-1&minContext=abc",
      ),
    ).toEqual({});
  });

  it("keeps zero and valid enum values", () => {
    expect(
      parseFilters("?maxCost=0&minContext=0&tier=unrated&provider=opencode-go"),
    ).toEqual({
      maxCost: 0,
      minContext: 0,
      tier: "unrated",
      provider: "opencode-go",
    });
  });
});

describe("applyFilters", () => {
  const rows = [
    row({ key: "a", name: "Alpha", agenticCost: 0.2, tier: "S", score: 95 }),
    row({
      key: "b",
      name: "Beta",
      freeKind: "limited-time",
      freeNow: true,
      zeroMarginal: true,
      agenticCost: 0,
      tier: "B",
      score: 60,
      context: 1_000_000,
    }),
    row({
      key: "c",
      name: "Gamma",
      freeKind: "subscription-included",
      zeroMarginal: true,
      agenticCost: null,
      tier: "unrated",
      score: null,
      releaseDate: undefined,
    }),
  ];

  it("filters free-now and zero-marginal separately", () => {
    expect(applyFilters(rows, { free: "free-now" }).map((item) => item.name)).toEqual([
      "Beta",
    ]);
    expect(
      applyFilters(rows, { free: "zero-marginal" }).map((item) => item.name),
    ).toEqual(["Beta", "Gamma"]);
  });

  it("filters by cost, context, provider, tier, and search", () => {
    expect(applyFilters(rows, { maxCost: 0.1 }).map((item) => item.name)).toEqual([
      "Beta",
    ]);
    expect(
      applyFilters(rows, { minContext: 500_000 }).map((item) => item.name),
    ).toEqual(["Beta"]);
    expect(
      applyFilters(rows, { tier: "unrated" }).map((item) => item.name),
    ).toEqual(["Gamma"]);
    expect(applyFilters(rows, { q: "amm" }).map((item) => item.name)).toEqual([
      "Gamma",
    ]);
  });

  it("sorts costs ascending and puts unknown costs last", () => {
    expect(
      applyFilters(rows, { sort: "cost-asc" }).map((item) => item.name),
    ).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(
      applyFilters(rows, { sort: "cost-desc" }).map((item) => item.name),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("sorts scores and releases with missing values last", () => {
    expect(
      applyFilters(rows, { sort: "score-desc" }).map((item) => item.name),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(
      applyFilters(rows, { sort: "release-desc" }).map((item) => item.name),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("compare query", () => {
  it("deduplicates, caps, and ignores empty values", () => {
    expect(parseCompare("?models=a,b,a,,c,d,e")).toEqual(["a", "b", "c", "d"]);
    expect(parseCompare("?models=")).toEqual([]);
  });

  it("round-trips only the selected slugs", () => {
    expect(serializeCompare(["a", "b"])).toBe("?models=a,b");
    expect(serializeCompare([])).toBe("");
  });
});

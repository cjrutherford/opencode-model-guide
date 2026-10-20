import { describe, expect, it } from "vitest";

import {
  EVENT_FILTERS,
  EVENT_GROUPS,
  FREE_KIND_LABELS,
  TIER_LABELS,
  confidenceBand,
  eventMatchesFilter,
  formatConfidenceBand,
  sourceLabel,
} from "../src/lib/labels";

describe("shared labels", () => {
  it("keeps every free kind distinct", () => {
    expect(FREE_KIND_LABELS["open-free"]).toBe("Free");
    expect(FREE_KIND_LABELS["limited-time"]).toBe("Free · limited time");
    expect(FREE_KIND_LABELS["subscription-included"]).toBe(
      "Included with Go",
    );
    expect(FREE_KIND_LABELS.trial).toBe("Free · trial terms");
    expect(new Set(Object.values(FREE_KIND_LABELS)).size).toBe(5);
  });

  it("maps change filters to event types", () => {
    expect(eventMatchesFilter("free_started", "all")).toBe(true);
    expect(eventMatchesFilter("free_started", "free")).toBe(true);
    expect(eventMatchesFilter("free_ended", "free")).toBe(true);
    expect(eventMatchesFilter("price_changed", "price")).toBe(true);
    expect(eventMatchesFilter("price_changed", "free")).toBe(false);
    expect(eventMatchesFilter("source_failed", "source_failed")).toBe(true);
    expect(eventMatchesFilter("source_failed", "unknown")).toBe(false);
    expect(EVENT_FILTERS.map((filter) => filter.value)).toEqual([
      "all",
      "free",
      "price",
      "deprecated",
      "new",
      "source",
    ]);
    expect(EVENT_GROUPS.deprecated).toEqual(["deprecated"]);
  });

  it("bands confidence without inventing a value", () => {
    expect(confidenceBand(0.8)).toBe("high");
    expect(confidenceBand(0.5)).toBe("medium");
    expect(confidenceBand(0.2)).toBe("low");
    expect(confidenceBand(null)).toBeNull();
    expect(confidenceBand(Number.NaN)).toBeNull();
    expect(formatConfidenceBand(null)).toBe("No confidence estimate");
    expect(formatConfidenceBand(0.8)).toBe("High confidence");
  });

  it("formats tier and unknown source labels", () => {
    expect(TIER_LABELS.unrated).toBe("Unrated");
    expect(sourceLabel("opencode.models")).toBe("OpenCode models endpoint");
    expect(sourceLabel("new-source")).toBe("New Source");
  });
});

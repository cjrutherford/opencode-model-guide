import { describe, expect, it } from "vitest";

import {
  formatAvailability,
  formatBenchmarkValue,
  formatCapability,
  formatConfidence,
  formatDate,
  formatDateTime,
  formatEventType,
  formatFlag,
  formatFreeKind,
  formatProvider,
  formatScore,
  formatSource,
  formatTier,
  formatTokens,
  formatTraining,
  formatUsd,
} from "../src/lib/format";

describe("format helpers", () => {
  it("formats modeled costs", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(null)).toBe("price not published");
  });

  it("formats token limits compactly", () => {
    expect(formatTokens(32_000)).toBe("32K");
    expect(formatTokens(200_000)).toBe("200K");
    expect(formatTokens(1_048_576)).toBe("1M");
  });

  it("formats dates in UTC", () => {
    expect(formatDate("2026-10-20T23:30:00.000Z")).toBe("Oct 20, 2026");
  });

  it("formats confidence and scores", () => {
    expect(formatConfidence(0.8)).toBe("80%");
    expect(formatScore(83.808)).toBe("83.8");
  });

  it("uses explicit free-kind labels", () => {
    expect(formatFreeKind("open-free")).toBe("Free");
    expect(formatFreeKind("limited-time")).toBe("Free · limited time");
    expect(formatFreeKind("subscription-included")).toBe("Included with Go");
    expect(formatFreeKind("trial")).toBe("Free · trial terms");
    expect(formatFreeKind("paid")).toBe("Paid");
  });

  it("formats provider and event labels", () => {
    expect(formatProvider("opencode")).toBe("Console");
    expect(formatProvider("opencode-go")).toBe("Go");
    expect(formatEventType("free_started")).toBe("Free");
    expect(formatEventType("source_failed")).toBe("Source issue");
  });

  it("formats benchmark values by metric", () => {
    expect(formatBenchmarkValue(74.56, "percent")).toBe("74.6%");
    expect(formatBenchmarkValue(1659.4, "elo")).toBe("1659");
    expect(formatBenchmarkValue(0.0814, "score")).toBe("0.081");
    expect(formatBenchmarkValue(76.5, "score")).toBe("76.5");
    expect(formatBenchmarkValue(Number.NaN, "percent")).toBe("—");
  });

  it("formats evidence labels and timestamps", () => {
    expect(formatTier("unrated")).toBe("Unrated");
    expect(formatTier("S")).toBe("S");
    expect(formatAvailability("live")).toBe("Live");
    expect(formatFlag("usage-limited")).toBe("Usage limited");
    expect(formatTraining("may-train")).toBe("May train on inputs");
    expect(formatCapability("toolCall")).toBe("Tool calling");
    expect(formatSource("opencode-go.models")).toBe(
      "OpenCode Go models endpoint",
    );
    expect(formatDateTime("2026-10-20T12:47:29.440Z")).toContain(
      "Oct 20, 2026",
    );
    expect(formatDateTime("2026-10-20T12:47:29.440Z")).toContain("UTC");
  });
});

import { describe, expect, it } from "vitest";

import {
  formatConfidence,
  formatDate,
  formatEventType,
  formatFreeKind,
  formatProvider,
  formatScore,
  formatTokens,
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
    expect(formatFreeKind("open-free")).toBe("Open free");
    expect(formatFreeKind("limited-time")).toBe("Limited-time free");
    expect(formatFreeKind("subscription-included")).toBe("Subscription included");
    expect(formatFreeKind("trial")).toBe("Trial");
    expect(formatFreeKind("paid")).toBe("Paid");
  });

  it("formats provider and event labels", () => {
    expect(formatProvider("opencode")).toBe("Console");
    expect(formatProvider("opencode-go")).toBe("Go");
    expect(formatEventType("free_started")).toBe("Free now");
    expect(formatEventType("source_failed")).toBe("Source issue");
  });
});

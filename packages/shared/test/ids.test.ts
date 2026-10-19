import { describe, expect, it } from "vitest";

import { eventId, modelKey, normalizeModelName, slugify } from "../src/ids";

describe("modelKey", () => {
  it("joins provider and id", () => {
    expect(modelKey("opencode", "deepseek-v4.1-flash-free")).toBe(
      "opencode/deepseek-v4.1-flash-free",
    );
  });
});

describe("slugify", () => {
  it("lowercases and collapses the provider separator and dots", () => {
    expect(slugify("opencode/deepseek-v4.1-flash-free")).toBe(
      "opencode-deepseek-v4-1-flash-free",
    );
  });

  it("is idempotent", () => {
    const once = slugify("opencode-go/glm-5.3");
    expect(slugify(once)).toBe(once);
  });

  it("collapses repeated separators and trims edges", () => {
    expect(slugify("Opencode / Kimi (K3)")).toBe("opencode-kimi-k3");
  });
});

describe("eventId", () => {
  it("is deterministic and includes the date", () => {
    const at = "2026-10-19T13:00:00.000Z";
    expect(eventId("free_started", "opencode/kimi-k3", at)).toBe(
      "free_started:opencode/kimi-k3:2026-10-19",
    );
    expect(eventId("free_started", "opencode/kimi-k3", at)).toBe(
      eventId("free_started", "opencode/kimi-k3", at),
    );
  });
});

describe("normalizeModelName", () => {
  it("lowercases, strips suffixes and parentheses, and collapses separators", () => {
    expect(normalizeModelName("Claude 4.6 Opus (Preview) [Free]")).toBe("claude 4 6 opus");
  });

  it("strips dates", () => {
    expect(normalizeModelName("GPT-5.1 Codex 2026-08-14")).toBe("gpt 5 1 codex");
  });

  it("is idempotent", () => {
    const once = normalizeModelName("DeepSeek V4.1 Flash Free");
    expect(normalizeModelName(once)).toBe(once);
  });
});

import { describe, expect, it } from "vitest";

import type { FreeKind, ModelRecord, ProviderId } from "@omg/shared";

import { resolveModelName } from "../src/resolve";

const NOW = "2026-10-19T13:00:00.000Z";

function model(overrides: {
  provider?: ProviderId;
  id: string;
  name: string;
  free?: FreeKind;
}): ModelRecord {
  const provider = overrides.provider ?? "opencode";
  return {
    key: `${provider}/${overrides.id}`,
    provider,
    id: overrides.id,
    name: overrides.name,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {
      toolCall: false,
      reasoning: false,
      attachment: false,
      structuredOutput: false,
      temperature: false,
    },
    limits: { context: 200000, output: 10000 },
    pricing: {
      currency: "USD",
      unit: "per_1m_tokens",
      pricingKnown: true,
      input: 1,
      output: 2,
    },
    free: { kind: overrides.free ?? "paid", flags: [] },
    availability: "live",
    sources: [{ id: "models.dev", url: "https://models.dev/api.json", fetchedAt: NOW }],
    conflicts: [],
    firstSeen: NOW,
    lastSeen: NOW,
  };
}

const models: ModelRecord[] = [
  model({ id: "kimi-k3", name: "Kimi K3" }),
  model({ id: "claude-opus-4-6", name: "Claude Opus 4.6" }),
  model({ id: "glm-5.3", name: "GLM-5.3" }),
  model({ id: "glm-5.3-free", name: "GLM-5.3 Free", free: "open-free" }),
  model({ provider: "opencode-go", id: "glm-5.3", name: "GLM-5.3", free: "subscription-included" }),
  model({ id: "gpt-5", name: "GPT-5" }),
  model({ id: "gpt-5-codex-mini", name: "GPT-5 Codex Mini" }),
  model({ id: "alpha-beta-gamma-delta", name: "Alpha Beta Gamma Delta" }),
  model({ id: "alpha-beta-gamma-epsilon", name: "Alpha Beta Gamma Epsilon" }),
  model({ id: "alpha-beta-gamma-delta-epsilon-zeta", name: "Alpha Beta Gamma Delta Epsilon Zeta" }),
  model({ id: "seven-a", name: "Alpha Beta Gamma Delta Epsilon Zeta Eta" }),
  model({ id: "seven-b", name: "Alpha Beta Gamma Delta Epsilon Zeta Theta" }),
];

describe("resolveModelName", () => {
  it("resolves an exact model key", () => {
    expect(resolveModelName("opencode/kimi-k3", models, {})).toEqual({
      modelKey: "opencode/kimi-k3",
      match: "exact",
      confidence: 1,
    });
  });

  it("resolves an exact model ID", () => {
    expect(resolveModelName("kimi-k3", models, {})).toEqual({
      modelKey: "opencode/kimi-k3",
      match: "exact",
      confidence: 1,
    });
  });

  it("resolves a normalized model name", () => {
    expect(resolveModelName("Kimi K3", models, {})).toEqual({
      modelKey: "opencode/kimi-k3",
      match: "exact",
      confidence: 1,
    });
  });

  it("prefers the paid Console model when normalized names collide", () => {
    expect(resolveModelName("GLM 5.3", models, {})).toEqual({
      modelKey: "opencode/glm-5.3",
      match: "exact",
      confidence: 1,
    });
  });

  it("resolves an exact ID shared by both providers to Console", () => {
    expect(resolveModelName("glm-5.3", models, {})).toEqual({
      modelKey: "opencode/glm-5.3",
      match: "exact",
      confidence: 1,
    });
  });

  it("uses a manual alias", () => {
    expect(
      resolveModelName("Claude 4.6 Opus", models, {
        "claude 4 6 opus": "opencode/claude-opus-4-6",
      }),
    ).toEqual({
      modelKey: "opencode/claude-opus-4-6",
      match: "alias",
      confidence: 1,
    });
  });

  it("ignores an alias that points to an unknown model", () => {
    expect(
      resolveModelName("Totally Unknown Model", models, {
        "totally unknown model": "opencode/missing",
      }),
    ).toEqual({ match: "unmatched", confidence: 0 });
  });

  it("fuzzy-matches a long name with one extra token", () => {
    const result = resolveModelName(
      "Alpha Beta Gamma Delta Epsilon Zeta Extra",
      models,
      {},
    );
    expect(result).toMatchObject({
      modelKey: "opencode/alpha-beta-gamma-delta-epsilon-zeta",
      match: "fuzzy",
    });
    expect(result.confidence).toBeCloseTo(12 / 13, 10);
  });

  it("rejects a short name with an extra token", () => {
    expect(resolveModelName("GPT 5 Codex Mini Extra", models, {})).toEqual({
      match: "unmatched",
      confidence: 0,
    });
  });

  it("rejects a fuzzy match when the runner-up is too close", () => {
    const close = models.filter(
      (candidate) => candidate.id === "seven-a" || candidate.id === "seven-b",
    );
    expect(
      resolveModelName("Alpha Beta Gamma Delta Epsilon Zeta Iota", close, {}),
    ).toEqual({ match: "unmatched", confidence: 0 });
  });

  it("returns unmatched for an unknown name", () => {
    expect(resolveModelName("Totally Unknown Model", models, {})).toEqual({
      match: "unmatched",
      confidence: 0,
    });
  });
});

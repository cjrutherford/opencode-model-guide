import { describe, expect, it } from "vitest";

import type { ModelRecord, ProviderId, Snapshot } from "@omg/shared";

import { selectFreeModels } from "../src/models";

function makeModel(
  provider: ProviderId,
  id: string,
  overrides: Partial<ModelRecord> = {},
): ModelRecord {
  return {
    key: `${provider}/${id}`,
    provider,
    id,
    name: id,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: false,
      structuredOutput: true,
      temperature: true,
    },
    limits: { context: 200_000, output: 32_000 },
    pricing: {
      currency: "USD",
      unit: "per_1m_tokens",
      pricingKnown: true,
      input: 0,
      output: 0,
    },
    free: { kind: "limited-time", flags: [] },
    availability: "live",
    sources: [
      {
        id: "models.dev",
        url: "https://example.com/models.json",
        fetchedAt: "2026-10-21T00:00:00.000Z",
      },
    ],
    conflicts: [],
    firstSeen: "2026-10-20T00:00:00.000Z",
    lastSeen: "2026-10-21T00:00:00.000Z",
    ...overrides,
  };
}

const consoleFreeIds = [
  "beam-free",
  "big-pickle",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "jev-1.13-free",
  "longcat-2.5-preview-free",
  "mimo-v2.6-flash-free",
  "minimax-m3.1-flash-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free",
];

function snapshot(models: ModelRecord[]): Snapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-21T09:00:00.000Z",
    models,
    sources: [],
  };
}

function fullSnapshot(): Snapshot {
  return snapshot([
    ...consoleFreeIds.map((id) =>
      makeModel("opencode", id, {
        name: id.replace(/-free$/, ""),
        free: { kind: "limited-time", flags: [] },
      }),
    ),
    makeModel("opencode-go", "beam-free"),
    makeModel("opencode-go", "longcat-2.5-preview-free"),
    makeModel("opencode-go", "minimax-m3.1-flash-free"),
    makeModel("opencode", "deprecated-free", {
      availability: "deprecated",
    }),
    makeModel("opencode", "unlisted-free", {
      availability: "unlisted",
    }),
    makeModel("opencode", "paid-model", {
      free: { kind: "paid", flags: [] },
    }),
    makeModel("opencode", "go-included", {
      free: { kind: "subscription-included", flags: [] },
    }),
  ]);
}

describe("selectFreeModels", () => {
  it("selects the 10 unique live Console free models", () => {
    const selected = selectFreeModels(fullSnapshot());

    expect(selected).toHaveLength(10);
    expect(selected.every((model) => model.provider === "opencode")).toBe(true);
    expect(new Set(selected.map((model) => model.id)).size).toBe(10);
    expect(selected.map((model) => model.id)).toEqual(
      [...consoleFreeIds].sort((left, right) => left.localeCompare(right)),
    );
  });

  it("prefers the Console listing when a Go twin appears first", () => {
    const selected = selectFreeModels(
      snapshot([
        makeModel("opencode-go", "beam-free", { name: "Beam Go" }),
        makeModel("opencode", "beam-free", { name: "Beam Console" }),
      ]),
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      provider: "opencode",
      id: "beam-free",
      name: "Beam Console",
    });
  });

  it("filters deprecated, unlisted, paid, and subscription-included models", () => {
    const selected = selectFreeModels(
      snapshot([
        makeModel("opencode", "live-free"),
        makeModel("opencode", "open-free", {
          free: { kind: "open-free", flags: [] },
        }),
        makeModel("opencode", "trial-free", {
          free: { kind: "trial", flags: [] },
        }),
        makeModel("opencode", "deprecated", { availability: "deprecated" }),
        makeModel("opencode", "unlisted", { availability: "unlisted" }),
        makeModel("opencode", "paid", { free: { kind: "paid", flags: [] } }),
        makeModel("opencode", "included", {
          free: { kind: "subscription-included", flags: [] },
        }),
      ]),
    );

    expect(selected.map((model) => model.id)).toEqual([
      "live-free",
      "open-free",
      "trial-free",
    ]);
  });

  it("supports an explicit Console subset in stable order", () => {
    const selected = selectFreeModels(fullSnapshot(), {
      modelKeys: [
        "opencode/mimo-v2.6-flash-free",
        "opencode/glm-5.3-flash-free",
      ],
    });

    expect(selected.map((model) => model.modelKey)).toEqual([
      "opencode/glm-5.3-flash-free",
      "opencode/mimo-v2.6-flash-free",
    ]);
  });

  it("rejects an explicit Go twin instead of double-counting it", () => {
    expect(() =>
      selectFreeModels(fullSnapshot(), {
        modelKeys: ["opencode-go/beam-free"],
      }),
    ).toThrow(/Console/i);
  });

  it("rejects unknown, non-free, and unavailable model keys", () => {
    expect(() =>
      selectFreeModels(fullSnapshot(), {
        modelKeys: ["opencode/missing-free"],
      }),
    ).toThrow(/unknown/i);

    expect(() =>
      selectFreeModels(fullSnapshot(), {
        modelKeys: ["opencode/paid-model"],
      }),
    ).toThrow(/free/i);

    expect(() =>
      selectFreeModels(fullSnapshot(), {
        modelKeys: ["opencode/deprecated-free"],
      }),
    ).toThrow(/live/i);
  });

  it("rejects an empty explicit selection", () => {
    expect(() => selectFreeModels(fullSnapshot(), { modelKeys: [] })).toThrow(
      /at least one/i,
    );
  });

  it("keeps an unknown zero context and maps free pricing", () => {
    const selected = selectFreeModels(
      snapshot([
        makeModel("opencode", "jev-1.13-free", {
          limits: { context: 0, output: 0 },
        }),
      ]),
    );

    expect(selected[0]).toMatchObject({
      modelKey: "opencode/jev-1.13-free",
      context: 0,
      freeKind: "limited-time",
      inputPrice: 0,
      outputPrice: 0,
    });
  });

  it("is stable when the snapshot order changes", () => {
    const first = selectFreeModels(fullSnapshot());
    const reversed = selectFreeModels(
      snapshot([...fullSnapshot().models].reverse()),
    );

    expect(first.map((model) => model.modelKey)).toEqual(
      reversed.map((model) => model.modelKey),
    );
  });
});

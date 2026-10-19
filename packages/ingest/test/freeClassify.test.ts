import { describe, expect, it } from "vitest";

import type { ModelRecord, Pricing, Snapshot } from "@omg/shared";

import {
  classifyFreeResult,
  classifyOne,
  type ClassifyContext,
} from "../src/freeClassify";
import type {
  DocsEvidence,
  DocsFreeEntry,
  DocsPriceEntry,
} from "../src/sources/opencodeDocs";

const NOW = "2026-10-19T13:00:00.000Z";

function pricing(
  input = 0,
  output = 0,
  extra: Partial<Pricing> = {},
): Pricing {
  return {
    currency: "USD",
    unit: "per_1m_tokens",
    pricingKnown: true,
    input,
    output,
    ...extra,
  };
}

function baseModel(overrides: Partial<ModelRecord> = {}): ModelRecord {
  const provider = overrides.provider ?? "opencode";
  const id = overrides.id ?? "x";
  const name = overrides.name ?? "X";
  return {
    key: `${provider}/${id}`,
    provider,
    id,
    name,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {
      toolCall: false,
      reasoning: false,
      attachment: false,
      structuredOutput: false,
      temperature: false,
    },
    limits: { context: 100000, output: 10000 },
    pricing: pricing(),
    free: { kind: "paid", flags: [] },
    availability: "live",
    privacy: { training: "unknown" },
    sources: [
      {
        id: "models.dev",
        url: "https://models.dev/api.json",
        fetchedAt: NOW,
      },
    ],
    conflicts: [],
    firstSeen: NOW,
    lastSeen: NOW,
    ...overrides,
  };
}

function freeEntry(overrides: Partial<DocsFreeEntry> = {}): DocsFreeEntry {
  return {
    name: "X Free",
    group: "console",
    limitedTime: true,
    stealth: false,
    training: "none",
    notes: "",
    ...overrides,
  };
}

function priceEntry(overrides: Partial<DocsPriceEntry> = {}): DocsPriceEntry {
  return {
    name: "X Free",
    group: "console",
    input: 0,
    output: 0,
    free: true,
    unlimited: false,
    limitedTime: true,
    ...overrides,
  };
}

function evidence(overrides: Partial<DocsEvidence> = {}): DocsEvidence {
  return {
    freeModels: [],
    prices: [],
    consoleFree: [],
    consolePrices: [],
    goPrices: [],
    goPrivacy: [],
    endpoints: [],
    planPrices: { go: 10, goPlus: 40 },
    sources: [],
    sourceRefs: [],
    warnings: [],
    ...overrides,
  };
}

function context(overrides: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    now: NOW,
    previous: null,
    planPrices: { go: 10, goPlus: 40 },
    live: new Set(),
    goLive: new Set(),
    sourceRefs: [],
    ...overrides,
  };
}

describe("classifyOne", () => {
  it("classifies a zero-price limited-time model", () => {
    const model = classifyOne(baseModel({ name: "X Free" }), {
      freeEntry: freeEntry(),
      now: NOW,
    });
    expect(model.free.kind).toBe("limited-time");
    expect(model.free.flags).toContain("limited-time");
    expect(model.privacy?.training).toBe("none");
    expect(model.free.since).toBe("2026-10-19");
  });

  it("classifies a free model with no trial signals as open-free", () => {
    const model = classifyOne(baseModel({ name: "X Free" }), {
      freeEntry: freeEntry({ limitedTime: false }),
      now: NOW,
    });
    expect(model.free.kind).toBe("open-free");
    expect(model.free.flags).toEqual([]);
  });

  it("classifies a may-train free model as trial", () => {
    const model = classifyOne(baseModel({ name: "X Free" }), {
      freeEntry: freeEntry({ limitedTime: false, training: "may-train" }),
      now: NOW,
    });
    expect(model.free.kind).toBe("trial");
    expect(model.free.flags).toEqual(
      expect.arrayContaining(["trial", "trains-on-data"]),
    );
  });

  it("classifies a region-restricted free model as trial", () => {
    const model = classifyOne(baseModel({ name: "X Free" }), {
      freeEntry: freeEntry({
        limitedTime: false,
        regionsExcluded: ["Angola"],
      }),
      now: NOW,
    });
    expect(model.free.kind).toBe("trial");
    expect(model.free.flags).toEqual(
      expect.arrayContaining(["trial", "region-restricted"]),
    );
    expect(model.free.regionsExcluded).toEqual(["Angola"]);
  });

  it("classifies a Go paid model as subscription-included", () => {
    const model = classifyOne(
      baseModel({
        provider: "opencode-go",
        id: "glm-5.3",
        key: "opencode-go/glm-5.3",
        name: "GLM-5.3",
        pricing: pricing(1.4, 4.4, { cacheRead: 0.26 }),
      }),
      {
        price: priceEntry({
          name: "GLM-5.3",
          group: "go",
          free: false,
          input: 1.4,
          output: 4.4,
          cacheRead: 0.26,
          limitedTime: false,
          monthlyLimitUsd: 15,
        }),
        plan: "go",
        planPrices: { go: 10, goPlus: 40 },
        now: NOW,
      },
    );
    expect(model.free.kind).toBe("subscription-included");
    expect(model.free.flags).toEqual(["usage-limited"]);
    expect(model.subscription).toMatchObject({
      plan: "go",
      monthlyUsd: 10,
      includedUsageUsd: 15,
    });
  });

  it("classifies a paid model as paid", () => {
    const model = classifyOne(baseModel({ name: "Paid" }), {
      price: priceEntry({
        name: "Paid",
        free: false,
        input: 2,
        output: 4,
        limitedTime: false,
      }),
      now: NOW,
    });
    expect(model.free.kind).toBe("paid");
    expect(model.free.flags).toEqual([]);
    expect(model.free.status).toBeUndefined();
    expect(model.subscription).toBeUndefined();
  });

  it("marks docs-free but deprecated models uncertain and records a conflict", () => {
    const model = classifyOne(
      baseModel({ name: "Old Free", availability: "deprecated" }),
      {
        freeEntry: freeEntry({ name: "Old Free" }),
        now: NOW,
      },
    );
    expect(model.free.kind).toBe("limited-time");
    expect(model.free.status).toBe("uncertain");
    expect(model.conflicts.some((conflict) => conflict.field === "free.kind")).toBe(
      true,
    );
  });

  it("keeps the models.dev price when docs say free and records a conflict", () => {
    const model = classifyOne(
      baseModel({ name: "X Free", pricing: pricing(2, 4) }),
      {
        freeEntry: freeEntry({ name: "X Free" }),
        price: priceEntry({ name: "X Free" }),
        now: NOW,
      },
    );
    expect(model.free.kind).toBe("limited-time");
    expect(model.free.status).toBe("uncertain");
    expect(model.pricing.input).toBe(2);
    expect(
      model.conflicts.some((conflict) => conflict.field === "pricing.input"),
    ).toBe(true);
  });

  it("records a price conflict when docs and models.dev differ", () => {
    const model = classifyOne(
      baseModel({ name: "Paid", pricing: pricing(1, 2) }),
      {
        price: priceEntry({
          name: "Paid",
          free: false,
          input: 1.5,
          output: 2,
          limitedTime: false,
        }),
        now: NOW,
      },
    );
    expect(model.free.kind).toBe("paid");
    expect(model.conflicts.some((conflict) => conflict.field === "pricing")).toBe(
      true,
    );
  });

  it("preserves free.since from the previous snapshot", () => {
    const previous: ModelRecord = {
      ...baseModel({ name: "X Free" }),
      free: {
        kind: "open-free",
        flags: [],
        since: "2026-09-01",
      },
    };
    const model = classifyOne(baseModel({ name: "X Free" }), {
      freeEntry: freeEntry(),
      previous,
      now: NOW,
    });
    expect(model.free.since).toBe("2026-09-01");
  });

  it("keeps the previous free classification when docs are unavailable", () => {
    const previous: ModelRecord = {
      ...baseModel({ name: "X Free" }),
      free: {
        kind: "open-free",
        flags: ["zero-retention"],
        since: "2026-09-01",
      },
    };
    const model = classifyOne(baseModel({ name: "X Free" }), {
      docsAvailable: false,
      previous,
      now: NOW,
    });
    expect(model.free).toMatchObject({
      kind: "open-free",
      since: "2026-09-01",
    });
  });
});

describe("classifyFreeResult", () => {
  it("resolves a console free entry and attaches the docs source", () => {
    const model = baseModel({
      id: "deepseek-v4.1-flash-free",
      name: "DeepSeek V4.1 Flash Free",
      pricing: pricing(0, 0, { cacheRead: 0 }),
    });
    const docs = evidence({
      freeModels: [freeEntry({ name: "DeepSeek V4.1 Flash Free" })],
      prices: [priceEntry({ name: "DeepSeek V4.1 Flash Free" })],
      endpoints: [
        {
          name: "DeepSeek V4.1 Flash Free",
          id: "deepseek-v4.1-flash-free",
          group: "console",
        },
      ],
    });

    const result = classifyFreeResult(
      [model],
      docs,
      context({ live: new Set(["deepseek-v4.1-flash-free"]) }),
    );

    expect(result.models).toHaveLength(1);
    expect(result.models[0]!.free.kind).toBe("limited-time");
    expect(
      result.models[0]!.sources.some(
        (source) => source.id === "opencode.console-docs",
      ),
    ).toBe(true);
  });

  it("uses endpoint ids to disambiguate names that normalize to the same value", () => {
    const freeModel = baseModel({
      id: "jev-1.13-free",
      name: "Jev 1.13 Free",
    });
    const paidModel = baseModel({
      id: "jev-1.13",
      name: "Jev 1.13",
      pricing: pricing(0.042, 0),
    });
    const docs = evidence({
      freeModels: [freeEntry({ name: "Jev 1.13 Free" })],
      prices: [
        priceEntry({ name: "Jev 1.13 Free" }),
        priceEntry({
          name: "Jev 1.13",
          free: false,
          input: 0.042,
          output: 0,
          limitedTime: false,
        }),
      ],
      endpoints: [
        { name: "Jev 1.13 Free", id: "jev-1.13-free", group: "console" },
        { name: "Jev 1.13", id: "jev-1.13", group: "console" },
      ],
    });

    const result = classifyFreeResult(
      [freeModel, paidModel],
      docs,
      context({ live: new Set(["jev-1.13-free", "jev-1.13"]) }),
    );

    const free = result.models.find(
      (model) => model.key === "opencode/jev-1.13-free",
    );
    const paid = result.models.find(
      (model) => model.key === "opencode/jev-1.13",
    );
    expect(free?.free.kind).toBe("limited-time");
    expect(paid?.free.kind).toBe("paid");
  });

  it("adds docs-only live models with real docs prices", () => {
    const docs = evidence({
      freeModels: [freeEntry({ name: "Jev 1.13 Free" })],
      prices: [
        priceEntry({ name: "Jev 1.13 Free" }),
        priceEntry({
          name: "Jev 1.13",
          free: false,
          input: 0.042,
          output: 0,
          limitedTime: false,
        }),
      ],
      endpoints: [
        { name: "Jev 1.13 Free", id: "jev-1.13-free", group: "console" },
        { name: "Jev 1.13", id: "jev-1.13", group: "console" },
      ],
    });

    const result = classifyFreeResult(
      [],
      docs,
      context({ live: new Set(["jev-1.13-free", "jev-1.13"]) }),
    );

    expect(result.models.map((model) => model.key)).toEqual([
      "opencode/jev-1.13",
      "opencode/jev-1.13-free",
    ]);

    const free = result.models.find(
      (model) => model.key === "opencode/jev-1.13-free",
    );
    expect(free?.pricing).toMatchObject({
      pricingKnown: true,
      input: 0,
      output: 0,
    });
    expect(free?.limits).toEqual({ context: 0, output: 0 });
    expect(free?.free.kind).toBe("limited-time");
    expect(free?.free.status).toBe("confirmed");

    const paid = result.models.find(
      (model) => model.key === "opencode/jev-1.13",
    );
    expect(paid?.pricing).toMatchObject({
      pricingKnown: true,
      input: 0.042,
      output: 0,
    });
    expect(paid?.free.kind).toBe("paid");
    expect(
      result.warnings.some((warning) => warning.includes("did not match")),
    ).toBe(false);
  });

  it("excludes test and backup live ids", () => {
    const docs = evidence({
      endpoints: [
        { name: "Test", id: "test", group: "console" },
        { name: "Backup", id: "x-backup", group: "console" },
      ],
    });

    const result = classifyFreeResult(
      [],
      docs,
      context({ live: new Set(["test", "x-backup"]) }),
    );
    expect(result.models).toHaveLength(0);
  });

  it("marks zero-price models not in docs as open-free but uncertain", () => {
    const model = baseModel({
      id: "mystery",
      name: "Mystery",
      pricing: pricing(0, 0),
    });
    const result = classifyFreeResult(
      [model],
      evidence(),
      context({ live: new Set(["mystery"]) }),
    );

    expect(result.models[0]!.free.kind).toBe("open-free");
    expect(result.models[0]!.free.status).toBe("uncertain");
    expect(result.models[0]!.free.note?.toLowerCase()).toContain(
      "official docs free list",
    );
    expect(result.models[0]!.free.note?.toLowerCase()).toContain("unconfirmed");
    expect(
      result.warnings.some((warning) => warning.includes("zero-price")),
    ).toBe(true);
  });

  it("keeps the previous free classification when docs are unavailable", () => {
    const previousModel: ModelRecord = {
      ...baseModel({ id: "mystery", name: "Mystery" }),
      free: {
        kind: "open-free",
        flags: ["zero-retention"],
        since: "2026-09-01",
      },
    };
    const previous: Snapshot = {
      schemaVersion: 1,
      generatedAt: NOW,
      models: [previousModel],
      sources: [],
    };

    const result = classifyFreeResult(
      [baseModel({ id: "mystery", name: "Mystery" })],
      evidence(),
      context({
        previous,
        live: new Set(["mystery"]),
        docsAvailable: { console: false, go: false },
      }),
    );

    expect(result.models[0]!.free.kind).toBe("open-free");
    expect(result.models[0]!.free.since).toBe("2026-09-01");
  });

  it("sets Go subscriptions and privacy from the Go docs", () => {
    const model = baseModel({
      provider: "opencode-go",
      id: "glm-5.3",
      key: "opencode-go/glm-5.3",
      name: "GLM-5.3",
      pricing: pricing(1.4, 4.4, { cacheRead: 0.26 }),
    });
    const docs = evidence({
      prices: [
        priceEntry({
          name: "GLM-5.3",
          group: "go",
          free: false,
          input: 1.4,
          output: 4.4,
          cacheRead: 0.26,
          limitedTime: false,
          monthlyLimitUsd: 15,
        }),
      ],
      goPrivacy: [{ name: "GLM-5.3", training: "none", retentionDays: 0 }],
      endpoints: [{ name: "GLM-5.3", id: "glm-5.3", group: "go" }],
    });

    const result = classifyFreeResult(
      [model],
      docs,
      context({ goLive: new Set(["glm-5.3"]) }),
    );

    expect(result.models[0]!.free.kind).toBe("subscription-included");
    expect(result.models[0]!.subscription).toMatchObject({
      plan: "go",
      monthlyUsd: 10,
      includedUsageUsd: 15,
    });
    expect(result.models[0]!.privacy).toMatchObject({
      training: "none",
      retentionDays: 0,
    });
  });

  it("keeps Go models missing from the docs price table uncertain", () => {
    const model = baseModel({
      provider: "opencode-go",
      id: "minimax-m2.7",
      key: "opencode-go/minimax-m2.7",
      name: "MiniMax-M2.7",
      pricing: pricing(0.3, 1.2),
    });
    const docs = evidence({
      endpoints: [{ name: "Other", id: "other", group: "go" }],
    });

    const result = classifyFreeResult(
      [model],
      docs,
      context({ goLive: new Set(["minimax-m2.7"]) }),
    );

    expect(result.models[0]!.free.kind).toBe("subscription-included");
    expect(result.models[0]!.free.status).toBe("uncertain");
    expect(result.models[0]!.subscription).toBeUndefined();
    expect(result.models[0]!.free.note?.toLowerCase()).toContain("unconfirmed");
    expect(
      result.warnings.some((warning) => warning.includes("no docs price row")),
    ).toBe(true);
  });

  it("classifies Go free rows as limited-time with the unlimited flag", () => {
    const model = baseModel({
      provider: "opencode-go",
      id: "beam-free",
      key: "opencode-go/beam-free",
      name: "Beam Free",
    });
    const docs = evidence({
      freeModels: [freeEntry({ name: "Beam Free", group: "go" })],
      prices: [
        priceEntry({ name: "Beam Free", group: "go", unlimited: true }),
      ],
      goPrivacy: [
        { name: "Beam Free", training: "none", retentionDays: 30 },
      ],
      endpoints: [{ name: "Beam Free", id: "beam-free", group: "go" }],
    });

    const result = classifyFreeResult(
      [model],
      docs,
      context({ goLive: new Set(["beam-free"]) }),
    );

    expect(result.models[0]!.free.kind).toBe("limited-time");
    expect(result.models[0]!.free.flags).toEqual(
      expect.arrayContaining(["limited-time", "unlimited"]),
    );
    expect(result.models[0]!.privacy).toMatchObject({
      training: "none",
      retentionDays: 30,
    });
  });

  it("reports live models without docs endpoints instead of dropping them silently", () => {
    const result = classifyFreeResult(
      [],
      evidence(),
      context({ goLive: new Set(["glm-5.1"]) }),
    );

    expect(result.models).toHaveLength(0);
    expect(
      result.warnings.some((warning) =>
        warning.includes("opencode-go/glm-5.1"),
      ),
    ).toBe(true);
  });
});

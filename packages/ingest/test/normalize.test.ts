import { describe, expect, it } from "vitest";

import { normalizeCatalog, type NormalizeContext } from "../src/normalize";
import { parseModelsDev } from "../src/sources/modelsDev";
import rawModelsDev from "./fixtures/models-dev.sample.json";

const NOW = "2026-10-19T13:00:00.000Z";
const providers = parseModelsDev(rawModelsDev);

function baseCtx(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    now: NOW,
    previous: null,
    live: new Set(["deepseek-v4.1-flash-free", "kimi-k3"]),
    goLive: new Set(["glm-5.3"]),
    sourceRefs: [],
    ...overrides,
  };
}

function byKey(models: ReturnType<typeof normalizeCatalog>, key: string) {
  const model = models.find((candidate) => candidate.key === key);
  if (!model) throw new Error(`missing model ${key}`);
  return model;
}

function snapshotWith(
  models: ReturnType<typeof normalizeCatalog>,
  key: string,
  firstSeen: string,
) {
  return {
    schemaVersion: 1 as const,
    generatedAt: NOW,
    sources: [],
    models: models.map((model) => (model.key === key ? { ...model, firstSeen } : model)),
  };
}

describe("normalizeCatalog", () => {
  it("maps a zero-price model as open-free and live", () => {
    const model = byKey(
      normalizeCatalog(providers, baseCtx()),
      "opencode/deepseek-v4.1-flash-free",
    );
    expect(model.free.kind).toBe("open-free");
    expect(model.availability).toBe("live");
    expect(model.pricing.input).toBe(0);
    expect(model.pricing.output).toBe(0);
    expect(model.firstSeen).toBe(NOW);
    expect(model.lastSeen).toBe(NOW);
  });

  it("marks a model absent from live and deprecated as deprecated", () => {
    const model = byKey(normalizeCatalog(providers, baseCtx()), "opencode/old-model");
    expect(model.availability).toBe("deprecated");
  });

  it("marks a model absent from live and not deprecated as unlisted", () => {
    const model = byKey(normalizeCatalog(providers, baseCtx()), "opencode/hidden-model");
    expect(model.availability).toBe("unlisted");
  });

  it("records a conflict when models.dev says deprecated but the model is live", () => {
    const model = byKey(
      normalizeCatalog(providers, baseCtx({ live: new Set(["old-model"]) })),
      "opencode/old-model",
    );
    expect(model.availability).toBe("live");
    expect(model.conflicts).toHaveLength(1);
    expect(model.conflicts[0]?.field).toBe("availability");
    expect(model.conflicts[0]?.resolution).toBe("preferred");
    expect(model.conflicts[0]?.values).toContainEqual({
      source: "models.dev",
      value: "deprecated",
    });
  });

  it("preserves firstSeen from the previous snapshot and advances lastSeen", () => {
    const firstRun = normalizeCatalog(providers, baseCtx());
    const previous = snapshotWith(
      firstRun,
      "opencode/deepseek-v4.1-flash-free",
      "2026-09-01T00:00:00.000Z",
    );

    const later = "2026-10-20T13:00:00.000Z";
    const model = byKey(
      normalizeCatalog(providers, baseCtx({ now: later, previous })),
      "opencode/deepseek-v4.1-flash-free",
    );
    expect(model.firstSeen).toBe("2026-09-01T00:00:00.000Z");
    expect(model.lastSeen).toBe(later);
  });

  it("classifies Go models with non-zero prices as subscription-included", () => {
    const model = byKey(normalizeCatalog(providers, baseCtx()), "opencode-go/glm-5.3");
    expect(model.free.kind).toBe("subscription-included");
    expect(model.availability).toBe("live");
    expect(model.subscription).toBeUndefined();
  });

  it("maps tier and over-200k prices", () => {
    const model = byKey(normalizeCatalog(providers, baseCtx()), "opencode/gpt-tiered");
    expect(model.pricing.tiers).toHaveLength(1);
    expect(model.pricing.tiers?.[0]).toMatchObject({
      minInputTokens: 272000,
      input: 5,
      output: 22.5,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
    expect(model.pricing.contextOver200k).toMatchObject({
      input: 10,
      output: 45,
      cacheRead: 1,
      cacheWrite: 12.5,
    });
  });

  it("attaches models.dev and the matching live endpoint as sources", () => {
    const opencode = byKey(normalizeCatalog(providers, baseCtx()), "opencode/kimi-k3");
    expect(opencode.sources.map((source) => source.id)).toEqual([
      "models.dev",
      "opencode.models",
    ]);
    expect(opencode.sources.every((source) => source.fetchedAt === NOW)).toBe(true);

    const go = byKey(normalizeCatalog(providers, baseCtx()), "opencode-go/glm-5.3");
    expect(go.sources.map((source) => source.id)).toEqual([
      "models.dev",
      "opencode-go.models",
    ]);
  });

  it("marks a free model not seen live as uncertain", () => {
    const model = byKey(
      normalizeCatalog(providers, baseCtx({ live: new Set() })),
      "opencode/deepseek-v4.1-flash-free",
    );
    expect(model.free.kind).toBe("open-free");
    expect(model.free.status).toBe("uncertain");
    expect(model.availability).toBe("unlisted");
  });

  it("defaults privacy to unknown and leaves subscription unset", () => {
    const model = byKey(normalizeCatalog(providers, baseCtx()), "opencode/kimi-k3");
    expect(model.privacy).toEqual({ training: "unknown" });
    expect(model.subscription).toBeUndefined();
  });

  it("sorts models by key", () => {
    const keys = normalizeCatalog(providers, baseCtx()).map((model) => model.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  it("ignores providers that are missing from the payload", () => {
    const onlyOpencode = providers.filter((provider) => provider.id === "opencode");
    const keys = normalizeCatalog(onlyOpencode, baseCtx()).map((model) => model.key);
    expect(keys.every((key) => key.startsWith("opencode/"))).toBe(true);
  });
});

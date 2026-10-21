import { describe, expect, it } from "vitest";

import type {
  BenchmarksFile,
  ChangeEvent,
  FreeKind,
  ModelRecord,
  ProviderId,
  ScoresFile,
  Snapshot,
  UseCaseId,
} from "@omg/shared";

import {
  bestValueByUseCase,
  freeCaveat,
  freeNowModels,
  isFreeNow,
  latestEvents,
  latestUpdatedAt,
} from "../src/lib/home";

const NOW = "2026-10-20T12:00:00.000Z";

function makeModel(options: {
  id: string;
  free?: FreeKind;
  availability?: ModelRecord["availability"];
  provider?: ProviderId;
  context?: number;
  training?: NonNullable<ModelRecord["privacy"]>["training"];
  status?: "confirmed" | "uncertain";
  note?: string;
}): ModelRecord {
  const provider = options.provider ?? "opencode";
  const model: ModelRecord = {
    key: `${provider}/${options.id}`,
    provider,
    id: options.id,
    name: options.id,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {
      toolCall: true,
      reasoning: true,
      attachment: false,
      structuredOutput: false,
      temperature: true,
    },
    limits: { context: options.context ?? 200_000, output: 10_000 },
    pricing: {
      currency: "USD",
      unit: "per_1m_tokens",
      pricingKnown: true,
      input: 3,
      output: 15,
    },
    free: {
      kind: options.free ?? "paid",
      flags: [],
      ...(options.status ? { status: options.status } : {}),
      ...(options.note ? { note: options.note } : {}),
    },
    availability: options.availability ?? "live",
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
  };
  if (options.training) {
    model.privacy = { training: options.training };
  }
  return model;
}

function makeSnapshot(models: ModelRecord[]): Snapshot {
  return { schemaVersion: 1, generatedAt: NOW, models, sources: [] };
}

function scoreRecord(
  modelKey: string,
  useCases: Partial<Record<UseCaseId, { score: number | null; tier: string; confidence: number }>>,
  agenticCost = 0.5,
  goEffective?: number,
): ScoresFile["scores"][number] {
  return {
    modelKey,
    benchmarks: {},
    useCases: useCases as ScoresFile["scores"][number]["useCases"],
    cost: {
      profiles: {
        "quick-edit": agenticCost / 4,
        "agentic-pr": agenticCost,
        "long-context": agenticCost * 2,
      },
      ...(goEffective === undefined
        ? {}
        : {
            goEffective: {
              "quick-edit": goEffective / 4,
              "agentic-pr": goEffective,
              "long-context": goEffective * 2,
            },
          }),
    },
  };
}

describe("freeNowModels", () => {
  it("keeps only live, no-subscription free models", () => {
    const models = [
      makeModel({ id: "limited", free: "limited-time" }),
      makeModel({ id: "open", free: "open-free" }),
      makeModel({ id: "trial", free: "trial" }),
      makeModel({ id: "included", free: "subscription-included" }),
      makeModel({ id: "paid", free: "paid" }),
      makeModel({ id: "old", free: "open-free", availability: "deprecated" }),
      makeModel({ id: "unlisted", free: "limited-time", availability: "unlisted" }),
    ];

    expect(freeNowModels(makeSnapshot(models)).map((model) => model.key)).toEqual([
      "opencode/open",
      "opencode/limited",
      "opencode/trial",
    ]);
  });

  it("sorts by free kind, then provider, context, and name", () => {
    const models = [
      makeModel({
        id: "go-large",
        free: "open-free",
        provider: "opencode-go",
        context: 400_000,
      }),
      makeModel({
        id: "console-small",
        free: "open-free",
        context: 100_000,
      }),
      makeModel({
        id: "console-large",
        free: "open-free",
        context: 300_000,
      }),
    ];

    expect(freeNowModels(makeSnapshot(models)).map((model) => model.key)).toEqual([
      "opencode/console-large",
      "opencode/console-small",
      "opencode-go/go-large",
    ]);
  });

  it("matches the exported isFreeNow predicate", () => {
    const live = makeModel({ id: "live", free: "open-free" });
    const deprecated = makeModel({
      id: "old",
      free: "open-free",
      availability: "deprecated",
    });
    expect(isFreeNow(live)).toBe(true);
    expect(isFreeNow(deprecated)).toBe(false);
  });
});

describe("freeCaveat", () => {
  it("names the free kind and the main caveats", () => {
    const model = makeModel({
      id: "caveat",
      free: "limited-time",
      status: "uncertain",
      training: "may-train",
    });
    const caveat = freeCaveat(model);
    expect(caveat).toContain("Limited-time");
    expect(caveat).toContain("Terms uncertain");
    expect(caveat).toContain("May train on inputs");
  });

  it("uses a source note when present", () => {
    const model = makeModel({
      id: "note",
      free: "trial",
      note: "Free until the end of the month.",
    });
    expect(freeCaveat(model)).toContain("Free until the end of the month");
  });
});

describe("latestEvents", () => {
  it("returns the newest events first and respects the limit", () => {
    const event = (at: string, summary: string): ChangeEvent => ({
      id: `free_started:opencode/model:${at.slice(0, 10)}`,
      type: "free_started",
      at,
      modelKey: "opencode/model",
      summary,
      data: {},
      notify: true,
    });

    const events = [
      event("2026-10-18T12:00:00.000Z", "Older"),
      event("2026-10-20T12:00:00.000Z", "Newest"),
      event("2026-10-19T12:00:00.000Z", "Middle"),
    ];

    expect(latestEvents(events, 2).map((item) => item.summary)).toEqual([
      "Newest",
      "Middle",
    ]);
  });
});

describe("latestUpdatedAt", () => {
  it("uses the newest generated timestamp", () => {
    const snapshot = makeSnapshot([]);
    const scores: ScoresFile = {
      schemaVersion: 1,
      generatedAt: "2026-10-22T12:00:00.000Z",
      scores: [],
    };
    const benchmarks: BenchmarksFile = {
      schemaVersion: 1,
      generatedAt: "2026-10-21T12:00:00.000Z",
      results: [],
      unmatched: [],
      sources: [],
    };

    expect(latestUpdatedAt(snapshot, scores, benchmarks)).toBe(
      "2026-10-22T12:00:00.000Z",
    );
  });
});

describe("bestValueByUseCase", () => {
  it("picks the top rated model in each access group and preserves gaps", () => {
    const freeHigh = makeModel({ id: "free-high", free: "open-free" });
    const freeLow = makeModel({ id: "free-low", free: "limited-time" });
    const go = makeModel({
      id: "go",
      free: "subscription-included",
      provider: "opencode-go",
    });
    const paid = makeModel({ id: "paid", free: "paid" });
    const snapshot = makeSnapshot([freeHigh, freeLow, go, paid]);
    const scores: ScoresFile = {
      schemaVersion: 1,
      generatedAt: NOW,
      scores: [
        scoreRecord(freeHigh.key, {
          frontend: { score: 80, tier: "A", confidence: 0.8 },
        }, 0.4),
        scoreRecord(freeLow.key, {
          frontend: { score: 70, tier: "B", confidence: 0.7 },
        }),
        scoreRecord(
          go.key,
          { frontend: { score: 90, tier: "S", confidence: 0.9 } },
          0.9,
          0.6,
        ),
        scoreRecord(paid.key, {
          frontend: { score: 85, tier: "S", confidence: 0.85 },
        }, 0.7),
      ],
    };

    const picks = bestValueByUseCase(snapshot, scores);
    const frontend = picks.find((pick) => pick.useCase === "frontend");
    const agentic = picks.find((pick) => pick.useCase === "agentic-coding");

    expect(frontend?.groups.map((group) => group.label)).toEqual([
      "Free now",
      "Included in Go",
      "Pay as you go",
    ]);
    expect(frontend?.groups[0].pick).toMatchObject({
      model: { key: freeHigh.key },
      score: 80,
      tier: "A",
      confidence: 0.8,
      agenticCost: 0.4,
      costBasis: "list",
    });
    expect(frontend?.groups[1].pick).toMatchObject({
      model: { key: go.key },
      score: 90,
      tier: "S",
      confidence: 0.9,
      agenticCost: 0.6,
      costBasis: "go-effective",
    });
    expect(frontend?.groups[2].pick).toMatchObject({
      model: { key: paid.key },
      score: 85,
      tier: "S",
      confidence: 0.85,
      agenticCost: 0.7,
      costBasis: "list",
    });
    expect(agentic?.groups.every((group) => group.pick === null)).toBe(true);
  });

  it("keeps free, Go, and pay-as-you-go candidates separate and live-only", () => {
    const free = makeModel({ id: "free", free: "trial" });
    const go = makeModel({
      id: "go",
      free: "subscription-included",
      provider: "opencode-go",
    });
    const paid = makeModel({ id: "paid", free: "paid" });
    const deprecated = makeModel({
      id: "deprecated",
      free: "paid",
      availability: "deprecated",
    });
    const unlisted = makeModel({
      id: "unlisted",
      free: "subscription-included",
      provider: "opencode-go",
      availability: "unlisted",
    });
    const snapshot = makeSnapshot([free, go, paid, deprecated, unlisted]);
    const scores: ScoresFile = {
      schemaVersion: 1,
      generatedAt: NOW,
      scores: [
        scoreRecord(free.key, {
          frontend: { score: 70, tier: "B", confidence: 0.7 },
        }),
        scoreRecord(go.key, {
          frontend: { score: 80, tier: "A", confidence: 0.8 },
        }),
        scoreRecord(paid.key, {
          frontend: { score: 90, tier: "S", confidence: 0.9 },
        }),
        scoreRecord(deprecated.key, {
          frontend: { score: 100, tier: "S", confidence: 1 },
        }),
        scoreRecord(unlisted.key, {
          frontend: { score: 100, tier: "S", confidence: 1 },
        }),
      ],
    };

    const frontend = bestValueByUseCase(snapshot, scores).find(
      (pick) => pick.useCase === "frontend",
    );

    expect(frontend?.groups.map((group) => group.pick?.model.key)).toEqual([
      free.key,
      go.key,
      paid.key,
    ]);
  });

  it("includes limited-time and Go free listings in the free group", () => {
    const limited = makeModel({ id: "limited", free: "limited-time" });
    const goFree = makeModel({
      id: "go-free",
      free: "limited-time",
      provider: "opencode-go",
    });
    const snapshot = makeSnapshot([limited, goFree]);
    const scores: ScoresFile = {
      schemaVersion: 1,
      generatedAt: NOW,
      scores: [
        scoreRecord(limited.key, {
          frontend: { score: 60, tier: "B", confidence: 0.6 },
        }),
        scoreRecord(goFree.key, {
          frontend: { score: 75, tier: "A", confidence: 0.7 },
        }),
      ],
    };

    const free = bestValueByUseCase(snapshot, scores).find(
      (pick) => pick.useCase === "frontend",
    )?.groups[0];

    expect(free?.pick?.model.key).toBe(goFree.key);
  });

  it("falls back to list cost when a Go pick has no effective cost", () => {
    const go = makeModel({
      id: "go",
      free: "subscription-included",
      provider: "opencode-go",
    });
    const snapshot = makeSnapshot([go]);
    const scores: ScoresFile = {
      schemaVersion: 1,
      generatedAt: NOW,
      scores: [
        scoreRecord(
          go.key,
          { frontend: { score: 80, tier: "A", confidence: 0.8 } },
          0.9,
        ),
      ],
    };

    const pick = bestValueByUseCase(snapshot, scores).find(
      (item) => item.useCase === "frontend",
    )?.groups[1].pick;

    expect(pick).toMatchObject({
      agenticCost: 0.9,
      costBasis: "list",
    });
  });

  it("ignores unrated scores and unknown models", () => {
    const a = makeModel({ id: "a", free: "paid" });
    const snapshot = makeSnapshot([a]);
    const scores: ScoresFile = {
      schemaVersion: 1,
      generatedAt: NOW,
      scores: [
        scoreRecord(a.key, {
          frontend: { score: 80, tier: "unrated", confidence: 0.8 },
        }),
        scoreRecord("opencode/missing", {
          frontend: { score: 99, tier: "S", confidence: 1 },
        }),
      ],
    };

    expect(
      bestValueByUseCase(snapshot, scores)
        .find((pick) => pick.useCase === "frontend")
        ?.groups.every((group) => group.pick === null),
    ).toBe(true);
  });
});

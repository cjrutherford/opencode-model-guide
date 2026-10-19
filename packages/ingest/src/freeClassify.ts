import {
  modelKey,
  normalizeModelName,
  type Conflict,
  type FreeInfo,
  type ModelRecord,
  type Pricing,
  type Privacy,
  type ProviderId,
  type Snapshot,
  type SourceRef,
} from "@omg/shared";

import {
  CONSOLE_DOCS_URL,
  GO_DOCS_URL,
  type DocsEndpointEntry,
  type DocsEvidence,
  type DocsFreeEntry,
  type DocsGroup,
  type DocsPriceEntry,
  type DocsPrivacyEntry,
} from "./sources/opencodeDocs";

export interface ClassifyContext {
  now: string;
  previous: Snapshot | null;
  planPrices: { go: number; goPlus: number };
  live?: Set<string>;
  goLive?: Set<string>;
  sourceRefs?: SourceRef[];
  docsAvailable?: { console: boolean; go: boolean };
}

export interface ClassifyOneOptions {
  freeEntry?: DocsFreeEntry;
  price?: DocsPriceEntry;
  privacy?: DocsPrivacyEntry;
  plan?: "go" | "go-plus";
  planPrices?: { go: number; goPlus: number };
  previous?: ModelRecord | null;
  docsAvailable?: boolean;
  now?: string;
  docsSources?: SourceRef[];
}

export interface ClassifyResult {
  models: ModelRecord[];
  warnings: string[];
}

const DOCS_URLS: Record<DocsGroup, string> = {
  console: CONSOLE_DOCS_URL,
  go: GO_DOCS_URL,
};

const LIVE_URLS: Record<DocsGroup, string> = {
  console: "https://opencode.ai/inference/v1/models",
  go: "https://opencode.ai/inference/go/v1/models",
};

const DOCS_SOURCE_IDS: Record<
  DocsGroup,
  "opencode.console-docs" | "opencode.go-docs"
> = {
  console: "opencode.console-docs",
  go: "opencode.go-docs",
};

const LIVE_SOURCE_IDS: Record<
  DocsGroup,
  "opencode.models" | "opencode-go.models"
> = {
  console: "opencode.models",
  go: "opencode-go.models",
};

function groupFor(provider: ProviderId): DocsGroup {
  return provider === "opencode" ? "console" : "go";
}

function providerFor(group: DocsGroup): ProviderId {
  return group === "console" ? "opencode" : "opencode-go";
}

function dedupeSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const result: SourceRef[] = [];
  for (const source of sources) {
    const key = `${source.id}|${source.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function refsFor(
  group: DocsGroup,
  ctx: ClassifyContext,
  evidence: DocsEvidence,
): SourceRef[] {
  const id = DOCS_SOURCE_IDS[group];
  const candidates = [
    ...(ctx.sourceRefs ?? []),
    ...evidence.sources,
    ...evidence.sourceRefs,
  ].filter((source) => source.id === id);
  if (candidates.length > 0) return dedupeSources(candidates);
  return [{ id, url: DOCS_URLS[group], fetchedAt: ctx.now }];
}

function liveRefFor(group: DocsGroup, ctx: ClassifyContext): SourceRef {
  const id = LIVE_SOURCE_IDS[group];
  const found = (ctx.sourceRefs ?? []).find((source) => source.id === id);
  return found ?? { id, url: LIVE_URLS[group], fetchedAt: ctx.now };
}

function addSources(model: ModelRecord, sources: SourceRef[]): void {
  for (const source of sources) {
    const exists = model.sources.some(
      (existing) => existing.id === source.id && existing.url === source.url,
    );
    if (!exists) model.sources.push(source);
  }
}

function addConflict(
  model: ModelRecord,
  field: string,
  values: Conflict["values"],
  resolution: Conflict["resolution"],
  note: string,
): void {
  if (model.conflicts.some((conflict) => conflict.field === field && conflict.note === note)) {
    return;
  }
  model.conflicts.push({ field, values, resolution, note });
}

function privacyFromEntry(entry: DocsPrivacyEntry): Privacy {
  const privacy: Privacy = { training: entry.training };
  if (entry.retentionDays !== undefined) privacy.retentionDays = entry.retentionDays;
  if (entry.notes) privacy.notes = entry.notes;
  return privacy;
}

function comparePrices(price: DocsPriceEntry, pricing: Pricing): string[] {
  const fields: Array<[string, number | undefined, number | undefined]> = [
    ["input", price.free ? 0 : price.input, pricing.input],
    ["output", price.free ? 0 : price.output, pricing.output],
    ["cacheRead", price.cacheRead, pricing.cacheRead],
    ["cacheWrite", price.cacheWrite, pricing.cacheWrite],
  ];

  const differences: string[] = [];
  for (const [name, docsValue, catalogValue] of fields) {
    if (docsValue === undefined || catalogValue === undefined) continue;
    if (Math.abs(docsValue - catalogValue) > 0.001) differences.push(name);
  }
  return differences;
}

function priceSnapshot(price: DocsPriceEntry): Record<string, unknown> {
  return {
    input: price.free ? 0 : price.input,
    output: price.free ? 0 : price.output,
    cacheRead: price.cacheRead,
    cacheWrite: price.cacheWrite,
  };
}

function pricingSnapshot(pricing: Pricing): Record<string, unknown> {
  return {
    input: pricing.input,
    output: pricing.output,
    cacheRead: pricing.cacheRead,
    cacheWrite: pricing.cacheWrite,
  };
}

function pricingFromDocs(price: DocsPriceEntry): Pricing {
  const pricing: Pricing = {
    currency: "USD",
    unit: "per_1m_tokens",
    pricingKnown: true,
    input: price.free ? 0 : (price.input ?? 0),
    output: price.free ? 0 : (price.output ?? 0),
  };

  if (price.free) {
    pricing.cacheRead = 0;
  } else if (price.cacheRead !== undefined) {
    pricing.cacheRead = price.cacheRead;
  }
  if (price.cacheWrite !== undefined) pricing.cacheWrite = price.cacheWrite;
  return pricing;
}

function unknownPricing(): Pricing {
  return {
    currency: "USD",
    unit: "per_1m_tokens",
    pricingKnown: false,
    input: 0,
    output: 0,
  };
}

export function classifyOne(
  model: ModelRecord,
  options: ClassifyOneOptions = {},
): ModelRecord {
  const now = options.now ?? model.lastSeen;
  const group = groupFor(model.provider);
  const docsAvailable = options.docsAvailable ?? true;

  const next: ModelRecord = {
    ...model,
    free: { ...model.free, flags: [...model.free.flags] },
    sources: [...model.sources],
    conflicts: [...model.conflicts],
  };
  if (model.privacy) next.privacy = { ...model.privacy };

  if (!docsAvailable) {
    if (options.previous) {
      next.free = {
        ...options.previous.free,
        flags: [...options.previous.free.flags],
      };
      if (options.previous.privacy) next.privacy = { ...options.previous.privacy };
      else delete next.privacy;
      if (options.previous.subscription) {
        next.subscription = { ...options.previous.subscription };
      } else {
        delete next.subscription;
      }
    }
    return next;
  }

  const freeEntry = options.freeEntry;
  const price = options.price;
  const planPrices = options.planPrices ?? { go: 10, goPlus: 40 };

  if (options.docsSources && (freeEntry || price || options.privacy)) {
    addSources(next, options.docsSources);
  }

  const free: FreeInfo = next.free;
  delete free.since;
  delete free.status;
  delete free.regionsExcluded;
  delete free.note;
  free.flags = [];

  const docsFree = freeEntry !== undefined;
  const docsPricePositive =
    price !== undefined &&
    ((price.input ?? 0) > 0 || (price.output ?? 0) > 0);
  const catalogPricePositive =
    model.pricing.pricingKnown && model.pricing.input > 0;
  const zeroPriceNotInDocs =
    !docsFree &&
    price === undefined &&
    model.pricing.pricingKnown &&
    model.pricing.input === 0 &&
    model.pricing.output === 0;

  if (freeEntry) {
    const limited = freeEntry.limitedTime;
    const trialByTerms =
      freeEntry.trialOnly === true ||
      freeEntry.training === "may-train" ||
      (freeEntry.regionsExcluded?.length ?? 0) > 0;

    if (limited) free.kind = "limited-time";
    else if (trialByTerms) free.kind = "trial";
    else free.kind = "open-free";

    const flags = new Set<string>();
    if (limited) flags.add("limited-time");
    if (trialByTerms) flags.add("trial");
    if (freeEntry.stealth) flags.add("stealth");
    if (freeEntry.training === "may-train") flags.add("trains-on-data");
    if (freeEntry.retentionDays === 0) flags.add("zero-retention");
    if ((freeEntry.regionsExcluded?.length ?? 0) > 0) flags.add("region-restricted");
    if (/feedback/i.test(freeEntry.notes)) flags.add("feedback-program");
    if (price?.unlimited) flags.add("unlimited");
    free.flags = [...flags];
    if (freeEntry.regionsExcluded?.length) {
      free.regionsExcluded = [...freeEntry.regionsExcluded];
    }

    const privacy: Privacy = { training: freeEntry.training };
    if (freeEntry.retentionDays !== undefined) {
      privacy.retentionDays = freeEntry.retentionDays;
    }
    if (options.privacy) {
      if (options.privacy.training !== "unknown") {
        privacy.training = options.privacy.training;
      }
      if (options.privacy.retentionDays !== undefined) {
        privacy.retentionDays = options.privacy.retentionDays;
      }
      if (options.privacy.notes) privacy.notes = options.privacy.notes;
    }
    next.privacy = privacy;

    if (model.availability === "deprecated") {
      free.status = "uncertain";
      addConflict(
        next,
        "free.kind",
        [
          { source: DOCS_SOURCE_IDS[group], value: free.kind },
          { source: "availability", value: "deprecated" },
        ],
        "unresolved",
        "Docs list the model as free while the model is deprecated.",
      );
    } else if (docsPricePositive || catalogPricePositive) {
      free.status = "uncertain";
      addConflict(
        next,
        "pricing.input",
        [
          {
            source: DOCS_SOURCE_IDS[group],
            value: price?.free ? 0 : (price?.input ?? 0),
          },
          { source: "models.dev", value: model.pricing.input },
        ],
        "preferred",
        "Docs say free but models.dev publishes a price; the published price wins.",
      );
    } else if (!model.pricing.pricingKnown) {
      free.status = "uncertain";
    } else if (model.availability === "live") {
      free.status = "confirmed";
    } else {
      free.status = "uncertain";
    }
  } else if (
    model.provider === "opencode-go" &&
    price &&
    (price.monthlyLimitUsd ?? 0) > 0
  ) {
    free.kind = "subscription-included";
    free.flags = ["usage-limited"];
    free.status =
      model.availability === "live" && planPrices.go > 0 ? "confirmed" : "uncertain";

    const plan = options.plan ?? "go";
    next.subscription = {
      plan,
      monthlyUsd: plan === "go-plus" ? planPrices.goPlus : planPrices.go,
      includedUsageUsd: price.monthlyLimitUsd!,
    };
    if (options.privacy) next.privacy = privacyFromEntry(options.privacy);
  } else if (
    model.provider === "opencode-go" &&
    price &&
    docsPricePositive
  ) {
    free.kind = "subscription-included";
    free.flags = ["usage-limited"];
    free.status = "uncertain";
    free.note =
      "Go docs do not publish a monthly limit for this model; plan inclusion is unconfirmed.";
    if (options.previous?.subscription) {
      next.subscription = { ...options.previous.subscription };
    }
    if (options.privacy) next.privacy = privacyFromEntry(options.privacy);
  } else if (
    model.provider === "opencode-go" &&
    price === undefined &&
    catalogPricePositive
  ) {
    free.kind = "subscription-included";
    free.flags = ["usage-limited"];
    free.status = "uncertain";
    free.note =
      "Go docs do not list this model; plan inclusion and monthly limit are unconfirmed.";
    if (options.previous?.subscription) {
      next.subscription = { ...options.previous.subscription };
    }
    if (options.privacy) next.privacy = privacyFromEntry(options.privacy);
  } else if (zeroPriceNotInDocs) {
    free.kind = "open-free";
    free.status = "uncertain";
    free.note =
      "Not in the official docs free list; free status is unconfirmed.";
  } else if (price?.free) {
    free.kind = "open-free";
    free.status = "uncertain";
    if (price.unlimited) free.flags = ["unlimited"];
  } else {
    free.kind = "paid";
  }

  const docsFreePriceConflict =
    docsFree && (docsPricePositive || catalogPricePositive);
  if (price && model.pricing.pricingKnown && !docsFreePriceConflict) {
    const differences = comparePrices(price, model.pricing);
    if (differences.length > 0) {
      addConflict(
        next,
        "pricing",
        [
          { source: DOCS_SOURCE_IDS[group], value: priceSnapshot(price) },
          { source: "models.dev", value: pricingSnapshot(model.pricing) },
        ],
        "preferred",
        `Docs and models.dev differ on ${differences.join(", ")}; models.dev wins.`,
      );
    }
  }

  if (free.kind !== "paid") {
    const previousFree = options.previous?.free;
    if (previousFree && previousFree.kind !== "paid" && previousFree.since) {
      free.since = previousFree.since;
    } else {
      free.since = now.slice(0, 10);
    }
  } else {
    delete free.since;
    delete free.status;
    delete free.regionsExcluded;
    free.flags = [];
  }

  if (free.kind !== "subscription-included") {
    delete next.subscription;
  }

  return next;
}

interface ModelIndex {
  raw: Map<string, ModelRecord[]>;
  norm: Map<string, ModelRecord[]>;
  byId: Map<string, ModelRecord>;
}

function buildIndex(models: ModelRecord[]): ModelIndex {
  const raw = new Map<string, ModelRecord[]>();
  const norm = new Map<string, ModelRecord[]>();
  const byId = new Map<string, ModelRecord>();

  const push = (
    map: Map<string, ModelRecord[]>,
    key: string,
    model: ModelRecord,
  ): void => {
    const list = map.get(key);
    if (list) list.push(model);
    else map.set(key, [model]);
  };

  for (const model of models) {
    push(raw, `${model.provider}|${model.name}`, model);
    push(norm, `${model.provider}|${normalizeModelName(model.name)}`, model);
    byId.set(`${model.provider}|${model.id}`, model);
  }

  return { raw, norm, byId };
}

function resolveModel(
  name: string,
  group: DocsGroup,
  index: ModelIndex,
  endpoints: DocsEndpointEntry[],
): ModelRecord | null {
  const provider = providerFor(group);
  const raw = index.raw.get(`${provider}|${name}`);
  if (raw?.length === 1) return raw[0]!;

  const normalized = normalizeModelName(name);
  const norm = index.norm.get(`${provider}|${normalized}`);
  if (norm?.length === 1) return norm[0]!;

  const endpoint =
    endpoints.find((entry) => entry.group === group && entry.name === name) ??
    endpoints.find(
      (entry) =>
        entry.group === group &&
        normalizeModelName(entry.name) === normalized,
    );
  if (endpoint) {
    const byId = index.byId.get(`${provider}|${endpoint.id}`);
    if (byId) return byId;
  }

  return null;
}

function findDocEntry<T>(
  raw: Map<string, T>,
  normalized: Map<string, T>,
  name: string,
  group: DocsGroup,
): T | undefined {
  return (
    raw.get(`${group}|${name}`) ??
    normalized.get(`${group}|${normalizeModelName(name)}`)
  );
}

export function classifyFreeResult(
  input: ModelRecord[],
  evidence: DocsEvidence,
  ctx: ClassifyContext,
): ClassifyResult {
  const warnings = [...evidence.warnings];
  const index = buildIndex(input);
  const live = ctx.live ?? new Set<string>();
  const goLive = ctx.goLive ?? new Set<string>();

  // A docs entry that maps to a live endpoint absent from the snapshot is a
  // docs-only model; it is added below rather than reported as unmatched.
  const isDocsOnlyCandidate = (name: string, group: DocsGroup): boolean => {
    const endpoint = evidence.endpoints.find(
      (entry) =>
        entry.group === group &&
        (entry.name === name ||
          normalizeModelName(entry.name) === normalizeModelName(name)),
    );
    if (!endpoint) return false;
    const liveSet = group === "console" ? live : goLive;
    if (!liveSet.has(endpoint.id)) return false;
    return !index.byId.has(`${providerFor(group)}|${endpoint.id}`);
  };

  const freeRaw = new Map<string, DocsFreeEntry>();
  for (const entry of evidence.freeModels) {
    const rawKey = `${entry.group}|${entry.name}`;
    if (!freeRaw.has(rawKey)) freeRaw.set(rawKey, entry);
  }

  const priceRaw = new Map<string, DocsPriceEntry>();
  const priceNorm = new Map<string, DocsPriceEntry>();
  for (const entry of evidence.prices) {
    const rawKey = `${entry.group}|${entry.name}`;
    if (!priceRaw.has(rawKey)) priceRaw.set(rawKey, entry);
    const normKey = `${entry.group}|${normalizeModelName(entry.name)}`;
    if (!priceNorm.has(normKey)) priceNorm.set(normKey, entry);
  }

  const privacyRaw = new Map<string, DocsPrivacyEntry>();
  const privacyNorm = new Map<string, DocsPrivacyEntry>();
  for (const entry of evidence.goPrivacy) {
    const rawKey = `go|${entry.name}`;
    if (!privacyRaw.has(rawKey)) privacyRaw.set(rawKey, entry);
    const normKey = `go|${normalizeModelName(entry.name)}`;
    if (!privacyNorm.has(normKey)) privacyNorm.set(normKey, entry);
  }

  const freeByKey = new Map<string, DocsFreeEntry>();
  for (const entry of evidence.freeModels) {
    const model = resolveModel(entry.name, entry.group, index, evidence.endpoints);
    if (!model) {
      if (!isDocsOnlyCandidate(entry.name, entry.group)) {
        warnings.push(
          `docs free entry "${entry.name}" (${entry.group}) did not match a catalog model`,
        );
      }
      continue;
    }
    if (!freeByKey.has(model.key)) freeByKey.set(model.key, entry);
  }

  const priceByKey = new Map<string, DocsPriceEntry>();
  for (const entry of evidence.prices) {
    const model = resolveModel(entry.name, entry.group, index, evidence.endpoints);
    if (!model) {
      if (!isDocsOnlyCandidate(entry.name, entry.group)) {
        warnings.push(
          `docs price entry "${entry.name}" (${entry.group}) did not match a catalog model`,
        );
      }
      continue;
    }
    if (!priceByKey.has(model.key)) priceByKey.set(model.key, entry);
  }

  const privacyByKey = new Map<string, DocsPrivacyEntry>();
  for (const entry of evidence.goPrivacy) {
    const model = resolveModel(entry.name, "go", index, evidence.endpoints);
    if (!model) continue;
    if (!privacyByKey.has(model.key)) privacyByKey.set(model.key, entry);
  }

  const previousByKey = new Map(
    (ctx.previous?.models ?? []).map((model) => [model.key, model]),
  );
  const docsAvailable = ctx.docsAvailable ?? { console: true, go: true };
  const classified = input.map((model) => {
    const group = groupFor(model.provider);
    const available =
      group === "console" ? docsAvailable.console : docsAvailable.go;
    const freeEntry = freeByKey.get(model.key);
    const price = priceByKey.get(model.key);
    const privacy = privacyByKey.get(model.key);

    if (available && !freeEntry && !price) {
      if (
        model.pricing.pricingKnown &&
        model.pricing.input === 0 &&
        model.pricing.output === 0
      ) {
        warnings.push(
          `zero-price model ${model.key} is not in the docs free list; free status is uncertain`,
        );
      } else if (model.provider === "opencode-go") {
        warnings.push(
          `Go model ${model.key} has no docs price row; subscription limit is unknown`,
        );
      }
    }

    return classifyOne(model, {
      freeEntry,
      price,
      privacy,
      plan: model.provider === "opencode-go" ? "go" : undefined,
      planPrices: ctx.planPrices,
      previous: previousByKey.get(model.key) ?? null,
      docsAvailable: available,
      now: ctx.now,
      docsSources: available ? refsFor(group, ctx, evidence) : [],
    });
  });

  const byKey = new Map(classified.map((model) => [model.key, model]));

  for (const endpoint of evidence.endpoints) {
    const group = endpoint.group;
    const available =
      group === "console" ? docsAvailable.console : docsAvailable.go;
    if (!available) continue;

    const provider = providerFor(group);
    const liveSet = group === "console" ? live : goLive;
    if (!liveSet.has(endpoint.id)) continue;
    if (endpoint.id === "test" || endpoint.id.endsWith("-backup")) continue;

    const key = modelKey(provider, endpoint.id);
    if (byKey.has(key)) continue;

    // Free-list names are expected to match an endpoint row exactly. Normalizing
    // would merge distinct models such as "Jev 1.13" and "Jev 1.13 Free".
    const freeEntry = freeRaw.get(`${group}|${endpoint.name}`);
    const price = findDocEntry(priceRaw, priceNorm, endpoint.name, group);
    const paidByPrice =
      price !== undefined &&
      ((price.input ?? 0) > 0 || (price.output ?? 0) > 0);

    if (!freeEntry && !paidByPrice) {
      warnings.push(
        `live docs-only model ${key} has no free entry or published price; skipped`,
      );
      continue;
    }

    const pricing = price ? pricingFromDocs(price) : unknownPricing();
    const sources = refsFor(group, ctx, evidence);
    const liveRef = liveRefFor(group, ctx);
    if (!sources.some((source) => source.id === liveRef.id)) {
      sources.push(liveRef);
    }

    const base: ModelRecord = {
      key,
      provider,
      id: endpoint.id,
      name: endpoint.name,
      modalities: { input: ["text"], output: ["text"] },
      capabilities: {
        toolCall: false,
        reasoning: false,
        attachment: false,
        structuredOutput: false,
        temperature: false,
      },
      limits: { context: 0, output: 0 },
      pricing,
      free: { kind: "paid", flags: [] },
      availability: "live",
      privacy: { training: "unknown" },
      sources,
      conflicts: [],
      firstSeen: ctx.now,
      lastSeen: ctx.now,
    };

    const privacy =
      group === "go"
        ? findDocEntry(privacyRaw, privacyNorm, endpoint.name, "go")
        : undefined;

    const next = classifyOne(base, {
      freeEntry,
      price,
      privacy,
      plan: provider === "opencode-go" ? "go" : undefined,
      planPrices: ctx.planPrices,
      previous: null,
      docsAvailable: true,
      now: ctx.now,
      docsSources: refsFor(group, ctx, evidence),
    });

    if (!price) {
      warnings.push(
        `docs-only model ${key} has no published price; pricingKnown=false`,
      );
    }
    warnings.push(
      `docs-only model ${key} added with incomplete limits metadata`,
    );
    byKey.set(key, next);
  }

  for (const group of ["console", "go"] as const) {
    const available =
      group === "console" ? docsAvailable.console : docsAvailable.go;
    if (!available) continue;

    const provider = providerFor(group);
    const liveSet = group === "console" ? live : goLive;
    const endpointIds = new Set(
      evidence.endpoints
        .filter((endpoint) => endpoint.group === group)
        .map((endpoint) => endpoint.id),
    );

    for (const id of liveSet) {
      if (id === "test" || id.endsWith("-backup")) continue;
      const key = modelKey(provider, id);
      if (endpointIds.has(id) || byKey.has(key)) continue;
      warnings.push(
        `live model ${key} has no docs endpoint entry; skipped`,
      );
    }
  }

  return {
    models: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
    warnings: [...new Set(warnings)],
  };
}

export function classifyFree(
  models: ModelRecord[],
  evidence: DocsEvidence,
  ctx: ClassifyContext,
): ModelRecord[] {
  return classifyFreeResult(models, evidence, ctx).models;
}

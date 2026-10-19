import {
  modelKey,
  type Availability,
  type Conflict,
  type FreeInfo,
  type FreeKind,
  type ModelRecord,
  type Pricing,
  type ProviderId,
  type Snapshot,
  type SourceRef,
} from "@omg/shared";

import type { ModelsDevModel, ModelsDevProvider, NativeProviderId } from "./sources/modelsDev";

export interface NormalizeContext {
  now: string;
  previous: Snapshot | null;
  live: Set<string>;
  goLive: Set<string>;
  sourceRefs: SourceRef[];
}

type ModelSourceId = "models.dev" | "opencode.models" | "opencode-go.models";

const PROVIDER_ORDER: NativeProviderId[] = ["opencode", "opencode-go"];

const SOURCE_URLS: Record<ModelSourceId, string> = {
  "models.dev": "https://models.dev/api.json",
  "opencode.models": "https://opencode.ai/inference/v1/models",
  "opencode-go.models": "https://opencode.ai/inference/go/v1/models",
};

const SOURCE_FIELDS: Record<ModelSourceId, string[]> = {
  "models.dev": [
    "name",
    "family",
    "limits",
    "capabilities",
    "pricing",
    "status",
    "release_date",
  ],
  "opencode.models": ["id"],
  "opencode-go.models": ["id"],
};

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sourceRef(id: ModelSourceId, ctx: NormalizeContext): SourceRef {
  const provided = ctx.sourceRefs.find((ref) => ref.id === id);
  if (provided) return provided;
  return { id, url: SOURCE_URLS[id], fetchedAt: ctx.now, fields: SOURCE_FIELDS[id] };
}

function mapPricing(model: ModelsDevModel): Pricing {
  const cost = model.cost;
  if (!cost) {
    return {
      currency: "USD",
      unit: "per_1m_tokens",
      pricingKnown: false,
      input: 0,
      output: 0,
    };
  }

  const pricing: Pricing = {
    currency: "USD",
    unit: "per_1m_tokens",
    pricingKnown: true,
    input: toNumber(cost.input),
    output: toNumber(cost.output),
  };

  if (typeof cost.cache_read === "number") pricing.cacheRead = cost.cache_read;
  if (typeof cost.cache_write === "number") pricing.cacheWrite = cost.cache_write;

  if (Array.isArray(cost.tiers)) {
    const tiers: NonNullable<Pricing["tiers"]> = [];
    for (const tier of cost.tiers) {
      const size = tier.tier?.size;
      if (typeof size !== "number") continue;
      const mapped: NonNullable<Pricing["tiers"]>[number] = {
        minInputTokens: size,
        input: toNumber(tier.input),
        output: toNumber(tier.output),
      };
      if (typeof tier.cache_read === "number") mapped.cacheRead = tier.cache_read;
      if (typeof tier.cache_write === "number") mapped.cacheWrite = tier.cache_write;
      tiers.push(mapped);
    }
    if (tiers.length > 0) pricing.tiers = tiers;
  }

  const over = cost.context_over_200k;
  if (over) {
    const mapped: NonNullable<Pricing["contextOver200k"]> = {
      input: toNumber(over.input),
      output: toNumber(over.output),
    };
    if (typeof over.cache_read === "number") mapped.cacheRead = over.cache_read;
    if (typeof over.cache_write === "number") mapped.cacheWrite = over.cache_write;
    pricing.contextOver200k = mapped;
  }

  return pricing;
}

function mapModalities(model: ModelsDevModel): ModelRecord["modalities"] {
  const input = (model.modalities?.input ?? ["text"]).filter((value) => value.length > 0);
  const output = (model.modalities?.output ?? ["text"]).filter((value) => value.length > 0);
  return {
    input: input.length > 0 ? input : ["text"],
    output: output.length > 0 ? output : ["text"],
  };
}

function mapLimits(model: ModelsDevModel): ModelRecord["limits"] {
  const limits: ModelRecord["limits"] = {
    context: toNumber(model.limit?.context),
    output: toNumber(model.limit?.output),
  };
  if (typeof model.limit?.input === "number") limits.input = model.limit.input;
  return limits;
}

function classifyFree(provider: ProviderId, pricing: Pricing): FreeKind {
  if (pricing.pricingKnown && pricing.input === 0 && pricing.output === 0) {
    return "open-free";
  }
  if (provider === "opencode-go") return "subscription-included";
  return "paid";
}

function mapFree(
  provider: ProviderId,
  pricing: Pricing,
  availability: Availability,
): FreeInfo {
  const kind = classifyFree(provider, pricing);
  const free: FreeInfo = { kind, flags: [] };
  if (kind !== "paid") {
    free.status = availability === "live" ? "confirmed" : "uncertain";
  }
  return free;
}

function availabilityFor(
  model: ModelsDevModel,
  isLive: boolean,
): { availability: Availability; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];

  let availability: Availability;
  if (isLive) {
    availability = "live";
  } else if (model.status === "deprecated") {
    availability = "deprecated";
  } else {
    availability = "unlisted";
  }

  if (model.status === "deprecated" && isLive) {
    conflicts.push({
      field: "availability",
      values: [
        { source: "models.dev", value: "deprecated" },
        { source: "live-endpoint", value: "live" },
      ],
      resolution: "preferred",
      note: "models.dev marks the model deprecated while a live endpoint still lists it.",
    });
    availability = "live";
  }

  return { availability, conflicts };
}

export function normalizeCatalog(
  providers: ModelsDevProvider[],
  ctx: NormalizeContext,
): ModelRecord[] {
  const previousByKey = new Map(
    (ctx.previous?.models ?? []).map((model) => [model.key, model]),
  );

  const models: ModelRecord[] = [];

  for (const providerId of PROVIDER_ORDER) {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider) continue;

    const liveSet = providerId === "opencode" ? ctx.live : ctx.goLive;
    const liveSourceId: ModelSourceId =
      providerId === "opencode" ? "opencode.models" : "opencode-go.models";

    for (const [recordId, model] of Object.entries(provider.models)) {
      const id = typeof model.id === "string" && model.id.length > 0 ? model.id : recordId;
      const key = modelKey(providerId, id);
      const pricing = mapPricing(model);
      const { availability, conflicts } = availabilityFor(model, liveSet.has(id));
      const previous = previousByKey.get(key);

      models.push({
        key,
        provider: providerId,
        id,
        name: model.name ?? id,
        family: model.family,
        releaseDate: model.release_date,
        modalities: mapModalities(model),
        capabilities: {
          toolCall: model.tool_call === true,
          reasoning: model.reasoning === true,
          attachment: model.attachment === true,
          structuredOutput: model.structured_output === true,
          temperature: model.temperature === true,
        },
        limits: mapLimits(model),
        pricing,
        free: mapFree(providerId, pricing, availability),
        availability,
        privacy: { training: "unknown" },
        sources: [sourceRef("models.dev", ctx), sourceRef(liveSourceId, ctx)],
        conflicts,
        firstSeen: previous?.firstSeen ?? ctx.now,
        lastSeen: ctx.now,
      });
    }
  }

  return models.sort((a, b) => a.key.localeCompare(b.key));
}

import { z } from "zod";

import {
  BENCHMARK_IDS,
  COST_PROFILE_IDS,
  USE_CASE_IDS,
} from "./constants";

export const SCHEMA_VERSION = 1 as const;

export const PROVIDER_IDS = ["opencode", "opencode-go"] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const FREE_KINDS = [
  "paid",
  "open-free",
  "limited-time",
  "subscription-included",
  "trial",
] as const;
export const FreeKindSchema = z.enum(FREE_KINDS);
export type FreeKind = z.infer<typeof FreeKindSchema>;

export const AVAILABILITY_VALUES = [
  "live",
  "deprecated",
  "unlisted",
  "unknown",
] as const;
export const AvailabilitySchema = z.enum(AVAILABILITY_VALUES);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const SOURCE_REF_IDS = [
  "models.dev",
  "opencode.models",
  "opencode-go.models",
  "opencode.console-docs",
  "opencode.go-docs",
] as const;
export const SourceRefIdSchema = z.enum(SOURCE_REF_IDS);
export type SourceRefId = z.infer<typeof SourceRefIdSchema>;

export const SOURCE_STATUS_IDS = [
  ...SOURCE_REF_IDS,
  "swe-bench",
  "lmarena",
  "aider-polyglot",
  "terminal-bench",
  "artificial-analysis",
] as const;
export const SourceStatusIdSchema = z.enum(SOURCE_STATUS_IDS);
export type SourceStatusId = z.infer<typeof SourceStatusIdSchema>;

export const MATCH_TYPES = ["exact", "alias", "fuzzy", "unmatched"] as const;
export const MatchTypeSchema = z.enum(MATCH_TYPES);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const METRIC_TYPES = ["percent", "elo", "score"] as const;
export const MetricTypeSchema = z.enum(METRIC_TYPES);
export type MetricType = z.infer<typeof MetricTypeSchema>;

export const EVENT_TYPES = [
  "model_added",
  "free_started",
  "free_ended",
  "price_changed",
  "deprecated",
  "source_failed",
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

const nonnegative = (label: string) =>
  z.number().min(0, { message: `${label} must be nonnegative` });

export const SourceRefSchema = z.strictObject({
  id: SourceRefIdSchema,
  url: z.string().url(),
  fetchedAt: z.iso.datetime(),
  fields: z.array(z.string()).optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const ConflictSchema = z.strictObject({
  field: z.string().min(1),
  values: z.array(
    z.strictObject({
      source: z.string().min(1),
      value: z.unknown(),
    }),
  ),
  resolution: z.enum(["preferred", "unresolved"]),
  note: z.string().optional(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

export const PricingTierSchema = z.strictObject({
  minInputTokens: z.number().int().nonnegative(),
  input: nonnegative("tier input"),
  output: nonnegative("tier output"),
  cacheRead: nonnegative("tier cacheRead").optional(),
  cacheWrite: nonnegative("tier cacheWrite").optional(),
});
export type PricingTier = z.infer<typeof PricingTierSchema>;

export const ContextOver200kSchema = z.strictObject({
  input: nonnegative("context input"),
  output: nonnegative("context output"),
  cacheRead: nonnegative("context cacheRead").optional(),
  cacheWrite: nonnegative("context cacheWrite").optional(),
});
export type ContextOver200k = z.infer<typeof ContextOver200kSchema>;

export const PricingSchema = z.strictObject({
  currency: z.literal("USD"),
  unit: z.literal("per_1m_tokens"),
  pricingKnown: z.boolean(),
  input: nonnegative("input"),
  output: nonnegative("output"),
  cacheRead: nonnegative("cacheRead").optional(),
  cacheWrite: nonnegative("cacheWrite").optional(),
  tiers: z.array(PricingTierSchema).optional(),
  contextOver200k: ContextOver200kSchema.optional(),
});
export type Pricing = z.infer<typeof PricingSchema>;

export const SubscriptionInfoSchema = z.strictObject({
  plan: z.enum(["go", "go-plus"]),
  monthlyUsd: nonnegative("monthlyUsd"),
  includedUsageUsd: nonnegative("includedUsageUsd"),
  estimatedRequestsPerMonth: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});
export type SubscriptionInfo = z.infer<typeof SubscriptionInfoSchema>;

export const FreeInfoSchema = z.strictObject({
  kind: FreeKindSchema,
  flags: z.array(z.string()),
  since: z.string().optional(),
  note: z.string().optional(),
  status: z.enum(["confirmed", "uncertain"]).optional(),
  regionsExcluded: z.array(z.string()).optional(),
});
export type FreeInfo = z.infer<typeof FreeInfoSchema>;

export const ModalitiesSchema = z.strictObject({
  input: z.array(z.string()).min(1),
  output: z.array(z.string()).min(1),
});
export type Modalities = z.infer<typeof ModalitiesSchema>;

export const CapabilitiesSchema = z.strictObject({
  toolCall: z.boolean(),
  reasoning: z.boolean(),
  attachment: z.boolean(),
  structuredOutput: z.boolean(),
  temperature: z.boolean(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const LimitsSchema = z.strictObject({
  context: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  input: z.number().int().nonnegative().optional(),
});
export type Limits = z.infer<typeof LimitsSchema>;

export const PrivacySchema = z.strictObject({
  training: z.enum(["none", "may-train", "unknown"]),
  retentionDays: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});
export type Privacy = z.infer<typeof PrivacySchema>;

export const ModelRecordSchema = z.strictObject({
  key: z.string().min(1),
  provider: ProviderIdSchema,
  id: z.string().min(1),
  name: z.string().min(1),
  family: z.string().optional(),
  releaseDate: z.string().optional(),
  modalities: ModalitiesSchema,
  capabilities: CapabilitiesSchema,
  limits: LimitsSchema,
  pricing: PricingSchema,
  subscription: SubscriptionInfoSchema.optional(),
  free: FreeInfoSchema,
  availability: AvailabilitySchema,
  privacy: PrivacySchema.optional(),
  sources: z.array(SourceRefSchema).min(1, {
    message: "model must have at least one source",
  }),
  conflicts: z.array(ConflictSchema),
  firstSeen: z.iso.datetime(),
  lastSeen: z.iso.datetime(),
});
export type ModelRecord = z.infer<typeof ModelRecordSchema>;

export const SourceStatusSchema = z
  .strictObject({
    id: SourceStatusIdSchema,
    url: z.string().url(),
    ok: z.boolean(),
    status: z.enum(["ok", "failed", "skipped"]),
    fetchedAt: z.iso.datetime(),
    durationMs: z.number().int().nonnegative().optional(),
    itemCount: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
    reason: z.string().optional(),
    required: z.boolean().optional(),
  })
  .superRefine((source, ctx) => {
    if (source.ok !== (source.status === "ok")) {
      ctx.addIssue({
        code: "custom",
        message: `source status mismatch: ${source.id}`,
      });
    }
  });
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    generatedAt: z.iso.datetime(),
    models: z.array(ModelRecordSchema),
    sources: z.array(SourceStatusSchema),
  })
  .superRefine((snapshot, ctx) => {
    const seen = new Set<string>();
    for (const model of snapshot.models) {
      if (seen.has(model.key)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate model key: ${model.key}`,
        });
      }
      seen.add(model.key);

      if (model.key !== `${model.provider}/${model.id}`) {
        ctx.addIssue({
          code: "custom",
          message: `model key mismatch: ${model.key} !== ${model.provider}/${model.id}`,
        });
      }

      if (model.sources.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `model has no sources: ${model.key}`,
        });
      }
    }
  });
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const BenchmarkResultSchema = z
  .strictObject({
    benchmark: z.enum(BENCHMARK_IDS),
    metric: MetricTypeSchema,
    value: z.number(),
    modelNameRaw: z.string().min(1),
    modelKey: z.string().min(1).optional(),
    match: MatchTypeSchema,
    matchConfidence: z.number().min(0).max(1),
    date: z.string().min(1),
    sourceUrl: z.string().url(),
    harness: z.string().optional(),
    costPerTaskUsd: nonnegative("costPerTaskUsd").optional(),
    tokensPerTask: z.number().int().nonnegative().optional(),
    meta: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
  })
  .superRefine((result, ctx) => {
    if (result.match === "unmatched" && result.modelKey !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `unmatched benchmark result must not have a modelKey: ${result.modelNameRaw}`,
      });
    }
    if (result.match !== "unmatched" && result.modelKey === undefined) {
      ctx.addIssue({
        code: "custom",
        message: `matched benchmark result must have a modelKey: ${result.modelNameRaw}`,
      });
    }
  });
export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;

export const BenchmarksFileSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  results: z.array(BenchmarkResultSchema),
  unmatched: z.array(z.string()),
  sources: z.array(SourceStatusSchema),
});
export type BenchmarksFile = z.infer<typeof BenchmarksFileSchema>;

export const BenchmarkScoreSchema = z.strictObject({
  percentile: z.number().min(0).max(100),
  value: z.number(),
  date: z.string().min(1),
});
export type BenchmarkScore = z.infer<typeof BenchmarkScoreSchema>;

export const UseCaseScoreSchema = z.strictObject({
  score: z.number().min(0).max(100).nullable(),
  tier: z.enum(["S", "A", "B", "C", "D", "unrated"]),
  confidence: z.number().min(0).max(1),
});
export type UseCaseScore = z.infer<typeof UseCaseScoreSchema>;

export const ScoreRecordSchema = z.strictObject({
  modelKey: z.string().min(1),
  benchmarks: z.partialRecord(z.enum(BENCHMARK_IDS), BenchmarkScoreSchema),
  useCases: z.partialRecord(z.enum(USE_CASE_IDS), UseCaseScoreSchema),
  cost: z.strictObject({
    profiles: z.record(z.enum(COST_PROFILE_IDS), z.number().nullable()),
    goEffective: z
      .record(z.enum(COST_PROFILE_IDS), z.number().nullable())
      .optional(),
  }),
});
export type ScoreRecord = z.infer<typeof ScoreRecordSchema>;

export const ScoresFileSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    generatedAt: z.iso.datetime(),
    scores: z.array(ScoreRecordSchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const score of file.scores) {
      if (seen.has(score.modelKey)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate score modelKey: ${score.modelKey}`,
        });
      }
      seen.add(score.modelKey);
    }
  });
export type ScoresFile = z.infer<typeof ScoresFileSchema>;

export const ChangeEventSchema = z
  .strictObject({
    id: z.string().min(1),
    type: EventTypeSchema,
    at: z.iso.datetime(),
    modelKey: z.string().min(1),
    summary: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
    notify: z.boolean(),
  })
  .superRefine((event, ctx) => {
    const expected = `${event.type}:${event.modelKey}:${event.at.slice(0, 10)}`;
    if (event.id !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `event id mismatch: ${event.id} !== ${expected}`,
      });
    }
  });
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;

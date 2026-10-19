export const BENCHMARK_IDS = [
  "swe-bench-verified",
  "swe-bench-multilingual",
  "lmarena-webdev",
  "lmarena-agent",
  "lmarena-text",
  "lmarena-document",
  "aider-polyglot",
  "terminal-bench",
  "artificial-analysis",
] as const;

export type BenchmarkId = (typeof BENCHMARK_IDS)[number];

export const COST_PROFILES = {
  "quick-edit": {
    label: "Quick edit",
    inputTokens: 12_000,
    cachedInputTokens: 8_000,
    outputTokens: 1_500,
  },
  "agentic-pr": {
    label: "Agentic PR",
    inputTokens: 120_000,
    cachedInputTokens: 90_000,
    outputTokens: 8_000,
  },
  "long-context": {
    label: "Long-context task",
    inputTokens: 400_000,
    cachedInputTokens: 250_000,
    outputTokens: 6_000,
  },
} as const;

export type CostProfileId = keyof typeof COST_PROFILES;

export const COST_PROFILE_IDS = [
  "quick-edit",
  "agentic-pr",
  "long-context",
] as const satisfies readonly CostProfileId[];

export const USE_CASE_WEIGHTS = {
  "agentic-coding": {
    "swe-bench-verified": 0.45,
    "terminal-bench": 0.2,
    "lmarena-agent": 0.2,
    "aider-polyglot": 0.15,
  },
  "everyday-edits": {
    "swe-bench-verified": 0.2,
    "lmarena-webdev": 0.25,
    "lmarena-text": 0.15,
    "aider-polyglot": 0.4,
  },
  frontend: {
    "lmarena-webdev": 0.6,
    "lmarena-text": 0.2,
    "aider-polyglot": 0.2,
  },
  "long-context": {
    "swe-bench-verified": 0.3,
    "lmarena-text": 0.3,
    "lmarena-document": 0.4,
  },
} as const;

export type UseCaseId = keyof typeof USE_CASE_WEIGHTS;

export const USE_CASE_IDS = [
  "agentic-coding",
  "everyday-edits",
  "frontend",
  "long-context",
] as const satisfies readonly UseCaseId[];

export const TIER_THRESHOLDS = [
  { tier: "S", min: 90 },
  { tier: "A", min: 75 },
  { tier: "B", min: 50 },
  { tier: "C", min: 25 },
  { tier: "D", min: 0 },
] as const;

export type RatedTier = (typeof TIER_THRESHOLDS)[number]["tier"];
export type Tier = RatedTier | "unrated";

export const FRESHNESS = [
  { maxDays: 30, factor: 1.0 },
  { maxDays: 90, factor: 0.8 },
  { maxDays: 180, factor: 0.5 },
  { maxDays: Infinity, factor: 0.2 },
] as const;

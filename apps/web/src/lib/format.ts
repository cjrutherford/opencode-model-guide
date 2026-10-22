import type {
  Availability,
  BenchmarkId,
  Capabilities,
  EventType,
  FreeKind,
  MetricType,
  ProviderId,
  SourceStatusId,
  Tier,
  UseCaseId,
} from "@omg/shared";

import {
  EVENT_LABELS,
  FREE_KIND_LABELS,
  TIER_LABELS,
  sourceLabel,
} from "./labels";

export {
  CONFIDENCE_LABELS,
  EVENT_LABELS,
  FREE_KIND_LABELS,
  TIER_LABELS,
} from "./labels";

export const USE_CASE_LABELS: Record<UseCaseId, string> = {
  "agentic-coding": "Agentic coding",
  "everyday-edits": "Everyday edits",
  frontend: "Frontend",
  "long-context": "Long context",
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  opencode: "Console",
  "opencode-go": "Go",
};

export const BENCHMARK_LABELS: Record<BenchmarkId, string> = {
  "swe-bench-verified": "SWE-bench Verified",
  "swe-bench-multilingual": "SWE-bench Multilingual",
  "lmarena-webdev": "LMArena WebDev",
  "lmarena-agent": "LMArena Agent",
  "lmarena-text": "LMArena Text",
  "lmarena-document": "LMArena Document",
  "aider-polyglot": "Aider Polyglot",
  "terminal-bench": "Terminal-Bench",
  "artificial-analysis": "Artificial Analysis Coding Index",
};

const AVAILABILITY_LABELS: Record<Availability, string> = {
  live: "Live",
  deprecated: "Deprecated",
  unlisted: "Unlisted",
  unknown: "Unknown",
};

const TRAINING_LABELS = {
  none: "No training on inputs",
  "may-train": "May train on inputs",
  unknown: "Training policy unknown",
} as const;

const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  toolCall: "Tool calling",
  reasoning: "Reasoning",
  attachment: "Attachments",
  structuredOutput: "Structured output",
  temperature: "Temperature",
};

const FLAG_LABELS: Record<string, string> = {
  "usage-limited": "Usage limited",
  "limited-time": "Limited time",
  trial: "Trial",
  "trains-on-data": "Trains on data",
  "feedback-program": "Feedback program",
  "zero-retention": "Zero retention",
  unlimited: "Unlimited",
  stealth: "Stealth",
  "region-restricted": "Region restricted",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const compactTokens = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "price not published";
  if (value === 0) return "$0";
  if (value > 0 && value < 0.0001) return "<$0.0001";
  if (value < 1) return `$${value.toPrecision(2)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return compactTokens.format(value);
}

export function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return dateFormatter.format(parsed);
}

export function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

export function formatPassRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  if (value < 3_600_000) {
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1_000);
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.round((value % 3_600_000) / 60_000);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

const countFormatter = new Intl.NumberFormat("en-US");

export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return countFormatter.format(value);
}

export function formatFreeKind(kind: FreeKind): string {
  return FREE_KIND_LABELS[kind];
}

export function formatProvider(provider: ProviderId): string {
  return PROVIDER_LABELS[provider];
}

export function formatEventType(type: EventType): string {
  return EVENT_LABELS[type];
}

export function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return dateTimeFormatter.format(parsed);
}

export function formatBenchmarkValue(
  value: number,
  metric: MetricType,
): string {
  if (!Number.isFinite(value)) return "—";
  if (metric === "percent") return `${value.toFixed(1)}%`;
  if (metric === "elo") return `${Math.round(value)}`;
  return Math.abs(value) < 1 ? value.toFixed(3) : value.toFixed(1);
}

export function formatTier(tier: Tier): string {
  return TIER_LABELS[tier];
}

export function formatAvailability(availability: Availability): string {
  return AVAILABILITY_LABELS[availability];
}

export function formatTraining(
  training: "none" | "may-train" | "unknown" | undefined,
): string {
  return training ? TRAINING_LABELS[training] : "Training policy unknown";
}

export function formatModality(value: string): string {
  if (value.toLowerCase() === "pdf") return "PDF";
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function formatCapability(capability: keyof Capabilities): string {
  return CAPABILITY_LABELS[capability];
}

export function formatSource(id: SourceStatusId): string {
  return sourceLabel(id);
}

export function formatFlag(flag: string): string {
  if (FLAG_LABELS[flag]) return FLAG_LABELS[flag];
  return flag
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function formatConflictValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

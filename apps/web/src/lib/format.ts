import type {
  Availability,
  BenchmarkId,
  Capabilities,
  EventType,
  FreeKind,
  MetricType,
  ProviderId,
  SourceRefId,
  Tier,
  UseCaseId,
} from "@omg/shared";

export const FREE_KIND_LABELS: Record<FreeKind, string> = {
  paid: "Paid",
  "open-free": "Open free",
  "limited-time": "Limited-time free",
  "subscription-included": "Subscription included",
  trial: "Trial",
};

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

export const EVENT_LABELS: Record<EventType, string> = {
  model_added: "New model",
  free_started: "Free now",
  free_ended: "Free ended",
  price_changed: "Price change",
  deprecated: "Deprecated",
  source_failed: "Source issue",
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

const SOURCE_LABELS: Record<SourceRefId, string> = {
  "models.dev": "models.dev",
  "opencode.models": "OpenCode models endpoint",
  "opencode-go.models": "OpenCode Go models endpoint",
  "opencode.console-docs": "OpenCode Console docs",
  "opencode.go-docs": "OpenCode Go docs",
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
  return tier === "unrated" ? "Unrated" : tier;
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

export function formatSource(id: SourceRefId): string {
  return SOURCE_LABELS[id];
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

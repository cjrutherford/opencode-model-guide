import type {
  EventType,
  FreeKind,
  ProviderId,
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

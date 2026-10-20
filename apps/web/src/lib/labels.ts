import type {
  EventType,
  FreeKind,
  SourceStatusId,
  Tier,
} from "@omg/shared";

export const FREE_KIND_LABELS: Record<FreeKind, string> = {
  paid: "Paid",
  "open-free": "Free",
  "limited-time": "Free · limited time",
  "subscription-included": "Included with Go",
  trial: "Free · trial terms",
};

export const EVENT_LABELS: Record<EventType, string> = {
  model_added: "New model",
  free_started: "Free",
  free_ended: "No longer free",
  price_changed: "Price change",
  deprecated: "Deprecated",
  source_failed: "Source issue",
};

export const TIER_LABELS: Record<Tier, string> = {
  S: "S",
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  unrated: "Unrated",
};

export const CONFIDENCE_LABELS = {
  high: "High",
  medium: "Medium",
  low: "Low",
} as const;

export type ConfidenceBand = keyof typeof CONFIDENCE_LABELS;

export function confidenceBand(
  value: number | null | undefined,
): ConfidenceBand | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (value >= 0.75) return "high";
  if (value >= 0.45) return "medium";
  return "low";
}

export function formatConfidenceBand(
  value: number | null | undefined,
): string {
  const band = confidenceBand(value);
  return band ? `${CONFIDENCE_LABELS[band]} confidence` : "No confidence estimate";
}

export const EVENT_GROUPS = {
  model_added: ["new"],
  free_started: ["free"],
  free_ended: ["free"],
  price_changed: ["price"],
  deprecated: ["deprecated"],
  source_failed: ["source"],
} as const satisfies Record<EventType, readonly EventFilterValue[]>;

export type EventFilterValue =
  | "all"
  | "free"
  | "price"
  | "deprecated"
  | "new"
  | "source";

export const EVENT_FILTERS: ReadonlyArray<{
  value: EventFilterValue;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "free", label: "Free" },
  { value: "price", label: "Price" },
  { value: "deprecated", label: "Deprecated" },
  { value: "new", label: "New" },
  { value: "source", label: "Source" },
];

export function eventMatchesFilter(
  type: EventType,
  filter: string | null | undefined,
): boolean {
  if (!filter || filter === "all") return true;
  if (type === filter) return true;
  return (EVENT_GROUPS[type] as readonly string[]).includes(filter);
}

export const SOURCE_LABELS: Record<string, string> = {
  "models.dev": "models.dev",
  "opencode.models": "OpenCode models endpoint",
  "opencode-go.models": "OpenCode Go models endpoint",
  "opencode.console-docs": "OpenCode Console docs",
  "opencode.go-docs": "OpenCode Go docs",
  "swe-bench": "SWE-bench",
  lmarena: "LMArena",
  "aider-polyglot": "Aider Polyglot",
  "terminal-bench": "Terminal-Bench",
  "artificial-analysis": "Artificial Analysis",
  "live-endpoint": "Live endpoint",
  availability: "Availability",
};

export function sourceLabel(id: SourceStatusId | string): string {
  return (
    SOURCE_LABELS[id] ??
    id
      .split(/[-.]/)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ")
  );
}

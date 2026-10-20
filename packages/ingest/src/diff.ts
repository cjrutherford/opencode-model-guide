import {
  eventId,
  type ChangeEvent,
  type FreeKind,
  type ModelRecord,
  type Pricing,
  type Snapshot,
  type SourceStatus,
} from "@omg/shared";

export interface DiffOptions {
  now: string;
  requiredSources?: readonly string[];
}

const FREE_NOW_KINDS: ReadonlySet<FreeKind> = new Set([
  "open-free",
  "limited-time",
  "trial",
]);

const PRICE_FIELDS = [
  ["input", "input"],
  ["output", "output"],
  ["cacheRead", "cache read"],
  ["cacheWrite", "cache write"],
] as const;

export function isFreeNow(model: Pick<ModelRecord, "free">): boolean {
  return FREE_NOW_KINDS.has(model.free.kind);
}

export function isZeroMarginal(model: Pick<ModelRecord, "free">): boolean {
  return isFreeNow(model) || model.free.kind === "subscription-included";
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function priceSnapshot(pricing: Pricing): Record<string, unknown> {
  return canonical(pricing) as Record<string, unknown>;
}

function pricesEqual(before: Pricing, after: Pricing): boolean {
  return JSON.stringify(canonical(before)) === JSON.stringify(canonical(after));
}

function formatUsd(value: number): string {
  const digits = value > 0 && value < 0.01 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

function freeKindPhrase(kind: FreeKind): string | null {
  switch (kind) {
    case "limited-time":
      return "limited time";
    case "trial":
      return "trial terms";
    case "subscription-included":
      return "included with a subscription";
    default:
      return null;
  }
}

function freeStartedSummary(model: ModelRecord): string {
  const phrase = freeKindPhrase(model.free.kind);
  return phrase
    ? `${model.name} is now free (${phrase}).`
    : `${model.name} is now free.`;
}

function modelAddedSummary(model: ModelRecord): string {
  if (!isFreeNow(model)) return `${model.name} was added to the catalog.`;
  const phrase = freeKindPhrase(model.free.kind);
  return phrase
    ? `${model.name} was added and is free (${phrase}).`
    : `${model.name} was added and is free.`;
}

function priceChangedSummary(
  model: ModelRecord,
  before: Pricing,
  after: Pricing,
): string {
  const changes: string[] = [];
  for (const [field, label] of PRICE_FIELDS) {
    const previous = before[field];
    const current = after[field];
    if (previous === current) continue;
    const from = previous === undefined ? "unpublished" : formatUsd(previous);
    const to = current === undefined ? "unpublished" : formatUsd(current);
    changes.push(`${label} ${from} → ${to}`);
  }

  if (changes.length === 1) {
    const [field, label] = PRICE_FIELDS.find(([key]) => before[key] !== after[key])!;
    return `${model.name} ${label} price changed from ${
      before[field] === undefined ? "unpublished" : formatUsd(before[field])
    } to ${
      after[field] === undefined ? "unpublished" : formatUsd(after[field])
    } per 1M tokens.`;
  }

  if (changes.length > 1) {
    return `${model.name} prices changed: ${changes.join(", ")} per 1M tokens.`;
  }

  const tiersChanged =
    JSON.stringify(canonical(before.tiers ?? [])) !==
    JSON.stringify(canonical(after.tiers ?? []));
  if (tiersChanged) return `${model.name} tiered pricing changed.`;

  const longContextChanged =
    JSON.stringify(canonical(before.contextOver200k ?? null)) !==
    JSON.stringify(canonical(after.contextOver200k ?? null));
  if (longContextChanged) return `${model.name} long-context pricing changed.`;

  if (before.pricingKnown !== after.pricingKnown) {
    return after.pricingKnown
      ? `${model.name} pricing is now confirmed.`
      : `${model.name} pricing is no longer confirmed.`;
  }

  return `${model.name} pricing metadata changed.`;
}

function event(
  type: ChangeEvent["type"],
  modelKey: string,
  now: string,
  summary: string,
  data: Record<string, unknown>,
  notify: boolean,
): ChangeEvent {
  return {
    id: eventId(type, modelKey, now),
    type,
    at: now,
    modelKey,
    summary,
    data,
    notify,
  };
}

function sourceFailure(
  source: string,
  nextSource: SourceStatus | undefined,
  now: string,
): ChangeEvent {
  const modelKey = `system/${source}`;
  const error = nextSource?.error;
  return event(
    "source_failed",
    modelKey,
    now,
    error
      ? `Required source ${source} failed: ${error}`
      : `Required source ${source} failed.`,
    { source, error: error ?? null },
    true,
  );
}

export function compareEvents(left: ChangeEvent, right: ChangeEvent): number {
  if (left.at !== right.at) return left.at < right.at ? -1 : 1;
  if (left.type !== right.type) return left.type < right.type ? -1 : 1;
  if (left.modelKey !== right.modelKey) return left.modelKey < right.modelKey ? -1 : 1;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

export function diffSnapshots(
  prev: Snapshot | null,
  next: Snapshot,
  opts: DiffOptions,
): ChangeEvent[] {
  if (prev === null) return [];

  const { now } = opts;
  const previousModels = new Map(prev.models.map((model) => [model.key, model]));
  const events: ChangeEvent[] = [];

  for (const model of next.models) {
    const before = previousModels.get(model.key);

    if (!before) {
      events.push(
        event(
          "model_added",
          model.key,
          now,
          modelAddedSummary(model),
          {
            name: model.name,
            provider: model.provider,
            free: model.free.kind,
            availability: model.availability,
          },
          isFreeNow(model),
        ),
      );
      continue;
    }

    if (!isFreeNow(before) && isFreeNow(model)) {
      events.push(
        event(
          "free_started",
          model.key,
          now,
          freeStartedSummary(model),
          { from: before.free.kind, to: model.free.kind },
          true,
        ),
      );
    }

    const becameDeprecated =
      before.availability !== "deprecated" && model.availability === "deprecated";

    if (isFreeNow(before) && (!isFreeNow(model) || becameDeprecated)) {
      events.push(
        event(
          "free_ended",
          model.key,
          now,
          `${model.name} is no longer free${
            model.availability === "deprecated" ? " (deprecated)" : ""
          }.`,
          {
            from: before.free.kind,
            to: model.free.kind,
            availability: model.availability,
          },
          true,
        ),
      );
    }

    if (!pricesEqual(before.pricing, model.pricing)) {
      events.push(
        event(
          "price_changed",
          model.key,
          now,
          priceChangedSummary(model, before.pricing, model.pricing),
          {
            before: priceSnapshot(before.pricing),
            after: priceSnapshot(model.pricing),
          },
          false,
        ),
      );
    }

    if (becameDeprecated) {
      events.push(
        event(
          "deprecated",
          model.key,
          now,
          `${model.name} is now deprecated.`,
          { from: before.availability, to: model.availability },
          isFreeNow(model),
        ),
      );
    }
  }

  const previousSources = new Map<string, SourceStatus>(
    prev.sources.map((source) => [source.id, source]),
  );
  const nextSources = new Map<string, SourceStatus>(
    next.sources.map((source) => [source.id, source]),
  );
  const requiredSources = opts.requiredSources ?? [];

  for (const sourceId of requiredSources) {
    const before = previousSources.get(sourceId);
    const after = nextSources.get(sourceId);
    if (before?.ok === true && (!after || !after.ok)) {
      events.push(sourceFailure(sourceId, after, now));
    }
  }

  const seen = new Set<string>();
  return events
    .filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .sort(compareEvents);
}

import {
  USE_CASE_IDS,
  type BenchmarksFile,
  type ChangeEvent,
  type ModelRecord,
  type RatedTier,
  type ScoreRecord,
  type ScoresFile,
  type Snapshot,
  type UseCaseId,
  type UseCaseScore,
} from "@omg/shared";

import { USE_CASE_LABELS } from "./format";
import { isFreeNow } from "./models";

export { isFreeNow };

export interface BestValuePick {
  model: ModelRecord;
  score: number;
  tier: RatedTier;
  confidence: number;
  agenticCost: number | null;
}

export interface BestValue {
  useCase: UseCaseId;
  label: string;
  pick: BestValuePick | null;
}

const FREE_KIND_RANK = {
  "open-free": 0,
  "limited-time": 1,
  trial: 2,
  "subscription-included": 3,
  paid: 4,
} as const;

const PROVIDER_RANK = {
  opencode: 0,
  "opencode-go": 1,
} as const;

export function freeNowModels(snapshot: Snapshot): ModelRecord[] {
  return snapshot.models
    .filter(isFreeNow)
    .sort((left, right) => {
      const kind =
        FREE_KIND_RANK[left.free.kind] - FREE_KIND_RANK[right.free.kind];
      if (kind !== 0) return kind;

      const provider =
        PROVIDER_RANK[left.provider] - PROVIDER_RANK[right.provider];
      if (provider !== 0) return provider;

      if (left.limits.context !== right.limits.context) {
        return right.limits.context - left.limits.context;
      }

      return left.name.localeCompare(right.name);
    });
}

export function freeCaveat(model: ModelRecord): string {
  const parts: string[] = [];

  if (model.free.note) {
    parts.push(model.free.note);
  } else {
    switch (model.free.kind) {
      case "open-free":
        parts.push("Open free; no token charge.");
        break;
      case "limited-time":
        parts.push("Limited-time free offer.");
        break;
      case "trial":
        parts.push("Trial access.");
        break;
      case "subscription-included":
        parts.push("Included with a subscription.");
        break;
      case "paid":
        parts.push("Paid model.");
        break;
    }
  }

  if (model.free.status === "uncertain") parts.push("Terms uncertain.");
  if (model.privacy?.training === "may-train") parts.push("May train on inputs.");

  return parts.join(" ");
}

export function latestEvents(
  events: ChangeEvent[],
  limit = 5,
): ChangeEvent[] {
  return [...events]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, limit);
}

export function latestUpdatedAt(
  snapshot: Snapshot,
  scores: ScoresFile,
  benchmarks: BenchmarksFile,
): string {
  return [snapshot.generatedAt, scores.generatedAt, benchmarks.generatedAt].reduce(
    (latest, candidate) =>
      Date.parse(candidate) > Date.parse(latest) ? candidate : latest,
  );
}

function isRated(
  useCase: UseCaseScore | undefined,
): useCase is UseCaseScore & { score: number; tier: RatedTier } {
  return (
    useCase !== undefined &&
    useCase.tier !== "unrated" &&
    useCase.score !== null &&
    Number.isFinite(useCase.score)
  );
}

export function bestValueByUseCase(
  snapshot: Snapshot,
  scores: ScoresFile,
): BestValue[] {
  const models = new Map(snapshot.models.map((model) => [model.key, model]));

  return USE_CASE_IDS.map((useCase) => {
    let best:
      | {
          record: ScoreRecord;
          useCase: UseCaseScore & { score: number; tier: RatedTier };
          model: ModelRecord;
        }
      | undefined;

    for (const record of scores.scores) {
      const score = record.useCases[useCase];
      if (!isRated(score)) continue;

      const model = models.get(record.modelKey);
      if (!model) continue;

      if (
        !best ||
        score.score > best.useCase.score ||
        (score.score === best.useCase.score &&
          score.confidence > best.useCase.confidence) ||
        (score.score === best.useCase.score &&
          score.confidence === best.useCase.confidence &&
          record.modelKey < best.record.modelKey)
      ) {
        best = { record, useCase: score, model };
      }
    }

    if (!best) {
      return { useCase, label: USE_CASE_LABELS[useCase], pick: null };
    }

    return {
      useCase,
      label: USE_CASE_LABELS[useCase],
      pick: {
        model: best.model,
        score: best.useCase.score,
        tier: best.useCase.tier,
        confidence: best.useCase.confidence,
        agenticCost: best.record.cost.profiles["agentic-pr"],
      },
    };
  });
}

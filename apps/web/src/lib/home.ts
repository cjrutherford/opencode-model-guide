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

export const ACCESS_GROUP_IDS = ["free", "go-included", "payg"] as const;

export type AccessGroupId = (typeof ACCESS_GROUP_IDS)[number];

export const ACCESS_GROUP_LABELS: Record<AccessGroupId, string> = {
  free: "Free now",
  "go-included": "Included in Go",
  payg: "Pay as you go",
};

export type CostBasis = "list" | "go-effective";

export interface BestValuePick {
  model: ModelRecord;
  score: number;
  tier: RatedTier;
  confidence: number;
  agenticCost: number | null;
  costBasis: CostBasis;
}

export interface BestValueGroup {
  id: AccessGroupId;
  label: string;
  pick: BestValuePick | null;
}

export interface BestValue {
  useCase: UseCaseId;
  label: string;
  groups: BestValueGroup[];
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

function accessGroupFor(model: ModelRecord): AccessGroupId | null {
  if (model.availability !== "live") return null;
  if (isFreeNow(model)) return "free";
  if (model.free.kind === "subscription-included") return "go-included";
  if (model.free.kind === "paid") return "payg";
  return null;
}

function costForPick(
  record: ScoreRecord,
  group: AccessGroupId,
): Pick<BestValuePick, "agenticCost" | "costBasis"> {
  if (group === "go-included") {
    const effective = record.cost.goEffective?.["agentic-pr"];
    if (effective !== undefined && effective !== null) {
      return { agenticCost: effective, costBasis: "go-effective" };
    }
  }

  return {
    agenticCost: record.cost.profiles["agentic-pr"],
    costBasis: "list",
  };
}

export function bestValueByUseCase(
  snapshot: Snapshot,
  scores: ScoresFile,
): BestValue[] {
  const models = new Map(snapshot.models.map((model) => [model.key, model]));

  return USE_CASE_IDS.map((useCase) => {
    const groups = ACCESS_GROUP_IDS.map((groupId): BestValueGroup => {
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
        if (!model || accessGroupFor(model) !== groupId) continue;

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
        return {
          id: groupId,
          label: ACCESS_GROUP_LABELS[groupId],
          pick: null,
        };
      }

      return {
        id: groupId,
        label: ACCESS_GROUP_LABELS[groupId],
        pick: {
          model: best.model,
          score: best.useCase.score,
          tier: best.useCase.tier,
          confidence: best.useCase.confidence,
          ...costForPick(best.record, groupId),
        },
      };
    });

    return {
      useCase,
      label: USE_CASE_LABELS[useCase],
      groups,
    };
  });
}

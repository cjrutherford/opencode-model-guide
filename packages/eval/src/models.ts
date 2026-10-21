import {
  EVAL_FREE_KINDS,
  type EvalFreeKind,
  type EvalModel,
  type FreeKind,
  type ModelRecord,
  type Snapshot,
} from "@omg/shared";

export interface FreeModelSelectionOptions {
  modelKeys?: string[];
}

function isFreeKind(kind: FreeKind): kind is EvalFreeKind {
  return (EVAL_FREE_KINDS as readonly string[]).includes(kind);
}

function toEvalModel(model: ModelRecord): EvalModel {
  if (!isFreeKind(model.free.kind)) {
    throw new Error(`model is not free: ${model.key}`);
  }

  return {
    modelKey: model.key,
    name: model.name,
    provider: model.provider,
    id: model.id,
    freeKind: model.free.kind,
    context: model.limits.context,
    inputPrice: model.pricing.input,
    outputPrice: model.pricing.output,
  };
}

function eligibleConsoleModel(model: ModelRecord | undefined): boolean {
  return Boolean(
    model &&
      model.provider === "opencode" &&
      model.availability === "live" &&
      isFreeKind(model.free.kind),
  );
}

export function selectFreeModels(
  snapshot: Snapshot,
  options: FreeModelSelectionOptions = {},
): EvalModel[] {
  const liveFree = snapshot.models.filter(
    (model) => model.availability === "live" && isFreeKind(model.free.kind),
  );

  const byId = new Map<string, ModelRecord>();
  for (const model of liveFree) {
    const current = byId.get(model.id);
    if (!current) {
      byId.set(model.id, model);
      continue;
    }

    // The Console listing is the canonical one. A Go listing must never create
    // a second attempt for the same underlying model.
    if (current.provider === "opencode-go" && model.provider === "opencode") {
      byId.set(model.id, model);
    }
  }

  const consoleModels = [...byId.values()]
    .filter((model) => model.provider === "opencode")
    .sort((left, right) => left.key.localeCompare(right.key));

  if (options.modelKeys === undefined) {
    return consoleModels.map(toEvalModel);
  }

  if (options.modelKeys.length === 0) {
    throw new Error("select at least one model");
  }

  const selected: ModelRecord[] = [];
  const seen = new Set<string>();

  for (const key of options.modelKeys) {
    if (seen.has(key)) {
      throw new Error(`duplicate model key: ${key}`);
    }
    seen.add(key);

    const model = snapshot.models.find((candidate) => candidate.key === key);
    if (!model) {
      throw new Error(`unknown model key: ${key}`);
    }

    if (model.provider === "opencode-go") {
      const consoleTwin = consoleModels.find(
        (candidate) => candidate.id === model.id,
      );
      if (consoleTwin) {
        throw new Error(
          `Go twin is not supported in free-only selection; use Console model ${consoleTwin.key}`,
        );
      }
      throw new Error(`model is not a Console model: ${key}`);
    }

    if (model.availability !== "live") {
      throw new Error(`model is not live: ${key}`);
    }

    if (!isFreeKind(model.free.kind)) {
      throw new Error(`model is not free: ${key}`);
    }

    if (!eligibleConsoleModel(model)) {
      throw new Error(`model is not selected by the free Console rules: ${key}`);
    }

    selected.push(model);
  }

  return selected
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(toEvalModel);
}

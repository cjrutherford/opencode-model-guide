import {
  normalizeModelName,
  type MatchType,
  type ModelRecord,
} from "@omg/shared";

export interface Resolution {
  modelKey?: string;
  match: MatchType;
  confidence: number;
}

interface Candidate {
  model: ModelRecord;
  normalized: string;
  tokens: Set<string>;
}

function preference(model: ModelRecord): number {
  const freeRank = model.free.kind === "paid" ? 0 : 1;
  const providerRank = model.provider === "opencode" ? 0 : 1;
  return freeRank * 2 + providerRank;
}

function compareModels(left: ModelRecord, right: ModelRecord): number {
  const rank = preference(left) - preference(right);
  if (rank !== 0) return rank;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function preferred(models: ModelRecord[]): ModelRecord {
  return [...models].sort(compareModels)[0]!;
}

function tokenSet(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter(Boolean));
}

function dice(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return (2 * intersection) / (left.size + right.size);
}

function unmatched(): Resolution {
  return { match: "unmatched", confidence: 0 };
}

export function resolveModelName(
  raw: string,
  models: ModelRecord[],
  aliases: Record<string, string>,
): Resolution {
  const trimmed = raw.trim();
  if (!trimmed) return unmatched();

  const keyHit = models.find((model) => model.key === trimmed);
  if (keyHit) {
    return { modelKey: keyHit.key, match: "exact", confidence: 1 };
  }

  const idHits = models.filter((model) => model.id === trimmed);
  if (idHits.length > 0) {
    return { modelKey: preferred(idHits).key, match: "exact", confidence: 1 };
  }

  const normalizedRaw = normalizeModelName(trimmed);
  if (!normalizedRaw) return unmatched();

  const normalizedHits = models.filter(
    (model) =>
      normalizeModelName(model.name) === normalizedRaw ||
      normalizeModelName(model.id) === normalizedRaw,
  );
  if (normalizedHits.length > 0) {
    return { modelKey: preferred(normalizedHits).key, match: "exact", confidence: 1 };
  }

  const aliasKey = aliases[normalizedRaw];
  if (aliasKey) {
    const aliasTarget = models.find((model) => model.key === aliasKey);
    if (aliasTarget) {
      return { modelKey: aliasTarget.key, match: "alias", confidence: 1 };
    }
  }

  const rawTokens = tokenSet(normalizedRaw);
  const byNormalized = new Map<string, ModelRecord[]>();
  for (const model of models) {
    for (const value of [model.name, model.id]) {
      const normalized = normalizeModelName(value);
      if (!normalized) continue;
      const group = byNormalized.get(normalized) ?? [];
      group.push(model);
      byNormalized.set(normalized, group);
    }
  }

  const perModel = new Map<string, Candidate>();
  for (const [normalized, group] of byNormalized) {
    const model = preferred(group);
    const score = dice(rawTokens, tokenSet(normalized));
    const existing = perModel.get(model.key);
    if (!existing || score > dice(rawTokens, existing.tokens)) {
      perModel.set(model.key, {
        model,
        normalized,
        tokens: tokenSet(normalized),
      });
    }
  }

  let best: Candidate | null = null;
  let bestScore = -1;
  let secondScore = -1;

  for (const candidate of perModel.values()) {
    const score = dice(rawTokens, candidate.tokens);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = candidate;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (!best || bestScore < 0.85) return unmatched();
  if (rawTokens.size !== best.tokens.size && bestScore < 0.9) return unmatched();
  if (bestScore - Math.max(0, secondScore) < 0.05) return unmatched();

  return {
    modelKey: best.model.key,
    match: "fuzzy",
    confidence: bestScore,
  };
}

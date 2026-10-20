import type {
  Availability,
  FreeKind,
  ProviderId,
  Tier,
} from "@omg/shared";

import { FREE_KIND_LABELS, TIER_LABELS } from "./labels";

export type Sort =
  | "name"
  | "context"
  | "cost-asc"
  | "cost-desc"
  | "score-desc"
  | "release-desc";

export const DEFAULT_SORT: Sort = "name";

export type FreeFilter = FreeKind | "free-now" | "zero-marginal";

export interface Filters {
  q?: string;
  free?: FreeFilter;
  provider?: ProviderId;
  minContext?: number;
  maxCost?: number;
  tier?: Tier;
  sort?: Sort;
}

export const SORT_OPTIONS: ReadonlyArray<{ value: Sort; label: string }> = [
  { value: "name", label: "Name" },
  { value: "context", label: "Largest context" },
  { value: "cost-asc", label: "Lowest agentic cost" },
  { value: "cost-desc", label: "Highest agentic cost" },
  { value: "score-desc", label: "Best tier score" },
  { value: "release-desc", label: "Newest release" },
];

export const FREE_FILTER_OPTIONS: ReadonlyArray<{
  value: FreeFilter;
  label: string;
}> = [
  { value: "free-now", label: "Free right now" },
  { value: "zero-marginal", label: "No token charge" },
  { value: "open-free", label: FREE_KIND_LABELS["open-free"] },
  { value: "limited-time", label: FREE_KIND_LABELS["limited-time"] },
  { value: "trial", label: FREE_KIND_LABELS.trial },
  { value: "subscription-included", label: FREE_KIND_LABELS["subscription-included"] },
  { value: "paid", label: FREE_KIND_LABELS.paid },
];

export const TIER_OPTIONS: ReadonlyArray<{ value: Tier; label: string }> = [
  { value: "S", label: TIER_LABELS.S },
  { value: "A", label: TIER_LABELS.A },
  { value: "B", label: TIER_LABELS.B },
  { value: "C", label: TIER_LABELS.C },
  { value: "D", label: TIER_LABELS.D },
  { value: "unrated", label: TIER_LABELS.unrated },
];

const SORTS = new Set<Sort>(SORT_OPTIONS.map((option) => option.value));
const FREE_FILTERS = new Set<FreeFilter>(
  FREE_FILTER_OPTIONS.map((option) => option.value),
);
const TIERS = new Set<Tier>(TIER_OPTIONS.map((option) => option.value));

export interface FilterRow {
  key: string;
  name: string;
  provider: ProviderId;
  availability: Availability;
  freeKind: FreeKind;
  freeNow: boolean;
  zeroMarginal: boolean;
  context: number;
  agenticCost: number | null;
  tier: Tier;
  score: number | null;
  releaseDate?: string;
}

function nonnegativeNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const filters: Filters = {};

  const q = params.get("q")?.trim();
  if (q) filters.q = q;

  const free = params.get("free") as FreeFilter | null;
  if (free && FREE_FILTERS.has(free)) filters.free = free;

  const provider = params.get("provider");
  if (provider === "opencode" || provider === "opencode-go") {
    filters.provider = provider;
  }

  const minContext = nonnegativeNumber(params.get("minContext"));
  if (minContext !== undefined) filters.minContext = Math.floor(minContext);

  const maxCost = nonnegativeNumber(params.get("maxCost"));
  if (maxCost !== undefined) filters.maxCost = maxCost;

  const tier = params.get("tier") as Tier | null;
  if (tier && TIERS.has(tier)) filters.tier = tier;

  const sort = params.get("sort") as Sort | null;
  if (sort && SORTS.has(sort)) filters.sort = sort;

  return filters;
}

export function serializeFilters(filters: Filters): string {
  const params = new URLSearchParams();

  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.free) params.set("free", filters.free);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.minContext !== undefined) {
    params.set("minContext", String(filters.minContext));
  }
  if (filters.maxCost !== undefined) {
    params.set("maxCost", String(filters.maxCost));
  }
  if (filters.tier) params.set("tier", filters.tier);
  if (filters.sort && filters.sort !== DEFAULT_SORT) {
    params.set("sort", filters.sort);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function compareName(left: FilterRow, right: FilterRow): number {
  return left.name.localeCompare(right.name) || left.key.localeCompare(right.key);
}

function compareNullable(
  left: number | null,
  right: number | null,
  direction: 1 | -1,
  rows: [FilterRow, FilterRow],
): number {
  if (left === null && right === null) return compareName(rows[0], rows[1]);
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction || compareName(rows[0], rows[1]);
}

export function applyFilters<T extends FilterRow>(
  rows: readonly T[],
  filters: Filters,
): T[] {
  const q = filters.q?.trim().toLowerCase();

  return rows
    .filter((row) => {
      if (q && !`${row.name} ${row.key}`.toLowerCase().includes(q)) {
        return false;
      }

      if (filters.free === "free-now" && !row.freeNow) return false;
      if (filters.free === "zero-marginal" && !row.zeroMarginal) return false;
      if (
        filters.free &&
        filters.free !== "free-now" &&
        filters.free !== "zero-marginal" &&
        row.freeKind !== filters.free
      ) {
        return false;
      }

      if (filters.provider && row.provider !== filters.provider) return false;
      if (
        filters.minContext !== undefined &&
        row.context < filters.minContext
      ) {
        return false;
      }
      if (filters.maxCost !== undefined) {
        if (row.agenticCost === null || row.agenticCost > filters.maxCost) {
          return false;
        }
      }
      if (filters.tier && row.tier !== filters.tier) return false;

      return true;
    })
    .sort((left, right) => {
      switch (filters.sort ?? DEFAULT_SORT) {
        case "context":
          return right.context - left.context || compareName(left, right);
        case "cost-asc":
          return compareNullable(left.agenticCost, right.agenticCost, 1, [
            left,
            right,
          ]);
        case "cost-desc":
          return compareNullable(left.agenticCost, right.agenticCost, -1, [
            left,
            right,
          ]);
        case "score-desc":
          return compareNullable(left.score, right.score, -1, [left, right]);
        case "release-desc":
          if (!left.releaseDate && !right.releaseDate) {
            return compareName(left, right);
          }
          if (!left.releaseDate) return 1;
          if (!right.releaseDate) return -1;
          return (
            right.releaseDate.localeCompare(left.releaseDate) ||
            compareName(left, right)
          );
        case "name":
        default:
          return compareName(left, right);
      }
    });
}

export function parseCompare(search: string, limit = 4): string[] {
  const raw = new URLSearchParams(search).get("models") ?? "";
  const slugs: string[] = [];

  for (const part of raw.split(",")) {
    const slug = part.trim();
    if (slug && !slugs.includes(slug)) slugs.push(slug);
    if (slugs.length >= limit) break;
  }

  return slugs;
}

export function serializeCompare(slugs: readonly string[]): string {
  const unique = [...new Set(slugs.filter(Boolean))].slice(0, 4);
  return unique.length
    ? `?models=${unique.map((slug) => encodeURIComponent(slug)).join(",")}`
    : "";
}

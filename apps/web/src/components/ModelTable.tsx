import { useEffect, useMemo, useState } from "react";

import FreeBadgePill from "./FreeBadgePill";
import ModelCard from "./ModelCard";
import {
  DEFAULT_SORT,
  FREE_FILTER_OPTIONS,
  SORT_OPTIONS,
  TIER_OPTIONS,
  applyFilters,
  parseFilters,
  serializeFilters,
  type Filters,
  type Sort,
} from "../lib/filters";
import {
  formatAvailability,
  formatDate,
  formatProvider,
  formatScore,
  formatTokens,
  formatUsd,
} from "../lib/format";
import type { ModelRow } from "../lib/models";

interface Props {
  rows: ModelRow[];
}

function sortForColumn(column: "name" | "context" | "cost" | "tier" | "release"): Sort {
  switch (column) {
    case "context":
      return "context";
    case "cost":
      return "cost-asc";
    case "tier":
      return "score-desc";
    case "release":
      return "release-desc";
    case "name":
    default:
      return "name";
  }
}

function ariaSort(
  column: "name" | "context" | "cost" | "tier" | "release",
  sort: Sort | undefined,
): "ascending" | "descending" | "none" {
  switch (column) {
    case "name":
      return sort === "name" || !sort ? "ascending" : "none";
    case "context":
      return sort === "context" ? "descending" : "none";
    case "cost":
      return sort === "cost-asc"
        ? "ascending"
        : sort === "cost-desc"
          ? "descending"
          : "none";
    case "tier":
      return sort === "score-desc" ? "descending" : "none";
    case "release":
      return sort === "release-desc" ? "descending" : "none";
  }
}

function SortButton({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: "name" | "context" | "cost" | "tier" | "release";
  sort: Sort | undefined;
  onSort: (column: "name" | "context" | "cost" | "tier" | "release") => void;
}) {
  const state = ariaSort(column, sort);
  return (
    <button
      className="inline-flex items-center gap-1 text-left uppercase tracking-[0.1em] hover:text-ink"
      type="button"
      onClick={() => onSort(column)}
    >
      {label}
      <span aria-hidden="true" className="text-[0.7em]">
        {state === "ascending" ? "↑" : state === "descending" ? "↓" : "↕"}
      </span>
    </button>
  );
}

export default function ModelTable({ rows }: Props) {
  const [filters, setFilters] = useState<Filters>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setFilters(parseFilters(window.location.search));
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const query = serializeFilters(filters);
    const target = `${window.location.pathname}${query}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (target !== current) {
      window.history.replaceState(null, "", target);
    }
  }, [filters, mounted]);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const hasFilters = Object.keys(filters).length > 0;

  function update(key: keyof Filters, value: Filters[keyof Filters]) {
    setFilters((current) => {
      const next: Filters = { ...current };
      if (value === undefined || value === "") {
        delete next[key];
      } else {
        (next as Record<string, unknown>)[key] = value;
      }
      return next;
    });
  }

  function updateNumber(key: "minContext" | "maxCost", raw: string) {
    if (raw.trim() === "") {
      update(key, undefined);
      return;
    }
    const value = Number(raw);
    update(key, Number.isFinite(value) ? Math.max(0, value) : undefined);
  }

  function handleSort(column: "name" | "context" | "cost" | "tier" | "release") {
    const target = sortForColumn(column);
    if (column === "cost" && filters.sort === "cost-asc") {
      update("sort", "cost-desc");
      return;
    }
    update("sort", target);
  }

  return (
    <div>
      <div className="card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="control-label" htmlFor="model-search">
              Search
            </label>
            <input
              className="control"
              id="model-search"
              type="search"
              value={filters.q ?? ""}
              placeholder="Name or model key"
              onChange={(event) => update("q", event.target.value)}
            />
          </div>

          <div>
            <label className="control-label" htmlFor="model-free">
              Free terms
            </label>
            <select
              className="control"
              id="model-free"
              value={filters.free ?? ""}
              onChange={(event) =>
                update("free", (event.target.value || undefined) as Filters["free"])
              }
            >
              <option value="">Any terms</option>
              {FREE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="control-label" htmlFor="model-provider">
              Provider
            </label>
            <select
              className="control"
              id="model-provider"
              value={filters.provider ?? ""}
              onChange={(event) =>
                update(
                  "provider",
                  (event.target.value || undefined) as Filters["provider"],
                )
              }
            >
              <option value="">All providers</option>
              <option value="opencode">Console</option>
              <option value="opencode-go">Go</option>
            </select>
          </div>

          <div>
            <label className="control-label" htmlFor="model-context">
              Minimum context
            </label>
            <input
              className="control"
              id="model-context"
              type="number"
              min="0"
              step="1000"
              value={filters.minContext ?? ""}
              placeholder="e.g. 200000"
              onChange={(event) => updateNumber("minContext", event.target.value)}
            />
          </div>

          <div>
            <label className="control-label" htmlFor="model-cost">
              Max agentic cost (USD)
            </label>
            <input
              className="control"
              id="model-cost"
              type="number"
              min="0"
              step="0.01"
              value={filters.maxCost ?? ""}
              placeholder="e.g. 1.00"
              onChange={(event) => updateNumber("maxCost", event.target.value)}
            />
          </div>

          <div>
            <label className="control-label" htmlFor="model-tier">
              Best tier
            </label>
            <select
              className="control"
              id="model-tier"
              value={filters.tier ?? ""}
              onChange={(event) =>
                update("tier", (event.target.value || undefined) as Filters["tier"])
              }
            >
              <option value="">Any tier</option>
              {TIER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="control-label" htmlFor="model-sort">
              Sort
            </label>
            <select
              className="control"
              id="model-sort"
              value={filters.sort ?? DEFAULT_SORT}
              onChange={(event) => update("sort", event.target.value as Sort)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted" aria-live="polite">
            {filtered.length} of {rows.length} models
          </p>
          <button
            className="text-xs font-semibold underline decoration-line underline-offset-4 hover:decoration-accent disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={!hasFilters}
            onClick={() => setFilters({})}
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="mt-4 hidden sm:block">
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[680px]">
            <caption className="sr-only">
              OpenCode-native models with free terms, context, modeled agentic
              cost, best tier, and release date.
            </caption>
            <thead>
              <tr>
                <th
                  className="sticky left-0 z-20 bg-raised"
                  scope="col"
                  aria-sort={ariaSort("name", filters.sort)}
                >
                  <SortButton
                    label="Model"
                    column="name"
                    sort={filters.sort}
                    onSort={handleSort}
                  />
                </th>
                <th scope="col">Free</th>
                <th scope="col" aria-sort={ariaSort("context", filters.sort)}>
                  <SortButton
                    label="Context"
                    column="context"
                    sort={filters.sort}
                    onSort={handleSort}
                  />
                </th>
                <th scope="col" aria-sort={ariaSort("cost", filters.sort)}>
                  <SortButton
                    label="Agentic task"
                    column="cost"
                    sort={filters.sort}
                    onSort={handleSort}
                  />
                </th>
                <th scope="col" aria-sort={ariaSort("tier", filters.sort)}>
                  <SortButton
                    label="Best tier"
                    column="tier"
                    sort={filters.sort}
                    onSort={handleSort}
                  />
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSort("release", filters.sort)}
                >
                  <SortButton
                    label="Released"
                    column="release"
                    sort={filters.sort}
                    onSort={handleSort}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.key}>
                  <th
                    className="sticky left-0 z-10 bg-raised"
                    scope="row"
                  >
                    <a className="font-semibold" href={row.href}>
                      {row.name}
                    </a>
                    <span className="mt-0.5 block text-[0.68rem] font-normal text-muted">
                      {formatProvider(row.provider)}
                      {row.availability !== "live"
                        ? ` · ${formatAvailability(row.availability)}`
                        : ""}
                    </span>
                  </th>
                  <td>
                    <FreeBadgePill
                      kind={row.freeKind}
                      uncertain={row.freeStatus === "uncertain"}
                    />
                  </td>
                  <td className="num">{formatTokens(row.context)}</td>
                  <td className="num">{formatUsd(row.agenticCost)}</td>
                  <td>
                    {row.tier === "unrated" ? (
                      <span className="text-xs text-muted">Insufficient data</span>
                    ) : (
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-display text-lg">{row.tier}</span>
                        {row.score !== null && (
                          <span className="num text-xs text-muted">
                            {formatScore(row.score)}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td>
                    {row.releaseDate ? (
                      <time dateTime={row.releaseDate}>
                        {formatDate(row.releaseDate)}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:hidden">
        {filtered.map((row) => (
          <ModelCard key={row.key} row={row} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="card mt-4 p-6 text-sm">
          <p className="font-semibold">No models match these filters.</p>
          <p className="mt-1 text-muted">
            Try widening the context or cost range, or clear the filters.
          </p>
          <button
            className="mt-4 border border-ink px-3 py-2 text-xs font-semibold hover:border-accent hover:text-accent"
            type="button"
            onClick={() => setFilters({})}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

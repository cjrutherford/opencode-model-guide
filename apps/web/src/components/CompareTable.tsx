import { useEffect, useMemo, useState, type ReactNode } from "react";

import FreeBadgePill from "./FreeBadgePill";
import {
  formatAvailability,
  formatConfidence,
  formatProvider,
  formatTokens,
  formatUsd,
} from "../lib/format";
import type { CompareRow } from "../lib/models";
import { parseCompare, serializeCompare } from "../lib/filters";

interface Props {
  rows: CompareRow[];
}

type Direction = "higher" | "lower";

function tierRank(tier: CompareRow["bestTier"]): number | null {
  switch (tier) {
    case "S":
      return 5;
    case "A":
      return 4;
    case "B":
      return 3;
    case "C":
      return 2;
    case "D":
      return 1;
    default:
      return null;
  }
}

function bestIndexes(values: Array<number | null>, direction: Direction): Set<number> {
  const numbers = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (numbers.length === 0 || values.length < 2) return new Set();

  const best =
    direction === "higher" ? Math.max(...numbers) : Math.min(...numbers);
  return new Set(
    values.flatMap((value, index) => (value === best ? [index] : [])),
  );
}

function listPrice(row: CompareRow, value: number | null): string {
  if (!row.pricingKnown) return "not published";
  return value === null ? "—" : formatUsd(value);
}

interface Definition {
  label: string;
  get: (row: CompareRow) => ReactNode;
  rank?: (row: CompareRow) => number | null;
  direction?: Direction;
}

const definitions: Definition[] = [
  {
    label: "Provider",
    get: (row) => formatProvider(row.provider),
  },
  {
    label: "Free terms",
    get: (row) => (
      <FreeBadgePill
        kind={row.freeKind}
        uncertain={row.freeStatus === "uncertain"}
      />
    ),
  },
  {
    label: "Availability",
    get: (row) => formatAvailability(row.availability),
  },
  {
    label: "Context",
    get: (row) => formatTokens(row.context),
    rank: (row) => row.context,
    direction: "higher",
  },
  {
    label: "Max output",
    get: (row) => formatTokens(row.output),
    rank: (row) => row.output,
    direction: "higher",
  },
  {
    label: "Input / 1M",
    get: (row) => listPrice(row, row.inputPrice),
    rank: (row) => row.inputPrice,
    direction: "lower",
  },
  {
    label: "Output / 1M",
    get: (row) => listPrice(row, row.outputPrice),
    rank: (row) => row.outputPrice,
    direction: "lower",
  },
  {
    label: "Cache read / 1M",
    get: (row) => listPrice(row, row.cacheRead),
    rank: (row) => row.cacheRead,
    direction: "lower",
  },
  {
    label: "Agentic PR task",
    get: (row) => formatUsd(row.agenticCost),
    rank: (row) => row.agenticCost,
    direction: "lower",
  },
  {
    label: "Quick edit task",
    get: (row) => formatUsd(row.quickCost),
    rank: (row) => row.quickCost,
    direction: "lower",
  },
  {
    label: "Long-context task",
    get: (row) => formatUsd(row.longContextCost),
    rank: (row) => row.longContextCost,
    direction: "lower",
  },
  {
    label: "Agentic tier",
    get: (row) =>
      row.agenticTier === "unrated" ? "Insufficient data" : row.agenticTier,
    rank: (row) => tierRank(row.agenticTier),
    direction: "higher",
  },
  {
    label: "Frontend tier",
    get: (row) =>
      row.frontendTier === "unrated" ? "Insufficient data" : row.frontendTier,
    rank: (row) => tierRank(row.frontendTier),
    direction: "higher",
  },
  {
    label: "Long-context tier",
    get: (row) =>
      row.longContextTier === "unrated"
        ? "Insufficient data"
        : row.longContextTier,
    rank: (row) => tierRank(row.longContextTier),
    direction: "higher",
  },
  {
    label: "Best-tier confidence",
    get: (row) =>
      row.bestConfidence === null
        ? "Insufficient data"
        : formatConfidence(row.bestConfidence),
    rank: (row) => row.bestConfidence,
    direction: "higher",
  },
];

export default function CompareTable({ rows }: Props) {
  const bySlug = useMemo(
    () => new Map(rows.map((row) => [row.slug, row])),
    [rows],
  );
  const [slots, setSlots] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const parsed = parseCompare(window.location.search)
      .filter((slug) => bySlug.has(slug))
      .slice(0, 4);
    setSlots(parsed.length > 0 ? parsed : [""]);
    setMounted(true);
  }, [bySlug]);

  useEffect(() => {
    if (!mounted) return;
    const query = serializeCompare(slots);
    const target = `${window.location.pathname}${query}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (target !== current) {
      window.history.replaceState(null, "", target);
    }
  }, [slots, mounted]);

  const selected = slots
    .map((slug) => (slug ? bySlug.get(slug) : undefined))
    .filter((row): row is CompareRow => row !== undefined);

  function setSlot(index: number, slug: string) {
    setSlots((current) =>
      current.map((value, position) => {
        if (position === index) return slug;
        return slug && value === slug ? "" : value;
      }),
    );
  }

  function removeSlot(index: number) {
    setSlots((current) => current.filter((_, position) => position !== index));
  }

  return (
    <div>
      <div className="card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {slots.map((slug, index) => (
            <div key={`slot-${index}`}>
              <label className="control-label" htmlFor={`compare-model-${index}`}>
                Model {index + 1}
              </label>
              <div className="flex gap-2">
                <select
                  className="control"
                  id={`compare-model-${index}`}
                  value={slug}
                  onChange={(event) => setSlot(index, event.target.value)}
                >
                  <option value="">Pick a model</option>
                  {rows.map((row) => {
                    const taken = slots.some(
                      (value, position) =>
                        position !== index && value === row.slug,
                    );
                    return (
                      <option key={row.key} value={row.slug} disabled={taken}>
                        {row.name}
                      </option>
                    );
                  })}
                </select>
                <button
                  className="shrink-0 border border-line px-2 text-xs font-semibold hover:border-accent hover:text-accent"
                  type="button"
                  aria-label={`Remove model ${index + 1}`}
                  onClick={() => removeSlot(index)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <button
            className="border border-ink px-3 py-2 text-xs font-semibold hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={slots.length >= 4}
            onClick={() => setSlots((current) => [...current, ""])}
          >
            Add model
          </button>
          <button
            className="text-xs font-semibold underline decoration-line underline-offset-4 hover:decoration-accent disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={slots.length <= 1 && !slots[0]}
            onClick={() => setSlots([""])}
          >
            Clear all
          </button>
          <p className="text-xs text-muted" aria-live="polite">
            {selected.length} of 4 selected
          </p>
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="card mt-4 p-6 text-sm">
          <p className="font-semibold">Pick up to four models to compare.</p>
          <p className="mt-1 text-muted">
            The selection is stored in the URL, so you can share or reload it.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-3 text-xs text-muted sm:hidden">
            Scroll the table sideways to see every model.
          </p>
          <div className="card mt-3 overflow-x-auto">
            <table className="data-table min-w-[640px] sm:min-w-[720px]">
              <caption className="sr-only">
                Side-by-side comparison of selected OpenCode-native models.
                Prices are per million tokens; task costs are modeled.
              </caption>
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-28 bg-raised sm:w-40" scope="col">
                    Attribute
                  </th>
                  {selected.map((row) => (
                    <th key={row.key} scope="col">
                      <a className="font-semibold normal-case tracking-normal" href={row.href}>
                        {row.name}
                      </a>
                      <span className="mt-1 block normal-case tracking-normal">
                        <FreeBadgePill
                          kind={row.freeKind}
                          uncertain={row.freeStatus === "uncertain"}
                        />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {definitions.map((definition) => {
                  const values = definition.rank
                    ? selected.map((row) => definition.rank?.(row) ?? null)
                    : [];
                  const best =
                    definition.direction !== undefined
                      ? bestIndexes(values, definition.direction)
                      : new Set<number>();

                  return (
                    <tr key={definition.label}>
                      <th
                        className="sticky left-0 z-10 w-28 bg-raised font-semibold sm:w-40"
                        scope="row"
                      >
                        {definition.label}
                      </th>
                      {selected.map((row, index) => (
                        <td
                          key={row.key}
                          className={best.has(index) ? "compare-best" : undefined}
                          title={best.has(index) ? "Best in this row" : undefined}
                        >
                          {definition.get(row)}
                          {best.has(index) && (
                            <span className="sr-only"> (best in row)</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

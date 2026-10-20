import FreeBadgePill from "./FreeBadgePill";
import {
  USE_CASE_LABELS,
  formatAvailability,
  formatDate,
  formatProvider,
  formatScore,
  formatTokens,
  formatUsd,
} from "../lib/format";
import type { ModelRow } from "../lib/models";

interface Props {
  row: ModelRow;
}

export default function ModelCard({ row }: Props) {
  return (
    <a
      className="card block min-w-0 p-4 no-underline hover:border-accent"
      href={row.href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">
            {formatProvider(row.provider)}
            {row.availability !== "live"
              ? ` · ${formatAvailability(row.availability)}`
              : ""}
          </p>
          <h3 className="mt-1 break-words font-display text-xl leading-tight tracking-tight">
            {row.name}
          </h3>
        </div>
        <FreeBadgePill
          kind={row.freeKind}
          uncertain={row.freeStatus === "uncertain"}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="eyebrow">Context</dt>
          <dd className="num mt-0.5">{formatTokens(row.context)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Agentic task</dt>
          <dd className="num mt-0.5">{formatUsd(row.agenticCost)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Best tier</dt>
          <dd className="mt-0.5">
            {row.tier === "unrated" ? (
              <span className="text-muted">Insufficient data</span>
            ) : (
              <>
                <span className="font-display text-lg">{row.tier}</span>
                {row.score !== null && (
                  <span className="num ml-1 text-muted">
                    {formatScore(row.score)}
                  </span>
                )}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Released</dt>
          <dd className="mt-0.5">
            {row.releaseDate ? formatDate(row.releaseDate) : "—"}
          </dd>
        </div>
      </dl>

      {row.tierUseCase && (
        <p className="mt-3 text-xs text-muted">
          Best rated for {USE_CASE_LABELS[row.tierUseCase].toLowerCase()}
        </p>
      )}
    </a>
  );
}

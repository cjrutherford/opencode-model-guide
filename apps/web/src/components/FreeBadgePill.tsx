import type { FreeKind } from "@omg/shared";

import { formatFreeKind } from "../lib/format";

interface Props {
  kind: FreeKind;
  uncertain?: boolean;
  className?: string;
}

export default function FreeBadgePill({
  kind,
  uncertain = false,
  className = "",
}: Props) {
  const label = formatFreeKind(kind);

  return (
    <span
      className={`badge badge--${kind} ${uncertain ? "badge--uncertain" : ""} ${className}`.trim()}
      title={uncertain ? `${label} — terms uncertain` : label}
    >
      <span className="badge-dot" aria-hidden="true" />
      {label}
      {uncertain && <span className="badge-uncertain">uncertain</span>}
    </span>
  );
}

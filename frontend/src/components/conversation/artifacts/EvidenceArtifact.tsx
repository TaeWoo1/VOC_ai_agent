import { Link } from "react-router-dom";
import type { EvidenceArtifact as Evidence } from "../../../lib/conversation/types";
import { count } from "../../../lib/format";

/** What was read: label · count · window. Locators, ids and provenance strings never render. */
export function EvidenceArtifact({ artifact }: { artifact: Evidence }) {
  return (
    <ul className="space-y-1 text-sm text-muted" aria-label={artifact.title}>
      {artifact.items.map((e, i) => {
        const window = e.from && e.to ? `${e.from} ~ ${e.to}` : e.asOf ? `${e.asOf} 기준` : null;
        const line = [e.label, e.count != null ? `${count(e.count)}건` : null, window, e.covered ? null : "확인 못 함"].filter(Boolean).join(" · ");
        return (
          <li key={i} className="break-keep">
            {e.link ? <Link to={e.link} className="hover:underline">{line}</Link> : line}
          </li>
        );
      })}
    </ul>
  );
}

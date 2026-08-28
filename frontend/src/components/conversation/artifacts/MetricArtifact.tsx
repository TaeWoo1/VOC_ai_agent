import { Link } from "react-router-dom";
import type { MetricArtifact as Metric } from "../../../lib/conversation/types";
import { count, wonShort } from "../../../lib/format";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

function fmt(unit: string, value: number): string {
  return unit === "원" ? wonShort(value) : count(value);
}

/** A row of compact numbers — label over value, a delta only when the runtime sent one. */
export function MetricArtifact({ artifact }: { artifact: Metric }) {
  const onOpen = useContinueInPanel("METRIC");
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      <div className="grid grid-cols-2 gap-3 px-4 pb-3 sm:grid-cols-3">
        {artifact.metrics.map((m) => {
          const body = (
            <>
              <p className="text-sm font-medium text-muted">{m.label}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-ink">
                {fmt(m.unit, m.value)}
                <span className="ml-1 text-sm font-semibold text-muted">{m.unit}</span>
              </p>
              {m.deltaPercent != null ? (
                <p className="mt-0.5 text-xs text-muted">
                  {m.deltaPercent === 0 ? "이전 기간과 같음" : `${m.deltaPercent > 0 ? "▲" : "▼"} ${Math.abs(m.deltaPercent)}% 이전 기간 대비`}
                </p>
              ) : null}
            </>
          );
          return m.to ? (
            <Link key={m.label} to={m.to} onClick={onOpen} className="rounded-xl border border-line px-3 py-2 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
              {body}
            </Link>
          ) : (
            <div key={m.label} className="rounded-xl border border-line px-3 py-2">{body}</div>
          );
        })}
      </div>
    </ArtifactCard>
  );
}

import { Link } from "react-router-dom";
import type { ChartArtifact as Chart } from "../../../lib/conversation/types";
import { TrendChart } from "../../ui/TrendChart";
import type { MetricSeries } from "../../../lib/types";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

function toSeries(s: Chart["series"][number], unit: string): MetricSeries {
  return { key: s.key, label: s.label, unit, points: s.points };
}

/** The product's one chart, with the runtime's series — tooltip, legend and keyboard come with it. */
export function ChartArtifact({ artifact }: { artifact: Chart }) {
  const onOpen = useContinueInPanel("CHART");
  const [first, second] = artifact.series;
  if (!first) return null;
  return (
    <ArtifactCard
      title={artifact.title}
      note={[artifact.note, artifact.caption].filter(Boolean).join(" · ") || null}
      action={artifact.to ? <Link to={artifact.to} onClick={onOpen} className="text-xs font-semibold text-brand-700 hover:underline">자세히 보기</Link> : undefined}
    >
      <div className="px-4 pb-2">
        <TrendChart primary={toSeries(first, artifact.unit)} secondary={second ? toSeries(second, artifact.unit) : undefined} label={artifact.title} height={140} />
      </div>
    </ArtifactCard>
  );
}

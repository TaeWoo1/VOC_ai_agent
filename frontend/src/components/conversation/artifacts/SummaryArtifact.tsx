import type { SummaryArtifact as Summary } from "../../../lib/conversation/types";
import { ArtifactCard } from "./ArtifactCard";

export function SummaryArtifact({ artifact }: { artifact: Summary }) {
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      <ul className="space-y-1 px-4 pb-2">
        {artifact.lines.map((line, i) => (
          <li key={i} className="break-keep text-base text-ink">{line}</li>
        ))}
      </ul>
    </ArtifactCard>
  );
}

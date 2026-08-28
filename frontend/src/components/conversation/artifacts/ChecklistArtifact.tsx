import { Link } from "react-router-dom";
import type { ChecklistArtifact as Checklist } from "../../../lib/conversation/types";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

export function ChecklistArtifact({ artifact }: { artifact: Checklist }) {
  const onOpen = useContinueInPanel("CHECKLIST");
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      <ol className="space-y-1.5 px-4 pb-3">
        {artifact.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-base text-ink">
            <span className="tabular-nums text-muted">{i + 1}.</span>
            <span className="min-w-0 break-keep">
              {item.to ? <Link to={item.to} onClick={onOpen} className="font-semibold text-brand-700 hover:underline">{item.label}</Link> : item.label}
              {item.detail ? <span className="ml-1 text-sm text-muted">{item.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </ArtifactCard>
  );
}

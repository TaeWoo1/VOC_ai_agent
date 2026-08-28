import { Link } from "react-router-dom";
import type { ListArtifact as List } from "../../../lib/conversation/types";
import { WorkItem } from "../../ui/WorkItem";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

export function ListArtifact({ artifact }: { artifact: List }) {
  const onOpen = useContinueInPanel("LIST");
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      <ul className="divide-y divide-line/70">
        {artifact.items.map((item) => (
          <li key={item.id}>
            <WorkItem
              state={item.status?.label ?? null}
              tone={item.status?.tone ?? "neutral"}
              title={item.primary}
              meta={item.secondary}
              to={item.to}
              onClick={onOpen}
              time={item.to ? <span aria-hidden="true">›</span> : undefined}
            />
          </li>
        ))}
      </ul>
      {artifact.more ? (
        <p className="px-4 py-2">
          <Link to={artifact.more.to} onClick={onOpen} className="text-sm font-semibold text-brand-700 hover:underline">
            {artifact.more.label}
          </Link>
        </p>
      ) : null}
    </ArtifactCard>
  );
}

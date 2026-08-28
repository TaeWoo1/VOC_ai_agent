import type { WorkspaceLinkArtifact as WorkspaceLink } from "../../../lib/conversation/types";
import { BtnLink } from "../../ui/Btn";
import { useContinueInPanel } from "../useContinueInPanel";

export function WorkspaceLinkArtifact({ artifact }: { artifact: WorkspaceLink }) {
  const onOpen = useContinueInPanel("WORKSPACE_LINK");
  const label = artifact.link.count != null ? `${artifact.link.label} (${artifact.link.count}건)` : artifact.link.label;
  return (
    <div>
      <BtnLink to={artifact.link.to} variant="outline" size="sm" onClick={onOpen}>{label}</BtnLink>
      {artifact.note ? <p className="mt-1 text-sm text-muted">{artifact.note}</p> : null}
    </div>
  );
}

import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAgentPanel } from "../../lib/agentPanel";
import { analytics } from "../../lib/analytics";
import type { ArtifactType } from "../../lib/conversation/types";

/**
 * A link inside a conversation artifact leaves the home for a workspace; the conversation should
 * still be beside the seller when they get there. So a press from the home (or the full page) opens
 * the contextual panel — with no request, no sentence — and the same thread continues next to the
 * list it pointed at. From inside the panel the panel is already open and nothing changes.
 */
export function useContinueInPanel(type?: ArtifactType): () => void {
  const panel = useAgentPanel();
  const { pathname } = useLocation();
  return useCallback(() => {
    if (type) analytics.track("artifact_opened", { type: type.toLowerCase() as Lowercase<ArtifactType> });
    if (panel && !panel.open && (pathname === "/" || pathname === "/agent")) panel.openPanel();
  }, [panel, pathname, type]);
}

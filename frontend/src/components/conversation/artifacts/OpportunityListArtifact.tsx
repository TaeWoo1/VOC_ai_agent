import type { OpportunityListArtifact as OpportunityList } from "../../../lib/conversation/types";
import { WorkItem } from "../../ui/WorkItem";
import type { StatusTone } from "../../ui/Status";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/** Kind in the seller's words comes from the backend; the tone is the one rule this file adds. */
const TONE: Record<string, StatusTone> = {
  PRODUCT_IMPROVEMENT_REVIEW: "warn",
};

/**
 * Improvement opportunities in the conversation — the same objects the product and issue screens show,
 * drawn as rows that open the issue's surface (where the evidence and the prepared action live). The
 * conversation neither accepts nor dismisses: a decision is made where its evidence is.
 */
export function OpportunityListArtifact({ artifact, headline }: { artifact: OpportunityList; headline?: string }) {
  const onOpen = useContinueInPanel("OPPORTUNITY_LIST");
  return (
    <ArtifactCard title={artifact.title} note={artifact.note} headline={headline} titleSaid={artifact.titleSaid} testId="opportunity-list">
      {artifact.items.length === 0 ? (
        <p className="px-4 pb-2 text-sm text-muted">지금 제안할 개선 기회가 없습니다.</p>
      ) : null}
      <ul className="divide-y divide-line/70">
        {artifact.items.map((o) => (
          <li key={`${o.issueId}:${o.kind}`}>
            <WorkItem
              state={o.kindLabelKo}
              tone={TONE[o.kind] ?? "info"}
              title={o.recommendationKo}
              meta={[o.issueTitle, `근거 리뷰 ${o.evidenceCount}건`, o.productName, o.status === "ACCEPTED" ? o.statusLabelKo : null]
                .filter(Boolean)
                .join(" · ")}
              to={o.to}
              onClick={onOpen}
            />
          </li>
        ))}
      </ul>
    </ArtifactCard>
  );
}

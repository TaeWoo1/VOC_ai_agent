import type { IssueListArtifact as IssueList } from "../../../lib/conversation/types";
import { WorkItem } from "../../ui/WorkItem";
import type { StatusTone } from "../../ui/Status";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/** Severity in the seller's words; an unknown value renders no word rather than the token. */
const SEVERITY: Record<string, { word: string; tone: StatusTone }> = {
  HIGH: { word: "심각", tone: "bad" },
  MEDIUM: { word: "주의", tone: "warn" },
  LOW: { word: "참고", tone: "neutral" },
};

export function IssueListArtifact({ artifact, headline }: { artifact: IssueList; headline?: string }) {
  const onOpen = useContinueInPanel("ISSUE_LIST");
  return (
    <ArtifactCard title={artifact.title} note={artifact.note} headline={headline}>
      {artifact.items.length === 0 ? <p className="px-4 pb-2 text-sm text-muted">반복해서 나타나는 문제는 아직 없습니다.</p> : null}
      <ul className="divide-y divide-line/70">
        {artifact.items.map((issue) => {
          const sev = SEVERITY[issue.severity];
          return (
            <li key={issue.issueId}>
              <WorkItem
                state={sev?.word ?? null}
                tone={sev?.tone ?? "neutral"}
                title={issue.title}
                meta={[`근거 리뷰 ${issue.evidenceCount}건`, issue.productName].filter(Boolean).join(" · ")}
                time={issue.lastOn ?? undefined}
                to={issue.to}
                onClick={onOpen}
              />
            </li>
          );
        })}
      </ul>
    </ArtifactCard>
  );
}

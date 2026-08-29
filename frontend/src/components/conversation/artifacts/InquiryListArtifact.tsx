import { Link } from "react-router-dom";
import type { InquiryGroupKey, InquiryListArtifact as InquiryList } from "../../../lib/conversation/types";
import { WorkItem } from "../../ui/WorkItem";
import type { StatusTone } from "../../ui/Status";
import { previewText } from "../../../lib/plainText";
import { relativeTime } from "../../../lib/format";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/** The first word of every row is its work state — the same words the 문의 screen uses. */
const STATE: Record<InquiryGroupKey, { word: string; tone: StatusTone }> = {
  DRAFT_READY: { word: "초안 준비됨", tone: "info" },
  NEEDS_CLARIFICATION: { word: "되묻는 초안", tone: "warn" },
  KNOWLEDGE_MISSING: { word: "답변 기준 필요", tone: "warn" },
  UNANSWERED: { word: "답변 필요", tone: "warn" },
  ANSWERED: { word: "답변함", tone: "good" },
};

export function InquiryListArtifact({ artifact }: { artifact: InquiryList }) {
  const onOpen = useContinueInPanel("INQUIRY_LIST");
  const groups = artifact.groups.filter((g) => g.items.length > 0);
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      {groups.length === 0 ? <p className="px-4 pb-2 text-sm text-muted">보여드릴 문의가 없습니다.</p> : null}
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          {groups.length > 1 ? (
            <p className="border-y border-line/70 bg-canvas px-4 py-1.5 text-xs font-semibold text-muted">
              {group.label} <span className="tabular-nums">{group.items.length}</span>
            </p>
          ) : null}
          <ul className="divide-y divide-line/70">
            {group.items.map((item) => (
              <li key={item.workItemId ?? item.inquiryId}>
                <WorkItem
                  state={STATE[group.key].word}
                  tone={STATE[group.key].tone}
                  title={previewText(item.title) || "제목 없는 문의"}
                  meta={[item.channelNameKo, item.productName].filter(Boolean).join(" · ") || undefined}
                  time={relativeTime(item.receivedAt)}
                  to={item.to}
                  onClick={onOpen}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {artifact.more ? (
        <p className="px-4 py-2">
          <Link to={artifact.more.to} onClick={onOpen} className="text-sm font-semibold text-brand-700 hover:underline">{artifact.more.label}</Link>
        </p>
      ) : null}
    </ArtifactCard>
  );
}

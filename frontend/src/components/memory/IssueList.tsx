import { Link } from "react-router-dom";
import type { ReviewIssueView } from "../../lib/types";
import { changeBadges } from "../../lib/reviewIssuesView";
import { Facts } from "../ui/ObjectRow";
import { evidenceCountLabel, groupIssues, lastSeenLabel } from "../../lib/memoryView";
import type { ChangeTone } from "../../lib/reviewIssuesView";

// Status colour is used here because these states have real meaning: a surge and a severity are
// verdicts the extractor reached, not decoration.
const TONE_CLASS: Record<ChangeTone, string> = {
  bad: "bg-bad/10 text-bad",
  warn: "bg-warn/10 text-warn",
  neutral: "bg-canvas text-muted",
  good: "bg-good/10 text-good",
};

function IssueRow({ issue, selected }: { issue: ReviewIssueView; selected: boolean }) {
  const badges = changeBadges(issue.change);
  const lastSeen = lastSeenLabel(issue);
  // One title and one line of facts (UI/UX v2 Phase 1). The row used to open with two chips — lifecycle and
  // severity — above the title, so the metadata was read before the problem; 77% of this list's letters were 13px.
  // Severity now lives in the detail header; the lifecycle word stays because the list is grouped by it.
  return (
    <li>
      <Link
        to={`/memory/${issue.id}`}
        aria-current={selected ? "true" : undefined}
        className={`block px-5 py-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700 ${
          selected ? "bg-brand-50 shadow-[inset_3px_0_0_#1B64DA]" : "hover:bg-canvas"
        }`}
      >
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 break-keep">
          <span className="text-base font-bold text-ink">{issue.title}</span>
          {badges.map((badge) => (
            <span key={badge.kind} className={`rounded-full px-2 py-px text-xs font-semibold ${TONE_CLASS[badge.tone]}`}>
              {badge.labelKo}
            </span>
          ))}
        </p>
        <Facts className="mt-1 text-sm text-muted">
          <span>{issue.lifecycleLabelKo}</span>
          <span>{evidenceCountLabel(issue)}</span>
          {lastSeen ? <span>{lastSeen}</span> : null}
          {issue.dominantProductName ? <span className="truncate">{issue.dominantProductName}</span> : null}
        </Facts>
      </Link>
    </li>
  );
}

/** Grouped, worst-first issue list. Groups with nothing in them are omitted, not shown empty. */
export function IssueList({
  issues,
  selectedId,
}: {
  issues: readonly ReviewIssueView[];
  selectedId: string | null;
}) {
  const groups = groupIssues(issues);
  return (
    <div aria-label="반복 이슈 목록" role="region" className="space-y-5">
      {groups.map((group) => (
        <section key={group.key}>
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-base font-bold text-ink">{group.heading}</h2>
            <span className="text-sm font-semibold tabular-nums text-muted">{group.issues.length}</span>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {group.issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} selected={issue.id === selectedId} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

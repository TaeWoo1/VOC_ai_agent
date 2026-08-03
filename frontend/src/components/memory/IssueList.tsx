import { Link } from "react-router-dom";
import type { ReviewIssueView } from "../../lib/types";
import { SEVERITY_LABEL_KO, changeBadges } from "../../lib/reviewIssuesView";
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
  return (
    <li>
      <Link
        to={`/memory/${issue.id}`}
        aria-current={selected ? "true" : undefined}
        className={`block px-4 py-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700 ${
          selected ? "bg-brand-50" : "hover:bg-canvas"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted">
            {issue.lifecycleLabelKo}
          </span>
          <span className="text-xs font-medium text-muted">
            심각도 {SEVERITY_LABEL_KO[issue.severity]}
          </span>
        </div>

        <p className="mt-2 break-keep font-semibold text-ink">{issue.title}</p>

        {badges.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge.kind}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[badge.tone]}`}
              >
                {badge.labelKo}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{evidenceCountLabel(issue)}</span>
          {lastSeen ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{lastSeen}</span>
            </>
          ) : null}
          {issue.dominantProductName ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{issue.dominantProductName}</span>
            </>
          ) : null}
        </div>
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
    <div aria-label="반복 이슈 목록" role="region">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="border-b border-line bg-canvas px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {group.heading}
          </h2>
          <ul className="divide-y divide-line">
            {group.issues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} selected={issue.id === selectedId} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

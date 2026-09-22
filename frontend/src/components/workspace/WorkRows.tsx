import { DecisionList, DecisionRow } from "../ui/DecisionRow";
import { selectionHref } from "./MasterDetail";
import { isOldBacklog, type HomeWorkRow } from "../../lib/homeWork";
import { waitLabel } from "../../lib/copy/customerOps";
import type { CaseQueueState } from "../../pages/app/OperationsCase";

/**
 * The rows of 확인할 일 — on 오늘 (the first few) and on the queue (all of them) — drawn once, here.
 *
 * <p><b>No row carries a button.</b> Every row used to end in 「검토」 — twenty-seven identical controls, the first one
 * solid, on a list whose rows were already links. A row is now a selection: on a wide screen it opens the item in the
 * pane beside the list, where the one primary action lives; on a narrow one it opens the item's own screen, exactly
 * as before.
 *
 * <p><b>The two groups are drawn, not just sorted.</b> {@link isOldBacklog} has ordered this list inside two groups
 * since the Demo Core freeze; a year-plus backlog row still waited in the same unbroken list, at the same weight as
 * this month's. A divider now says where the old ones start. Nothing is hidden, folded or re-ordered.
 */
export function WorkRows({
  rows,
  selectedKey,
  wide,
  search,
  now,
  ariaLabel,
  showBacklogDivider = true,
}: {
  rows: HomeWorkRow[];
  selectedKey: string | null;
  wide: boolean;
  /** The page's current query string, kept on every selection link. */
  search: string;
  now?: Date;
  ariaLabel: string;
  showBacklogDivider?: boolean;
}) {
  const caseIds = rows.map((r) => r.caseId).filter((id): id is string => id !== null);
  const firstOld = showBacklogDivider ? rows.findIndex((r) => isOldBacklog(r, now ?? new Date())) : -1;
  const oldCount = firstOld >= 0 ? rows.length - firstOld : 0;

  const draw = (row: HomeWorkRow) => {
    // A review opened on its own page from here offers the way back to here.
    const fullScreen = row.kind === "REVIEW" ? `${row.to}?from=work` : row.to;
    return (
      <DecisionRow
        key={row.key}
        tone={row.reason.tone}
        icon={row.reason.icon}
        tag={row.reason.tag}
        source={row.source}
        title={row.title}
        line={row.line}
        wait={waitLabel(row.since, now)}
        to={selectionHref(wide, row.key, fullScreen, search)}
        state={!wide && row.caseId ? ({ caseIds } satisfies CaseQueueState) : undefined}
        selected={wide && row.key === selectedKey}
      />
    );
  };

  if (firstOld <= 0) {
    return <DecisionList ariaLabel={ariaLabel}>{rows.map(draw)}</DecisionList>;
  }
  return (
    <div className="space-y-4">
      <DecisionList ariaLabel={ariaLabel}>{rows.slice(0, firstOld).map(draw)}</DecisionList>
      <p className="flex items-center gap-3 text-sm font-semibold text-muted" role="separator">
        <span>1년 넘게 기다린 것 {oldCount.toLocaleString("ko-KR")}건</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
      </p>
      <DecisionList ariaLabel={`${ariaLabel} · 1년 넘게 기다린 것`}>{rows.slice(firstOld).map(draw)}</DecisionList>
    </div>
  );
}

/** The row the pane shows: the one in the URL when it is still in the list, otherwise the first. */
export function selectedRow(rows: HomeWorkRow[], key: string | null): HomeWorkRow | null {
  return (key ? rows.find((r) => r.key === key) : undefined) ?? rows[0] ?? null;
}

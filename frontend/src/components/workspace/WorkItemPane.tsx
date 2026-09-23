import { Link } from "react-router-dom";
import { Facts } from "../ui/ObjectRow";
import { CaseLayout, type PaneDepth } from "./CaseLayout";
import { InquiryResponsePanel } from "../inbox/InquiryResponsePanel";
import { OperationsCaseView } from "../../pages/app/OperationsCase";
import { ReviewCaseView } from "../../pages/app/ReviewReplyTask";
import { waitLabel } from "../../lib/copy/customerOps";
import type { HomeWorkRow } from "../../lib/homeWork";

/**
 * <b>The right-hand pane of 확인할 일 and 오늘</b> — the selected row, drawn where the seller already is.
 *
 * <p>Each kind is drawn by the screen that owns it, in its pane reading: a case by the case screen, a review by the
 * Review Case, an inquiry by the same response panel 문의 uses. Nothing is re-implemented here, so deciding in the
 * pane and deciding on the full page are the same reads and the same writes. `key` forces a clean mount per item: a
 * half-written draft must never follow the seller to the next row.
 *
 * <p><b>{@link PaneDepth} decides how much of that screen unfolds</b> (Home v3.1). At 「full」 the pane is the
 * workspace, as it has been. At 「preview」 every form is left to the screen that owns it and the pane answers the
 * questions a seller asks before opening anything — what this is, why it was brought up, what was checked, what is
 * recommended — with one way in docked under it. Same components, same state; what differs is what is offered,
 * never what is true.
 */
export function WorkItemPane({ row, now, depth = "full" }: { row: HomeWorkRow; now?: Date; depth?: PaneDepth }) {
  if (row.kind === "CASE") {
    return <OperationsCaseView key={row.key} caseId={row.subjectId} variant="pane" depth={depth} />;
  }
  if (row.kind === "REVIEW") {
    return <ReviewCaseView key={row.key} reviewId={row.subjectId} variant="pane" depth={depth} />;
  }
  const wait = waitLabel(row.since, now);
  return (
    <CaseLayout
      key={row.key}
      variant="pane"
      depth={depth}
      decisionLabel="판매자의 결정"
      // The response panel prints the channel and the time with the question; drawn here too it was the same line
      // twice, one block apart. Kept only when there is no panel to say it.
      meta={
        row.workItemId === null ? (
          <Facts>
            <span>{row.source}</span>
            {wait ? <span className="tabular-nums">{wait}</span> : null}
          </Facts>
        ) : undefined
      }
      title={row.title}
      titleHidden={row.workItemId !== null}
      headerAction={
        <Link to={`/inquiries/${row.subjectId}`} className="rounded font-semibold text-muted hover:text-ink hover:underline">
          문의에서 보기
        </Link>
      }
      decision={
        // <b>An inquiry's pane keeps its panel at either depth</b>, and that is not an exception to the preview
        // rule — it is the rule reading correctly. What a preview leaves out are the JUDGMENT forms, and this row
        // has none: the response panel is the reply lane itself, and the row carries only a truncated first line,
        // so a preview of it would be a title with an ellipsis and a button. Rendered once at 440px it was exactly
        // that — an empty pane where the work used to be. See {@link paneCarriesOwnAction}, which is how the dock
        // knows not to put a second solid beside this one.
        row.workItemId ? (
          <InquiryResponsePanel workItemId={row.workItemId} />
        ) : (
          <p className="break-keep text-sm leading-relaxed text-muted">
            이 문의에는 reviewnary가 답변 방향을 제안할 수 없습니다. 답변은 해당 채널의 판매자센터에서 직접 작성합니다.
          </p>
        )
      }
    />
  );
}

/** Where the pane's docked action takes the seller: the full screen that owns the row. */
export function workItemFullScreen(row: HomeWorkRow): string {
  if (row.kind === "CASE") return `/customer-operations/cases/${row.subjectId}`;
  if (row.kind === "REVIEW") return `/reviews/reply/${row.subjectId}?from=work`;
  return `/inquiries/${row.subjectId}`;
}

/**
 * Whether this row's pane offers something to press of its own — so the docked action is the way out
 * rather than the thing to do, and the pane still has exactly one solid.
 */
export function paneCarriesOwnAction(row: HomeWorkRow): boolean {
  return row.kind === "INQUIRY" && row.workItemId !== null;
}

import { Link } from "react-router-dom";
import { Facts } from "../ui/ObjectRow";
import { CaseLayout } from "./CaseLayout";
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
 */
export function WorkItemPane({ row, now }: { row: HomeWorkRow; now?: Date }) {
  if (row.kind === "CASE") {
    return <OperationsCaseView key={row.key} caseId={row.subjectId} variant="pane" />;
  }
  if (row.kind === "REVIEW") {
    return <ReviewCaseView key={row.key} reviewId={row.subjectId} variant="pane" />;
  }
  const wait = waitLabel(row.since, now);
  return (
    <CaseLayout
      key={row.key}
      variant="pane"
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

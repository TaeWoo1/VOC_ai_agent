import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { DecisionList, DecisionRow } from "../../components/ui/DecisionRow";
import { api } from "../../lib/apiClient";
import { caseWorkRow, type HomeWorkRow } from "../../lib/homeWork";
import { COPY, waitLabel, waitSince } from "../../lib/copy/customerOps";
import type { CaseQueueState } from "./OperationsCase";

const TITLE = "확인 필요";
const DESCRIPTION = "문의와 리뷰를 함께, 기다린 순서대로 봅니다.";

/**
 * <b>The queue</b> — every case waiting for the seller's decision, in one list.
 *
 * <p>The Home briefs the first few of exactly this list; this screen is the rest of it. Both draw their rows with
 * {@link caseWorkRow} from one backend read, so the list the seller is briefed with and the list they work through
 * cannot name different work.
 *
 * <p><b>문의와 리뷰를 가르지 않는다.</b> A case is a case: what the row says comes from the decision it carries, and
 * its subject kind is one fact in the row rather than the list it belongs to. Every row opens the case screen, which
 * carries this whole queue so 「다음 건」 walks the morning instead of stopping at the briefing's edge.
 *
 * <p><b>Nothing here decides anything.</b> No control on this screen resolves, dismisses or sends; the case screen
 * and the inquiry/review screens it links to still own every write.
 */
export function OperationsCaseQueue({ now }: { now?: Date }) {
  const [work, setWork] = useState<{ rows: HomeWorkRow[]; total: number } | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api
      .getCustomerOperationsDecisions()
      .then((d) => {
        if (!live) return;
        const rows = d.rows.map(caseWorkRow).sort((a, b) => waitSince(a.since) - waitSince(b.since));
        setWork({ rows, total: d.total });
      })
      .catch(() => {
        if (live) setWork(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const caseIds = (work?.rows ?? []).map((r) => r.caseId).filter((id): id is string => id !== null);

  return (
    <div className="space-y-5">
      <PageHead title={TITLE} description={DESCRIPTION} />

      {work === undefined ? <p className="text-sm text-muted">불러오는 중입니다.</p> : null}

      {/* A failed read says so. An empty list and a list we could not read are different sentences, and only one of
          them is good news. */}
      {work === null ? (
        <p className="text-sm text-bad" role="alert">
          확인 필요 목록을 불러오지 못했습니다.
        </p>
      ) : null}

      {work && work.rows.length === 0 ? (
        <p className="break-keep leading-relaxed text-ink">지금 확인이 필요한 문의나 리뷰가 없습니다.</p>
      ) : null}

      {work && work.rows.length > 0 ? (
        <section aria-label={TITLE}>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-[#E6E9ED] px-2 text-xs font-semibold leading-[21px] text-muted">
              {COPY.listOrder}
            </span>
            <span className="text-sm text-muted">{work.rows.length.toLocaleString("ko-KR")}건</span>
          </div>
          <DecisionList ariaLabel={TITLE}>
            {work.rows.map((row, i) => (
              <DecisionRow
                key={row.key}
                tone={row.reason.tone}
                icon={row.reason.icon}
                tag={row.reason.tag}
                source={row.source}
                title={row.title}
                line={row.line}
                wait={waitLabel(row.since, now)}
                verb={row.verb}
                primary={i === 0}
                to={row.to}
                state={row.caseId ? ({ caseIds } satisfies CaseQueueState) : undefined}
              />
            ))}
          </DecisionList>
          {/* `total` is counted over the same read as the rows, so a shortfall means this list is deeper than one
              read reaches — not that the rest is somewhere else. */}
          {work.total > work.rows.length ? (
            <p className="mt-3 break-keep text-sm text-muted">
              이 목록에 {work.total.toLocaleString("ko-KR")}건이 있고 {work.rows.length.toLocaleString("ko-KR")}건까지
              보여 드립니다. 처리하시면 다음 건이 올라옵니다.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

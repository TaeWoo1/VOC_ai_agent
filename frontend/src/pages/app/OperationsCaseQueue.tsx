import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { DecisionList, DecisionRow } from "../../components/ui/DecisionRow";
import { api } from "../../lib/apiClient";
import { mergeHomeWork, type HomeWork } from "../../lib/homeWork";
import { HOME_QUEUE_SIZE } from "../../components/customerOperations/CustomerOpsHome";
import { COPY, waitLabel } from "../../lib/copy/customerOps";
import type { CaseQueueState } from "./OperationsCase";

const TITLE = "확인 필요";
const DESCRIPTION = "문의와 리뷰를 함께, 기다린 순서대로 봅니다.";

/**
 * <b>The queue</b> — everything waiting for the seller's decision, in one list.
 *
 * <p>The Home briefs the first few of exactly this list; this screen is the rest of it. <b>That sentence was
 * false.</b> The Home's 「확인 필요」 has been {@link mergeHomeWork} — cases, the reviews triage marked 지금 확인, and
 * the inquiry work queue, deduplicated by owning screen — since Customer Operations v3.1, while this screen read
 * cases alone. Measured on the demo org: the Home said 27건 and 확인할 일, the sidebar entry a seller reaches for
 * first, said 1건. Two screens under one name, one of them missing twenty-six items.
 *
 * <p>So it draws the same list, with the same composer. The only difference left is depth: the case half comes from
 * the dedicated decisions read rather than the Home's briefing-sized slice, because this screen exists to be the
 * whole of what the Home shortens.
 *
 * <p><b>A partial read is drawn, not refused.</b> Four reads answer this list and they fail independently; showing
 * nothing because one of them failed would hide work that was read successfully. Only a list where nothing could be
 * read at all says so.
 *
 * <p><b>문의와 리뷰를 가르지 않는다.</b> What a row says comes from the decision it carries, and its subject kind is
 * one fact in the row rather than the list it belongs to. A case opens the case screen, which carries this whole
 * queue so 「다음 건」 walks the morning; everything else opens the screen that owns it.
 *
 * <p><b>Nothing here decides anything.</b> No control on this screen resolves, dismisses or sends; the case screen
 * and the inquiry/review screens it links to still own every write.
 */
export function OperationsCaseQueue({ now }: { now?: Date }) {
  const [work, setWork] = useState<HomeWork | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const nothing = <T,>() => (p: Promise<T>) => p.catch(() => null);
    Promise.all([
      nothing<Awaited<ReturnType<typeof api.getCustomerOperationsHome>>>()(api.getCustomerOperationsHome()),
      nothing<Awaited<ReturnType<typeof api.getCustomerOperationsDecisions>>>()(api.getCustomerOperationsDecisions()),
      nothing<Awaited<ReturnType<typeof api.getOperationsHomeStrict>>>()(api.getOperationsHomeStrict()),
      nothing<Awaited<ReturnType<typeof api.getInquiryQueueStrict>>>()(
        api.getInquiryQueueStrict({ size: HOME_QUEUE_SIZE }),
      ),
    ]).then(([co, decisions, ops, queue]) => {
      if (!live) return;
      if (!co && !decisions && !ops && !queue) {
        setWork(null);
        return;
      }
      // The deep case list replaces the Home's briefing slice; everything else is read exactly as the Home reads it.
      const merged = co ? (decisions ? { ...co, decisions } : co) : null;
      setWork(mergeHomeWork(merged, ops, queue, now));
    });
    return () => {
      live = false;
    };
  }, [now]);

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
          {/* A read that reported more than it returned. The shortfall means this list is deeper than one read
              reaches — not that the rest is somewhere else — so it says so instead of passing its length off as
              the total. How many more it cannot say: the reads that overflowed count different populations. */}
          {work.truncated ? (
            <p className="mt-3 break-keep text-sm text-muted">
              한 번에 {work.rows.length.toLocaleString("ko-KR")}건까지 보여 드립니다. 처리하시면 다음 건이 올라옵니다.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

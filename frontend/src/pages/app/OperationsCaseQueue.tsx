import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Facts } from "../../components/ui/ObjectRow";
import { MasterDetail, useWideLayout } from "../../components/workspace/MasterDetail";
import { WorkRows, selectedRow } from "../../components/workspace/WorkRows";
import { WorkItemPane } from "../../components/workspace/WorkItemPane";
import { api } from "../../lib/apiClient";
import { mergeHomeWork, reasonCounts, type HomeWork } from "../../lib/homeWork";
import { HOME_QUEUE_SIZE } from "../../components/customerOperations/CustomerOpsHome";
import { COPY } from "../../lib/copy/customerOps";
import { ReplyWorkHistory } from "../../components/customerOperations/ReplyWorkHistory";
import { attentionUncertaintyCopy } from "../../lib/attention";
import type { ReviewWorkView } from "../../lib/types";

/** One name for one list: the nav entry, this page's title and the Home's section all say 확인할 일 (UI/UX v2). */
const TITLE = COPY.listTitle;
/** The scope label: what this count counts, so it is not read against the 리뷰 or 문의 screens' own numbers. */
const DESCRIPTION = "판매자님의 결정을 기다리는 문의와 리뷰입니다. 오래 기다린 것부터 봅니다.";

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
 *
 * <p><b>Master-detail (UI/UX v2 Phase 1).</b> On a wide screen the selected row opens beside the list — drawn by the
 * very screen that owns it ({@link WorkItemPane}) — so the morning is worked without leaving the list. The first row
 * is selected when nothing is, because an empty right half is a page waiting for a click.
 */
export function OperationsCaseQueue({ now }: { now?: Date }) {
  const [work, setWork] = useState<HomeWork | null | undefined>(undefined);
  const [reviewWork, setReviewWork] = useState<ReviewWorkView | null>(null);
  // Bumped when a set-aside review is restored below, so it comes back into this list without a reload.
  const [reloadKey, setReloadKey] = useState(0);
  const wide = useWideLayout();
  const location = useLocation();
  const [params] = useSearchParams();

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
      // The review half, whole (UI/UX v2 Phase 3): every undecided 확인 필요 review, and the seller's own reply work
      // before approval — the items the 리뷰 screen's 「내 답변 작업」 used to be the only home of.
      nothing<Awaited<ReturnType<typeof api.getReviewWorkStrict>>>()(
        Promise.resolve().then(() => api.getReviewWorkStrict()),
      ),
    ]).then(([co, decisions, ops, queue, reviewWork]) => {
      if (!live) return;
      if (!co && !decisions && !ops && !queue && !reviewWork) {
        setWork(null);
        return;
      }
      // The deep case list replaces the Home's briefing slice; everything else is read exactly as the Home reads it.
      const merged = co ? (decisions ? { ...co, decisions } : co) : null;
      setWork(mergeHomeWork(merged, ops, queue, now, reviewWork));
      setReviewWork(reviewWork);
    });
    return () => {
      live = false;
    };
  }, [now, reloadKey]);

  const rows = work?.rows ?? [];
  const selected = wide ? selectedRow(rows, params.get("item")) : null;

  const list = (
    <>
      <PageHead
        title={TITLE}
        description={DESCRIPTION}
        meta={
          work && rows.length > 0 ? (
            <Facts className="text-sm text-muted">
              <span className="font-semibold text-ink">
                {rows.length.toLocaleString("ko-KR")}
                {work.truncated ? "+" : ""}건
              </span>
              {reasonCounts(rows).map((part) => (
                <span key={part}>{part}</span>
              ))}
              <span>{COPY.listOrder}</span>
            </Facts>
          ) : undefined
        }
      />

      {work === undefined ? <p className="text-sm text-muted">불러오는 중입니다.</p> : null}

      {/* An account whose reply work cannot be attributed declines to answer rather than reading as 「no work」 —
          the same copy the 리뷰 screen's 「내 답변 작업」 used, moved with the work (UI/UX v2 Phase 3). */}
      {(reviewWork?.committed ?? []).map((account) => {
        const uncertain = attentionUncertaintyCopy(account.coverage ?? "COVERED");
        return uncertain ? (
          <div key={account.accountId} role="status" className="rounded-xl bg-warn/5 px-4 py-3" data-testid="reply-work-coverage-uncertain">
            <p className="text-sm font-semibold text-ink">
              {account.channelNameKo ?? account.channelCode}: {uncertain.headline}
            </p>
            <p className="mt-1 text-sm text-muted">{uncertain.detail}</p>
          </div>
        ) : null;
      })}

      {/* A failed read says so. An empty list and a list we could not read are different sentences, and only one of
          them is good news. */}
      {work === null ? (
        <p className="text-sm text-bad" role="alert">
          확인할 일 목록을 불러오지 못했습니다.
        </p>
      ) : null}

      {work && rows.length === 0 ? (
        <p className="break-keep leading-relaxed text-ink">지금 확인이 필요한 문의나 리뷰가 없습니다.</p>
      ) : null}

      {work && rows.length > 0 ? (
        <section aria-label={TITLE}>
          <WorkRows
            rows={rows}
            selectedKey={selected?.key ?? null}
            wide={wide}
            search={location.search}
            now={now}
            ariaLabel={TITLE}
          />
          {/* A read that reported more than it returned. The shortfall means this list is deeper than one read
              reaches — not that the rest is somewhere else — so it says so instead of passing its length off as
              the total. How many more it cannot say: the reads that overflowed count different populations. */}
          {work.truncated ? (
            <p className="mt-3 break-keep text-sm text-muted">
              한 번에 {rows.length.toLocaleString("ko-KR")}건까지 보여 드립니다. 처리하시면 다음 건이 올라옵니다.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* History, not work: what the seller reported posting, and what they set aside — with 복원. */}
      {reviewWork ? (
        <ReplyWorkHistory accounts={reviewWork.committed} onRestored={() => setReloadKey((n) => n + 1)} />
      ) : null}
    </>
  );

  return (
    <MasterDetail
      wide={wide}
      list={list}
      detailLabel="선택한 확인할 일"
      detail={selected ? <WorkItemPane row={selected} now={now} /> : null}
    />
  );
}

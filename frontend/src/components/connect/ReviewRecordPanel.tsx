import { Panel } from "../ui/Panel";
import { BtnLink } from "../ui/Btn";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { reviewEntryLabel, reviewRecordPath, reviewRecordSummary } from "../../lib/reviewRecord";

/**
 * 상품평 — the channel workspace's way into what this account collected.
 *
 * **It is a panel and not just the header button because the header button did not work.** Twice on
 * a live sitting a seller in front of this page could not find the record, and both times the run
 * only continued because someone else typed the URL. A small outline control in a row of page chrome
 * is findable by whoever put it there; a titled region that states how many 상품평 are waiting is
 * findable by the person the number belongs to.
 *
 * The count is read here rather than passed in, so a failure to read it stays local. It is rendered
 * only as words about the record, never as a gate: loading, empty, and unreadable all keep the same
 * link in the same place, because the one thing this panel exists to guarantee is that the way in is
 * always visible.
 */
export function ReviewRecordPanel({
  accountId,
  refreshKey = 0,
}: {
  accountId: string;
  refreshKey?: number;
}) {
  // `size: 1` — only the total is wanted. The reviews themselves belong to the page this links to.
  const { data, loading } = useApiData(
    () => api.getChannelReviewsStrict(accountId, { size: 1 }),
    [accountId, refreshKey],
  );
  const count = data?.total ?? null;

  return (
    <Panel
      title="상품평"
      description={
        loading ? "수집한 상품평을 확인하는 중입니다." : reviewRecordSummary(count)
      }
      action={
        <BtnLink to={reviewRecordPath(accountId)} size="sm">
          {reviewEntryLabel(loading ? null : count)}
        </BtnLink>
      }
    >
      <p className="break-keep text-base leading-relaxed text-muted">
        상품평을 고르면 전체 내용을 읽고, 그 상품평이 쿠팡 화면 어디에 있는지 찾아 볼 수 있습니다.
        쿠팡은 판매자 답글 기능이 없어 답변 작성 기능은 제공하지 않습니다.
      </p>
    </Panel>
  );
}

import { Panel } from "../ui/Panel";
import { BtnLink } from "../ui/Btn";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import {
  reviewEntryLabel,
  reviewRecordNote,
  reviewRecordPath,
  reviewRecordSummary,
  reviewWord,
} from "../../lib/reviewRecord";

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
  channelCode,
  refreshKey = 0,
}: {
  accountId: string;
  /** Whose record this is. Only this channel's own note may be printed under it. */
  channelCode?: string | null;
  refreshKey?: number;
}) {
  // `size: 1` — only the total is wanted. The reviews themselves belong to the page this links to.
  const { data, loading, error } = useApiData(
    () => api.getChannelReviewsStrict(accountId, { size: 1 }),
    [accountId, refreshKey],
  );
  /**
   * **`error` is read, and that is load-bearing.** `useApiData` keeps the last successful `data`
   * across a re-read, so a refetch that fails — and this panel refetches, on every `refreshKey` bump
   * the workspace's four child sections can cause — would otherwise keep stating the previous total
   * as current. On a changed account it would state the PREVIOUS account's total beside a link to
   * this one. A failed read is not zero reviews, and it is not the old number either.
   */
  const count = error ? null : data?.total ?? null;
  const note = reviewRecordNote(channelCode);
  const word = reviewWord(channelCode);

  return (
    <Panel
      title={word}
      description={
        loading ? `수집한 ${word} 수를 확인하는 중입니다.` : reviewRecordSummary(count, channelCode)
      }
      action={
        // Outline: the panel is already the loud thing on the page — a titled region stating how many
        // 상품평 are waiting. The page's one solid action stays in the header.
        <BtnLink to={reviewRecordPath(accountId)} size="sm" variant="outline">
          {reviewEntryLabel(loading ? null : count, channelCode)}
        </BtnLink>
      }
    >
      {note ? (
        <p className="break-keep text-base leading-relaxed text-muted">{note}</p>
      ) : (
        <p className="break-keep text-base leading-relaxed text-muted">
          이 채널에서 수집한 구매자 {word} 기록입니다.
        </p>
      )}
    </Panel>
  );
}

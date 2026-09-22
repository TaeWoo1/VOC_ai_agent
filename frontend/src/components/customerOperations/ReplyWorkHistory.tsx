import { useState } from "react";
import { DismissedReplyWork } from "../DismissedReplyWork";
import { Disclosure } from "../ui/Disclosure";
import { ReplyWorkRow } from "../reviews/ReplyWorkRow";
import type { ReviewWorkAccount } from "../../lib/types";

/**
 * <b>History of the seller's reply work, under 확인할 일</b> (UI/UX v2 Phase 3).
 *
 * <p>The 리뷰 screen's 「내 답변 작업」 carried two things that are not work: the replies the seller reported
 * posting (최근에 기록한 답변), and the reviews they set aside with 복원 (제외한 작업). The work itself moved into
 * 확인할 일's rows; these two move here, below it, per account — separate lists, never merged, each read the way it
 * always was. Nothing here is counted as work.
 *
 * <p>「답변했다고 기록」 is still paired with 「확인 안 함」: a public reply has no read-back oracle.
 *
 * <p><b>Folded</b> (Phase 4): history sits under the active work as a secondary, collapsed region — it is where a
 * seller goes to undo, not where the morning is worked.
 */
export function ReplyWorkHistory({
  accounts,
  onRestored,
}: {
  accounts: ReviewWorkAccount[];
  /** A review was put back in the to-do — the list above should read again. */
  onRestored?: () => void;
}) {
  const [restored, setRestored] = useState(0);
  if (accounts.length === 0) return null;
  return (
    <section aria-label="지난 답변 작업" className="pt-2">
      <Disclosure label={<h2 className="inline text-sm font-semibold text-muted">지난 답변 작업</h2>} note="기록한 답변 · 제외한 작업">
      <div className="mt-3 space-y-4">
      {accounts.map((account) => (
        <div key={account.accountId} className="space-y-3">
          {accounts.length > 1 ? (
            <p className="text-sm font-semibold text-muted">{account.channelNameKo ?? account.channelCode}</p>
          ) : null}
          {account.recentlyReported.length > 0 ? (
            <div data-testid="reply-work-recent">
              <h3 className="text-sm font-semibold text-ink">최근에 기록한 답변</h3>
              <p className="mt-1 text-sm text-muted">
                답변했다고 기록한 리뷰입니다. reviewnary는 채널에 실제로 등록됐는지 확인하지 않습니다(확인 안 함).
              </p>
              <ul className="mt-2 divide-y divide-line/70 overflow-hidden rounded-2xl border border-line bg-surface">
                {account.recentlyReported.map((item) => (
                  <li key={item.actionRef ?? item.reviewId}>
                    <ReplyWorkRow item={item} dim />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* Restoring puts a review back in the to-do, and the list above reads again. */}
          <DismissedReplyWork accountId={account.accountId} refreshSignal={restored} onRestored={() => {
              setRestored((n) => n + 1);
              onRestored?.();
            }} />
        </div>
      ))}
      </div>
      </Disclosure>
    </section>
  );
}

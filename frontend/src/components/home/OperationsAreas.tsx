import { Link } from "react-router-dom";
import {
  collectionLines,
  preparedLine,
  problemLine,
  reviewWorkLine,
  watchLine,
} from "../../lib/operationsHome";
import { RepeatedProblemList } from "./RepeatedProblemList";
import { PreparedWorkList } from "./PreparedWorkList";
import { ratingLabel } from "../../lib/reviewRecord";
import type { OperationsHome } from "../../lib/types";

/**
 * <b>Operations Home — the four things a seller should see before they ask anything.</b>
 *
 * <p>지금 확인할 리뷰 · 반복 문제 · 최근 수집 상태 · 준비된 작업. Each area states one fact and hands
 * the work to the surface that owns it; none of them decides anything here, because a Home that could
 * also decide would be a second door onto every decision in the product.
 *
 * <p><b>Urgency is never invented, and three habits enforce that.</b>
 * <ul>
 *   <li><b>No area is ranked against another.</b> They sit side by side in a fixed order, because
 *       weighing a review against a stale channel would need a number nobody measured.</li>
 *   <li><b>「문제 N개」와 「지금 결정 필요 N개」가 다른 문장이다.</b> The tier total and the undecided
 *       count are different facts and are printed as different sentences; 관찰 중 problems are stated
 *       and never drawn as tasks.</li>
 *   <li><b>An area with nothing to say says so in one quiet line, and does not grow.</b></li>
 * </ul>
 *
 * <p><b>This does not replace the conversation.</b> It sits above the thread: chat-first, not
 * chat-only. Every row is a link out, so the Home is where a morning starts and never where it ends.
 */
export function OperationsAreas({ home }: { home: OperationsHome }) {
  const { reviews, problems, prepared, collection } = home;
  const watch = watchLine(reviews);
  const preparedSentence = preparedLine(prepared);
  const channels = collectionLines(collection);

  return (
    <div className="space-y-5" aria-label="오늘 확인할 것">
      {/* 1 — 지금 확인할 리뷰 */}
      <Area title="지금 확인할 리뷰" to="/reviews" linkLabel="리뷰 기록 열기">
        <p className="break-keep leading-relaxed text-ink">{reviewWorkLine(reviews)}</p>
        {reviews.rows.length > 0 ? (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {reviews.rows.map((row) => (
              <li key={row.reviewId} className="p-3">
                <Link
                  to={`/reviews/reply/${row.reviewId}`}
                  className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                >
                  {/* The customer's own sentence leads — it is the reason to open the row. A masked
                      preview that survived nothing is null and the row falls back to its facts. */}
                  {row.quote ? (
                    <p className="break-keep text-sm leading-relaxed text-ink">「{row.quote}」</p>
                  ) : (
                    <p className="break-keep text-sm leading-relaxed text-muted">
                      본문을 표시할 수 없는 리뷰입니다.
                    </p>
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                    <span className="tabular-nums">{row.occurredOn ?? "날짜 없음"}</span>
                    <span className="tabular-nums">{ratingLabel(row.rating)}</span>
                    {row.productName ? <span className="break-keep">{row.productName}</span> : null}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {/* The observation signal, stated apart from the work above it and never added to it. */}
        {watch ? <p className="mt-3 break-keep text-sm leading-relaxed text-muted">{watch}</p> : null}
      </Area>

      {/* 2 — 반복 문제 */}
      <Area title="반복 문제" to="/memory" linkLabel="고객운영 메모리 열기">
        <p className="break-keep leading-relaxed text-ink">{problemLine(problems)}</p>
        {/* The rows are shared with 고객 운영 관리's Home — see RepeatedProblemList for why there is one renderer. */}
        <RepeatedProblemList rows={problems.rows} />
      </Area>

      {/*
        3 and 4 share a row from 1152 up. Both are short — three channel lines and a handful of
        prepared rows — and stacking them cost the page 250px that pushed them under the fold on every
        width. Below 1152 they stack, because two columns that narrow would wrap a channel name.
      */}
      <div className="grid gap-5 lg:grid-cols-2">
      {/* 3 — 최근 수집 상태 */}
      <Area title="최근 수집 상태" to="/connect" linkLabel="채널 연결 열기">
        {channels.length === 0 ? (
          <p className="break-keep leading-relaxed text-muted">아직 연결된 판매 채널이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {channels.map((line) => (
              <li key={line.channelCode} className="flex flex-wrap items-baseline gap-x-2">
                <span className="break-keep font-medium text-ink">{line.channelNameKo}</span>
                <span
                  className={`break-keep text-sm tabular-nums ${line.warn ? "text-warn" : "text-muted"}`}
                >
                  {line.sentence}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Area>

      {/* 4 — 준비된 작업 */}
      <Area title="준비된 작업">
        {preparedSentence ? (
          <p className="break-keep leading-relaxed text-ink">{preparedSentence}</p>
        ) : (
          // Nothing prepared is a complete answer. The area does not offer to prepare something,
          // because nothing here may create work that no record supports.
          <p className="break-keep leading-relaxed text-muted">지금 준비된 작업은 없습니다.</p>
        )}
        {/* The rows are shared with 고객 운영 관리's 실행 대기 — see PreparedWorkList for why one renderer. */}
        <PreparedWorkList rows={prepared.rows} />
      </Area>
      </div>
    </div>
  );
}

/** One area: a heading, its content, and at most one way out. */
function Area({
  title,
  to,
  linkLabel,
  children,
}: {
  title: string;
  to?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        {to && linkLabel ? (
          <Link
            to={to}
            className="rounded text-sm font-semibold text-brand-700 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            {linkLabel}
          </Link>
        ) : null}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

import { Link } from "react-router-dom";
import { BtnLink } from "../ui/Btn";
import { Disclosure } from "../ui/Disclosure";
import { Status, type StatusTone } from "../ui/Status";
import {
  actionKo,
  decisionsLine,
  dispositionWord,
  gapRowLine,
  handledLine,
  kstClock,
  sourceHealthLine,
  subjectFallback,
  subjectKindKo,
  unobservedLine,
  VERIFYING_WORD,
} from "../../lib/customerOperations";
import type { CustomerOperationsDecisionRow, CustomerOperationsHome } from "../../lib/customerOperationsTypes";

const TONE_TEXT: Record<StatusTone, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-brand-700",
  neutral: "text-muted",
};

/**
 * <b>The three exception areas of 「고객 운영 관리」.</b> Each area is one population and none is added to another:
 *
 * <ol>
 *   <li><b>내 결정 필요</b> — open customer cases the seller has to decide, still waiting on the canonical record.</li>
 *   <li><b>Reviewnary가 정리하거나 준비한 일</b> — what was closed, watched or drafted. Folded: it is not a request.</li>
 *   <li><b>Reviewnary가 제대로 확인하지 못한 곳</b> — sources to reconnect, then the last check's facts per source.</li>
 * </ol>
 *
 * Every row hands the work to the screen that already owns the decision; nothing here resolves, dismisses or sends.
 */
export function CustomerOperationsExceptions({
  home,
  now,
  headingLevel = "h3",
}: {
  home: CustomerOperationsHome;
  now?: Date;
  headingLevel?: "h2" | "h3";
}) {
  return (
    <div className="space-y-5">
      <Area title="내 결정 필요" level={headingLevel}>
        <p className="break-keep leading-relaxed text-ink">{decisionsLine(home.decisions.total)}</p>
        {home.decisions.rows.length > 0 ? (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
            {home.decisions.rows.map((row) => (
              <DecisionItem key={row.caseId} row={row} />
            ))}
          </ul>
        ) : null}
        {/* The rest of this list is the rest of THIS list — not two other screens. Sending the seller to 문의 and
            리뷰 to find it was the split this area exists to remove. */}
        {home.decisions.total > home.decisions.rows.length ? (
          <p className="mt-2 text-sm">
            <Link
              to="/customer-operations/cases"
              className="font-medium text-brand-700 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            >
              나머지 {(home.decisions.total - home.decisions.rows.length).toLocaleString("ko-KR")}건 보기
            </Link>
          </p>
        ) : null}
      </Area>

      <Area title="Reviewnary가 정리하거나 준비한 일" level={headingLevel}>
        <p className="break-keep leading-relaxed text-ink">{handledLine(home.handled)}</p>
        {home.handled.rows.length > 0 ? (
          <Disclosure label="정리한 일 보기" note={`${home.handled.rows.length}건`} className="mt-2">
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
              {home.handled.rows.map((row) => {
                const word = row.verifying || row.disposition === "NEEDS_DECISION" ? VERIFYING_WORD : dispositionWord(row.disposition);
                return (
                  <li key={row.caseId} className="p-3">
                    <Link
                      to={row.to}
                      className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                    >
                      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                        <Status variant="word" tone={word.tone}>
                          {word.label}
                        </Status>
                        <span>{subjectKindKo(row.subjectKind)}</span>
                        {row.channelNameKo ? <span>{row.channelNameKo}</span> : null}
                        {row.rating !== null ? <span>별점 {row.rating}점</span> : null}
                      </p>
                      <p className="mt-1 break-keep text-ink">{row.title ?? subjectFallback(row.subjectKind)}</p>
                      {/* The area's headline already states what «처리 확인 중» means; a row repeating that
                          sentence would say one fact twice. The row says what the case is about instead. */}
                      <p className="mt-1 break-keep text-sm text-muted">{row.summary ?? row.reasonNote}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Disclosure>
        ) : null}
      </Area>

      <Area title="Reviewnary가 제대로 확인하지 못한 곳" level={headingLevel}>
        <p className="break-keep leading-relaxed text-ink">{unobservedLine(home)}</p>
        {home.gaps.rows.length > 0 ? (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
            {home.gaps.rows.map((row) => (
              <li key={row.caseId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="break-keep font-medium text-ink">{gapRowLine(row)}</p>
                  <p className="text-sm text-muted">{kstClock(row.since, now) ?? "최근"}부터</p>
                </div>
                <BtnLink to={row.to} size="sm" variant="outline">
                  다시 연결하기
                </BtnLink>
              </li>
            ))}
          </ul>
        ) : null}
        {home.sources.length > 0 ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-ink">
              지난 확인{home.lastCheckedAt ? ` · ${kstClock(home.lastCheckedAt, now)}` : ""}
            </p>
            <ul className="mt-1 space-y-1">
              {home.sources.map((source) => {
                const line = sourceHealthLine(source);
                return (
                  <li key={`${source.channelCode}-${source.dataType}`} className={`break-keep text-sm ${TONE_TEXT[line.tone]}`}>
                    {line.text}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </Area>
    </div>
  );
}

function DecisionItem({ row }: { row: CustomerOperationsDecisionRow }) {
  const action = actionKo(row.recommendedActionType);
  // The case screen is where this row's whole story is — what was investigated, which company knowledge was used,
  // and the [정보 알려주기] when knowledge is what is missing. The owning inquiry/review screen is one link inside it.
  return (
    <li className="p-3">
      <Link
        to={`/customer-operations/cases/${row.caseId}`}
        className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      >
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span>{subjectKindKo(row.subjectKind)}</span>
          {row.channelNameKo ? <span>{row.channelNameKo}</span> : null}
          {row.rating !== null ? <span>별점 {row.rating}점</span> : null}
          {row.draftPrepared ? (
            <Status tone="info">초안 준비됨 · 아직 보내지 않음</Status>
          ) : null}
        </p>
        <p className="mt-1 break-keep font-semibold text-ink">{row.title ?? subjectFallback(row.subjectKind)}</p>
        <p className="mt-1 break-keep text-sm leading-relaxed text-ink">{row.summary ?? row.reasonNote}</p>
        {/* A prepared next step is shown whether or not it also fits one of the eight action types. The review lane
            names its step in the seller's own words and picks no type, and hiding the sentence because the label
            above it is missing would drop the more useful half. */}
        {action || row.recommendedAction ? (
          <p className="mt-1 break-keep text-sm text-muted">
            제안: {action ?? row.recommendedAction}
            {action && row.recommendedAction ? ` — ${row.recommendedAction}` : ""}
          </p>
        ) : null}
        {row.missingInformation.length > 0 ? (
          <p className="mt-1 break-keep text-sm text-muted">더 알아야 할 것: {row.missingInformation.join(", ")}</p>
        ) : null}
      </Link>
    </li>
  );
}

function Area({ title, level, children }: { title: string; level: "h2" | "h3"; children: React.ReactNode }) {
  const Heading = level;
  return (
    <section aria-label={title}>
      <Heading className="text-base font-bold text-ink">{title}</Heading>
      <div className="mt-2">{children}</div>
    </section>
  );
}

import { Link } from "react-router-dom";
import type { TodayItem } from "../../lib/todayInbox";
import { Panel } from "../ui/Panel";
import { BtnLink } from "../ui/Btn";
import { useAgentAvailability } from "../../hooks/useAgentAvailability";

/**
 * Today Inbox — the home's answer to "오늘 내가 확인하거나 조치할 일은 무엇인가?".
 *
 * Three items, always the same three, always in this order: 리뷰 · 문의 · 연결. Each item is a
 * count and the rows behind it, and every link on it lands on the screen that shows exactly that
 * count (`lib/todayInbox.ts` states the contract). A headline whose count no single screen shows
 * (several review accounts, or channels + alerts) is a heading, not a link — the exact links are
 * the per-channel shares under it. A count that could not be measured is a sentence, never 0.
 *
 * The agent assist appears ONLY when the operations runtime actually answered — never a disabled
 * button, never a "준비 중" label.
 */
export function TodayInbox({ items }: { items: readonly TodayItem[] }) {
  const agentReachable = useAgentAvailability();
  return (
    <Panel
      title="오늘 할 일"
      description="리뷰·문의·연결에서 지금 사람이 봐야 할 것만 모았습니다. 숫자는 각 화면이 세는 것과 같습니다."
      action={
        agentReachable ? (
          <BtnLink to="/agent" size="sm" variant="outline">
            운영 에이전트로 정리
          </BtnLink>
        ) : undefined
      }
    >
      <ol className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="py-4 first:pt-0 last:pb-0">
            <TodayItemView item={item} />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Count({ item }: { item: TodayItem }) {
  if (item.signal.kind !== "READY") {
    return <span className="break-keep text-base text-muted">{item.hint}</span>;
  }
  return (
    <span className="text-2xl font-bold tabular-nums text-ink">
      {item.signal.count}
      <span className="ml-1 text-base font-semibold text-muted">건</span>
    </span>
  );
}

function TodayItemView({ item }: { item: TodayItem }) {
  const headline = (
    <>
      <span className="break-keep text-base font-semibold text-ink">{item.label}</span>
      <Count item={item} />
    </>
  );
  return (
    <div>
      {item.to ? (
        <Link
          to={item.to}
          className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          {headline}
        </Link>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-3">{headline}</div>
      )}

      {item.breakdown.length > 0 ? (
        <ul aria-label={`${item.label} 채널별`} className="mt-2 flex flex-wrap gap-2">
          {item.breakdown.map((share) => (
            <li key={share.key}>
              <Link
                to={share.to}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-canvas px-3 text-sm font-medium text-ink transition hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
              >
                {share.label}
                <span className="tabular-nums text-muted">{share.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {item.note ? <p className="mt-2 break-keep text-sm text-muted">{item.note}</p> : null}

      {item.rows.length > 0 ? (
        <ul aria-label={`${item.label} 목록`} className="mt-3 divide-y divide-line rounded-xl border border-line">
          {item.rows.map((row) => (
            <li key={row.key}>
              <Link
                to={row.to}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
              >
                <span className="min-w-0 flex-1 truncate break-keep font-medium text-ink">{row.title}</span>
                <span className="shrink-0 text-xs text-muted">{row.meta}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : item.signal.kind === "READY" && item.signal.count === 0 ? (
        <p className="mt-2 break-keep text-sm text-muted">{quietLine(item.id)}</p>
      ) : null}
    </div>
  );
}

/** What an honest zero says. Never "정상" — a quiet list is not a health claim. */
function quietLine(id: TodayItem["id"]): string {
  switch (id) {
    case "reviews":
      return "지금 확인 필요로 분류된 리뷰가 없습니다.";
    case "inquiries":
      return "지금 답변을 기다리는 문의가 없습니다.";
    case "connections":
      return "지금 확인이 필요한 연결은 없습니다. 채널별 상태는 채널 연결에서 직접 확인하실 수 있습니다.";
  }
}

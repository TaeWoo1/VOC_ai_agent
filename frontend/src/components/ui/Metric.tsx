import type { ReactNode } from "react";
import type { MetricKpi } from "../../lib/types";
import { count, wonShort } from "../../lib/format";

/**
 * One headline number, sized to be read first.
 *
 * <b>Three layers of type, in a fixed order: label, number, caveat.</b> The audit's first finding was
 * that every card on every screen carried the same weight, so nothing was answered first. A metric is
 * the one element allowed to be loud, and it earns that by being a single number a seller acts on.
 *
 * <b>A delta is drawn only when the backend says one exists.</b> `comparable` is not a styling hint —
 * 미답변 문의 is today's backlog and there is no history to compare it against, so a component that
 * computed its own arrow would be inventing a trend.
 */
export function Metric({
  kpi,
  emphasis = false,
  onClick,
}: {
  kpi: MetricKpi;
  /** The one number this screen is about. At most one per screen. */
  emphasis?: boolean;
  onClick?: () => void;
}) {
  const value = kpi.unit === "원" ? wonShort(kpi.value) : count(kpi.value);
  const caveat = caveatFor(kpi);
  const body = (
    <>
      <p className="text-sm font-medium text-muted">{kpi.label}</p>
      <p className={`mt-1.5 font-bold tabular-nums text-ink ${emphasis ? "text-3xl" : "text-2xl"}`}>
        {value}
        <span className="ml-1 text-base font-semibold text-muted">{kpi.unit}</span>
      </p>
      <div className="mt-1.5 min-h-[1.25rem]">
        {kpi.comparable && kpi.deltaPercent !== null ? <Delta percent={kpi.deltaPercent} /> : null}
        {caveat ? <p className="break-keep text-sm text-warn">{caveat}</p> : null}
      </div>
    </>
  );

  const shell = `rounded-2xl border p-5 text-left ${
    emphasis ? "border-brand/30 bg-brand-50/40" : "border-line bg-surface"
  }`;
  if (!onClick) {
    return <div className={shell}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${shell} transition hover:border-brand/40 hover:bg-brand-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2`}
    >
      {body}
    </button>
  );
}

/**
 * The caveat line — what is NOT in this number.
 *
 * Ordered by severity: a channel missing from the total is a bigger qualification than a channel
 * whose freshness is unproven, and only one line fits. Both are shown as text rather than an icon,
 * because an icon would need a legend nobody reads.
 */
function caveatFor(kpi: MetricKpi): string | null {
  if (kpi.excludedChannels > 0) {
    return `채널 ${kpi.excludedChannels}곳이 이 숫자에 없습니다`;
  }
  if (kpi.freshnessUnproven) {
    return "최신 여부를 확인하지 못한 채널이 있습니다";
  }
  return null;
}

/**
 * Direction and magnitude — never a judgement.
 *
 * More inquiries is not "bad" and more negative reviews is not "good", and a component cannot know
 * which. The arrow says what changed; the seller decides what it means.
 */
function Delta({ percent }: { percent: number }) {
  if (percent === 0) {
    return <p className="text-sm text-muted">이전 기간과 같음</p>;
  }
  const up = percent > 0;
  return (
    <p className="text-sm text-muted">
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span className="ml-1 tabular-nums">{Math.abs(percent)}%</span>
      <span className="ml-1">{up ? "증가" : "감소"} (이전 기간 대비)</span>
    </p>
  );
}

/** A responsive row of metrics. Two up on phones, six across on a desktop. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

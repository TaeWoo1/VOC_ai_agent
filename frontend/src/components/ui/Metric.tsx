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
 *
 * <b>Why the freshness mark became a word</b> (Executive-friendly UX Redesign v1). It used to be a
 * dagger with a legend line under the row: `†` plus 「† 표시는 최신 여부를 확인하지 못한 채널이
 * 포함된 숫자입니다」. A typographic dagger is a device an academic reader decodes and a 50-year-old
 * 판매회사 대표 does not — and the legend cost a whole line of the first screen to explain a symbol.
 * The qualification now sits ON the card it qualifies, in four words, and the legend is gone. Nothing
 * was softened: the same cards carry it, and the channel table below still names which channel.
 */
export function Metric({
  kpi,
  emphasis = false,
  size = "md",
  onClick,
  beforeFirstConnection = false,
}: {
  kpi: MetricKpi;
  /** The one number this screen is about. At most one per screen. */
  emphasis?: boolean;
  /** `lg` — 오늘 상태. The three numbers the home screen exists to answer, read from across a desk. */
  size?: "md" | "lg";
  onClick?: () => void;
  /**
   * **The seller has not connected a channel yet** (Pilot Readiness Gate v1 §4).
   *
   * A missing channel is a warning when there is a working total for it to be missing FROM: one of
   * four channels stopped collecting and the number under the seller's eye is quietly short. Before
   * the first connection there is no such total — every channel is missing, by definition, and the
   * seller was told so in the sentence at the top of the page. Rendered in `warn` on a two-minute-old
   * account it reads as three faults, which is the screen inventing an outage on its first showing.
   *
   * It is not hidden: the same fact is said, in the plainer form the seller can act on, in `muted`.
   */
  beforeFirstConnection?: boolean;
}) {
  const value = kpi.unit === "원" ? wonShort(kpi.value) : count(kpi.value);
  const caveat = beforeFirstConnection ? "아직 연결된 채널이 없습니다" : caveatFor(kpi);
  const big = size === "lg";
  const body = (
    <>
      {/* A card that navigates says so (Executive Readiness Fix v1). These have been `<button>`s
          since the redesign, but nothing on them looked pressable — a reader asked where to go to
          work through the 26 and concluded 「26이라는 큰 숫자는 눌러지게 안 생겼다」, then went
          hunting in the sidebar. The chevron is the affordance; the hover tint was not one. */}
      <p
        className={`flex items-center gap-1 font-medium text-muted ${big ? "text-base" : "text-sm"}`}
      >
        {kpi.label}
        {onClick ? (
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0">
            <path
              d="M7.5 4.5 13 10l-5.5 5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </p>
      <p
        className={`mt-1.5 font-bold tabular-nums text-ink ${
          big ? "text-4xl" : emphasis ? "text-3xl" : "text-2xl"
        }`}
      >
        {value}
        <span className={`ml-1 font-semibold text-muted ${big ? "text-lg" : "text-base"}`}>
          {kpi.unit}
        </span>
      </p>
      <div className={big ? "mt-2 min-h-[1.5rem]" : "mt-1.5 min-h-[1.25rem]"}>
        {kpi.comparable && kpi.deltaPercent !== null ? <Delta percent={kpi.deltaPercent} /> : null}
        {caveat ? (
          <p className={`break-keep text-sm ${beforeFirstConnection ? "text-muted" : "text-warn"}`}>
            {caveat}
          </p>
        ) : null}
        {kpi.freshnessUnproven ? (
          <p className="break-keep text-sm text-warn">최신 수집 확인 안 됨</p>
        ) : null}
      </div>
    </>
  );

  const shell = `rounded-2xl border ${big ? "p-6" : "p-5"} text-left ${
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
 * Only the card-specific qualification is drawn here: a channel MISSING from the total, which
 * differs per number.
 */
function caveatFor(kpi: MetricKpi): string | null {
  if (kpi.excludedChannels > 0) {
    return `채널 ${kpi.excludedChannels}곳이 이 숫자에 없습니다`;
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
  // 「(이전 기간 대비)」 wrapped every card onto a second line and said the same five words six times
  // across one row. What it compares against is stated ONCE, and exactly, in 「이 숫자에 대하여」 —
  // with both date ranges. The screen reader still hears the full sentence (Demo UX Polish v1).
  return (
    <p className="text-sm text-muted">
      {/* 「이전 기간 대비」 is back on the card (Executive Readiness Fix v1). It was dropped when six
          KPIs printed it six times and wrapped every one of them; three cards remain and only one
          ever carries a delta, so it costs one line once — and a bare 「▲397% 증가」 left a reader
          asking 「무엇 대비인지 없다」. */}
      <span aria-hidden="true">
        이전 기간 대비{" "}
        {up ? "▲" : "▼"}
        <span className="ml-1 tabular-nums">{Math.abs(percent)}%</span>
        <span className="ml-1">{up ? "증가" : "감소"}</span>
      </span>
      <span className="sr-only">
        이전 기간 대비 {Math.abs(percent)}% {up ? "증가" : "감소"}
      </span>
    </p>
  );
}

/**
 * The numbers that are context, not work — one quiet line, never six more cards.
 *
 * 매출·문의·리뷰 are what the shop DID; 주문·미답변 문의·확인할 리뷰 are what is waiting. Both used to
 * be cards of the same size in the same row, which is why the home screen answered nothing first and
 * why 「문의 2」 sat beside 「미답변 문의 26」 looking like a contradiction.
 */
export function MetricLine({ kpis }: { kpis: MetricKpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-base text-muted">
      {kpis.map((kpi) => (
        <span key={kpi.key} className="break-keep">
          {kpi.label}{" "}
          <span className="font-semibold tabular-nums text-ink">
            {kpi.unit === "원" ? wonShort(kpi.value) : count(kpi.value)}
          </span>
          {kpi.unit}
        </span>
      ))}
    </p>
  );
}

/** A responsive row of metrics. Two up on phones, six across on a desktop. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

/** 오늘 상태 — exactly three, equal width, nothing else in the row. */
export function MetricRowOfThree({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-3">{children}</div>;
}

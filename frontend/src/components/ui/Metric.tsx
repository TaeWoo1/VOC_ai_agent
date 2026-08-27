import type { ReactNode } from "react";
import type { MetricKpi } from "../../lib/types";
import { count, wonShort } from "../../lib/format";

/**
 * One number, sized to be read second (docs/reviewnary_design.md §6, §7).
 *
 * <b>Compact by default.</b> The home used to open with three large cards, each with its own orange
 * caveat sentence; the redesign puts the work first and the numbers under it as one row of compact
 * metrics — label over number, a delta when the backend says one exists, and the qualification as a
 * short line only where it differs per number.
 *
 * <b>A delta is drawn only when the backend says one exists.</b> `comparable` is not a styling hint:
 * 미답변 문의 is today's backlog with no history, and a component computing its own arrow would be
 * inventing a trend.
 *
 * <b>Why the freshness mark is a word, and now said once.</b> 「최신 수집 확인 안 됨」 used to print on
 * every card that carried it; the row now says it in one shared line (`MetricRow`'s `note`) and the
 * per-card line remains only for the channel-missing caveat, which differs per number.
 */
export function Metric({
  kpi,
  emphasis = false,
  size = "md",
  onClick,
  beforeFirstConnection = false,
  showFreshness = true,
}: {
  kpi: MetricKpi;
  /** The one number this screen is about. At most one per screen. */
  emphasis?: boolean;
  size?: "md" | "lg";
  onClick?: () => void;
  /**
   * The seller has not connected a channel yet (Pilot Readiness Gate v1 §4): the qualification is the
   * plainer fact, in `muted`, never three warn sentences on a two-minute-old account.
   */
  beforeFirstConnection?: boolean;
  /** False when the row above already says it once for every card. */
  showFreshness?: boolean;
}) {
  const value = kpi.unit === "원" ? wonShort(kpi.value) : count(kpi.value);
  const caveat = beforeFirstConnection ? "아직 연결된 채널이 없습니다" : caveatFor(kpi);
  const big = size === "lg";
  const body = (
    <>
      <p className="flex items-center gap-1 text-sm font-medium text-muted">
        {kpi.label}
        {onClick ? (
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
            <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </p>
      <p className={`mt-1 font-bold tabular-nums text-ink ${big ? "text-3xl" : "text-2xl"}`}>
        {value}
        <span className="ml-1 text-sm font-semibold text-muted">{kpi.unit}</span>
      </p>
      {kpi.comparable && kpi.deltaPercent !== null ? <Delta percent={kpi.deltaPercent} /> : null}
      {caveat ? (
        <p className={`mt-1 break-keep text-xs ${beforeFirstConnection ? "text-muted" : "text-warn"}`}>{caveat}</p>
      ) : null}
      {showFreshness && kpi.freshnessUnproven ? (
        <p className="mt-1 break-keep text-xs text-warn">최신 수집 확인 안 됨</p>
      ) : null}
    </>
  );

  const shell = `rounded-2xl border px-4 py-3 text-left ${
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

/** The caveat line — a channel MISSING from this total, which differs per number. */
function caveatFor(kpi: MetricKpi): string | null {
  if (kpi.excludedChannels > 0) {
    return `채널 ${kpi.excludedChannels}곳이 이 숫자에 없습니다`;
  }
  return null;
}

/** Direction and magnitude — never a judgement. */
function Delta({ percent }: { percent: number }) {
  if (percent === 0) {
    return <p className="mt-1 text-xs text-muted">이전 기간과 같음</p>;
  }
  const up = percent > 0;
  return (
    <p className="mt-1 text-xs text-muted">
      <span aria-hidden="true">
        {up ? "▲" : "▼"}
        <span className="ml-0.5 tabular-nums">{Math.abs(percent)}%</span>
        <span className="ml-1">이전 기간 대비</span>
      </span>
      <span className="sr-only">
        이전 기간 대비 {Math.abs(percent)}% {up ? "증가" : "감소"}
      </span>
    </p>
  );
}

/** The numbers that are context, not work — one quiet line. */
export function MetricLine({ kpis }: { kpis: MetricKpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted">
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

/** A responsive row of compact metrics: two up on phones, up to four across on a desktop. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** Exactly three, equal width. */
export function MetricRowOfThree({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-3">{children}</div>;
}

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { MetricSeries } from "../../lib/types";
import { count, wonShort, won } from "../../lib/format";

/**
 * A daily time series, drawn as SVG, with a real data table underneath it — and since Contextual
 * Agent Workspace & Interactive UX QA v1, an operational control rather than a picture.
 *
 * <b>Hover and keyboard show the exact numbers.</b> Every point is a band; the nearest band's date and
 * values render in a tooltip, and the same index is reachable with ←/→ on the focused chart, so what a
 * mouse user sees a keyboard user reads. The sr-only table stays — it is the verification path.
 *
 * <b>The legend toggles.</b> Each series is a button with `aria-pressed`; the last visible one cannot
 * be hidden, because an empty chart says nothing and looks like an outage.
 *
 * <b>Two units, two scales — said so.</b> Series with the same unit share one scale (「of which」 must
 * never look larger than its whole). Series with different units (매출 · 주문) each take their own,
 * and the axis caption names both maxima, so the shape is honest about what it is not comparing.
 *
 * <b>A click does something or is not offered.</b> `onSelectDate` turns the bands into buttons with a
 * pointer cursor; without it the chart has no click affordance at all (design contract §8-B).
 */
export interface TrendChartProps {
  primary: MetricSeries;
  /** The second line — 「of which」 (미답변, 부정) or a second measure (주문 beside 매출). */
  secondary?: MetricSeries;
  height?: number;
  /** A drill-down the backend can honour for one day. Absent ⇒ no click affordance. */
  onSelectDate?: (date: string) => void;
  /** The day the surface is currently drilled into, if any. */
  selectedDate?: string | null;
  /** What this chart is, for the accessible name. */
  label?: string;
}

const PRIMARY = "#1B64DA";
const SECONDARY = "#92400E";

function fmtValue(unit: string, value: number, exact = false): string {
  if (unit === "원") return exact ? won(value) : `${wonShort(value)}원`;
  return `${count(value)}${unit}`;
}

function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

export function TrendChart({ primary, secondary, height = 160, onSelectDate, selectedDate = null, label }: TrendChartProps) {
  const gradientId = useId();
  const liveId = useId();
  const points = primary.points;
  const [hidden, setHidden] = useState<{ primary: boolean; secondary: boolean }>({ primary: false, secondary: false });
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  const width = 720;
  const padY = 12;
  const sameUnit = !secondary || secondary.unit === primary.unit;
  const maxPrimary = useMemo(
    () => Math.max(1, ...points.map((p) => p.value), ...(sameUnit ? (secondary?.points ?? []).map((p) => p.value) : [])),
    [points, secondary, sameUnit],
  );
  const maxSecondary = useMemo(
    () => (secondary ? (sameUnit ? maxPrimary : Math.max(1, ...secondary.points.map((p) => p.value))) : 1),
    [secondary, sameUnit, maxPrimary],
  );

  if (points.length === 0) {
    return <p className="py-8 text-center text-muted">표시할 기간이 없습니다.</p>;
  }

  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? i * stepX : width / 2);
  const yFor = (value: number, max: number) => padY + (1 - value / max) * (height - padY * 2);
  const path = (series: MetricSeries, max: number) =>
    series.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yFor(p.value, max).toFixed(1)}`).join(" ");
  const area = `${path(primary, maxPrimary)} L${x(points.length - 1).toFixed(1)},${height - padY} L0,${height - padY} Z`;

  const showPrimary = !hidden.primary;
  const showSecondary = !!secondary && !hidden.secondary;
  const active = hover ?? focus;
  const activePoint = active != null ? points[active] : null;
  const activeSecondary = active != null && secondary ? secondary.points[active] : null;
  const interactive = !!onSelectDate;
  const bandW = points.length > 1 ? stepX : width;

  function toggle(which: "primary" | "secondary") {
    setHidden((prev) => {
      const next = { ...prev, [which]: !prev[which] };
      // Never hide the last visible series.
      const visible = (!next.primary ? 1 : 0) + (secondary && !next.secondary ? 1 : 0);
      return visible === 0 ? prev : next;
    });
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const base = focus ?? (e.key === "ArrowRight" ? -1 : points.length);
      const next = Math.min(points.length - 1, Math.max(0, base + (e.key === "ArrowRight" ? 1 : -1)));
      setFocus(next);
    } else if ((e.key === "Enter" || e.key === " ") && interactive && focus != null) {
      e.preventDefault();
      onSelectDate!(points[focus]!.date);
    } else if (e.key === "Home") {
      setFocus(0);
    } else if (e.key === "End") {
      setFocus(points.length - 1);
    }
  }

  const name = label ?? primary.label;
  const tipLeft = active != null ? `${((x(active) / width) * 100).toFixed(2)}%` : "0%";

  return (
    <figure className="m-0">
      <div className="relative">
        <div
          role="group"
          aria-label={`${name} 추이. 좌우 화살표로 날짜 이동${interactive ? ", Enter로 해당 날짜 보기" : ""}`}
          aria-describedby={liveId}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setFocus(null)}
          onMouseLeave={() => setHover(null)}
          className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          data-testid="trend-chart"
        >
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY} stopOpacity="0.16" />
                <stop offset="100%" stopColor={PRIMARY} stopOpacity="0" />
              </linearGradient>
            </defs>
            {selectedDate ? (() => {
              const i = points.findIndex((p) => p.date === selectedDate);
              return i >= 0 ? <rect x={x(i) - bandW / 2} y={0} width={bandW} height={height} fill={PRIMARY} fillOpacity="0.10" /> : null;
            })() : null}
            {active != null ? (
              <line x1={x(active)} x2={x(active)} y1={padY / 2} y2={height - padY / 2} stroke="#8B95A1" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            ) : null}
            {showPrimary ? <path d={area} fill={`url(#${gradientId})`} /> : null}
            {showPrimary ? <path d={path(primary, maxPrimary)} fill="none" stroke={PRIMARY} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
            {showSecondary ? (
              <path d={path(secondary!, maxSecondary)} fill="none" stroke={SECONDARY} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ) : null}
            {active != null && showPrimary ? <circle cx={x(active)} cy={yFor(points[active]!.value, maxPrimary)} r="4" fill={PRIMARY} vectorEffect="non-scaling-stroke" /> : null}
            {active != null && showSecondary && activeSecondary ? (
              <circle cx={x(active)} cy={yFor(activeSecondary.value, maxSecondary)} r="4" fill={SECONDARY} />
            ) : null}
            {/* Hit bands: one per point. Buttons only when a click is honoured. */}
            {points.map((p, i) => (
              <rect
                key={p.date}
                x={x(i) - bandW / 2}
                y={0}
                width={bandW}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={interactive ? () => onSelectDate!(p.date) : undefined}
                style={interactive ? { cursor: "pointer" } : undefined}
                data-testid={`trend-band-${p.date}`}
              />
            ))}
          </svg>
        </div>

        {activePoint ? (
          <div
            role="tooltip"
            data-testid="trend-tooltip"
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-card"
            style={{ left: `clamp(72px, ${tipLeft}, calc(100% - 72px))` }}
          >
            <p className="font-semibold text-ink">{fmtDate(activePoint.date)}</p>
            {showPrimary ? (
              <p className="whitespace-nowrap tabular-nums text-muted">
                {primary.label} <span className="font-semibold text-ink">{fmtValue(primary.unit, activePoint.value, true)}</span>
              </p>
            ) : null}
            {showSecondary && activeSecondary ? (
              <p className="whitespace-nowrap tabular-nums text-muted">
                {secondary!.label} <span className="font-semibold text-ink">{fmtValue(secondary!.unit, activeSecondary.value, true)}</span>
              </p>
            ) : null}
            {interactive ? <p className="text-muted">눌러서 이 날 보기</p> : null}
          </div>
        ) : null}
      </div>

      <p id={liveId} className="sr-only" aria-live="polite">
        {activePoint
          ? `${fmtDate(activePoint.date)} ${primary.label} ${fmtValue(primary.unit, activePoint.value, true)}${
              activeSecondary && showSecondary ? `, ${secondary!.label} ${fmtValue(secondary!.unit, activeSecondary.value, true)}` : ""
            }`
          : ""}
      </p>

      {/* Sparse date ticks: first, last and up to three between, so a 30-day line has a calendar. */}
      <div className="relative mt-1 h-4 text-xs tabular-nums text-muted" aria-hidden="true">
        {tickIndexes(points.length).map((i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `clamp(16px, ${((x(i) / width) * 100).toFixed(2)}%, calc(100% - 16px))` }}
          >
            {points[i]!.date.slice(5).replace("-", "/")}
          </span>
        ))}
      </div>

      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-muted">
        <span className="flex flex-wrap items-center gap-x-1 gap-y-1" role="group" aria-label="표시 항목">
          <LegendToggle color={PRIMARY} label={primary.label} pressed={showPrimary} onClick={() => toggle("primary")} />
          {secondary ? (
            <LegendToggle color={SECONDARY} dashed label={secondary.label} pressed={showSecondary} onClick={() => toggle("secondary")} />
          ) : null}
        </span>
        <span className="tabular-nums">
          {!sameUnit && secondary ? (
            <span>
              최대 {primary.label} {fmtValue(primary.unit, maxPrimary)} · {secondary.label} {fmtValue(secondary.unit, maxSecondary)}
            </span>
          ) : null}
        </span>
      </figcaption>

      {/* Screen-reader and verification path: the same numbers the line was drawn from. */}
      <table className="sr-only">
        <caption>
          {primary.label}
          {secondary ? ` 및 ${secondary.label}` : ""} 일별 값
        </caption>
        <thead>
          <tr>
            <th scope="col">날짜</th>
            <th scope="col">{primary.label}</th>
            {secondary ? <th scope="col">{secondary.label}</th> : null}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              <td>{fmtValue(primary.unit, p.value, true)}</td>
              {secondary ? <td>{fmtValue(secondary.unit, secondary.points[i]?.value ?? 0, true)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Which points get a date label: first, last, and up to three evenly between. */
export function tickIndexes(n: number): number[] {
  if (n <= 1) return n === 1 ? [0] : [];
  const want = Math.min(5, n);
  const out = new Set<number>();
  for (let k = 0; k < want; k++) out.add(Math.round((k * (n - 1)) / (want - 1)));
  return [...out].sort((a, b) => a - b);
}

function LegendToggle({ color, label, dashed, pressed, onClick }: { color: string; label: string; dashed?: boolean; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-[28px] items-center gap-2 rounded-md px-1.5 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${pressed ? "text-ink" : "text-muted line-through"}`}
    >
      <svg width="18" height="8" aria-hidden="true">
        <line x1="0" y1="4" x2="18" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "5 4" : undefined} opacity={pressed ? 1 : 0.35} />
      </svg>
      {label}
    </button>
  );
}

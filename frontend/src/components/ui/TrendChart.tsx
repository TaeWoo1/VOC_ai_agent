import { useId } from "react";
import type { MetricSeries } from "../../lib/types";
import { count, wonShort } from "../../lib/format";

/**
 * A daily time series, drawn as SVG, with a real data table underneath it.
 *
 * <b>SVG rather than a charting library.</b> The series is a couple of dozen points and this
 * repository ships five runtime dependencies in the whole frontend; a chart engine would be the
 * largest of them, for a line. The UI UX Pro Max chart guidance says the same thing from the other
 * side — under 1,000 points, SVG.
 *
 * <b>The table is not a fallback; it is part of the component.</b> A screen reader gets the numbers,
 * a sighted reader gets the shape, and the two are generated from one array so they cannot disagree.
 * The same guidance calls this out as the accessibility floor for a time series, and it is also how
 * anyone verifies a chart against the database.
 *
 * <b>Two series, distinguished by more than colour.</b> The second is drawn filled and dashed, so the
 * pair reads correctly in greyscale and to a colour-blind reader.
 */
export function TrendChart({
  primary,
  secondary,
  height = 160,
}: {
  primary: MetricSeries;
  /** The "of which" line — 미답변, 부정. Optional; a single-series chart is the common case. */
  secondary?: MetricSeries;
  height?: number;
}) {
  const gradientId = useId();
  const points = primary.points;
  if (points.length === 0) {
    return <p className="py-8 text-center text-muted">표시할 기간이 없습니다.</p>;
  }

  const width = 720;
  const padY = 12;
  // The two series share ONE scale. Drawing "of which" on its own axis makes a subset look larger
  // than the set it belongs to, which is a chart that lies without a single wrong number in it.
  const max = Math.max(
    1,
    ...points.map((p) => p.value),
    ...(secondary?.points ?? []).map((p) => p.value),
  );
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const y = (value: number) => padY + (1 - value / max) * (height - padY * 2);
  const path = (series: MetricSeries) =>
    series.points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  const area = `${path(primary)} L${(width).toFixed(1)},${height - padY} L0,${height - padY} Z`;
  const fmt = (value: number) => (primary.unit === "원" ? wonShort(value) : count(value));

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="presentation"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3182F6" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#3182F6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={path(primary)} fill="none" stroke="#3182F6" strokeWidth="2" strokeLinejoin="round" />
        {secondary ? (
          <path
            d={path(secondary)}
            fill="none"
            stroke="#B45309"
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>

      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span className="flex flex-wrap items-center gap-4">
          <Legend color="#3182F6" label={primary.label} />
          {secondary ? <Legend color="#B45309" dashed label={secondary.label} /> : null}
        </span>
        <span className="tabular-nums">
          {points[0]?.date.slice(5)} – {points[points.length - 1]?.date.slice(5)}
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
              <td>{fmt(p.value)}</td>
              {secondary ? <td>{count(secondary.points[i]?.value ?? 0)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="18" height="8" aria-hidden="true">
        <line
          x1="0"
          y1="4"
          x2="18"
          y2="4"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "5 4" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

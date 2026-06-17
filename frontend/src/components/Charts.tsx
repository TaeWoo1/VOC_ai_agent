import { EmptyState } from "./EmptyState";
import { shortDate, won, wonShort } from "../lib/format";
import type { ChannelSalesShare, SalesTrendPoint } from "../lib/types";

export function ShareBars({ items }: { items: ChannelSalesShare[] }) {
  if (items.length === 0) {
    return <EmptyState message="매출 데이터가 없습니다." />;
  }
  return (
    <ul className="space-y-4">
      {items.map((it, i) => (
        <li key={i}>
          <div className="mb-1 flex justify-between text-base">
            <span className="font-semibold">{it.channelNameKo}</span>
            <span className="text-muted">
              {won(it.salesAmount)} · {it.percent}%
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-canvas">
            <div className="h-3 rounded-full bg-brand" style={{ width: `${it.percent}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TrendBars({ points }: { points: SalesTrendPoint[] }) {
  if (points.length === 0) {
    return <EmptyState message="추이 데이터가 없습니다." />;
  }
  const max = Math.max(...points.map((p) => p.salesAmount), 1);
  return (
    <div className="flex items-end justify-between gap-2" style={{ height: 180 }}>
      {points.map((p, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-2">
          <span className="text-sm text-muted">{wonShort(p.salesAmount)}</span>
          <div
            className="w-full rounded-t-lg bg-brand/80"
            style={{ height: `${Math.max(6, (p.salesAmount / max) * 120)}px` }}
          />
          <span className="text-sm text-muted">{shortDate(p.date)}</span>
        </div>
      ))}
    </div>
  );
}

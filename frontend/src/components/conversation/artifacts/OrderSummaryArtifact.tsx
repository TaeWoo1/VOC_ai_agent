import { Link } from "react-router-dom";
import type { OrderSummaryArtifact as OrderSummary } from "../../../lib/conversation/types";
import { DataTable, Td, Th } from "../../ui/DataTable";
import { count, wonShort } from "../../../lib/format";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

function delta(p: number | null): string | null {
  if (p == null) return null;
  if (p === 0) return "이전 기간과 같음";
  return `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% 이전 기간 대비`;
}

/** Two compact numbers, then the channel table. 「—」 for a channel that could not report, never 0. */
export function OrderSummaryArtifact({ artifact }: { artifact: OrderSummary }) {
  const onOpen = useContinueInPanel("ORDER_SUMMARY");
  const t = artifact.totals;
  return (
    <ArtifactCard
      title={artifact.title}
      note={[artifact.note, artifact.exampleDataIncluded ? "예시 데이터가 포함된 숫자입니다" : null].filter(Boolean).join(" · ") || null}
      action={<Link to={artifact.to} onClick={onOpen} className="text-xs font-semibold text-brand-700 hover:underline">주문 화면</Link>}
    >
      <div className="grid grid-cols-2 gap-3 px-4 pb-3">
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="text-sm font-medium text-muted">매출 · {artifact.period.days}일</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-ink">{wonShort(t.sales)}<span className="ml-1 text-sm font-semibold text-muted">원</span></p>
          {delta(t.salesDeltaPercent) ? <p className="mt-0.5 text-xs text-muted">{delta(t.salesDeltaPercent)}</p> : null}
        </div>
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="text-sm font-medium text-muted">주문 · {artifact.period.days}일</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-ink">{count(t.orders)}<span className="ml-1 text-sm font-semibold text-muted">건</span></p>
          {delta(t.ordersDeltaPercent) ? <p className="mt-0.5 text-xs text-muted">{delta(t.ordersDeltaPercent)}</p> : null}
        </div>
      </div>
      {artifact.channels.length > 0 ? (
        <div className="px-4">
          <DataTable caption="채널별 매출과 주문" head={<><Th>채널</Th><Th numeric>매출</Th><Th numeric>주문</Th></>}>
            {artifact.channels.map((c) => {
              const counted = c.state === "OBSERVED_FRESH" || c.state === "OBSERVED_FRESHNESS_UNPROVEN" || c.state === "ZERO";
              return (
                <tr key={c.channelCode}>
                  <Td>{c.channelNameKo}</Td>
                  <Td numeric muted={!counted}>{counted ? `${wonShort(c.sales)}원` : "—"}</Td>
                  <Td numeric muted={!counted}>{counted ? count(c.orders) : "—"}</Td>
                </tr>
              );
            })}
          </DataTable>
        </div>
      ) : null}
      {artifact.exclusions.length > 0 ? (
        <p className="break-keep px-4 py-2 text-xs text-muted">합계에서 빠진 것 · {artifact.exclusions.join(" · ")}</p>
      ) : null}
    </ArtifactCard>
  );
}

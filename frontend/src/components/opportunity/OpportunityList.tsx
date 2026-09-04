import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import type { OpportunityView } from "../../lib/types";
import { OpportunityCard } from "./OpportunityCard";

/**
 * The opportunities of one issue, with the seller's decisions, on the issue's own surface.
 *
 * Dismissed ones are shown too (as 보류, with 되돌리기): this is the one place a decision can be undone,
 * so it must be the one place a dismissed opportunity is still visible. A read that fails says so; an
 * issue that yields nothing renders nothing — the heading is the caller's and it is drawn only when
 * there is something under it.
 */
export function OpportunityList({ issueId, onCount }: { issueId: string; onCount?: (n: number) => void }) {
  const [items, setItems] = useState<OpportunityView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const list = await api.getOpportunitiesStrict({ issueId, includeDismissed: true });
      setItems(list);
      onCount?.(list.length);
    } catch {
      setItems(null);
      setFailed(true);
      onCount?.(0);
    }
  }, [issueId, onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return <p className="mt-2 text-muted">개선 기회를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>;
  }
  if (items == null) {
    return <p className="mt-2 text-muted">개선 기회를 확인하는 중…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="mt-2 break-keep text-muted">
        이 문제에서는 아직 제안할 개선 기회가 없습니다. 근거가 더 쌓이거나 문제 유형이 안내로 답할 수 있는 것일 때 제안됩니다.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-3" aria-label="개선 기회 목록">
      {items.map((o) => (
        <li key={`${o.issueId}:${o.kind}`}>
          <OpportunityCard
            opportunity={o}
            showEvidenceLink={false}
            onChanged={(next) =>
              setItems((current) =>
                current ? current.map((c) => (c.issueId === next.issueId && c.kind === next.kind ? next : c)) : current,
              )
            }
          />
        </li>
      ))}
    </ul>
  );
}

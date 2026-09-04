import { useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import { count } from "../../lib/format";
import type { OpportunityView } from "../../lib/types";
import { SectionHeader } from "../ui/SectionHeader";
import { WorkItem } from "../ui/WorkItem";
import { KIND_TONE, actionable } from "./opportunityWords";

/**
 * A product's improvement opportunities — the door from 「반복되는 문제 15건」 to what can be done about them.
 *
 * <b>Rows, not cards.</b> The place to decide and to prepare a draft is the issue's own surface
 * (고객운영 메모리), where the evidence is; this section says what is suggested and takes the seller there.
 * It reads the same product-scoped issue list the signal card above it is built from, so it can never
 * name an issue that card does not.
 *
 * <b>Fail-soft, and zero is silence.</b> A failed read renders nothing rather than a warning — an
 * empty list and an unread list cannot be told apart here, and neither is a fact about the product.
 */
export function ProductOpportunities({ productId }: { productId: string }) {
  const [items, setItems] = useState<OpportunityView[] | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getOpportunitiesStrict({ productId })
      .then((list) => active && setItems(actionable(list)))
      .catch(() => active && setItems(null));
    return () => {
      active = false;
    };
  }, [productId]);

  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="개선 기회">
      <SectionHeader
        title={`개선 기회 ${count(items.length)}건`}
        hint="반복되는 문제에서 판매자님이 손볼 수 있는 곳 · 근거와 준비된 초안은 문제 화면에서"
      />
      <ul className="divide-y divide-line/70 rounded-2xl border border-line bg-surface">
        {items.map((o) => (
          <li key={`${o.issueId}:${o.kind}`}>
            <WorkItem
              state={o.kindLabelKo}
              tone={KIND_TONE[o.kind]}
              title={o.recommendationKo}
              meta={[o.issueTitle, `근거 ${count(o.evidenceCount)}건`, o.status === "ACCEPTED" ? o.statusLabelKo : null]
                .filter(Boolean)
                .join(" · ")}
              to={`/memory/${o.issueId}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

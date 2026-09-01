import { useState } from "react";
import { Link } from "react-router-dom";
import type { ProductListArtifact as ProductList } from "../../../lib/conversation/types";
import { Dot, Facet } from "../../ui/ObjectRow";
import { BtnLink } from "../../ui/Btn";
import { useConversation } from "../../../lib/conversation/ConversationProvider";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/**
 * Products as objects the conversation can STAND ON (Frontend-first Agent Workspace Redesign v1).
 *
 * Before this they were the one list that dead-ended: three names in a bordered box, no facts, no
 * press, and no way to say 「이 상품」 next. A press now does exactly what a press on an inquiry row
 * does — the same focus contract, verified in the runtime, shown in the context bar — so the follow-up
 * 「이 상품 리뷰에 어떤 문제가 있어?」 lands on the row the seller pointed at instead of a name the
 * planner has to resolve again.
 *
 * `more` stays: a catalogue that is the HEAD of a longer list says so, and that distinction is the
 * answer's own (Agentic Experience v2 §8).
 */
export function ProductListArtifact({ artifact, headline }: { artifact: ProductList; headline?: string }) {
  const onOpen = useContinueInPanel("PRODUCT_LIST");
  const conversation = useConversation();
  const [open, setOpen] = useState<string | null>(null);
  const selectedId = conversation?.workingSet?.selectedObject?.kind === "PRODUCT"
    ? conversation.workingSet.selectedObject.id : null;
  return (
    <ArtifactCard title={artifact.title} note={artifact.note} headline={headline} titleSaid={artifact.titleSaid}>
      <ul className="divide-y divide-line/70">
        {artifact.items.map((p) => {
          const expanded = open === p.productId;
          const selected = selectedId === p.productId;
          return (
            <li key={p.productId} className={selected ? "bg-brand-50/60" : ""}>
              <button
                type="button"
                onClick={() => {
                  setOpen((prev) => (prev === p.productId ? null : p.productId));
                  void conversation?.selectEntity({ productId: p.productId });
                }}
                aria-expanded={expanded}
                aria-current={selected ? "true" : undefined}
                className="block w-full px-4 py-3 text-left transition hover:bg-canvas/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
                data-testid="product-row-select"
              >
                <span className="block break-keep text-base font-semibold text-ink">{p.productName}</span>
                {p.facts.length > 0 ? (
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted">
                    {p.facts.map((f, i) => (
                      <span key={f.label} className="inline-flex items-center gap-1.5">
                        {i > 0 ? <Dot /> : null}
                        <Facet label={f.label} value={f.count} />
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
              {expanded ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-line/60 bg-canvas/60 px-4 py-2.5" data-testid="product-row-detail">
                  <BtnLink to={p.to} variant="outline" size="sm" onClick={onOpen}>상품 화면에서 열기</BtnLink>
                  <span className="text-sm text-muted">아래 입력창에 「이 상품」이라고 이어서 물어보실 수 있습니다.</span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {artifact.more ? (
        <p className="px-4 py-2">
          <Link to={artifact.more.to} onClick={onOpen} className="text-sm font-semibold text-brand-700 hover:underline">{artifact.more.label}</Link>
        </p>
      ) : null}
    </ArtifactCard>
  );
}

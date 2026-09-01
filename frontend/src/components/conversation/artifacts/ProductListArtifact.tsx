import { Link } from "react-router-dom";
import type { ProductListArtifact as ProductList } from "../../../lib/conversation/types";
import { Dot, Facet, ObjectRow } from "../../ui/ObjectRow";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/**
 * Products as object rows: the name is what the seller recognises, the facets are why this row is
 * here, and `more` is where the rest is when these rows are the head of a longer catalogue rather
 * than the whole of it (Agentic Experience v2 §8) — a distinction the answer's own sentence makes,
 * and one this card must not quietly drop.
 */
export function ProductListArtifact({ artifact, headline }: { artifact: ProductList; headline?: string }) {
  const onOpen = useContinueInPanel("PRODUCT_LIST");
  return (
    <ArtifactCard title={artifact.title} note={artifact.note} headline={headline}>
      <ul className="divide-y divide-line/70">
        {artifact.items.map((p) => (
          <li key={p.productId}>
            <ObjectRow
              name={p.productName}
              to={p.to}
              onClick={onOpen}
              facets={p.facts.map((f, i) => (
                <span key={f.label} className="inline-flex items-center gap-1.5">
                  {i > 0 ? <Dot /> : null}
                  <Facet label={f.label} value={f.count} />
                </span>
              ))}
            />
          </li>
        ))}
      </ul>
      {artifact.more ? (
        <p className="px-4 py-2">
          <Link to={artifact.more.to} onClick={onOpen} className="text-sm font-semibold text-brand-700 hover:underline">{artifact.more.label}</Link>
        </p>
      ) : null}
    </ArtifactCard>
  );
}

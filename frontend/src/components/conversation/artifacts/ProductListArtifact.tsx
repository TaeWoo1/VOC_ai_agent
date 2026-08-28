import type { ProductListArtifact as ProductList } from "../../../lib/conversation/types";
import { Dot, Facet, ObjectRow } from "../../ui/ObjectRow";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

export function ProductListArtifact({ artifact }: { artifact: ProductList }) {
  const onOpen = useContinueInPanel("PRODUCT_LIST");
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
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
    </ArtifactCard>
  );
}

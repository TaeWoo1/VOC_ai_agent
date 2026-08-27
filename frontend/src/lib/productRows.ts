import type { ProductSummaryView } from "./types";

/** What one product row says beside its name. `knowledge` is null when that read failed. */
export interface ProductRowFacts {
  channels: string[];
  inquiries: number;
  unanswered: number;
  reviews: number;
  issueEvidence: number;
  knowledge: number | null;
}

const CHANNEL_KO: Record<string, string> = { NAVER: "네이버", COUPANG: "쿠팡", CAFE24: "카페24" };

export function productChannelLabel(code: string): string {
  return CHANNEL_KO[code] ?? code;
}

/** The backend's placeholder for rows it could not attribute to a real product. */
export function isPlaceholderProduct(row: ProductSummaryView): boolean {
  return row.name.trim() === "(미지정 상품)";
}

/**
 * Presentation order (docs/reviewnary_design.md §7 상품): what needs attention first — unanswered
 * inquiries, then issue evidence, then review volume — then name. The unattributed placeholder goes
 * last regardless. A row whose facts have not arrived keeps its server order among the unknowns.
 * Backend semantics are untouched: this reorders, it never hides.
 */
export function orderProductRows(
  rows: readonly ProductSummaryView[],
  facts: ReadonlyMap<string, ProductRowFacts | null>,
): ProductSummaryView[] {
  const score = (row: ProductSummaryView): [number, number, number, number] => {
    const f = facts.get(row.id) ?? null;
    return [isPlaceholderProduct(row) ? 1 : 0, -(f?.unanswered ?? 0), -(f?.issueEvidence ?? 0), -(f?.reviews ?? 0)];
  };
  return [...rows].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i += 1) {
      if (sa[i] !== sb[i]) return sa[i] - sb[i];
    }
    return a.name.localeCompare(b.name, "ko");
  });
}

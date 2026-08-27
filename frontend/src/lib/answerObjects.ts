import type { EvidenceRef } from "./agentRuntime/types";

/**
 * <b>Which workspace objects an Agent answer is actually about.</b>
 *
 * <p>Chat-first Agent Shell Completion v1 §8. A free-text answer used to end at prose plus a text
 * link — 「근거 화면 열기」 — under each sentence. A seller who has just been told two of their
 * products have a repeating problem wants the two products, with somewhere to press. This turns the
 * answer's own evidence into that list.
 *
 * <p><b>Nothing here is derived, computed or inferred.</b> Every product id, name, label and count
 * below was already in {@link EvidenceRef.locator}; this groups them and drops the rest. In
 * particular it never SUMS two counts: 「리뷰 3」 and 「문의 2」 are two facts about a product and
 * 「관련 5건」 would be a third one nobody read. A product with no name is kept and labelled as such,
 * because an id with a link is still something the seller can open — 「-」 is not.
 */
export interface AnswerObject {
  readonly productId: string;
  /** The catalogue's name, when the evidence carried one. */
  readonly productName: string | null;
  /** What was read about it — the evidence's own words and its own counts, deduplicated. */
  readonly facts: readonly string[];
}

/** Where this object lives in the workspace. A route that already exists, never a new screen. */
export function answerObjectHref(object: AnswerObject): string {
  return `/products/${object.productId}`;
}

export function answerObjects(evidence: readonly EvidenceRef[]): AnswerObject[] {
  const byProduct = new Map<string, { name: string | null; facts: string[] }>();
  for (const ref of evidence) {
    const productId = ref.locator.productId;
    if (!productId) continue;
    const entry = byProduct.get(productId) ?? { name: null, facts: [] };
    // The first name wins and a later null never erases it — the same row can be cited by one tool
    // that resolved the catalogue and another that did not.
    if (!entry.name && ref.locator.productName) entry.name = ref.locator.productName;
    const label = ref.locator.label;
    if (label) {
      const fact = ref.locator.count != null ? `${label} ${ref.locator.count}건` : label;
      if (!entry.facts.includes(fact)) entry.facts.push(fact);
    }
    byProduct.set(productId, entry);
  }
  return [...byProduct.entries()].map(([productId, entry]) => ({
    productId,
    productName: entry.name,
    facts: entry.facts,
  }));
}

import { Link } from "react-router-dom";
import { Eyebrow } from "../../workspace/CaseLayout";
import type { ReviewDecisionContext } from "../../../lib/types";

/**
 * <b>근거 — the preview's numbers, as numbers</b> (reference-based hierarchy v2, 2026-09-26).
 *
 * <p>This replaces what {@link RepeatedSignal} and {@link GroundingOnHand} used to draw in a preview: two
 * sentences, a flowing 「리뷰 7건 · 부정 4건 · 상품 지식 0건 · 회사 운영 기준 0건」 and a 76-character footnote,
 * all at 15px/400 — the same weight as the customer's sentence, the triage reason and the judgment line. Measured
 * on the live panel, 190 of the 389 characters standing in the first viewport were system explanation, and one
 * type band carried eight different kinds of information. A preview whose job is 「is this worth opening」 cannot
 * be read; it has to be scanned.
 *
 * <p><b>The shape is Linear Peek's, not Zendesk's rail.</b> Zendesk answers this question with a label column —
 * 「Email / Phone / Local time / Language」 left, values right — so the labels are what line up and the values
 * hang off them. Here the figure is on top at 17px/700 and its noun sits under it at 12px muted: there is no
 * label column, and the heaviest thing in the group is the number. Two rows of three, because the rows are two
 * different questions — what this product's reviews are saying, and what a reply could stand on — and because
 * five cells across 392px would break 「회사 운영 기준」 onto a second line.
 *
 * <p><b>Nothing is dropped; the explanations moved one click</b>, to the full case that already renders every one
 * of them: what to do about the product state, what makes a 반복 문제 different from the triage category, that
 * these digits count what is FILED, the titles of the registered documents, why a product's figures are absent
 * when it is unlinked, and what filling an open ask buys. The two qualifiers this preview still needs it carries
 * as words rather than sentences — 「기록」 in 반복 문제 기록 (the claim is about our records, never about the
 * world) and 「등록」 in the two library nouns.
 */
export function EvidencePreview({ context }: { context: ReviewDecisionContext }) {
  const { knowledge, productSignal, repeatedProblems } = context;
  /**
   * <b>이름은 있는데 상품이 없다.</b> The channel sent a product name and this org holds no catalogue product for
   * it, so there are no per-product figures to print. The full case explains why in a sentence; here the absence
   * needs a name, because two missing cells with no word for them read as a failed read.
   */
  const unlinked = productSignal === null;

  return (
    <section aria-label="근거" className="space-y-3">
      <Eyebrow>근거</Eyebrow>

      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        {unlinked ? (
          // A dash in the figure's place, not an empty cell: it keeps the row's baselines and says the figure is
          // absent rather than zero. Why it is absent — the channel sent a name this catalogue has no product
          // for — is the full case's sentence.
          <Cell dash label="상품 미연결" />
        ) : (
          <>
            <Cell n={productSignal.reviews} label="리뷰" />
            <Cell n={productSignal.negativeReviews} label="부정 리뷰" />
          </>
        )}
        <Cell n={repeatedProblems.length} label="반복 문제 기록" />
        <Cell n={knowledge.productSources} label="상품 지식" />
        <Cell n={knowledge.orgSources} label="회사 운영 기준" />
        {/* Only when there are any. A zero here would answer a question the seller did not ask, and the row
            that explains what filling them buys is in the full case. */}
        {knowledge.openAsks > 0 ? <Cell n={knowledge.openAsks} label="답 없는 확인 필요" /> : null}
      </div>

      {/* A row of its own: these leave the panel, and everything above it does not. */}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold">
        <Link to="/knowledge" className="text-brand-700 hover:underline">
          답변 기준 보기 →
        </Link>
        {context.productId ? (
          <Link to={`/products/${context.productId}`} className="text-brand-700 hover:underline">
            상품 화면 열기 →
          </Link>
        ) : null}
      </p>
    </section>
  );
}

/** The figure, then what it counts. `dash` is a figure that does not exist — never a zero standing in for one. */
function Cell({ n, label, dash = false }: { n?: number; label: string; dash?: boolean }) {
  return (
    <div>
      <p className={`text-[17px] font-bold leading-none tabular-nums ${dash ? "text-[#C4CAD3]" : "text-ink"}`}>
        {dash ? "—" : (n ?? 0).toLocaleString("ko-KR")}
      </p>
      <p className="mt-1 break-keep text-[12px] leading-tight text-muted">{label}</p>
    </div>
  );
}

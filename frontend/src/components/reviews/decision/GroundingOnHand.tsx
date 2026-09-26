import { Link } from "react-router-dom";
import { Section } from "../../ui/Section";
import { usePaneDepth } from "../../workspace/CaseLayout";
import { Facts } from "../../ui/ObjectRow";
import { EVIDENCE_NOTE } from "../../../lib/reviewDecision";
import type { ReviewDecisionContext } from "../../../lib/types";

/**
 * <b>이 상품에 대해 우리가 아는 것</b> — the fourth question: what would a reply stand on.
 *
 * <b>Counts and titles, never bodies.</b> This block answers «is there anything registered about
 * this», which is a question about the library. What a DRAFT actually stood on is a different
 * question with a different answer, and it is shown where it belongs — as the draft's own citations,
 * read back from the source at display time.
 *
 * <b>Nothing is retrieved to render this.</b> Running retrieval at open would spend a model round
 * trip per workspace open (Retrieval v2: a question rewrite and an eligibility judgement) for a
 * passage nobody has asked for yet, and it would make opening a review cost money. These are four
 * counts and up to five titles.
 *
 * <b>Only active sources are counted.</b> A retired document cannot ground anything, so counting it
 * would tell the seller they have knowledge the drafter cannot see.
 *
 * <b>확인 필요 is the honest half.</b> A seller looking at a thin draft is entitled to know that
 * reviewnary has already asked N questions about this product that nobody has answered — that is
 * usually the reason, and it is one click from being fixed.
 */
export function GroundingOnHand({
  context,
  titled = true,
}: {
  context: ReviewDecisionContext;
  /** False when the caller's own fold already prints this name. */
  titled?: boolean;
}) {
  const { knowledge, productSignal } = context;
  const preview = usePaneDepth() === "preview";
  /**
   * <b>이름은 있는데 상품이 없다</b> — the review arrived with the channel's own product name and this
   * org holds no catalogue product for it yet. The only producer of a name without an id is that
   * fallback (`ReviewProductLabel`), so the two fields say it between them and no third field is
   * needed. It is the ordinary state of a seller who connected the browser and no product API.
   */
  const unlinked = context.productId == null && context.productName != null;
  // Only the page reading prints the product name: the preview's header already does.
  const productName =
    context.productId && context.productName ? (
      <Link to={`/products/${context.productId}`} className="break-keep font-medium text-ink hover:underline">
        {context.productName}
      </Link>
    ) : context.productName ? (
      <span className="break-keep font-medium text-ink">{context.productName}</span>
    ) : (
      <span className="break-keep text-muted">상품 미지정</span>
    );
  /**
   * <b>The preview no longer draws this.</b> Its four figures are cells of `EvidencePreview`'s grid — the shape
   * that answers 「what is registered」 without a paragraph — and the titles, the unlinked explanation, the
   * open-ask follow-up and the 「what these count」 note are this reading's, one click away on the full case.
   */
  return (
    <Section title={titled ? "이 상품에 대해 우리가 아는 것" : undefined} ariaLabel="이 상품에 대해 우리가 아는 것">
      <div className={preview ? "space-y-2" : "space-y-2 rounded-2xl border border-line bg-surface p-4"}>
        <Facts className="text-sm text-muted">
          {productName}
          {/* Null is not zero: a review bound to no product has no product to count for, and printing
              0건 would answer a question nobody could ask. */}
          {productSignal ? <span className="tabular-nums">리뷰 {productSignal.reviews}건</span> : null}
          {productSignal ? (
            <span className="tabular-nums">부정 {productSignal.negativeReviews}건</span>
          ) : null}
        </Facts>

        {unlinked ? (
          // Why the figures above are absent. Without this the seller reads a review whose product
          // counts are simply missing and has no way to learn that the answer is «not yet linked»
          // rather than «zero».
          <p className="break-keep text-sm leading-relaxed text-muted">
            판매 채널에서 읽은 상품명입니다. 아직 상품 목록의 상품과 연결되지 않아 상품별 수치는 표시하지
            않습니다.
          </p>
        ) : null}

        <Facts className="text-sm text-muted">
          <span className="tabular-nums">등록된 상품 지식 {knowledge.productSources}건</span>
          <span className="tabular-nums">회사 운영 기준 {knowledge.orgSources}건</span>
        </Facts>

        {knowledge.productTitles.length > 0 ? (
          <p className="break-keep text-sm text-ink">{knowledge.productTitles.join(" · ")}</p>
        ) : null}

        {knowledge.openAsks > 0 ? (
          <p className="break-keep text-sm leading-relaxed text-ink">
            아직 답하지 않은 확인 필요가 {knowledge.openAsks}건 있습니다. 채우면 다음 초안이 더 말할 수 있습니다.
          </p>
        ) : null}

        <Facts className="text-sm">
          <Link to="/knowledge" className="font-semibold text-brand-700 hover:underline">
            답변 기준 보기
          </Link>
          {context.productId ? (
            <Link to={`/products/${context.productId}`} className="font-semibold text-brand-700 hover:underline">
              상품 화면 열기
            </Link>
          ) : null}
        </Facts>

        {/* The second sentence points at 「아래 초안」, and a preview has no draft below it — the same wrong
            pointer the 처리 방법 note had. The first sentence is the one that matters (these are counts of
            what is FILED, not of what a draft used), so the preview keeps it and drops the direction. */}
        <p className="break-keep text-sm leading-relaxed text-muted">
          {EVIDENCE_NOTE.countsAreFiled} 초안이 실제로 무엇을 근거로 썼는지는 아래 초안에 인용으로 나옵니다.
        </p>
      </div>
    </Section>
  );
}

package com.sellerops.knowledge.bootstrap;

import java.util.List;
import java.util.Locale;

/**
 * <b>Which operating history each channel lets Reviewnary learn from, and how</b> — declared once, from what this
 * repository's collection paths actually read, so the screen never promises a source that is not there.
 *
 * <p>Every row is a repository fact with its evidence named in the javadoc beside it. Nothing here is a plan: a
 * source the official API offers but this product does not read is {@link Availability#NOT_WIRED}, not
 * {@link Availability#LEARNED}; a source only a seller-center screen might show, which nobody has observed, is
 * {@link Availability#SCREEN_UNPROVEN}. Channels not declared here answer {@link Availability#NOT_AVAILABLE}.
 *
 * <p>Record evidence (Customer Ops Product Quality Closure v1, 2026-09-18):
 * <ul>
 *   <li><b>NAVER inquiry answers — LEARNED.</b> Both official resources return the seller's published answer text
 *       ({@code NaverProductQnaClient} {@code answer}, {@code NaverCustomerInquiriesClient} {@code answerContent});
 *       ingest stores it as {@code inquiries.answer_body}; {@code InquiryAnswerMemoryImporter} records it as
 *       {@code IMPORTED_SELLER_ANSWER} after every inquiry ingest. The routine lane reaches 14 days back
 *       ({@code NaverInquiryCursor}); the older history is the bounded READ {@link KnowledgeBootstrapService} runs.
 *       Demo Org: 20 of 20 answered official rows carry the text.</li>
 *   <li><b>NAVER review replies — SCREEN_UNPROVEN.</b> NAVER has no review API. The Seller Center export's 25 columns
 *       ({@code contracts/review-export/naver/v1}) carry 답글여부 and 답글등록일시 and <i>no reply text</i>. Whether the
 *       Seller Center review screen exposes the reply text to a read has not been observed.</li>
 *   <li><b>NAVER product detail — LEARNED, per product.</b> {@code NaverChannelProductClient} reads
 *       {@code detailContent} and the options; {@code ProductDetailEnrichment} indexes the text when the page carries
 *       its answers as text. The 상품정보제공고시 sub-structure is not in the vendored contract and is not projected.</li>
 *   <li><b>Cafe24 inquiry answers — NOT_PROMOTED.</b> The answer is a child article or a board comment. The child
 *       article's author is not projected, so the stored row cannot prove the seller wrote it
 *       ({@code docs/inquiry_thread_semantics_v1.md}); the comment observer proves a seller comment but stores no
 *       body ({@code docs/cafe24_comment_answer_observation_v1.md}).</li>
 *   <li><b>Cafe24 review replies — NOT_WIRED.</b> Board comments are the same documented resource the inquiry
 *       observer reads; no review path reads them.</li>
 *   <li><b>Cafe24 product detail — LEARNED.</b> The catalogue sweep stores the description and spec facts.</li>
 *   <li><b>Coupang inquiry answers — NOT_PROMOTED.</b> {@code commentDtoList} entries carry no author field, so a
 *       seller's answer cannot be told from a buyer's follow-up ({@code CoupangInquiriesClient}).</li>
 *   <li><b>Coupang review replies — NOT_AVAILABLE.</b> The channel offers sellers no review reply.</li>
 *   <li><b>Coupang product detail — LEARNED.</b> The catalogue sweep stores spec and taxonomy facts.</li>
 * </ul>
 */
public final class ChannelHistoryCapability {

    /** How a history source reaches Reviewnary on one channel. */
    public enum Availability {
        /** Read by an official path this product runs; learned without the seller doing anything. */
        LEARNED,
        /** Read, but the stored row cannot prove the seller wrote it, so it is not company knowledge. */
        NOT_PROMOTED,
        /** The official API offers it; this product does not read it yet. */
        NOT_WIRED,
        /** Only a seller-center screen might show it, and no read of that screen has been observed. */
        SCREEN_UNPROVEN,
        /** The channel has no such thing, or no path to it exists. */
        NOT_AVAILABLE
    }

    /** One channel × source statement, with the sentence the seller reads. */
    public record Row(String channelCode, HistorySource source, Availability availability, String sentenceKo) {
    }

    private static final List<Row> ROWS = List.of(
            new Row("NAVER", HistorySource.PAST_INQUIRY_ANSWER, Availability.LEARNED,
                    "네이버에 등록하신 문의 답변을 가져와 비슷한 문의에 참고합니다."),
            new Row("NAVER", HistorySource.PAST_REVIEW_REPLY, Availability.SCREEN_UNPROVEN,
                    "네이버는 리뷰 답글 내용을 API나 내려받기 파일로 주지 않아 아직 가져오지 못합니다."),
            new Row("NAVER", HistorySource.PRODUCT_DETAIL, Availability.LEARNED,
                    "상품 상세페이지의 글과 옵션을 상품별로 읽어 둡니다. 글 대신 이미지로 된 상세페이지는 읽지 못합니다."),
            new Row("CAFE24", HistorySource.PAST_INQUIRY_ANSWER, Availability.NOT_PROMOTED,
                    "카페24 답변은 누가 썼는지 확인할 수 없어 회사 답변으로 쓰지 않습니다."),
            new Row("CAFE24", HistorySource.PAST_REVIEW_REPLY, Availability.NOT_WIRED,
                    "카페24 리뷰 댓글은 아직 가져오지 않습니다."),
            new Row("CAFE24", HistorySource.PRODUCT_DETAIL, Availability.LEARNED,
                    "상품 설명과 사양을 상품 정보 수집 때 함께 가져옵니다."),
            new Row("COUPANG", HistorySource.PAST_INQUIRY_ANSWER, Availability.NOT_PROMOTED,
                    "쿠팡은 답변을 누가 썼는지 알려주지 않아 회사 답변으로 쓰지 않습니다."),
            new Row("COUPANG", HistorySource.PAST_REVIEW_REPLY, Availability.NOT_AVAILABLE,
                    "쿠팡은 판매자 리뷰 답글 기능이 없습니다."),
            new Row("COUPANG", HistorySource.PRODUCT_DETAIL, Availability.LEARNED,
                    "상품 사양과 분류를 상품 정보 수집 때 함께 가져옵니다."));

    private ChannelHistoryCapability() {
    }

    public static Row of(String channelCode, HistorySource source) {
        String code = channelCode == null ? "" : channelCode.toUpperCase(Locale.ROOT);
        return ROWS.stream().filter(r -> r.channelCode().equals(code) && r.source() == source).findFirst()
                .orElse(new Row(code, source, Availability.NOT_AVAILABLE,
                        source.labelKo() + " — 이 채널에서는 가져올 방법이 없습니다."));
    }

    /** Whether the history bootstrap has a bounded READ to run for this channel's past inquiry answers. */
    public static boolean learnsInquiryHistory(String channelCode) {
        return of(channelCode, HistorySource.PAST_INQUIRY_ANSWER).availability() == Availability.LEARNED;
    }

    public static List<Row> all() {
        return ROWS;
    }
}

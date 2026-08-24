package com.sellerops.inquiry.publish;

import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.inquiry.publish.dto.InquiryReplyCapabilityView;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * What is known — from this repository and from audited vendor contracts — about posting a reply to
 * each channel's inquiries. A narrow, code-level registry, in the manner of {@code
 * ChannelApiGapRegistry}: it moves no capability status in
 * {@code docs/multi-channel-connector-roadmap.md} §4.1 and opens no schedule. It exists so a screen
 * can say the precise thing instead of inferring "unsupported" from the absence of an adapter.
 *
 * <p><b>Every row cites what it was derived from, and nothing is guessed.</b> A row is
 * {@link InquiryReplyTransport#DIRECT_API} only when an implemented endpoint exists in this
 * repository — not when a vendor's documentation is believed to describe one. A channel nobody has
 * audited is {@link InquiryReplyTransport#NEEDS_VERIFICATION}, which is a statement about the audit,
 * not about the channel.
 *
 * <p><b>NAVER is split by source subtype</b> because the two are different resources with different
 * identifier spaces ({@code questionId} vs {@code inquiryNo}) and would need different endpoints. An
 * approval for one is not an approval for the other, which is why the subtype is bound into the
 * approval and re-checked before the send.
 */
@Component
public class InquiryReplyCapabilityRegistry {

    /** One audited answer. {@code sourceSubtype} is null for a channel with a single source. */
    public record Row(String channelCode, String sourceSubtype, InquiryReplyTransport transport,
                      String reasonKo, String evidence) {
    }

    /**
     * The audit, as of Inquiry Action Flow v1 (2026-08-24).
     *
     * <p>COUPANG is the only DIRECT_API, and it is one because the endpoint is implemented here
     * ({@code CoupangInquiryReplyClient} → {@code POST .../onlineInquiries/{inquiryId}/replies}) with
     * an adapter that resolves the target from the {@code onlineInquiry:} handle stored at collection
     * time. It has never been exercised against a real marketplace; "implemented" and "live-proven"
     * are different claims and only the first is made here.
     *
     * <p>Both NAVER subtypes are PLATFORM_SUPPORTED_NOT_IMPLEMENTED. This row said UNSUPPORTED until
     * 2026-08-24, and that was wrong in the direction that matters: it read as a NAVER limitation when
     * the refusal is entirely ours. The Commerce API index vendored here
     * ({@code docs/vendor/naver-commerce-api/llms.txt} §문의) lists an answer endpoint for each of the
     * two subtypes — {@code PUT /v1/contents/qnas/&#123;questionId&#125;} for 상품 문의 and
     * {@code POST /v1/pay-merchant/inquiries/&#123;inquiryNo&#125;/answer} for 고객 문의. What blocks the
     * send is {@code NaverReadOnlyFenceTest}, which refuses {@code /external/v1/pay-merchant},
     * {@code qnas/} and {@code /answer} by name, so no build of this product can post a NAVER answer.
     * Implementing them is a later package; nothing here moves toward it.
     *
     * <p>CAFE24 is NEEDS_VERIFICATION and that is deliberate. The connector reads board 6 through
     * {@code Cafe24BoardArticlesClient}, which has no write method; whether the Admin API exposes a
     * board-comment write that a seller's OAuth scope would carry has not been audited. Rendering that
     * as "unsupported" would be inventing a vendor limitation, which this repository does not do.
     */
    private static final List<Row> ROWS = List.of(
            new Row("COUPANG", null, InquiryReplyTransport.DIRECT_API,
                    "쿠팡 상품별 고객문의는 공식 답변 API로 등록할 수 있습니다.",
                    "CoupangInquiryReplyClient · CoupangChannelReplyAdapter (구현됨, 라이브 미실행)"),
            new Row("NAVER", InquirySourceSubtype.NAVER_PRODUCT_QNA,
                    InquiryReplyTransport.PLATFORM_SUPPORTED_NOT_IMPLEMENTED,
                    "네이버는 상품 문의 답변 등록 API를 제공하지만, SellerOps가 아직 연결하지 않았습니다.",
                    "공식: PUT /v1/contents/qnas/{questionId} (llms.txt §문의) · "
                            + "미구현: NaverReadOnlyFenceTest가 쓰기 경로 3종을 이름으로 거부"),
            new Row("NAVER", InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY,
                    InquiryReplyTransport.PLATFORM_SUPPORTED_NOT_IMPLEMENTED,
                    "네이버는 고객 문의 답변 등록 API를 제공하지만, SellerOps가 아직 연결하지 않았습니다.",
                    "공식: POST /v1/pay-merchant/inquiries/{inquiryNo}/answer (llms.txt §문의) · "
                            + "미구현: NaverReadOnlyFenceTest가 쓰기 경로 3종을 이름으로 거부"),
            new Row("CAFE24", null, InquiryReplyTransport.NEEDS_VERIFICATION,
                    "카페24 문의 답변 등록 경로는 아직 확인하지 않았습니다. 지원하지 않는다는 뜻은 아닙니다.",
                    "Cafe24BoardArticlesClient — 읽기 전용 · 벤더 쓰기 계약 미감사"));

    /**
     * The audited answer for a channel + source subtype.
     *
     * <p>An exact subtype match wins; otherwise the channel's subtype-less row answers. A channel with
     * no row at all resolves to {@link InquiryReplyTransport#NEEDS_VERIFICATION} — the honest default,
     * because a channel nobody entered here is a channel nobody audited.
     */
    public InquiryReplyCapabilityView capability(String channelCode, String sourceSubtype) {
        if (channelCode == null) {
            return unaudited(null, sourceSubtype);
        }
        Optional<Row> exact = ROWS.stream()
                .filter(r -> r.channelCode().equals(channelCode) && Objects.equals(r.sourceSubtype(), sourceSubtype))
                .findFirst();
        Optional<Row> byChannel = exact.or(() -> ROWS.stream()
                .filter(r -> r.channelCode().equals(channelCode) && r.sourceSubtype() == null)
                .findFirst());
        return byChannel
                .map(r -> new InquiryReplyCapabilityView(channelCode, sourceSubtype,
                        r.transport().name(), r.reasonKo(), r.evidence()))
                .orElseGet(() -> unaudited(channelCode, sourceSubtype));
    }

    /** Every audited row, for a capability screen. */
    public List<InquiryReplyCapabilityView> all() {
        return ROWS.stream()
                .map(r -> new InquiryReplyCapabilityView(r.channelCode(), r.sourceSubtype(),
                        r.transport().name(), r.reasonKo(), r.evidence()))
                .toList();
    }

    private static InquiryReplyCapabilityView unaudited(String channelCode, String sourceSubtype) {
        return new InquiryReplyCapabilityView(channelCode, sourceSubtype,
                InquiryReplyTransport.NEEDS_VERIFICATION.name(),
                "이 채널의 문의 답변 등록 경로는 아직 확인하지 않았습니다.", "감사 기록 없음");
    }
}

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

    /**
     * One audited answer. {@code sourceSubtype} is null for a channel with a single source.
     *
     * <p>{@code overwrites} records whether this channel's own write REPLACES an answer that is
     * already there instead of refusing. It is a property of the vendor's contract, read off the
     * vendored document, and it changes what SellerOps is allowed to do when it cannot prove the
     * target's current state — see {@link #overwritesExistingAnswer}.
     */
    public record Row(String channelCode, String sourceSubtype, InquiryReplyTransport transport,
                      boolean overwrites, String reasonKo, String evidence) {
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
     * <p><b>Both NAVER subtypes are DIRECT_API as of Inquiry Workflow Completion v2 (2026-08-24),
     * and they are two rows because they are two contracts.</b> The official per-endpoint documents
     * are vendored here — {@code docs/vendor/naver-commerce-api/put-v1-contents-qnas-questionId.md}
     * and {@code post-v1-pay-merchant-inquiries-inquiryNo-answer.md} — and what they show is exactly
     * why "a generic NAVER write" would have been a fiction:
     *
     * <table>
     *   <caption>The two answer contracts, side by side</caption>
     *   <tr><th></th><th>상품 문의</th><th>고객 문의</th></tr>
     *   <tr><td>call</td><td>{@code PUT /v1/contents/qnas/&#123;questionId&#125;}</td>
     *       <td>{@code POST /v1/pay-merchant/inquiries/&#123;inquiryNo&#125;/answer}</td></tr>
     *   <tr><td>body</td><td>{@code commentContent}</td><td>{@code answerComment}</td></tr>
     *   <tr><td>target</td><td>{@code questionId} (int64)</td><td>{@code inquiryNo} (int64)</td></tr>
     *   <tr><td>already answered</td><td><b>silently overwrites</b> — the vendor states a second call
     *       "등록이 아닌 수정으로 동작"</td><td><b>refuses</b> with {@code ERR-NC-101010}</td></tr>
     *   <tr><td>errors</td><td>plain 400/401/403/404/500</td><td>{@code ERR-NC-1010xx} inside 400</td></tr>
     * </table>
     *
     * <p>The identifier spaces do not overlap and both are bare int64s, so an approval for one spent
     * on the other would not fail — it would answer a different customer's question. That is the
     * reason the subtype is bound into the approval and re-checked before the send, and the reason
     * each adapter names its own subtype in {@code servesSubtype}.
     *
     * <p><b>The connector's read-only fence is untouched.</b> The answer clients live in
     * {@code inquiry/publish/naver}, not in {@code connector/naver}, so
     * {@code NaverReadOnlyFenceTest} still holds over the lane that runs on a SCHEDULE with no human
     * in the turn. The write lane is the one that can never run without one.
     *
     * <p>CAFE24 is NEEDS_VERIFICATION and that is deliberate. See the re-audit below.
     *
     * <p><b>Re-audited 2026-08-24 (Inquiry Workflow Completion v2).</b>
     *
     * <ul>
     *   <li><b>NAVER</b> — moved PLATFORM_SUPPORTED_NOT_IMPLEMENTED → DIRECT_API for both subtypes,
     *       on the strength of the vendored request contracts above and the adapters written against
     *       them. Implemented is still not live-proven: neither has ever been exercised against a
     *       real store, and no NAVER answer can leave the process without an armed live-run approval
     *       id ({@code NaverAnswerLiveGuard}).</li>
     *   <li><b>CAFE24</b> — the platform side is now CONFIRMED and the SellerOps side is not, which is
     *       two different facts and the row records the weaker one. Confirmed from the official Admin
     *       API reference ({@code docs/vendor/cafe24-admin-api/post-boards-articles-comments.md}):
     *       {@code POST /api/v2/admin/boards/&#123;board_no&#125;/articles/&#123;article_no&#125;/comments}
     *       exists, takes scope {@code mall.write_community}, and REQUIRES {@code content},
     *       {@code writer} and {@code password}. Two things block it, and neither is a decision
     *       waiting to be made:
     *       <ol>
     *         <li>A comment is not proven to BE a seller answer on board 6. SellerOps derives
     *             ANSWERED from the article's {@code reply_status}, and nothing in this repository
     *             shows that posting a comment moves it — comments are not collected
     *             ({@code Cafe24ApiConnector#unsupportedScopes} names COMMENTS) and every one of the
     *             905 collected board-6 articles carries {@code PENDING}. Settling it needs a READ of
     *             the comments on an article whose status is 처리완료, which is a live marketplace
     *             call and needs its own approval.</li>
     *         <li>{@code writer} and {@code password} are required and SellerOps holds neither.
     *             Hardcoding them is forbidden and inventing them would put a fabricated author on a
     *             customer-visible reply.</li>
     *       </ol>
     *       The connection's own grant is a third, independent fact:
     *       {@code mall.read_community,mall.read_order,mall.read_product} — read-only, so a write
     *       would need the seller's re-consent even with everything above settled.</li>
     *   <li><b>COUPANG · GMARKET</b> — unchanged: implemented, never live-proven.</li>
     * </ul>
     */
    private static final List<Row> ROWS = List.of(
            new Row("COUPANG", null, InquiryReplyTransport.DIRECT_API, false,
                    "쿠팡 상품별 고객문의는 공식 답변 API로 등록할 수 있습니다.",
                    "CoupangInquiryReplyClient · CoupangChannelReplyAdapter (구현됨, 라이브 미실행)"),
            new Row("NAVER", InquirySourceSubtype.NAVER_PRODUCT_QNA,
                    InquiryReplyTransport.DIRECT_API, true,
                    "네이버 상품 문의는 공식 답변 등록 API로 보낼 수 있습니다.",
                    "공식 계약 사본: put-v1-contents-qnas-questionId.md (body: commentContent) · "
                            + "NaverProductQnaAnswerClient · NaverProductQnaReplyAdapter "
                            + "(구현됨, 라이브 미실행) · 같은 questionId 재호출은 덮어쓰기"),
            new Row("NAVER", InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY,
                    InquiryReplyTransport.DIRECT_API, false,
                    "네이버 고객 문의는 공식 답변 등록 API로 보낼 수 있습니다.",
                    "공식 계약 사본: post-v1-pay-merchant-inquiries-inquiryNo-answer.md "
                            + "(body: answerComment) · NaverCustomerInquiryAnswerClient · "
                            + "NaverCustomerInquiryReplyAdapter (구현됨, 라이브 미실행) · "
                            + "중복 답변은 ERR-NC-101010으로 거부됨"),
            new Row("GMARKET", null, InquiryReplyTransport.DIRECT_API, false,
                    "ESM+(지마켓/옥션) 문의는 구현된 답변 등록 경로로 보낼 수 있습니다.",
                    "EsmAnswerClient · EsmChannelReplyAdapter (구현됨, 실행 플래그 뒤에서만 등록)"),
            new Row("CAFE24", null, InquiryReplyTransport.NEEDS_VERIFICATION, false,
                    "카페24 게시판 댓글 등록 API는 확인했지만, 그 댓글이 문의 답변으로 처리되는지는 "
                            + "아직 확인하지 않았습니다. 지원하지 않는다는 뜻은 아닙니다.",
                    "플랫폼: POST /api/v2/admin/boards/{board_no}/articles/{article_no}/comments "
                            + "(scope mall.write_community, 필수 content·writer·password) — 공식 사본 보관 · "
                            + "미확정: board 6 댓글이 reply_status를 바꾸는지 근거 없음(댓글 미수집, "
                            + "수집된 905건 전부 PENDING) · writer/password를 SellerOps가 보유하지 않음 · "
                            + "현재 연결 scope는 mall.read_community,mall.read_order,mall.read_product (쓰기 미포함)"));

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

    /**
     * Whether SellerOps can actually post a reply to this channel + source subtype <em>today</em>.
     *
     * <p>Only {@link InquiryReplyTransport#DIRECT_API} answers true, and the reason is the distinction
     * this registry exists to keep: {@code PLATFORM_SUPPORTED_NOT_IMPLEMENTED} means the endpoint is
     * real and we have not connected it, {@code NEEDS_VERIFICATION} means nobody has looked, and
     * {@code GUIDED_ACTION} means the seller completes the action themselves. All three are honest
     * descriptions of a channel and none of them is a send this product can perform, so all three
     * stop a dispatch. {@code UNSUPPORTED} stops it too, for the one case where the channel is the
     * thing that refuses.
     *
     * <p>Resolution is per subtype and never widens: a subtype with no row of its own falls back to
     * its channel's subtype-less row only if one exists, which for NAVER it deliberately does not.
     */
    public boolean isImplemented(String channelCode, String sourceSubtype) {
        return InquiryReplyTransport.DIRECT_API.name()
                .equals(capability(channelCode, sourceSubtype).transport());
    }

    /**
     * Whether sending to this channel + subtype would REPLACE an answer that is already there.
     *
     * <p>True for exactly one audited row today: NAVER 상품 문의, whose
     * {@code PUT /v1/contents/qnas/&#123;questionId&#125;} the vendor describes as behaving "등록이
     * 아닌 수정으로" on a second call. Coupang, ESM+ and NAVER 고객 문의 all refuse a duplicate
     * instead, the last of them with its own code ({@code ERR-NC-101010}).
     *
     * <p>The distinction is not academic. Everywhere else, sending on a stale reading of "still
     * unanswered" risks a SECOND answer beside the first — visible, embarrassing, recoverable. Here
     * it risks REPLACING what a person typed in the NAVER console, with nothing left to recover from.
     * So this is the one case where SellerOps refuses rather than warns when it cannot prove the
     * target's current state ({@code PreSendCheck#OVERWRITE_WITHOUT_PROOF}).
     *
     * <p>A channel nobody audited answers false — but it cannot dispatch at all, so the value never
     * decides anything on its own.
     */
    public boolean overwritesExistingAnswer(String channelCode, String sourceSubtype) {
        if (channelCode == null) {
            return false;
        }
        return ROWS.stream()
                .filter(r -> r.channelCode().equals(channelCode)
                        && Objects.equals(r.sourceSubtype(), sourceSubtype))
                .findFirst()
                .or(() -> ROWS.stream()
                        .filter(r -> r.channelCode().equals(channelCode) && r.sourceSubtype() == null)
                        .findFirst())
                .map(Row::overwrites)
                .orElse(false);
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

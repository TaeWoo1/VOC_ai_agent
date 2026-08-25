package com.sellerops.inquiry.publish.cafe24;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Every field {@code POST /api/v2/admin/boards/&#123;board_no&#125;/articles} accepts, and what
 * SellerOps would put in it to attach an ANSWER to an existing 문의 article — classified, sourced,
 * and deliberately not yet a request builder.
 *
 * <p>This class is the audit, held as code so it cannot drift from the adapter that will read it.
 * Its only source is the vendored contract, {@code docs/vendor/cafe24-admin-api/get-boards-articles.md},
 * which is a transcription of the official Admin API reference. Nothing here is inferred from how
 * another channel behaves and nothing is remembered from a URL.
 *
 * <h2>Why a classification and not a body</h2>
 *
 * <p>The contract marks five fields REQUIRED — {@code board_no}, {@code writer}, {@code title},
 * {@code content}, {@code client_ip} — and SellerOps holds a value for exactly two of them
 * ({@code board_no}, and {@code content} once a human has approved a draft). The other three name a
 * person, a subject line, and a network address. Each has a {@link Sourcing} that says where a value
 * could legitimately come from, and three of them resolve to
 * {@link Sourcing#UNRESOLVED_NEEDS_OBSERVATION} or {@link Sourcing#PRODUCT_OWNER_DECISION} today. A
 * class that assembled a body regardless would have to invent them, and an invented {@code writer}
 * is a fabricated author on a message a customer reads.
 *
 * <p>So {@link #writeReady()} is false, and it is false for reasons the caller can enumerate rather
 * than for a flag someone forgot to flip.
 */
public final class Cafe24ReplyRequestShape {

    private Cafe24ReplyRequestShape() {
    }

    /** How the contract itself treats a field on this endpoint. */
    public enum Requirement {
        /** The reference marks it Required. Omitting it is not an option. */
        REQUIRED,
        /** Accepted, and SellerOps has a reason to send it. */
        OPTIONAL_USED,
        /** Accepted, and SellerOps will not send it. The reason is on the row. */
        NOT_USED
    }

    /** Where a value for this field may legitimately come from. */
    public enum Sourcing {
        /** SellerOps already holds it: the target article, the board, the approved draft. */
        HELD,
        /** The connection holds it — {@code mall_id} from the stored Cafe24 credential. */
        CONNECTION,
        /** The contract documents a specific value or rule that decides it. */
        CONTRACT_DOCUMENTED,
        /**
         * A deployment has to state it explicitly — it is not readable off a page and not derivable
         * at runtime. Unset is not a default; the adapter refuses to send.
         */
        DEPLOYMENT_CONFIGURED,
        /** Not decidable from the contract; the reply-actor observation is what answers it. */
        UNRESOLVED_NEEDS_OBSERVATION,
        /** Not a fact anyone can read off a page — someone has to decide and configure it. */
        PRODUCT_OWNER_DECISION,
        /** Nothing to source: the field is not sent. */
        NONE
    }

    /**
     * One field of the create request.
     *
     * @param name        the contract's own field name
     * @param requirement how the contract treats it
     * @param sourcing    where a legitimate value comes from
     * @param noteKo      why this row says what it says, in the seller-facing language of this repo
     */
    public record Field(String name, Requirement requirement, Sourcing sourcing, String noteKo) {

        /** A field that still blocks a WRITE: required (or used) and no value can be sourced yet. */
        public boolean blocksWrite() {
            return requirement != Requirement.NOT_USED
                    && (sourcing == Sourcing.UNRESOLVED_NEEDS_OBSERVATION
                    || sourcing == Sourcing.PRODUCT_OWNER_DECISION);
        }
    }

    /**
     * The complete accepted-field list of the create endpoint, in the contract's own order.
     *
     * <p>Read the {@code NOT_USED} rows as decisions, not omissions. {@code secret} is the sharpest
     * of them: a reply to a 비밀글 inheriting the parent's visibility is exactly the kind of thing a
     * default would get wrong in the customer-facing direction, so it is not defaulted here — it is
     * named as a decision. {@code reply_status} is the second: the contract accepts it on this call
     * and does not say whether setting it marks the PARENT answered, and that difference is the
     * whole difference between "the answer went out" and "the queue is clear".
     */
    private static final List<Field> FIELDS = List.of(
            new Field("board_no", Requirement.REQUIRED, Sourcing.HELD,
                    "문의가 수집된 게시판 번호 — 대상 문의 행이 이미 들고 있다."),
            new Field("reply_article_no", Requirement.OPTIONAL_USED, Sourcing.HELD,
                    "이 필드가 글을 답변으로 만든다. 승인된 대상 문의의 article_no이며, "
                            + "여기에 답글(REPLY) 행의 번호가 들어가면 고객의 질문이 아닌 글에 답하게 된다."),
            new Field("content", Requirement.REQUIRED, Sourcing.HELD,
                    "사람이 승인한 초안 본문. 승인 해시에 묶인 값 외에는 보내지 않는다."),
            new Field("writer", Requirement.REQUIRED, Sourcing.CONNECTION,
                    "연결이 이미 들고 있는 mall_id를 보낸다. 지어낸 사람 이름이 아니고, 계약이 "
                            + "member_id=mall_id일 때 작성자를 상점명으로 렌더링한다고 보장하므로 "
                            + "고객이 보는 이름이 되지도 않는다 — 관측(43/44가 상점 정체)이 그 "
                            + "렌더링과 양립한다. 기존 답변의 writer 값을 복사하지는 않는다."),
            new Field("title", Requirement.REQUIRED, Sourcing.HELD,
                    "질문 글의 제목 그대로. 관측이 결정적이다 — SAME_AS_PARENT 43 · 변형 1(그 1건은 "
                            + "답글에 달린 답글) · OTHER 0. 고객 제목을 가공하는 규칙은 만들지 않고, "
                            + "제목이 없거나 256자를 넘으면 자르지 않고 fail-close 한다."),
            new Field("client_ip", Requirement.REQUIRED, Sourcing.DEPLOYMENT_CONFIGURED,
                    "계약상 '작성자의 IP'. 기존 답변에서 관측되지만(44/44) 그 값을 재사용하지 "
                            + "않는다 — 과거 작성자의 IP는 새 요청을 보내는 클라이언트가 아니다. "
                            + "Action Executor의 egress IP를 배포 설정으로 명시하며, 런타임 외부 "
                            + "조회로 추측하지 않는다. 미설정이면 전송하지 않는다."),
            new Field("member_id", Requirement.OPTIONAL_USED, Sourcing.CONNECTION,
                    "계약이 명시한 유일한 출구 — member_id가 mall_id와 같으면 작성자가 사람 이름이 "
                            + "아니라 상점명으로 렌더링된다. 관측에서 이 판매자의 기존 답변 43/44가 "
                            + "실제로 그 조건을 만족한다. 연결이 이미 mall_id를 들고 있다."),
            new Field("reply_status", Requirement.OPTIONAL_USED, Sourcing.HELD,
                    "C를 보낸다 — 계약이 같은 호출에서 받는 유일한 완료 표시 수단이다. 다만 그것이 "
                            + "부모에 붙는지 자식에 붙는지는 여전히 미증명이며(관측된 자식은 전부 "
                            + "null, 부모는 43/44가 C), 따라서 전송 성공은 완료 표시를 뜻하지 "
                            + "않는다 — 부모 상태는 read-back으로 관측하고 다르면 Case B로 남긴다."),
            new Field("reply_user_id", Requirement.NOT_USED, Sourcing.NONE,
                    "필수가 아니며 의미가 증명되지 않았다. 관측상 자식에는 0/44로 아예 없고 부모에만 "
                            + "43/44 있다 — 자식에 실으면 플랫폼 자신이 만들지 않는 형태가 된다."),
            new Field("secret", Requirement.NOT_USED, Sourcing.PRODUCT_OWNER_DECISION,
                    "비밀글에 대한 답변이 비밀이어야 하는지는 계약이 정하지 않는다. 기본값을 "
                            + "고르는 것이 곧 고객 노출 결정이므로 여기서 정하지 않는다."),
            new Field("password", Requirement.NOT_USED, Sourcing.NONE,
                    "이 endpoint에서는 선택이다(댓글 POST에서는 필수). 보내지 않는다."),
            new Field("shop_no", Requirement.NOT_USED, Sourcing.NONE, "기본값 1을 쓴다."),
            new Field("created_date", Requirement.NOT_USED, Sourcing.NONE,
                    "작성 시각을 우리가 정하지 않는다."),
            new Field("writer_email", Requirement.NOT_USED, Sourcing.NONE, "판매자 이메일을 싣지 않는다."),
            new Field("nick_name", Requirement.NOT_USED, Sourcing.NONE, "보내지 않는다."),
            new Field("notice", Requirement.NOT_USED, Sourcing.NONE, "답변은 공지가 아니다."),
            new Field("fixed", Requirement.NOT_USED, Sourcing.NONE, "답변을 고정하지 않는다."),
            new Field("deleted", Requirement.NOT_USED, Sourcing.NONE, "삭제 상태를 쓰지 않는다."),
            new Field("reply", Requirement.NOT_USED, Sourcing.NONE,
                    "답변 신호가 아니다 — 답변된 글에서도 F로 관측되었다(2026-08-25)."),
            new Field("reply_mail", Requirement.NOT_USED, Sourcing.NONE,
                    "메일 발송은 별도의 고객 접촉이며 승인 대상이 아니다."),
            new Field("rating", Requirement.NOT_USED, Sourcing.NONE, "문의 답변에 평점은 없다."),
            new Field("sales_channel", Requirement.NOT_USED, Sourcing.NONE, "보내지 않는다."),
            new Field("input_channel", Requirement.NOT_USED, Sourcing.NONE, "기본값을 쓴다."),
            new Field("board_category_no", Requirement.NOT_USED, Sourcing.NONE, "분류를 바꾸지 않는다."),
            new Field("product_no", Requirement.NOT_USED, Sourcing.NONE,
                    "부모 글이 이미 상품을 지목한다. 답변이 다시 지목하지 않는다."),
            new Field("category_no", Requirement.NOT_USED, Sourcing.NONE, "보내지 않는다."),
            new Field("order_id", Requirement.NOT_USED, Sourcing.NONE,
                    "주문 참조는 채널이 지목한 것만 저장한다 — 우리가 새로 붙이지 않는다."),
            new Field("naverpay_review_id", Requirement.NOT_USED, Sourcing.NONE, "해당 없음."),
            new Field("attach_file_urls", Requirement.NOT_USED, Sourcing.NONE, "첨부를 보내지 않는다."));

    /** The audit, in contract order. */
    public static List<Field> fields() {
        return FIELDS;
    }

    /** One field by its contract name, or empty for a name this endpoint does not accept. */
    public static Optional<Field> field(String name) {
        String needle = name == null ? "" : name.strip().toLowerCase(Locale.ROOT);
        return FIELDS.stream().filter(f -> f.name().equals(needle)).findFirst();
    }

    /**
     * The fields that still stop a WRITE — required or used, with no value anyone is allowed to
     * source yet. Empty is the only state in which {@link #writeReady()} is true.
     */
    public static List<Field> blockers() {
        return FIELDS.stream().filter(Field::blocksWrite).toList();
    }

    /**
     * Whether every field of the create request now has a rule saying where its value comes from.
     *
     * <p><b>This is not a statement that a reply can be sent.</b> It is about the BODY only. A send
     * additionally needs a write grant the seller has to consent to, a configured
     * {@code client_ip} ({@link Sourcing#DEPLOYMENT_CONFIGURED} means a deployment states it, not
     * that one has), an approved draft, and a target this repository can name — all of which are
     * runtime facts checked elsewhere and none of which this class can see.
     *
     * <p>Deliberately derived rather than declared: it became true when the rows above stopped
     * saying {@code UNRESOLVED_NEEDS_OBSERVATION} / {@code PRODUCT_OWNER_DECISION}, which took an
     * approved observation, and never a flipped boolean.
     */
    public static boolean requestShapeSettled() {
        return blockers().isEmpty();
    }
}

package com.sellerops.ingest.canonical;

/**
 * 출처가 말하는 이 글의 <b>구조적 역할</b> — 스레드의 뿌리인가, 스레드 안의 답글인가.
 *
 * <p><b>이것은 "누가 썼는가"가 아니다.</b> 두 질문은 다르고, 하나만 증명됐다. Cafe24 board 6에서
 * 답변은 질문에 달린 <em>자식 글</em>이라는 것은 승인된 bounded READ proof로 확정됐지만
 * ({@code docs/inquiry_answer_execution_v1.md} — 검증된 관계는 {@code parent_article_no == 부모}),
 * 그 자식을 <em>판매자가</em> 썼다는 것은 확정되지 않았다. 자식 글에는 {@code reply_user_id}가 없었고,
 * 작성자를 말하는 나머지 필드({@code writer}, {@code member_id})는 고객 PII를 함께 나르기 때문에
 * 이 저장소가 투영하지 않는다. 그래서 이 어휘는 행위자에 대해 아무 말도 하지 않는다.
 *
 * <p>증명된 것은 딱 이것이다: <b>답글은 새로운 고객 문의가 아니다.</b> 그 하나가 이 enum의 전부이고,
 * 그것만으로 "판매자가 지금 답해야 하는 것"의 집합이 달라진다.
 *
 * <p>{@code null}은 정직한 값이다 — 스레드 구조를 발행하지 않는 출처(파일 업로드, ESM, NAVER,
 * Coupang)는 역할을 주장하지 않는다. {@link com.sellerops.inquiry.InquirySourceSubtype}의 {@code null}과
 * 같은 규약이고, 소급해서 채워 넣지 않는다.
 */
public enum SourceThreadRole {

    /** 스레드의 첫 글 — 출처가 부모를 지목하지 않는다. 고객 문의로 취급되는 유일한 역할. */
    ROOT,

    /**
     * 스레드 안의 답글 — 출처가 부모를 지목한다.
     *
     * <p>독립 고객 문의로 취급하지 않는다. 그러나 삭제하지도 않는다: 행은 본문·상태·감사 기록을
     * 그대로 유지하고, 현재 운영 읽기만 지나친다.
     */
    REPLY;

    /** 이 역할이 독립된 고객 문의로서 운영 큐에 들어갈 수 있는가. */
    public boolean isCustomerInquiry() {
        return this == ROOT;
    }
}

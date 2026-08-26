# NAVER 문의 답변 — 라이브 WRITE 증명 (2026-08-26)

> **한 줄.** SellerOps가 실제 마켓플레이스에 **처음으로 답변을 등록했다** — NAVER 상품 문의 1건,
> `PUT` **1회**, 자동 재시도 0, 그리고 발송 0.5초 뒤 **시스템 자신의 결정론적 read-back이
> `ANSWERED`를 관측했다**. `LIVE_VERIFIED`.

| | |
|---|---|
| 날짜 | 2026-08-26 16:17 KST |
| 채널 / capability | NAVER · `NAVER_PRODUCT_QNA` 답변 등록 (`PUT /external/v1/contents/qnas/{questionId}`) |
| 승인 ID | `apr-ce092e823017` (mode `WRITE`, max WRITE 1) — **1회용, 소진됨, 재사용 금지** |
| 커밋 | `00622aff` (`feat/proactive-operations-agent-v1`) — 라이브 실행이 돌던 코드 |
| org / 계정 | Demo Org `7146c50f` · seller account `bdccb7a7` |
| 대상 | inquiry `ae51c7f8` · external `naver-qna:686514802` · work item `7eafaf5a` |
| 결과 | **`LIVE_VERIFIED`** |

---

## 1. 무엇이 나갔는가

고객 질문은 「안녕하세요. 전선이 몇 가닥까지 들어가나요?」 (상품:
`[박스발송] 선바로 일체형 전선몰딩 열고 닫기 편한 전선몰드`).

발송된 본문은 **판매자가 고쳐 쓴 draft v2**다.

| version | author_kind | fingerprint | 상태 |
|---|---|---|---|
| 1 | `MODEL` | `dcee5bcf…` | **보존됨. 발송되지 않았다** |
| 2 | `SELLER` | `817ad463…` | 승인 · 발송 · 검증의 대상 |

append-only 계약은 지켜졌다 — 판매자의 수정이 AI 원본을 덮어쓰지 않고 새 버전이 됐고, 승인은 그
**버전과 fingerprint에 묶여** 기록됐다(`inquiry_approval.approved_draft_version=2`,
`approved_fingerprint=817ad463…`).

## 2. DB truth — 있는 그대로

```
inquiry_approval        1건   version 2 · 817ad463… · approver SELLER:242829f0 · 16:17:13.527
inquiry_action_intent   1건   POST_INQUIRY_REPLY · 같은 fingerprint
inquiry_execution       1건   status COMPLETED · provider_message_no 686514802
                              verify_attempts 1 · presend_state_proven t · failure_reason 없음
inquiry_verification    1건   verified=t · observed_status=ANSWERED · 16:17:14.019
inquiry_reply_draft     2건   v1 MODEL 보존 · v2 SELLER
answer_memory           2건   USER_APPROVED(승인 시) + EXECUTOR_SENT_VERIFIED(검증 성공 시)
                              둘 다 origin_draft_version=2 — 강한 기억의 출처는 판매자의 문장이다
inquiry_work_item       phase COMPLETED
```

감사 흐름은 여섯 줄이고 건너뛴 단계가 없다:

```
WORK_ITEM_OPENED       →OPEN            SYSTEM:CONNECTOR_INGEST   15:38:37
PROPOSAL_ADDED         →PROPOSED        SYSTEM:PROACTIVE_AGENT    15:48:47
APPROVAL_GRANTED       →APPROVED        SELLER:242829f0           16:17:13.529
ACTION_INTENT_CREATED  →ACTION_PENDING  SELLER:242829f0           16:17:13.529
EXECUTION_RECORDED     →EXECUTED        SYSTEM:PUBLISH            16:17:13.853
VERIFICATION_RECORDED  →COMPLETED       SYSTEM:PUBLISH            16:17:14.038
```

**승인과 실행 사이에 사람의 누름이 정확히 하나 있다.** `confirm-publish` 하나가 approval + intent를
쓰고 dispatch를 부른다 — 사전 승인 경로는 존재하지 않고, product-owner가 확인 패널에서
「저장된 버전 2」와 판매자 문장을 눈으로 확인한 뒤 **한 번** 눌렀다.

## 3. 왜 `LIVE_VERIFIED`인가 — 그리고 사람이 본 것은 근거가 아니다

발송 뒤 product-owner가 NAVER 화면에서 답변이 등록된 것을 직접 확인했고, 그 뒤 테스트 문의를
**삭제**했다. 사람이 봤다는 사실은 여기서 판정 근거로 쓰지 않는다.

판정의 근거는 **시스템 자신의 read-back**이며, 그것은 삭제보다 먼저 끝나 있었다. 16:17:14.017에
`NaverProductQnaClient`가 `rows=1 page 1/1 total=1`을 남겼고 — `NaverAnsweredStateReader`가 NAVER에
by-id 조회가 없으므로 창(lead 1h / trail 1min)을 다시 열어 external id를 찾은 것이다 — 2ms 뒤
`observed_status=ANSWERED`가 기록됐다.

- HTTP 2xx는 판정에 쓰이지 않았다. `ReplyPublishResult.confirmed`는 실행을 기록할 뿐이고, 종결은
  별도의 exact read 1회가 정한다.
- **「못 찾음」은 `UNANSWERED`로 바뀌지 않는다.** reader의 상태는 셋이고 부재는 `UNVERIFIABLE`이다.
  이번에는 찾았고, 답변이 달려 있었다.
- 만약 read-back이 삭제 뒤에 돌았다면 판정은 `MARKETPLACE_SEND_CONFIRMED_BY_OPERATOR` +
  `SYSTEM_READBACK_UNVERIFIABLE_AFTER_SOURCE_DELETION`이었을 것이다. **그 경우에도 DB의
  verification 행이나 strong memory를 손으로 만들지 않는다.** 그러지 않아도 됐다.

**소스 삭제는 여기서 아무것도 바꾸지 않는다.** `SOURCE_REMOVED` 의미론을 새로 만들지 않았고,
`InquiryOperationalStateProjector`는 여전히 부재를 삭제로 판정하지 않는다. NAVER action path는
**여기서 CLOSED**다.

## 4. duplicate safety

| 검사 | 값 |
|---|---|
| marketplace WRITE | **1** (`NaverProductQnaAnswerClient.postAnswer` 안에 `putJson` 1회, 루프 없음) |
| approval | **1** |
| execution | **1** (`dispatch_key` 유니크) |
| 자동 재시도 | **0** — adapter에 retry 메서드가 없다 |
| duplicate reply | **0** |

이 endpoint에서 재시도는 중복이 아니라 **덮어쓰기**다(공식 계약: 동일 `questionId` 재호출은 수정).
그래서 보호는 전송 직전 `PreSendCheck#ALREADY_ANSWERED`와 "애매하면 검증하고 재전송하지 않는다"
규칙 두 개이고, 이번 실행은 `presend_state_proven=t`로 그 첫 번째를 통과했다.

## 5. 정리 (§4)

```
SELLEROPS_INQUIRY_PUBLISH_EXECUTION_ENABLED=false   ← 실행 프로세스에서 확인
SELLEROPS_PROACTIVE_ENABLED=false                    ← 실행 프로세스에서 확인
SELLEROPS_INQUIRY_PUBLISH_NAVER_LIVE_APPROVAL_ID     ← 환경에서 제거됨
```

`apr-ce092e823017`은 소진됐고 재사용하지 않는다. scheduler cadence는 손대지 않았다
(`INTERVAL_MS=86400000`, `INITIAL_DELAY_MS=25000` — 증명 전과 동일). DB 직접 수정 0, 마켓플레이스
데이터 편의 수정 0.

## 6. 남은 한계

1. **`inquiries.status`는 여전히 `UNANSWERED`다.** 소스 행은 routine 수집이 뒤집는데, 그 소스가
   marketplace에서 삭제돼 다시는 관측되지 않는다. work item은 `COMPLETED`이지만 채널 coverage가 세는
   미답변 수는 `inquiries.status`를 읽으므로 이 1건이 계속 남는다. **고치지 않았다** — absence를
   삭제로 판정하는 경로를 여는 것이 이 증명의 범위가 아니고, 그 판단은 product-owner의 것이다.
2. **`proactive_case`는 `PREPARED`에 멈춰 있다.** 파생 규칙은 이미 옳다 —
   `phase ∉ {OPEN, PROPOSED}` ⇒ `ACTED`. 그저 tick이 필요하고, §4대로 proactive를 껐다.
3. 초안 품질 결함은 이 실행이 드러낸 **별개의 문제**이며 `docs/answer_applicability_v1.md`가 소유한다.

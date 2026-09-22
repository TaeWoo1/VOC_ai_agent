# Full MVP — 3채널 Production Capability 감사 v1

2026-09-22 · branch `feat/review-decision-workspace-v1` · baseline `e7530e05` · Demo Core는 `68bd10fc` freeze 유지

**이 문서는 새 기능을 정의하지 않는다.** NAVER / CAFE24 / COUPANG 세 채널이 고객 운영 한 바퀴
(수집 → 결합 → Case → Knowledge → 초안 → 승인 → 실행 → 완료 확인)의 어디까지 **실제 production
path로 이어져 있는가**만 적는다. 재구현 0 · 새 제품 로직 0 · 마켓플레이스 호출 0 · WRITE 0 ·
모델 호출 0 · 마이그레이션 0 · DB 행 변경 0.

> **먼저 정정 하나 — 이 감사는 원장을 새로 만들지 않았다.**
> 채널 × 객체 capability의 정본은 **이미 있다**: `backend/src/main/resources/product-truth/capabilities.yaml`
> → `docs/product_truth_matrix.md`(생성물, `ProductTruthReportTest`가 다시 쓴다). 48행 · 축 넷
> (**수집 · 읽기 · 초안 · 실행**). 아래 표의 그 네 축은 원장을 **인용**한 것이고, 원장이 갖고 있지
> 않은 다섯 축(**주문 결합 · OperationsCase · Knowledge · 승인 · 완료 확인**)만 이 감사가 코드에서
> 새로 확인했다. 원장과 어긋나는 것을 발견하면 §5에 **보고**했고 원장을 고치지 않았다 —
> 원장 수정은 product-owner 결정이다.

---

## 0. 한 문장

**문의 lane은 세 채널 모두 초안까지 이어져 있고 전송까지 닫힌 것은 두 채널(NAVER 상품문의 ·
Cafe24)뿐이며, 리뷰 lane은 세 채널 어디에서도 「보냈다」를 증명한 적이 없다.**
그리고 데모의 척추인 **고객 운영 관리(Responsibility)는 정기 경로가 Cafe24 전용**이다.

---

## 1. 3채널 × 9단계 매트릭스

범례 — **LIVE_PROVEN**: 실계정에서 이 주장 그대로 실행된 기록이 있다 · **PARTIAL**: 경로는 있으나
일부만 증명됐거나 일부 대상에만 해당한다 · **NOT_SUPPORTED**: 채널에 그 기능이 없거나 이 제품이
그 경로를 갖지 않는다(스위치가 아니다).

| 단계 | NAVER | CAFE24 | COUPANG |
|---|---|---|---|
| **1. Review 수집** | **LIVE_PROVEN (PARTIAL 성격)** — 공식 API **없음**(`ChannelApiGapRegistry` `REVIEW_API`). 판매자센터 export(09-02 E2E 신규 115 / 중복 33)와 **무인 Aside 관측**(09-17 Run A 52 / Run B 0) 둘 다 라이브 | **LIVE_PROVEN** — 공식 API 게시판 4 (07-30/31, 신규 insert + 동일창 멱등, 비밀글 fail-closed) | **LIVE_PROVEN (PARTIAL 성격)** — 공식 API **없음**. WING 상품평 Action Window (08-15 · 08-23 귀속 23/23), 09-14 「지금 동기화」 1 press |
| **2. Inquiry 수집** | **LIVE_PROVEN** — 상품문의 · 고객문의 둘 다 `CONFIRMED` (08-24, 정기 recurrence 포함). **톡톡은 NOT_SUPPORTED**(공식 API 부재) | **LIVE_PROVEN** — 게시판 6 (07-31) + 판매자 댓글 답변 관측 (08-26 `LIVE_VERIFIED`) | **LIVE_PROVEN** — v5 `onlineInquiries` (08-14, 재수집 insert 0 / skip 2) |
| **3-a. product 결합** | **LIVE_PROVEN** — 문의의 채널상품번호 정확 일치 18/18 | **LIVE_PROVEN** — 144 리스팅, 미해결 리뷰 124/124 relink | **LIVE_PROVEN (PARTIAL)** — 옵션ID(`vendorItemId`) 1차 · 노출상품ID fallback, 23/23; 모호하면 `AMBIGUOUS_OPTION_ID`로 fail-closed |
| **3-b. order 결합** | **PARTIAL** — 고객문의만 채널이 `orderId`를 실어 준다(`SOURCE_EXACT`). **상품문의에는 주문 필드가 없다**. 단건 주문 조회 **없음** ⇒ `STORED_ONLY` | **PARTIAL** — 게시글 `order_id` 투영됨 + 단건 조회(`Cafe24ExactOrderReader`) 구현. 그러나 **REAL 문의 중 `source_order_ref` 보유 0건** ⇒ `LIVE_ORDER_LOOKUP_NOT_RUN` | **NOT_SUPPORTED** — `onlineInquiries`의 `orderIds`를 **일부러 선언하지 않는다**(`CoupangInquiriesClient:486`) ⇒ 주문 결합 불가 |
| **4. OperationsCase 생성** | **PARTIAL** — 규칙은 채널 무관하지만 정기 관측 대상이 아니다. 기기 recipe(`NAVER_REVIEW_OBSERVE_V1` · `NAVER_PRODUCT_INQUIRY_OBSERVE_V1`)로만 들어오며 org **AND 판매자 계정** allow-list 뒤, 기본 OFF. 라이브: 리뷰 Case 1 (09-17 16:00), 문의 Case → 조사 (09-17/18 00:00) | **LIVE_PROVEN** — `CUSTOMER_OPERATIONS_V1`의 **유일한 정기 source**(PD-1). 라이브 09-21/22 (활성화 run → case → 재판단 → 초안) | **PARTIAL** — `COUPANG_REVIEW_OBSERVE_V1` 구현 · 기본 OFF · **LIVE_PROOF_PENDING**(09-17 WING 로그아웃) |
| **5. Knowledge 활용** | **LIVE_PROVEN** — 과거 문의 답변 `LEARNED`(20/20 본문 보유), 상품 상세 `LEARNED`. 근거 있는 초안 09-18 실측 | **PARTIAL** — 상품 상세 `LEARNED`이나 **과거 답변 `NOT_PROMOTED`**(자식 글은 작성자 미투영, 댓글은 본문 미저장) | **PARTIAL** — 상품 상세 `LEARNED`, **과거 답변 `NOT_PROMOTED`**(`commentDtoList`에 작성자 필드 없음), 과거 리뷰 답글 `NOT_AVAILABLE` |
| **6-a. 문의 초안** | **LIVE_PROVEN** — 08-26 · 09-18(GROUNDED, 판매자 지식 2건 인용) | **LIVE_PROVEN** — 08-25 (v1 MODEL 보존, v2 SELLER가 승인 대상) | **PARTIAL** — 경로는 **채널 무관 동일 코드**(`InquiryDraftComposer`)라 생성 가능하지만 **실계정 관측 0** |
| **6-b. 리뷰 초안** | **PARTIAL** — 템플릿 lane은 라이브 관측, **근거 기반 lane은 실판매자 계정 관측 0** | **PARTIAL** — 코드는 같으나 실제 몰에서 관측 0 | **NOT_SUPPORTED** — `replyFlowExists()` false ⇒ `authorize()`에서 **409**, 초안·승인·가이드 실행 전부 도달 불가 |
| **7. 승인** | **LIVE_PROVEN** — 문의(08-26, 단일 사용 소진) · 리뷰(09-03 · 09-05, 승인된 초안이 composer로) | **LIVE_PROVEN** — 문의 08-25 | **PARTIAL(문의)** — 승인 객체는 채널 무관이나 실행 전 `WRITE_NOT_SUPPORTED`/설정으로 막힘. **리뷰는 NOT_SUPPORTED** |
| **8. 외부 실행 / manual handoff** | **문의 LIVE_PROVEN** — `PUT .../qnas/{id}` 1회, 재시도 0 (08-26). 고객문의는 구현만. **리뷰는 GUIDED만** — `COMPOSER_FILLED ≠ 게시됨`, 마지막 등록은 판매자가 누른다 | **문의 LIVE_PROVEN** — `POST /boards/6/articles` (08-25, 3번째 시도에서 성공). **리뷰 댓글 adapter는 구현됨 · 어떤 몰에도 게시한 적 없음** | **전 객체 라이브 WRITE 0.** 문의 답변 adapter 구현됨(라이브 미실행). **리뷰는 채널에 기능 자체가 없다** ⇒ 복사 컨트롤도 렌더하지 않는다(올릴 곳이 없으므로) |
| **9. 완료 확인** | **문의 LIVE_PROVEN** — `NaverAnsweredStateReader`의 창 재독(단건 조회 계약이 없다) → `COMPLETED`. **리뷰는 `VERIFIED` 구조적 도달 불가** — 천장이 `SUBMISSION_OBSERVED_CONTENT_UNVERIFIED` | **문의 LIVE_PROVEN** — exact READ + **본문 해시 == 승인 초안** → `VERIFIED`(08-25). 리뷰도 같은 모양으로 `VERIFIED` 도달 가능하나 미실행 | **미실행** — 재조회 기반 검증 경로는 있으나 보낸 적이 없다 |

### 1-1. 실제로 일어난 마켓플레이스 WRITE — 전부

`docs/evidence/INDEX.md` 전수 확인 결과 **POST/PUT 시도는 네 번, 두 채널, 이틀**이 전부다.

| 날짜 | 채널 | 대상 | 요청 | 결과 |
|---|---|---|---|---|
| 2026-08-25 | Cafe24 | 문의 `a3672` | `POST /boards/6/articles` ×1 | 실패 `REJECTED_400` (생성 0) |
| 2026-08-25 | Cafe24 | 같은 대상 | POST ×1 (봉투 교정) | 실패 `REJECTED_422` (생성 0) |
| 2026-08-25 | Cafe24 | 같은 대상 → 자식 글 3673 | POST ×1 + exact READ ×1 | **`VERIFIED`** — 이 제품이 보낸 최초의 답변 |
| 2026-08-26 | NAVER | 상품문의 `686514802` | `PUT .../qnas/686514802` ×1 | **`LIVE_VERIFIED`** — 나간 문장은 AI 초안이 아니라 판매자가 고친 v2 |

**쿠팡은 0회.** WING에서 일어난 쓰기 성격의 사건(키 발급·삭제)은 **판매자 본인의 클릭**이고
에이전트의 click/type/submit은 0이다. 09-03·09-05 NAVER 가이드 리플라이는 WRITE 등급 승인을
받았으나 **submit 0**이다.

---

## 2. Full MVP를 막는 gap (우선순위 순)

### G1 — 고객 운영 관리가 Cafe24 전용이다 · **PRODUCT_OWNER_DECISION**

`ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1`의 정기 source는
`("CAFE24", INQUIRY)` + `("CAFE24", REVIEW)` **둘뿐**이고(PD-1, 2026-09-15), 활성화는
CONNECTED Cafe24 계정이 없으면 `409 NO_ELIGIBLE_SOURCE`로 거절된다.
NAVER·COUPANG은 기기 recipe로만 들어오며 org **AND 판매자 계정** allow-list 뒤에서 기본 OFF다.

⇒ **NAVER만 쓰는 판매자, 쿠팡만 쓰는 판매자는 제품의 canonical goal을 시작조차 할 수 없다.**
규칙·조사·초안은 전부 채널 무관인데 **범위만 Cafe24**다. PD-1의 근거(「판매자가 버튼을 눌러 읽는
것을 정기 의무에 넣으면 매 run이 실패 아닌 이유로 「확인하지 못함」을 보고한다」)는 여전히 타당하므로,
이것은 결함이 아니라 **열려 있는 제품 결정**이다 — 다만 Full MVP의 범위 질문으로 올린다.

### G2 — 리뷰 lane은 어느 채널에서도 「보냈다」를 증명한 적이 없다

- **NAVER**: WRITE adapter 자체가 없다. guided composer fill이 전부이고 `VERIFIED`는
  `ReviewExecutionVerification`의 구조상 **도달 불가**로 선언돼 있다.
- **CAFE24**: 댓글 adapter는 구현됐고 `VERIFIED`에 도달할 수 있으나 **어떤 몰에도 게시한 적이 없다**.
- **COUPANG**: 채널에 판매자 리뷰 답글 기능이 없다 — 켤 수 있는 스위치가 아니다.

⇒ Responsibility 문서가 적은 대로 **리뷰 Case의 천장은 `RECOMMENDATION_ONLY`**이고,
「Ask/Execute → Learn」이 닫히는 것은 **문의 lane뿐**이다. Full MVP가 리뷰까지 닫는다고 말하려면
필요한 것은 코드가 아니라 **Cafe24 리뷰 댓글 1회 라이브 증명**(대상 리뷰 + 단일 사용 승인)이다.

### G3 — 배포된 호스트가 볼 수 없던 설정 이름 · **이번 커밋에서 수정**

`application.yml`이 선언하는 env 이름 **238개 중 compose가 통과시키는 것은 81개**였다.
대부분은 튜닝 값이라 문제가 아니지만, 그중 일곱 개는 **이 감사가 LIVE_PROVEN으로 확인한 lane을
배포 호스트에서 도달 불가로** 만들고 있었다 — §4에서 고쳤다.

### G4 — 주문 결합은 어느 채널에서도 실제 문의 위에서 돈 적이 없다

단건 주문 조회를 가진 채널은 **Cafe24뿐**이고(`InquiryOrderFactReader:45`, 나머지는 `STORED_ONLY`),
그 Cafe24에서 **주문번호를 가진 REAL 문의가 0건**이라 `LIVE_ORDER_LOOKUP_NOT_RUN`이다.
NAVER는 고객문의만 주문을 싣고 상품문의에는 필드가 없으며, 쿠팡은 `orderIds`를 일부러 읽지 않는다.
⇒ **「주문 상태를 근거로 답한다」는 제품 주장은 세 채널 어디에서도 라이브로 서 본 적이 없다.**

### G5 — 제품 원장이 9일 뒤처져 있고, 새 축을 담을 자리가 없다 · **PRODUCT_OWNER_DECISION**

`product-truth/capabilities.yaml`의 마지막 수정은 **2026-09-13**이다. 그 뒤에 착지한 것:
Responsibility Package A/B(09-15·16) · Scheduled Aside NAVER 리뷰 무인 관측(09-17) ·
NAVER 상품문의 slice(09-17/18) · 리뷰 사진 vision(09-18) · M5 판매자 답글 읽기(09-18).

두 가지가 구조적이다.
1. **축이 넷뿐이다**(수집·읽기·초안·실행). 이 감사가 쓴 다섯 축 — 주문 결합 · OperationsCase ·
   Knowledge · 승인 · 완료 확인 — 은 `ProductCapability`에 **담을 칸이 없다**.
2. `FEATURE.*` 11행 어디에도 **고객 운영 관리(Responsibility)가 없다.** 가장 가까운 것이
   `FEATURE.PROACTIVE_OPERATIONS`인데 그것은 다른(이전) lane이다.

⇒ 원장을 확장할지, 이 감사 문서를 별도 층으로 둘지는 제품 결정이다. **이번 커밋은 원장을 고치지 않았다.**

### G6 — 코드 안에서 한 행이 자기 문장과 어긋난다 · **보고만**

`ChannelHistoryCapability`의 NAVER `PAST_REVIEW_REPLY`는 값이 **`SCREEN_UNPROVEN`**인데,
같은 행의 설명 문장은 「판매자센터의 리뷰 상세에서 **읽어 옵니다**」라고 적는다. 그리고 실제로
M5(09-18)가 그 읽기를 증명했고, `seller_reply_body`에 저장되며(`NAVER_REVIEW_DETAIL_V1`),
`LearnedKnowledgeService:153`가 그것을 지식 예시로 **읽고 있다**.

값을 바꾸지 않은 이유: `SCREEN_UNPROVEN`이 「bootstrap 경로에서는 여전히 미증명」을 뜻할 수 있다
(M5의 읽기는 운영자가 6회 클릭한 Aside 작업이지 온보딩 sweep이 아니다). **판매자 화면에 그대로
나가는 문장**이므로 어느 쪽이 맞는지는 product-owner가 정한다.

### G7 — 쿠팡은 아직 어떤 종류의 마켓플레이스 WRITE도 한 적이 없다

문의 답변 adapter는 구현돼 있으나 라이브 미실행이고, 전송 전제 중 하나인 `reply-by`는
**`application.yml`에 선언조차 없었다**(§4에서 수정). 쿠팡에서 한 바퀴를 닫으려면
adapter 작업이 아니라 **대상 문의 + 단일 사용 승인 + `reply-by` 값**이 필요하다.

---

## 3. 채널별 한 줄 요약

- **CAFE24** — 유일하게 **공식 API로 리뷰까지 읽는** 채널이고, 유일하게 **문의 전송이 `VERIFIED`로
  닫힌** 채널이며, **고객 운영 관리의 유일한 정기 source**다. 남은 것은 리뷰 답글 1회 라이브 증명과
  주문 결합의 실제 대상.
- **NAVER** — lane이 가장 깊다(수집 두 경로 · 문의 두 subtype · 정기 관측 · 근거 있는 초안 ·
  전송 `LIVE_VERIFIED` · 읽기 기반 완료 확인). 남은 것은 **리뷰 답글의 천장**(`VERIFIED` 도달 불가)과
  고객문의 전송 미실행, 그리고 **고객 운영 관리 정기 범위에서 빠져 있다는 것**.
- **COUPANG** — 읽기는 세 축(리뷰 · 문의 · 상품) 전부 라이브로 서 있다. 쓰기는 **한 번도 없다**.
  리뷰 답글은 영원히 없을 것이고(채널 기능 부재), 문의 답변은 승인과 값만 있으면 된다.

---

## 4. 이번 커밋에서 고친 것 — 설정 이름 도달성뿐

동작 변화 **0**(모든 값이 기존 기본값 그대로), 제품 로직 **0**, Demo Core UI **0**,
Goal Interpreter **0**, Agent architecture **0**. 선례는 `pilot_readiness_closure_v1.md` §3
(「컨테이너가 볼 수 없던 이름들」)과 같다.

**`docker-compose.yml` — 일곱 이름 추가**

| 이름 | 없어서 벌어지던 일 |
|---|---|
| `SELLEROPS_COLLECT_SCHEDULER_ENABLED` | pilot 템플릿은 `SELF_PILOT_ENABLED=true`로 **스케줄을 만든다**. 그 스케줄을 **실행하는** poller가 이 이름이고, 없으면 스케줄만 쌓이고 아무것도 수집되지 않는다 |
| `SELLEROPS_CONNECTOR_NAVER_INQUIRY_PRODUCT_QNA_ENABLED`<br>`SELLEROPS_CONNECTOR_NAVER_INQUIRY_CUSTOMER_ENABLED` | 커넥터 플래그를 켜도 **문의 두 lane은 켜지지 않는다**. 이 감사가 「수집·정기 둘 다 CONFIRMED」로 확인한 그 lane이 배포 호스트에서 도달 불가였다 |
| `SELLEROPS_CONNECTOR_COUPANG_REPLY_BY` | 쿠팡 답변의 전제. 비어 있으면 adapter가 **보내지 않고 거절**한다 |
| `SELLEROPS_CONNECTOR_CAFE24_ANSWER_EXECUTION_SCOPES` | 답변 WRITE의 전제인 **재동의 스코프**(`mall.write_community`)를 배포에서 설정할 수 없었다 — 이 저장소가 라이브로 증명한 **유일한 WRITE lane**의 전제다 |
| `SELLEROPS_REVIEW_PUBLISH_EXECUTION_ENABLED`<br>`SELLEROPS_REVIEW_PUBLISH_CAFE24_LIVE_APPROVAL_ID` | 문의 전송 이름은 **다섯 개**가 있었고 리뷰 전송 이름은 **0개**였다. 리뷰 실행 lane 전체가 배포 호스트에서 도달 불가 |

**`SELLEROPS_REVIEW_PUBLISH_CAFE24_SHOP_NO`는 일부러 추가하지 않았다.** 그 property는
`${SELLEROPS_REVIEW_PUBLISH_CAFE24_SHOP_NO:${SELLEROPS_INQUIRY_PUBLISH_CAFE24_SHOP_NO:0}}` —
**문의 쪽 값을 상속**한다. compose에 이름을 넣으면 모든 호스트에 명시값이 전달돼 그 상속이 조용히
`0`으로 바뀌고, 문의는 맞는 몰을, 리뷰는 없는 몰을 겨냥하게 된다. 이유를 파일에 적어 두었다.

**`backend/src/main/resources/application.yml`** — `sellerops.connector.coupang.reply-by`를
빈 기본값으로 **선언**했다. 이전에는 `PublishExecutionWiring`의 `@Value` 기본값으로만 존재해,
모든 설정 이름을 모아 둔 파일을 읽는 운영자가 그 lane이 이 값을 요구한다는 것을 알 수 없었다.

**`deploy/pilot/pilot.env.example`** — 같은 이름들을 **전부 OFF/빈 값**으로 적고 각각 왜 필요한지
한 줄씩 달았다. 이 템플릿의 자세는 바뀌지 않는다.

**검증:** `PilotConfigValidator` · `MockConnectorAvailability` · `AgentDraftBoundary` ·
`ProductTruth*` · `*Publish*` · `*ConnectorConfiguration*` · `*ReplyCapability*` 테스트 통과,
두 YAML 파싱 확인. 마켓플레이스 0 · WRITE 0 · 모델 0 · 마이그레이션 0 · DB 행 변경 0.

---

## 5. 결정이 필요한 것 (임의로 정하지 않았다)

1. **G1** — 고객 운영 관리의 정기 범위를 Cafe24 밖으로 넓힐 것인가. 넓힌다면 PD-1이 경고한
   「실패 아닌 이유의 「확인하지 못함」」을 어떻게 표현할 것인가.
2. **G2** — Full MVP의 완료 정의에 **리뷰 답글 라이브 증명**을 넣을 것인가. 넣는다면 대상은
   Cafe24 리뷰 댓글 1건이고 단일 사용 승인이 필요하다.
3. **G5** — 제품 원장에 다섯 축(주문 결합 · Case · Knowledge · 승인 · 완료 확인)과
   고객 운영 관리 feature 행을 추가할 것인가.
4. **G6** — NAVER `PAST_REVIEW_REPLY`를 `SCREEN_UNPROVEN`으로 둘 것인가(= bootstrap 기준),
   아니면 M5 증명을 반영할 것인가. 이 값은 **판매자 화면 문장**이다.
5. **G7** — 쿠팡 문의 답변 1회 라이브를 Full MVP에 넣을 것인가.

---

## 6. 하지 않은 것

새 기능 0 · 기존 기능 재구현 0 · Demo Core UI 무변경 · Goal Interpreter 무변경 ·
Agent architecture 무변경 · 제품 원장 무변경 · 채널 capability 값 무변경 ·
라이브 실행 0 · push 하지 않음.

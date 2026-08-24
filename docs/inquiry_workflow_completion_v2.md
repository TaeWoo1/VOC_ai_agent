# Inquiry Workflow Completion v2 — 근거가 먼저 옳아야 한다

**2026-08-24 · `feat/inquiry-product-attribution-action-coverage`**
북극성: 운영 Dashboard → 문의 확인 → 상품 이해 → Product Knowledge/RAG → AI 초안 → **사용자 명시 승인**
→ 별도 Action Executor → 실제 channel send.
**Agent reasoning graph는 이 패키지 이후에도 WRITE 0이다** — tool catalogue 변경 0,
`operatorToolRegistry.test.ts`가 등록 자체를 거부한다.

`docs/inquiry_action_flow_v1.md`(초안→승인→실행)과
`docs/inquiry_product_attribution_action_coverage_v1.md`(귀속·synthetic fence)를 덮어쓰지 않고 그 위에
쌓는다. 이 문서가 소유하는 것은 **retrieval correctness**, **사람이 정하는 상품 연결**,
**NAVER 두 subtype의 실제 계약**, 그리고 그로부터 나온 **전송 직전 규칙 하나**다.

---

## 1. RAG retrieval — 뒤집힘의 원인은 상수가 아니었다

### 1.1 라이브에서 본 것 (2026-08-24, 수정 전)

| 질문 | 라이브러리가 답할 수 있나 | 결과 |
|---|---|---|
| 「폭이 몇 mm인가요?」 · 문서: 「내부 폭은 18mm」 | **예** | **passage 0** |
| 「설치는 어떻게 하나요?」 · 문서: 「간편하게 설치할 수 있습니다」 | **예** | **passage 0** |
| 「교환 반품 기준 알려줘.」 | 예 | **passage 0** |
| 「교환 **및** 반품 기준 알려줘.」 | 예 | passage 1 |
| 「선바로 방수 되나요?」 | **아니오** | **passage 1, score 1.00** |
| 「선바로 가격이 얼마인가요?」 | **아니오** | **passage 1, score 1.00** |

답할 수 있는 질문은 전부 0을 돌려주고, 답할 수 없는 질문은 **자신 있게** 근거를 붙여 돌려줬다.

### 1.2 원인 — 하나의 숫자가 두 질문에 답하고 있었다

옛 scorer는 질문을 2글자 shingle로 자르고, `askableRatio`(코퍼스가 낱말을 가진 shingle의 비중)로 부재를
판정한 뒤 `topicCoverage`(그 **askable 부분** 대비 덮은 비율)로 순위를 매겼다. 네 가지가 동시에 무너진다.

1. **질문은 대부분 문법이다.** 「폭이 몇 mm인가요?」의 7개 shingle 중 5개가 의문형 뼈대이고 어떤 문서도
   그것을 쓰지 않는다 → `askableRatio` 0.07 → 부재로 판정. 게이트를 통과시킨 유일한 탈출구는
   `longestSharedRun ≥ 3`, 즉 **판매자의 표현을 조사까지 그대로 따라 쓴 질문**뿐이었다.
2. **그 탈출구를 상품 이름이 열었다.** 제목이 passage의 검색 텍스트에 붙으므로 「선바로」는 어느 passage와도
   3글자 run을 만든다 → 상품 이름을 부른 질문은 **전부** 게이트를 통과.
3. **문서 1개짜리 코퍼스에서 `topicCoverage`는 항상 1.0이다.** df를 같은 코퍼스에서 재기 때문에 askable
   shingle은 정의상 그 유일한 passage에 있다. 그래서 화면에 뜬 `1.00`은 정보가 0인 숫자였다.
4. **분모가 움직였다.** 분모가 "질문 중 코퍼스가 아는 부분"이므로 **라이브러리가 덜 알수록 점수가 올랐다.**
   이것이 뒤집힘의 이름이다.

### 1.3 불변식 (이번에 정의한 것)

- **명시적으로 답하는 passage는 NO_MATCH를 이긴다.**
- **분모가 줄어서 통과하는 일은 없다** — 부재 판정은 순위 점수와 다른 단위로 잰다.
- **핵심어가 하나도 겹치지 않으면 아무것도 돌려주지 않는다.**
- **「교환 및 반품」/「교환 반품」 같은 안전한 표기 차이는 검색을 가르지 않는다.** synonym ontology는 만들지
   않는다. deterministic, product-local, vector DB 없음. 사용자 작성 Product Knowledge와 marketplace
   Product Fact는 계속 다른 source다.

### 1.4 바꾼 것

| | 이전 | 지금 |
|---|---|---|
| 매칭 단위 | 질문 전체의 2글자 shingle | **낱말**, 그리고 코퍼스에 있는 **최장 접두**(`prefixMatch`) |
| 부분 매칭 허용 | 무조건 | 남은 꼬리가 **조사일 때만** — 폭+이 ○, 방+수 ✕ |
| 문법 처리 | 없음(분모에 그대로) | 의문형·어미·지시어·「상품/제품」을 **닫힌 목록**으로 제외(`QueryWords`) |
| 상품 이름 | run 게이트를 여는 열쇠 | **제외** — 이미 그 상품으로 좁혀 놓고 검색한다 |
| 부재 판정 | idf 가중 비율 | 질문 **내용어의 글자 수** 중 라이브러리가 가진 비중 |
| 순위 | askable 분모(움직임) | best-reachable 분모(모든 passage에 동일) + **절대 글자 수 하한** |

**닫힌 목록은 synonym ontology가 아니다.** 낱말을 다른 낱말로 바꾸지 않는다. 두 부류만 뺀다 — 문장을
질문으로 만드는 문법, 그리고 **이미 정해 놓은 대상**을 가리키는 말(「이 상품」, 그리고 상품 이름 자체).
빈도 기반 불용어 목록은 여전히 만들지 않았다.

### 1.5 수정 후 라이브 (같은 서버, 같은 데이터)

| 질문 | 결과 |
|---|---|
| 「폭이 몇 mm인가요?」 | **1건** (규격 문서, 1.00) |
| 「한 개당 길이가 몇 m인가요?」 — 길이를 적어 둔 상품 | **1건** |
| 「한 개당 길이가 몇 m인가요?」 — 적어 두지 않은 상품 | **0건** |
| 「설치는 어떻게 하나요?」 | **1건** |
| 「교환 반품 기준 알려줘.」 / 「교환 및 반품 …」 | **1건 / 1건** (0.67 / 0.69) |
| 「방수 되나요?」 · 「이 상품 방수 되나요?」 | **0 / 0** |
| 「선바로 방수 되나요?」 · 「선바로 가격이 얼마인가요?」 | **0 / 0** |
| 「배터리 충전 시간이 얼마나 되나요?」 | **0** |
| 「벽지에도 붙나요?」 · 「떼었다가 다시 붙일 수 있나요?」 · 「몇 가닥까지 들어가나요?」 | **1 / 1 / 1** |

같은 질문이 답이 적힌 상품에서는 걸리고 적히지 않은 상품에서는 안 걸린다 — 뒤집힘이 사라진 자리다.

---

## 2. 상품 미지정 문의 — 사람이 지정한다

Cafe24 source limitation은 확정이다: REAL 3,312건 / 정확 귀속 5건 / 미귀속 3,307건. **이 숫자를 자동
추측으로 올리지 않는다.** 대신 정직한 fallback을 만들었다.

- `POST /api/inquiries/{workItemId}/product` — 판매자가 **자기 검색에서 고른** productId만 받는다.
  문의 본문을 읽지 않고, 후보를 추천하지 않고, 결과가 하나여도 자동 선택하지 않는다.
- provenance를 **값으로** 가른다: `SOURCE_EXACT`(채널 식별자 일치) vs `USER_CONFIRMED`(사람이 지목).
  신뢰도가 아니라 **반증 방법**이 다르기 때문이다 — 전자는 채널을 다시 읽으면 확인되고, 후자는 지목한
  사람에게 물어야 한다. 그래서 후자에는 이름과 시각이 함께 남는다.
- **채널이 정한 귀속은 조용히 덮이지 않는다.** 다른 상품으로 바꾸려면 `override`가 필요하고, 없으면 409
  `SOURCE_BINDING_EXISTS`. 화면은 그것을 실패 문구가 아니라 **질문**으로 바꾼다.
- **재수집은 사람의 답을 덮지 않는다.** `IngestionService#repairAttribution`은 비어 있는 귀속만 채운다.
  소스가 나중에 다른 식별자를 주더라도 그 불일치는 `source_product_ref`로 **보이게** 남는다.
- 바뀐 내역은 `inquiry_product_binding_events`에 쌓인다(이전 상품·이전 provenance·행위자·시각). 지난주에
  만든 초안은 **그때 연결돼 있던 상품**의 지식으로 쓰였고, 그 사실을 되짚을 길은 이 행뿐이다.
- cross-org 상품은 404다(403이 아니다 — 없는 상품의 존재를 알려 주지 않는다). ingest의 공유 버킷
  「(미지정 상품)」에는 연결할 수 없다.

---

## 3. NAVER — 두 subtype은 정말로 다른 계약이다

공식 문서를 **사본으로 고정**하고(`docs/vendor/naver-commerce-api/`, 2026-08-24 취득) 그 위에서 구현했다.

| | 상품 문의 | 고객 문의 |
|---|---|---|
| 호출 | `PUT /v1/contents/qnas/{questionId}` | `POST /v1/pay-merchant/inquiries/{inquiryNo}/answer` |
| 본문 필수 | **`commentContent`** | **`answerComment`** (`answerTemplateId`는 선택 — **보내지 않는다**) |
| 대상 | `questionId` (int64) | `inquiryNo` (int64) |
| 이미 답변이 있으면 | **조용히 덮어쓴다** — "동일 questionId에 다시 호출하면 등록이 아닌 수정으로 동작" | **거부한다** — `ERR-NC-101010` |
| 오류 | 400/401/403/404/500 | 400 안에 `ERR-NC-1010xx` 세분 |

**"generic NAVER write"는 존재할 수 없는 문장이다.** 두 식별자 공간은 겹치지 않고 둘 다 맨 int64이므로,
한쪽 승인을 다른 쪽에 쓰면 실패하는 게 아니라 **다른 고객의 문의에 답하게 된다.** 그래서 adapter가
`servesSubtype`으로 자기 resource를 이름으로 요구하고, 승인에 subtype이 묶이고, 전송 직전에 다시 본다.

**수집 lane의 read-only fence는 그대로다.** 답변 client는 `connector/naver`가 아니라
`inquiry/publish/naver`에 있다. 수집은 **스케줄**로 돈다 — 사람이 턴에 없는 상시 권한이므로, 그 lane이
쓰지 못한다는 보장은 *쓰는 코드가 그 안에 없다*는 사실이어야 한다. `NaverAnswerContractTest`가 그것을
구조로 검사한다. 실제 호스트로 나가려면 `NaverAnswerLiveGuard`의 승인 ID가 armed여야 한다.

---

## 4. 전송 직전 — 덮어쓰는 채널에서는 "확인 불가"가 거절이다

기존 7항목(REAL provenance · 대상 동일성 · 계정/채널 · subtype · 이미 답변됨 · write capability · 신선도)은
그대로다. 계약을 읽고 **한 항목이 늘었다**.

`OVERWRITE_WITHOUT_PROOF` — 답변 상태를 지금 증명할 수 없고, **그 채널의 쓰기가 덮어쓰는 종류**라면 거절한다.

다른 채널에서 신선하지 않은 상태로 보내는 최악은 **답변이 두 개** 붙는 것이다. 보이고, 사과할 수 있다.
NAVER 상품 문의에서 같은 최악은 **사람이 콘솔에 직접 쓴 답변이 사라지는 것**이고, 사과할 대상이 남지
않는다. 그래서 이 한 경우에만 경고가 아니라 veto다. 어떤 채널이 여기 해당하는지는 판단이 아니라 감사된
벤더 계약에서 읽는다(`InquiryReplyCapabilityRegistry#overwritesExistingAnswer`).

---

## 5. Cafe24 — 플랫폼은 확인됐고, 우리 쪽은 아니다

공식 Admin API 사본: `docs/vendor/cafe24-admin-api/post-boards-articles-comments.md`.
`POST /api/v2/admin/boards/{board_no}/articles/{article_no}/comments`, scope `mall.write_community`,
**필수 `content`·`writer`·`password`**.

**"댓글을 만들 수 있다"와 "board 6에서 그 댓글이 판매자 답변으로 처리된다"는 같은 사실이 아니다.**
세 가지가 각각 독립적으로 막는다.

1. **의미 미확정.** SellerOps는 Cafe24의 ANSWERED를 article의 `reply_status`에서 유도한다. 댓글이 그것을
   바꾼다는 근거가 저장소에 없다 — 댓글은 수집 대상이 아니고(`unsupportedScopes`의 `COMMENTS`), 수집된
   board 6 article **905건 전부가 `PENDING`**이다. 확정하려면 `reply_status`가 처리완료인 article의 댓글을
   **읽어야** 하고, 그것은 라이브 marketplace 호출이라 별도 승인이 필요하다.
2. **`writer`/`password`를 보유하지 않는다.** 둘 다 필수인데 SellerOps의 Cafe24 연결 어디에도 없다.
   하드코딩은 금지돼 있고, 지어내면 고객에게 보이는 답변에 **가짜 작성자**가 찍힌다.
3. **현재 grant가 읽기 전용이다** — `mall.read_community,mall.read_order,mall.read_product`. 위 둘이
   풀려도 판매자 **재동의** 없이는 쓸 수 없다.

**API가 존재한다는 것만으로 `DIRECT_API`로 올리지 않는다.** 상태는 `NEEDS_VERIFICATION`으로 남고, 화면은
"지원하지 않는다는 뜻은 아닙니다"라고 말한다.

---

## 6. 라이브 상태

**`LIVE_WRITE_NOT_RUN` · manifest 없음.** 이번에는 막은 것이 capability가 아니라 **대상**이다.

| 채널 / source | 구현 | Demo Org REAL 미답변 | 안전한 대상 |
|---|---|---|---|
| COUPANG | 구현됨 | **0** (REAL 2건 전부 답변완료) | 없음 |
| NAVER `PRODUCT_QNA` | **구현됨(이번 패키지)** | **0** (REAL 13건 전부 답변완료) | 없음 |
| NAVER `CUSTOMER_INQUIRY` | **구현됨(이번 패키지)** | **0** (REAL 5건 전부 답변완료) | 없음 |
| GMARKET (ESM+) | 구현됨 | 0 (해당 연결 없음) | 없음 |
| CAFE24 | 미구현 | **69** | 없음 — 감사된 쓰기 경로가 없음 |

REAL 미답변 Coupang 8건은 **다른 org 소유**다. 배포는 `executionEnabled=false`,
`replyAdapterChannelCodes=[]`. **실제 marketplace WRITE 0.**

---

## 7. 남은 것

- **Cafe24 board 6 댓글 = 판매자 답변인가** — 라이브 READ 승인이 필요한 external 확인.
- **`writer`/`password` 조달** — product-owner 결정(판매자에게 물을 것인가, 다른 경로인가).
- **Product Knowledge 커버리지가 이제 병목이다.** Demo Org 320개 상품 중 지식이 등록된 것은 3개고,
  Cafe24 미귀속 backlog는 세금계산서·현금영수증·주문취소가 대부분이라 **상품 질문 자체가 거의 없다.**
  귀속을 늘려도 RAG가 답할 것이 늘지 않는다.
- Cafe24 미귀속 3,307건 — 사람이 지정할 수 있게 됐지만, 한 건씩이다. 일괄 지정은 만들지 않았다.

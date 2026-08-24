# Inquiry Product Attribution & Action Coverage v1

**날짜:** 2026-08-24 · **브랜치:** `feat/inquiry-product-attribution-action-coverage`
**성격:** connector 확장이 **아니다.** 핵심 inquiry workflow(운영 Dashboard → Agent 분석 → Product
Knowledge/RAG → 답변 초안 → 사용자 명시 승인 → 별도 Action Executor → 실제 marketplace send)의
**product/action coverage를 닫는 작업**이다.

**마켓플레이스 접촉 0.** 이 패키지는 라이브 WRITE를 실행하지 않았고, 실행할 수 있는 안전한 대상도
없었다(§8). Agent reasoning graph는 **여전히 WRITE 0**이며 tool catalogue에 WRITE tool을 추가하지 않았다.

---

## 0. 판정 요약

**전제는 맞았고, 원인은 예상과 달랐다.**

Cafe24 문의에 canonical product attribution이 사실상 없다는 진단은 **사실이었다.** 다만 원인은
"식별자를 버리고 있었다"가 아니라 **두 겹**이었고, 그 두 번째가 이 패키지의 상한을 결정한다.

1. **버리고 있었다 — 맞다.** ingest가 Cafe24 `product_no`를 canonical `sku`로 넘겨
   resolve-or-create 했고, 그 둘은 **다른 키 공간**이다. 어긋나면 **번호로 이름 붙은 상품을 만들어
   냈다.** canonical Demo Org의 `91`·`94`·`170` 세 개가 그것이고, **세 번호 전부 `channel_products`에
   실재하는 연결된 리스팅이다** — 정확한 귀속이 가능한데 조작된 값이 대신 저장돼 있었다.
2. **그런데 board 6에는 애초에 식별자가 거의 없다.** `product_no`는 board 6 응답에 **존재하는 필드**로
   라이브 확인돼 있지만(`docs/sellerops_cafe24_review_inquiry_capture.md`), 실제 값은
   `cafe24_community_articles` board 6 **905행 중 0행**, `inquiries` 3,425행 중 **10행**뿐이다
   (board 4 리뷰는 269/269 전부 보유). 상품 페이지가 아니라 게시판에서 쓴 일반 문의가 압도적이다.

그래서 `product_id`는 **전부 non-null이었고 거의 전부 무의미했다.** 3,415행이 공유
`(미지정 상품)` 한 행을 가리켰고 10행이 조작된 번호 상품을 가리켰다. 화면·대시보드·초안 작성기는
모두 "귀속됨"이라고 들었다.

**고친 뒤:** canonical Demo Org 3,312행 중 **5행이 실제 canonical 상품에 정확히 귀속**되고 3,307행이
**정직하게 무귀속**이다. 미답변 69건 중 **3건**이 상품을 얻었다.

**숫자를 올리지 않았다.** 이름 매칭으로 3,307을 채울 수 있었지만 그것은 attribution이 아니라 추측이다.

---

## 1. PART A — Cafe24 Inquiry Product Attribution

### 1.1 감사: source가 실제 주는 식별자

| 식별자 | board 6 응답 | 현재 투영 | canonical join |
|---|---|---|---|
| `product_no` | **키는 존재**(라이브 확인), 값은 거의 없음 | 투영함 | **`channel_products (channel_id, external_product_id)` 정확 일치 가능** |
| `article_no` | 있음 | 투영함 | dedup key (`cafe24:b6:a<no>`) |
| `order_id` | 응답에 존재 | **투영 안 함**(PII-bearing 키 그룹) | — |
| variant / option | 응답에 없음 | — | — |

**order relation은 현재 데이터로 막다른 길이다.** `channel_orders`에는 **line item이 없고**(상품 참조
컬럼 자체가 없다) **Cafe24 주문은 0행**이다. 주문 경유 귀속은 스키마와 데이터 양쪽에서 불가능하며,
`order_id`를 투영하는 것만으로는 아무것도 얻지 못한다. 추측하지 않고 여기서 멈춘다.

### 1.2 변경

- `Cafe24InquiryArticleMapper` — `product_no`를 **`ChannelProductRef`로 선언**한다. ref의 존재 자체가
  규칙이므로 ingest는 정확 일치만 하고, 못 찾으면 귀속하지 않으며, **이름 경로로 떨어질 수 없다.**
  `0`은 식별자가 아니다(Cafe24가 "상품 없음"에 쓰는 값).
- `inquiries.source_product_ref` (V69) — **채널이 준 식별자 원문을 보존한다.** 지금까지 귀속에
  실패하면 식별자는 resolve-or-create에 소비되고 영구히 사라졌다. 이제 `ref 있음 + product_id 없음`은
  **"채널이 지목한 리스팅을 우리가 아직 안 갖고 있다"** 는 수리 가능한 상태이고, `둘 다 없음`은
  **"채널이 아무 리스팅도 지목하지 않았다"** 는 수리할 것 없는 상태다. 전에는 구별 불가였다.
- `IngestionService.repairAttribution` — **재관측 시 없던 귀속만 채운다.** 이미 있는 귀속은 옮기지
  않는다(정확 일치했거나 사람이 고친 값이고, 나중 읽기가 그 둘의 반증은 아니다). **변경 없는 행에서도
  실행된다** — 다시는 바뀌지 않을 backlog가 카탈로그 수집 뒤에도 영원히 무귀속으로 남는 것을 막는다.
- V70 — bounded historical backfill. 우선순위 그대로: ① 정확 일치, ② 없으면 무귀속. **이름 매칭 0 ·
  상품 생성 0 · 상품 삭제 0 · CAFE24 + REAL만.**

### 1.3 backfill 실측 (real PG `sellerops`)

| | canonical Demo Org | 다른 org |
|---|---|---|
| Cafe24 REAL 문의 | 3,312 | 113 |
| 식별자 복구(`source_product_ref`) | 5 | 5 |
| **정확 귀속** | **5** (distinct 3) | **0** (리스팅이 그 org 소유가 아님 — org 스코핑 정상) |
| 정직한 무귀속 | 3,307 | 113 |
| ACTIVE 미답변 69건 중 귀속 | **3** | — |

귀속된 세 상품은 조작된 번호가 아니라 실재하는 상품이다:
`91 → 로맨틱러브10P(na97)` (sku `NA-97`) · `94 → 패밀리10P(na39)` (`NA-39`) ·
`170 → [벌크] 신개념 일체형 전선몰딩 선바로` (`sbr`). **셋 다 sku ≠ product_no** — 옛 경로가 상품을
지어낼 수밖에 없었던 바로 그 형태다.

**불변 실측:** products **320 / 308 불변** · inquiries **3,473 불변** · synthetic **19 불변** ·
work items **3,338 불변** · ambiguous 0 · 신규 product 0.

**남은 결함(이 패키지 범위 밖, 기록):** 조작된 상품 행 `91`·`94`·`170` 자체는 **삭제하지 않았다.**
리뷰가 각각 붙어 있고(170: 5, 94: 1) 리뷰 귀속은 이 패키지 범위가 아니다. 문의는 전부 옮겼으므로
문의 경로에서는 더 이상 보이지 않는다.

---

## 2. PART B — 운영 큐 REAL fence

**결함은 잠재였다 — 지금 synthetic work item은 0건이지만, 막는 것이 아무것도 없었다.**

- `InquiryWorkItemWriter.openConnectorInquiry` — REAL이 아니면 **work item을 열지 않고 history로만
  저장한다.** 큐 진입은 승인과 marketplace send로 이어지는 줄이고, DEMO_SEED 행이 그 줄에 서면
  픽스처가 실제 고객 문의 자리에 서게 된다.
- `InquiryWorkItemRepository.findOperationalByOrgIdAndPhase` — 큐 읽기를 join 단계에서 좁힌다.
  **페이지를 가져온 뒤 거르면 `totalElements`가 보여주지 않는 행을 세게 되고**, 12라고 말하며 9를
  보여주는 큐는 그 자체가 결함이며 다음 페이지에서 실제 작업을 건너뛴다.
- **`realDataOnly` Hibernate filter는 이 경로를 덮지 못한다** — 문의를 `findAllById`로 싣는데
  Hibernate filter는 `findById`에 적용되지 않는다. 그 사실에 기대는 것은 보호처럼 보이는 무보호였다.
  그래서 명시적으로 검사한다.
- `PreSendCheck.SYNTHETIC_TARGET` — 전송 직전 마지막 관문에서 거부. 승인은 그것을 만든 읽기보다
  오래 살고, DEMO_SEED 행의 `external_id`는 실제와 **똑같은 모양**이라 마켓플레이스는 저쪽에서 그
  문자열이 가리키는 무엇에든 답변하게 된다.
- **history/debug/admin 조회는 삭제하지 않았다.** 운영 큐에서 뺀 것은 수집하지 않은 척하는 것과 다르다.

---

## 3. PART C — 채널 × source subtype WRITE capability 재감사

**재감사했고, 아무 행도 움직이지 않았다.** 바뀌지 않은 재감사도 결과이므로 기록한다.

| 채널 / source | transport | 근거 | 라이브 증명 |
|---|---|---|---|
| COUPANG | `DIRECT_API` | `CoupangInquiryReplyClient` · `CoupangChannelReplyAdapter` | **없음** |
| GMARKET (ESM+) | `DIRECT_API` | `EsmAnswerClient` · `EsmChannelReplyAdapter` | 없음 |
| NAVER `PRODUCT_QNA` | `PLATFORM_SUPPORTED_NOT_IMPLEMENTED` | 공식 `PUT /v1/contents/qnas/{questionId}` | — |
| NAVER `CUSTOMER_INQUIRY` | `PLATFORM_SUPPORTED_NOT_IMPLEMENTED` | 공식 `POST /v1/pay-merchant/inquiries/{inquiryNo}/answer` | — |
| NAVER TalkTalk | `UNSUPPORTED` (채널 쪽 한계) | 커머스 API 문의 도메인에 엔드포인트 없음 | — |
| CAFE24 (board 6) | `NEEDS_VERIFICATION` | 쓰기 계약 미감사 | — |

**GMARKET 행은 이번에 추가됐다.** 구현된 adapter가 있는데 registry에 행이 없었다 — 감사 목록의
누락이었고, 새로 도입한 capability 관문이 그것을 즉시 거부로 바꿔 드러냈다. 이제
`everyRegisteredAdapterHasAnImplementedCapabilityRow`가 **adapter 등록과 감사 행을 한 사실로 묶는다.**

**NAVER는 결정이 없어서가 아니라 문서가 없어서 막혔다.** vendored `llms.txt` 53–55행은 세 답변
엔드포인트의 **method와 path만** 담는다. 요청 본문 · 필요 권한 · 응답 의미를 담은 개별 문서
(`put-v1-contents-qnas-questionId.md`, `post-v1-pay-merchant-inquiries-inquiryNo-answer.md`)는
**저장소에 없고, 이 환경에서 벤더 호스트에 접근할 수 없었다.** path만 알고 본문을 추측해 쓴 adapter는
구현이 아니므로 **쓰지 않았다.** 두 subtype의 계약은 실제로 다르며(`questionId` vs `inquiryNo`,
PUT vs POST) 하나의 generic NAVER write로 뭉개지 않는다.

**Cafe24는 여전히 미감사이고, 이제 그 옆에 사실 하나가 더 있다.** 이 몰의 저장된 grant는
`mall.read_community,mall.read_order`다. 게시판 댓글 쓰기가 존재하더라도 **이 연결로는 재동의 없이
호출할 수 없다.** 이것은 grant에 대한 사실이지 API에 대한 사실이 아니며, "Cafe24는 답변할 수 없다"로
승격하지 않는다.

---

## 4. PART D — Action adapters

**기존 Draft → Approval → Action Ticket → Executor를 그대로 재사용했다. 새 HITL 체계 0.**

구조 변경 하나: **adapter 해석이 채널 코드가 아니라 채널 × source subtype으로 좁혀졌다.**
`ChannelReplyAdapter.servesSubtype`의 기본값은 `null` subtype 하나만 서비스하므로, 다중 resource
채널은 **선언하지 않으면 서비스할 수 없다** — 실수로 뭉갤 수 없게 만든 것이다.

부수적으로 드러난 순서 결함 하나를 고쳤다: **재검증이 adapter 해석보다 먼저 실행된다.** 전에는
승인 후 subtype이 바뀐 문의가 adapter를 못 찾아 "할 일 없음"으로 조용히 빠져나가, 절대 쓸 수 없는
승인을 영원히 재시도하며 **이유는 아무 데도 기록되지 않았다.** 승인과 행의 모순은 transport 존재
여부와 무관하게 참이다.

같은 이유로 **capability 없는 채널은 `ACTION_PENDING`으로 방치되지 않고 `WRITE_NOT_SUPPORTED`로
거부된다** — 영원히 보내지지 않을 것이 모든 화면에서 "처리 중"으로 읽히는 것을 끝낸다.

**구현된 adapter: COUPANG · GMARKET.** NAVER 두 subtype과 CAFE24는 §3의 이유로 미구현이며, 자리는
구조적으로 존재하고 이유는 기록돼 있다.

---

## 5. PART E — Send safety

기존 승인 바인딩(org · seller account · channel · inquiry external id · source subtype · draft
hash/version · intended operation)은 그대로 두고, 전송 직전 재검증에 **두 항목을 추가**했다.

| # | 항목 | 상태 |
|---|---|---|
| 1 | REAL provenance | **추가** — `SYNTHETIC_TARGET` |
| 2 | target exact identity | 기존 — `TARGET_CHANGED` · `ACCOUNT_CHANGED` · `CHANNEL_CHANGED` · `SUBTYPE_CHANGED` |
| 3 | current connection | 기존 |
| 4 | write capability | **추가** — `WRITE_NOT_SUPPORTED` (채널 × subtype 단위) |
| 5 | answered state if verifiable | 기존 — `ALREADY_ANSWERED`, 확인 불가는 `stateProven=false`로 **기록**되고 화면에 표시 |
| 6 | draft hash | 기존 — confirm 시점 지문 대조 |
| 7 | duplicate action / idempotency | 기존 — commandId + 실행 상태 |

**이미 답변됨 → 전송 금지**(기존). **확인 불가를 안전으로 간주하지 않는다** — 거부가 아니라 기록된
무지이고, 누르기 전에 화면에 나오며, 위험을 감수하는 사람이 그 사실을 들은 사람이 된다.
**ambiguous timeout은 `DELIVERY_UNKNOWN` → verify, 자동 재전송 없음**(기존 계약, 무변경).

---

## 6. PART F — Product RAG grounded draft 증명 (실제 REAL Cafe24 문의)

**두 증명 모두 실제 저장된 미답변 Cafe24 문의로 수행했다.** 둘 다 이 패키지 전에는 **불가능**했다 —
문의가 canonical 상품에 닿지 못했기 때문이다.

**증명 1 — 지식이 있는 상품.** 문의 `c626515c`("선바로 한개당 길이가 몇m인가요?") →
canonical 상품 `[벌크] 신개념 일체형 전선몰딩 선바로`(리스팅 `170` 정확 일치) → Product Knowledge
검색 → `knowledgeState = GROUNDED`, evidence `PRODUCT_KNOWLEDGE · 선바로 상품 설명 (몰 게시 문구)`,
`authorKind = MODEL`.

> 현재 등록된 상품 정보에는 선바로 1개당 길이가 명확히 기재되어 있지 않아 내부 확인 후 정확한 길이를
> 다시 안내드리겠습니다.

**길이를 지어내지 않았다.** 등록된 지식은 설치 방법을 말하고 길이를 말하지 않으며, 초안은 그 부재를
말한다. **unsupported claim 0.**

등록한 지식 문서의 본문은 **몰이 스스로 게시한 상품 설명**(이미 `product_facts`에
`desc:summary`로 보유)을 옮긴 것이다. 판매자 상품의 사실을 지어내지 않기 위한 제약이었다.

**증명 2 — 지식이 없는 상품.** 문의 `03efb950`("소재가 필름이라고 되어져 있는데 …") →
canonical 상품 `패밀리10P(na39)`(리스팅 `94`) → `knowledgeState = NO_LIBRARY`, evidence **0건**.

> 말씀 주신 제품들의 정확한 소재 표기 의미와 러브 10P 포함 각 상품의 실제 소재는 확인 후
> 안내드리겠습니다.

소재를 단정하지 않았다. **unsupported claim 0.**

### 6.1 드러난 retrieval 결함 (수정하지 않음 — 보고)

검색이 **뒤집혀 있다.** 위 지식 문서에 대해:

- "설치가 간편한가요 공구가 필요한가요"(문서가 답할 수 있는 질문) → **passage 0건**
- "선바로 한개당 길이가 몇m인가요"(문서가 답할 수 없는 질문) → **passage 1건**

원인은 `topicCoverage`의 **분모가 질문의 "askable" 부분**이라는 점이다. 라이브러리가 아는 낱말이
적을수록 비율이 올라간다 — 길이 질문은 `선바로` 하나만 askable이라 coverage가 1.0에 가깝고,
설치 질문은 askable 낱말이 많아 0.4 바닥에 걸린다. `longestSharedRun` 우회로가 absence gate까지
통과시킨다.

**이번 패키지에서 고치지 않는다.** 이 스코어러는 라이브 측정으로 보정된 상수를 갖고 있고
(`KnowledgeTextTest`), 큰 변경 묶음 끝에서 조용히 재보정하는 것은 옳지 않다. **실제 결과는 안전했다**
— 약한 passage를 받고도 초안은 근거 없는 주장을 하지 않았다. backlog 항목으로 남긴다.

---

## 7. PART G — UX

| 표면 | 변경 |
|---|---|
| 문의 목록 행 | `channelCode`/`channelNameKo` · `productId`/`productName` 추가. 무귀속은 **"상품 미지정"** — 공백은 로딩 중으로 읽혀 운영자를 기다리게 한다 |
| 문의 목록 (age) | `ageLabel` — 대기 일수. 음수·`NaN` 렌더링 없음 |
| Inbox feed | 무귀속 라벨이 `-` → **"상품 미지정"**, 그리고 `OperatorProductName.displayNameOrNull`을 써서 **공유 버킷 이름을 상품명으로 출력하지 않는다** |
| 문의 상세 | `replyCapability` (채널 × subtype 감사 결과) 추가 |
| limitation 문구 | 감사된 `reasonKo`를 그대로 보여준다 — **transport 이름은 노출하지 않는다.** "네이버는 지원하지 않습니다"를 들은 판매자는 자기 채널이 못 하는 줄 알고 묻기를 멈추지만, 실제로는 엔드포인트가 있고 SellerOps가 연결하지 않았을 뿐이다 |

**작은 기술 버튼 추가 0.** 지원되지 않을 때만 명확한 문장을 보여준다.

**`invalid sourceType => 500`은 재현되지 않았다.** `/api/inquiries?phase=BOGUS` → **400**(Spring enum
바인딩), `/api/inquiries?phase=OPEN` → 200. 다른 경로일 수 있으나 이 패키지에서 라이브로 재현하지
못했으므로 **고쳤다고 적지 않는다.** 무관 UI polish(reviews chip, products pagination)는 손대지 않았다.

---

## 8. PART H — Live WRITE readiness

| 채널 / source | transport | 구현 | credential | **안전한 대상** | live proof |
|---|---|---|---|---|---|
| COUPANG | `DIRECT_API` | 있음 | 연결됨 | **없음** — Demo Org의 REAL 문의 2건은 **전부 답변완료**. 미답변 5건은 DEMO_SEED 3 · VERIFY_FIXTURE 2 (**synthetic**) | 미실행 |
| GMARKET | `DIRECT_API` | 있음 | — | **없음** — 이 org에 문의 0건 | 미실행 |
| NAVER `PRODUCT_QNA` | `PLATFORM_SUPPORTED_NOT_IMPLEMENTED` | **없음** | 연결됨 | 없음 — REAL 13건 전부 답변완료 | 미실행 |
| NAVER `CUSTOMER_INQUIRY` | `PLATFORM_SUPPORTED_NOT_IMPLEMENTED` | **없음** | 연결됨 | 없음 — REAL 5건 전부 답변완료 | 미실행 |
| CAFE24 board 6 | `NEEDS_VERIFICATION` | 없음 | read-only scope | **미답변 69건 있으나 감사된 쓰기 경로 없음** | 미실행 |

또한 배포 자체가 보낼 수 없다: `executionEnabled = false`, `replyAdapterChannelCodes = []`.

### **판정: `LIVE_WRITE_NOT_RUN`. manifest를 준비하지 않았다.**

준비할 수 없어서가 아니라 **묶을 대상이 없어서**다. 실제 고객 문의를 임의로 골라 보내지 않는다.

**그리고 PART B가 이 정지를 옳게 만들었다.** 그 fence 전이라면 Demo Org의 미답변 Coupang 3건이
**안전한 라이브 대상과 정확히 같은 모양**으로 보였을 것이다 — REAL 채널, ACTIVE, 미답변, 정확한
external id, DIRECT_API. 셋 다 DEMO_SEED다. 첫 라이브 WRITE 증명의 대상이 픽스처가 될 뻔했다.

---

## 9. 회귀

backend **2,887 tests / 0 failures / 22 skipped** · frontend **164 files / 2,266 tests** ·
`tsc --noEmit` clean · agent-runtime 무변경(**Agent tool catalogue WRITE 0 불변**).

## 10. 남은 blocker

1. **NAVER 답변 요청 본문 계약 미확보** — 벤더 개별 문서 페이지를 vendoring 해야 adapter 구현 가능.
   (external-research 항목)
2. **Cafe24 문의 답변 쓰기 계약 미감사** + 현재 연결 scope에 쓰기 없음. (external-research + 재동의)
3. **board 6 `product_no` 부재** — 3,307건은 source에 식별자가 없어 어떤 코드 변경으로도 귀속되지
   않는다. 귀속률을 올리려면 **다른 relation**(예: `order_id` → 주문 line item)이 필요하고, 그러려면
   `channel_orders`에 line item이 있어야 하며 Cafe24 주문 수집이 있어야 한다. **둘 다 없다.**
   (product-owner 결정 항목)
4. **RAG retrieval 역전**(§6.1) — 보정된 스코어러 재작업. (backlog)
5. **조작된 상품 행 3개**(`91`·`94`·`170`)가 리뷰 귀속 때문에 남아 있다. 리뷰 경로 정리 필요. (backlog)
6. **다른 org의 Cafe24 113행**이 canonical Demo Org와 동일한 형태로 존재한다(같은 69 미답변). 테넌트
   정리 여부는 product-owner 결정.

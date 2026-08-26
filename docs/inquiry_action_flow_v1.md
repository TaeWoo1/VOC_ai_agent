# Inquiry Action Flow v1 — 초안 → 승인 → 실행

**2026-08-24 · `feat/agent-evidence-scope-integrity`**
북극성: 운영 Dashboard → Agent 분석 → Product Knowledge/RAG → **초안** → **사용자 명시 승인** → **별도
Action Executor** → 실제 marketplace 실행. 이 문서는 그 중 **초안부터 승인까지**를 소유하고, 실행은
이미 있던 fail-closed 체인을 **재사용**한다. Demo Core Experience v1(`docs/demo_core_experience_v1.md`)을
덮어쓰지 않는다.

**Agent reasoning graph는 이 패키지 이후에도 WRITE 0이다.** Planner/Specialist tool catalogue에 marketplace
WRITE tool은 없고, `operatorToolRegistry.test.ts`가 등록 자체를 거부한다. 아래 send 경로는 Agent tool이
아니라 **별도 Action Executor**이며, 사람의 명시 승인에서만 시작된다.

---

## 1. 감사 먼저 — 이 패키지의 절반은 이미 있었다

`inquiry/publish/`에는 승인·의도·실행·검증·채널 어댑터가 **이미 완성되어** 있었다: 불변 승인 바인딩,
`commandId` 멱등키, `dispatch_key` unique index, 버려진 DISPATCHING을 재전송 없이 `DELIVERY_UNKNOWN`으로
재분류하는 복구 러너, 그리고 기본값이 비어 있는 어댑터 레지스트리. 그래서 §5·§8·§9는 **새로 만들지
않았다**. 실제로 비어 있던 곳은 셋이었다 — 승인이 **대상**에 묶이지 않았고(§3), 초안에 **본문이 없었고**(§4),
화면이 그 둘을 **말하지 않았다**(§5).

## 2. 채널별 문의 WRITE capability (감사 결과)

`InquiryReplyCapabilityRegistry` — code-level, 좁은 registry. **§4.1의 어떤 칸도 옮기지 않고**, 스케줄도
열지 않는다. `GET /api/inquiry-publish/transports`.

| 채널 | source subtype | transport | 근거 |
|---|---|---|---|
| COUPANG | (단일) | **`DIRECT_API`** | `CoupangInquiryReplyClient` → `POST …/onlineInquiries/{id}/replies` · `CoupangChannelReplyAdapter` — **구현됨, 라이브 미실행** |
| NAVER | `NAVER_PRODUCT_QNA` | **`DIRECT_API`** (2026-08-24 승격) | 공식 계약 사본 `docs/vendor/naver-commerce-api/put-v1-contents-qnas-questionId.md` — `PUT /v1/contents/qnas/{questionId}`, body **`commentContent`** · `NaverProductQnaAnswerClient` · `NaverProductQnaReplyAdapter` — **라이브 검증됨 (2026-08-26, `apr-ce092e823017`, WRITE 1회, `LIVE_VERIFIED`)** — `docs/evidence/naver_inquiry_answer_live_proof_v1.md` · ⚠ 같은 questionId 재호출은 **덮어쓰기** |
| NAVER | `NAVER_CUSTOMER_INQUIRY` | **`DIRECT_API`** (2026-08-24 승격) | 공식 계약 사본 `post-v1-pay-merchant-inquiries-inquiryNo-answer.md` — `POST /v1/pay-merchant/inquiries/{inquiryNo}/answer`, body **`answerComment`** · `NaverCustomerInquiryAnswerClient` · `NaverCustomerInquiryReplyAdapter` — **구현됨, 라이브 미실행** · 중복은 `ERR-NC-101010`으로 **거부** |
| GMARKET (ESM+) | (단일) | **`DIRECT_API`** | `EsmAnswerClient` · `EsmChannelReplyAdapter` — **구현됨, 라이브 미실행**. 2026-08-24 추가: 구현된 adapter가 있는데 감사 행이 없었다(누락) |
| CAFE24 | (단일) | **`NEEDS_VERIFICATION`** | 플랫폼은 확인됨 — 공식 사본 `docs/vendor/cafe24-admin-api/post-boards-articles-comments.md`: `POST /api/v2/admin/boards/{board_no}/articles/{article_no}/comments`, scope `mall.write_community`, **필수 `content`·`writer`·`password`** · 미확정 ①board 6 댓글이 `reply_status`를 바꾸는지 근거 없음 ②`writer`/`password`를 SellerOps가 보유하지 않음 ③**2026-08-25 READ proof로 확정 — `STANDARD_BOARD_REPLY_ARTICLE`**(승인된 bounded proof, GET 5회 · `docs/inquiry_answer_execution_v1.md` §10–§12 · 사본 `docs/vendor/cafe24-admin-api/get-boards-articles.md` 정정본 · `docs/vendor/cafe24-admin-api/urgentinquiry-and-reply.md` 신규): **답변은 질문에 달린 자식 글이다** — `article 247`의 `parent_article_no=246`, `reply_depth=1`. 댓글은 **0**(A2 기각), 긴급문의 목록에 부재(B 기각) — **그 글에서는**. **2026-08-26 정정 (`apr-c24-a3674-obs`, READ 7회, WRITE 0):** A2 기각은 그 대상에 대한 관측이었고 board 6 전체에 대한 것이 아니었다. 다른 문의(`a3674`)에서 판매자가 관리자 화면으로 등록한 답변은 **댓글**로 존재했다 — `comment_no=39`, `member_id == mall_id`, 자식 글 0, 긴급문의 부재, verdict **`STANDARD_BOARD_COMMENT`**. 그리고 **댓글 답변은 `reply_status`를 바꾸지 않는다**(14:56 답변 → 17:43 재수집에도 `N`). 즉 **board 6의 답변 표현은 하나가 아니다**: A1 자식 글과 A2 댓글이 **둘 다** 실재하고, 어느 것이 쓰이는지는 판매자가 화면에서 무엇을 눌렀는가로 갈린다. READ 쪽은 닫혔다(`Cafe24InquiryAnswerObserver` — 증명된 `member_id == mall_id` 댓글만 부모를 `ANSWERED`로 만들고, 본문은 가져오지 않는다; `docs/cafe24_comment_answer_observation_v1.md`). **WRITE 쪽 이 행의 상태는 그대로다** — 아래 미확정 항목은 여전히 미확정이다. `PUT`이 `reply_status`를 받지 않는다는 관측은 재확인됐고, 거기서 「방법이 없다」로 간 것이 추론이자 오류였다 — `POST /articles`가 `reply_article_no`를 받는다. **`reply` 필드는 답변 신호가 아니다**(답변된 글에서도 `F`); 신호는 `reply_status`뿐이고 SellerOps가 그것만 쓰던 것은 맞았다. **답변 본문은 이미 우리가 호출하는 `GET /boards/{board_no}/articles`가 돌려주고 있다**(자식 글의 `content`) — 새 endpoint도 새 scope도 불필요하고, 투영하지 않는 `parent_article_no`·`reply_user_id` 두 필드가 전부였다. **남은 WRITE 미확정**: 그 `POST`의 `reply_status=C`가 **부모**에 붙는지 **자식**에 붙는지 계약도 관측도 말하지 않으므로(관측된 자식은 `null`) 다음 adapter가 single-step인지 **one-step-and-a-gap**(답변은 보내되 완료 표시 불가)인지 아직 모른다 · 행위자 값은 A1 기준 `writer`+`client_ip`(**`password`는 불필요해졌다**)이며 미보유, `member_id = mall_id`면 작성자가 **상점명으로 렌더링**된다는 문서화된 출구가 있다 · **부수 결함(미수정)**: `parent_article_no`를 투영하지 않아 **판매자 자신의 답변 글이 미답변 문의로 수집된다**(`cafe24:b6:a247`) · 현재 연결 scope `mall.read_community,mall.read_order,mall.read_product`(쓰기 미포함) |

> **⚠ 2026-08-24 갱신 (Inquiry Workflow Completion v2).** NAVER 두 행이 위 표에서 이미 `DIRECT_API`로
> 승격됐다. 아래 문단은 그 직전 상태의 기록이며, 막고 있던 것이 **결정이 아니라 문서**였다는 진단이
> 옳았음을 증명한다 — 문서를 확보하자 그날 안에 구현됐다. 두 계약이 실제로 얼마나 다른지(본문 필드 이름,
> 중복 답변 시 덮어쓰기 vs 거부)와 그로부터 나온 새 전송 직전 규칙은
> `docs/inquiry_workflow_completion_v2.md` §3–§4.

**2026-08-24 재감사(Inquiry Product Attribution & Action Coverage v1) — 아무 행도 움직이지 않았다.**
NAVER 두 subtype이 여전히 미구현인 이유는 결정이 아니라 **문서**다: vendored `llms.txt`는 세 답변
엔드포인트의 method와 path**만** 싣고, 요청 본문·필요 권한·응답 의미를 담은 개별 문서는 저장소에 없으며
이 환경에서 벤더 호스트에 접근할 수 없었다. **path만 알고 본문을 추측한 adapter는 구현이 아니므로 쓰지
않았다.** 상세: `docs/inquiry_product_attribution_action_coverage_v1.md` §3.

**adapter 등록과 이 표는 이제 한 사실이다** — `everyRegisteredAdapterHasAnImplementedCapabilityRow`가
둘의 불일치를 빌드에서 거부한다. 그리고 adapter 해석 자체가 채널이 아니라 **채널 × source subtype**으로
좁혀졌다(`ChannelReplyAdapter.servesSubtype`, 기본값은 단일 resource 채널만).

세 가지를 구분해서 적는다.

- **`DIRECT_API`는 이 저장소에 구현된 endpoint가 있을 때만** 쓴다. 벤더 문서를 읽었다는 것만으로는 아니다.
- **NAVER는 `UNSUPPORTED`가 아니다 — 2026-08-24 정정.** 이 표는 처음에 두 subtype을 `UNSUPPORTED`로
  적었고, 그 미완 질문("네이버에 답변 endpoint가 있는가")의 답은 **이미 이 저장소 안에 있었다**:
  `docs/vendor/naver-commerce-api/llms.txt` §문의가 답변 endpoint를 **셋** 싣고 있다 — 상품 문의
  `PUT /v1/contents/qnas/{questionId}`, 고객 문의 `POST /v1/pay-merchant/inquiries/{inquiryNo}/answer`,
  그 수정 `PUT …/answer/{answerContentId}`. **거절하는 쪽은 네이버가 아니라 우리다.** 판매자가
  "네이버는 지원하지 않습니다"를 읽으면 자기 채널이 못 하는 일이라고 결론짓고 묻기를 그만두는데,
  사실은 SellerOps가 아직 만들지 않은 것이다. 그래서 두 뜻을 값으로 갈랐다 —
  `PLATFORM_SUPPORTED_NOT_IMPLEMENTED`(플랫폼은 되고 우리가 안 한다) vs `UNSUPPORTED`(채널 쪽 한계,
  예: TalkTalk). **fence는 그대로 서 있고 이 package는 WRITE를 구현하지 않는다** — 어떤 빌드도 네이버
  답변을 등록할 수 없다는 문장은 여전히 참이다. 바뀐 것은 *왜* 그런가에 대한 기록뿐이다.
- **CAFE24의 `NEEDS_VERIFICATION`은 "안 된다"가 아니다.** 감사가 끝나지 않았다는 뜻이고, 화면은 그렇게
  말한다("지원하지 않는다는 뜻은 아닙니다"). 감사가 끝나지 않은 것을 벤더의 한계로 그리는 것이
  이 표가 막으려는 유일한 오류다.

**"문의 READ가 된다"와 "그 문의에 WRITE가 된다"는 같은 capability가 아니다.** NAVER 상품 문의 13건과 고객
문의 5건은 라이브로 수집을 증명했고(§4.1), 그 사실은 답변 등록에 대해 **아무것도** 말하지 않는다.

## 3. 승인은 텍스트가 아니라 **대상**에 묶인다 (V66)

기존 승인은 정확한 draft version + fingerprint에 묶여 있었다 — "판매자가 보낸 그 문장을 읽었는가"에
답한다. **"그 문장이 갈 곳이 아직 그 곳인가"에는 답하지 않았다.** 계정·채널·문의 external id·source
subtype은 전부 dispatch 시점에 work item과 inquiry 행에서 **새로 읽혔고**, 둘을 비교하는 코드는 없었다.

`inquiry_approval`에 다섯 칸이 붙는다 — `seller_account_id`, `channel_id`, `target_external_id`,
`source_subtype`, `action_kind`. 승인을 묶는 **그 트랜잭션 안에서** 스냅샷된다.

`source_subtype`은 **값으로** 비교한다(null == null). 단일 source 채널의 null은 정직한 값이지, 어떤
subtype에나 맞는 wildcard가 아니다 — 그렇지 않으면 NAVER 상품 문의 승인이 고객 문의에 쓰인다.

## 4. 전송 직전 재확인 (`PreSendCheck`)

제품의 **유일한 marketplace WRITE** 바로 앞. 승인은 한 시점에 대한 진술이고, 재시작 뒤 resume이면 그
사이에 몇 시간이 있을 수 있다.

**거부(refuse) — 아무것도 보내지 않는다.** `NO_TARGET_SNAPSHOT`(V66 이전 승인 — 확인 불가는 신뢰 불가) ·
`ACCOUNT_CHANGED` · `CHANNEL_CHANGED` · `TARGET_CHANGED` · `SUBTYPE_CHANGED` ·
`ALREADY_ANSWERED`(마켓에서 누가 답했든 — **두 번째 답변은 재시도가 아니다**) · `NOT_ANSWERABLE`.
거부는 영구 실패다: 재시도가 아니라 재승인이 해법이므로 execution을 `FAILED`로 놓는다.

**무지(unproven) — 거부가 아니다.** 채널의 INQUIRY 수집이 지금 최신이 아니면 "아직 미답변"은 *마지막으로
본* 상태이지 *지금* 참인 상태가 아니다. 조용한 채널마다 거부하면 기능이 못 쓰게 되고, 조용히 보내면
확인되지 않은 상태를 안전으로 간주하는 것이다. 그래서 **기록한다** — `inquiry_execution.presend_state_proven`
/ `presend_note` — 그리고 **누르기 전에** 화면에 말한다(`InquiryDetail.answerStateNote`). 위험을 감수하는
사람이 그 사실을 들은 사람이어야 한다.

`OBSERVED_FRESH`와 `ZERO`만 증명으로 친다 — 관측으로 얻은 두 상태. 나머지는 전부 미증명이다. 새
endpoint도, 새 마켓 호출도 없다: 이미 수집이 기록해 둔 것을 읽는다.

## 5. Inquiry Draft v1 — 근거가 있어야 근거를 댄다

`InquiryDraftComposer`. 증거 순서: **고객 문의 → 해석된 canonical product → 판매자가 쓴 상품 지식**.
그 밖은 참조하지 않고, 참조하지 않은 것은 인용하지 않는다.

### 5.1 payload floor가 움직였다 (의도적으로)

v1은 질문만 보냈다. 그래서 모델이 낼 수 있는 사실 주장은 전부 **지어낸 것**이었고, 규칙이 그것을 금지하니
"확인 후 안내드리겠습니다"만 남았다. **근거를 대려면 근거가 거기 있어야 한다.**

floor는 이제 **셋**이다 — 문의 제목 · 문의 본문 · 검색된 판매자 지식 passage. passage는 **식별자를 전부
떼고** 나간다: product id, source id, chunk id, 작성자, 시각, 검색 점수 없음. 인용은 backend에 남은 검색
결과로 되조립한다. `AgentDraftPayloadFloorTest`가 **직렬화된 바이트**에 대해 단정한다.

지식은 판매자 자신이 쓴 문장이고, 이미 나가고 있던 **고객 텍스트보다 좁은 부류**다.

### 5.2 네 가지 상태 — 네 개의 다른 문제

`DraftKnowledgeState`: `NO_PRODUCT`(문의가 상품에 연결되지 않음) · `NO_LIBRARY`(상품은 있고 지식이 없음) ·
`NO_MATCH`(지식은 있고 이 질문에 해당 없음) · `GROUNDED`. 하나로 합치면 "이 상품을 모른다"와 "아는데
이건 아니다"가 같은 문장이 된다.

**`(미지정 상품)`은 상품이 아니다.** ingest는 이름 없는 행마다 공유 placeholder를 만든다. 그 productId로
라이브러리를 검색하면 존재하지 않는 상품에 대해 `NO_LIBRARY`("이 상품에 등록된 지식이 없다")라고 말하고,
판매자에게 **버킷에** 지식을 쓰라고 권하게 된다. `OperatorProductName.displayNameOrNull`의 판단을 재사용해
`NO_PRODUCT`로 떨어뜨린다.

**모델이 안 돌면 GROUNDED가 아니다.** 검색이 성공했어도 그 초안을 쓴 것은 그 passage를 본 적이 없다.
`RULE` 초안은 인용 0이고 상태는 `NO_MATCH`로 낮춘다.

### 5.3 초안에 남는 것

`inquiry_reply_draft`에 `author_kind`(SELLER/MODEL/RULE) · `model_version` · `knowledge_state` ·
`product_id`. `inquiry_draft_evidence`에 draft version별 인용 — passage **본문은 복사하지 않는다**(chunk_id로
판매자 지식 행을 가리킨다). 고객 콘텐츠·구매자 신원 없음.

**수정하면 판매자의 것이 된다.** 저장은 새 version + 새 fingerprint를 만들고, 승인은 fingerprint에 묶이므로
**이전 승인은 자동으로 무효**다 — 이 컴포넌트가 기억하는 규칙이 아니라 데이터의 성질이다. 인용도 같은
이유로 함께 지운다.

## 6. 화면 (§4)

**고객 문의 → AI 답변 → actions.** 세 블록, primary 하나.
Primary **[답변 보내기]**, secondary **[수정] [다시 작성]**.

- 한계는 텍스트 **위에** 있다. 아래에 있으면 다 읽은 뒤에 발견된다.
- 확인 블록이 열려 있는 동안 **초안을 바꿀 수 있는 컨트롤은 하나도 렌더되지 않는다** — 예전에는 수정/다시
  작성/저장이 살아 있어서 승인이 화면에 뜬 채로 초안이 움직일 수 있었다. 이제 레이아웃이 그 위험을 없앤다.
- 응답 TYPE 제안은 meta 한 줄로 내려갔다(work item을 OPEN→PROPOSED로 옮기는 일은 그대로 한다).

**markup은 표시 경계에서 걷어낸다** — `MarkupText`. 저장된 본문은 손대지 않는다(고객이 보낸 것의 기록이다).
목록 snippet · 판매자가 읽는 상세 · **모델이 읽는 payload** 셋 다에 적용한다: `<table border="1" style='width:
1240px…`로 감싸인 질문은 모델도 잘못 답한다.

## 7. 이번에 하지 않은 것

live marketplace WRITE **0**. NAVER 원인 추적 없음, recurrence 재시도 없음, 새 connector 없음, review reply
없음, bulk/autonomous send 없음, lexical 동의어 확장 없음. NAVER `BLOCKED_EXTERNAL` 상태 그대로.
**Agent tool catalogue 변경 0.**

## 8. 라이브 검증 (2026-08-24, canonical Demo Org, marketplace 접촉 0)

### 8.1 Visual QA — **BLOCKED 아님**

`collector`에 Playwright 1.61 + Chromium이 설치되어 있어 실제 브라우저 렌더를 확보했다(1440×2600,
ko-KR, 임시 컨텍스트, **localhost 외 모든 요청 차단**). Overview · Products · Inquiries · Reviews ·
Agent 다섯 화면. 이전 패키지의 `VISUAL_QA_BLOCKED`는 해소됐다.

**시각적으로 명백한 blocker 2건 — 이번에 고침**

| # | 발견 | 고침 |
|---|---|---|
| V1 | KPI 6장 중 **5장**에 「최신 여부를 확인하지 못한 채널이 있습니다」가 **글자 그대로 다섯 번**, 경고색으로. 한 문장의 사본 다섯 개는 경고 다섯 개가 아니라 숫자를 덮는 주황색 벽이다 | 카드는 `†` 표시(+ sr-only 문장), 문장은 **행 아래 한 번**(`MetricNote`). 표시된 카드는 그대로고 채널별 표도 그대로 |
| V2 | 통합 매출의 **채널별 산정 기준 차이**가 페이지 맨 아래 참조 블록에만 있었다 — 데모 관람자는 「176만원」을 보고 그 각주에 도달하지 못한다 | 같은 문장을 **숫자 바로 아래**로. 참조 블록에도 유지 |

**Inquiries에서 발견한 blocker 2건 — 이번에 고침**

| # | 발견 | 고침 |
|---|---|---|
| V3 | 문의 목록 미리보기가 **markup 그대로**였다: `<br /> [ Original Message ] <p>…`, `&nbsp;`, 한 행은 미리보기 전체가 `<table border="1" style='width: 1240px; border-width: 0px 1p…`. 판매자가 자기 큐를 읽을 수 없었다 | `MarkupText` — 저장 행 불변, 표시·모델 payload에서만 평문화. 재촬영으로 확인 |
| V4 | 대기 시간이 **「3442일 전」·「4150일 전」**(2015년 게시물). 4,150일과 4,000일을 다르게 처리하는 사람은 없다 | 한 달 넘으면 개월, 1년 넘으면 「1년 넘음」 |

기록만 하고 **고치지 않은 것**: `/reviews`의 칩 두 줄(작은 버튼 39개 중 9개가 32px 미만), `/products`의
페이지네이션 부재(300개 중 10행), `Section`/`Panel` 관용구 통합. 전면 디자인 시스템 재작성 금지에 따름.

### 8.2 초안 — 실제 REAL 문의에서

| 실행 | 결과 |
|---|---|
| REAL Cafe24 문의(세금계산서 요청, 전달된 메일 스레드) | `authorKind=MODEL` · `knowledgeState=NO_PRODUCT` · **인용 0** · 「이 문의는 아직 상품과 연결되지 않아…」 · prompt `agent-draft-prompt/v2` |
| 본문 평문화 | 저장된 `<p>`/`&nbsp;`/`[ Original Message ]`가 사람이 읽는 줄바꿈 텍스트로 — 모델도 같은 것을 받음 |
| 지어낸 사실 | **0** — 초안이 쓴 연락처는 **문의 본문 안에 판매자 자신이 이미 쓴 것**이었다 |

**grounded 경로**(`VERIFY_FIXTURE` 상품 + 운영자가 입력한 규격 지식):

| 질문 | 결과 |
|---|---|
| 「폭이 몇 mm인가요 **배송 문의드립니다**」 | `GROUNDED` · 인용 1건(`product-knowledge/DESCRIPTION:데모 운영자`) · 폭은 **18mm로 정확히 답하고**, 배송은 **약속하지 않고** 확인 후 안내로 남김 — 한 질문 안에서 아는 것과 모르는 것을 갈랐다 |
| 「색상 옵션 **추가 예정** 있나요」 | 지식에 있는 색상(백색·아이보리)만 말하고 **출시 예정은 약속하지 않음**. unsupported claim **0** |

**라이브 grounding의 한계, 정확히.** canonical Demo Org에서 **작업 가능한 문의 큐는 Cafe24뿐이고, Cafe24
문의 3,425건 중 이름 있는 canonical product에 붙은 것은 0건**이다(전부 공유 `(미지정 상품)` 버킷). NAVER
18건과 Coupang 4건은 이름 있는 상품에 붙지만 **work item이 없다**(이미 답변됨). 그래서 위 grounded 증명은
`VERIFY_FIXTURE` provenance에서 수행했고, 증명 뒤 만든 행은 전부 지웠다(§8.4). **이것이 남은 가장 큰 데모
blocker다** — 경로는 동작하고, 이 조직의 데이터가 거기 닿지 않는다.

> **⚠ 2026-08-24 부분 해소 — `docs/inquiry_product_attribution_action_coverage_v1.md`.** 위 문단의
> "0건"은 관측으로는 맞았지만 **원인 진단이 반쪽이었다.** ingest가 Cafe24 `product_no`를 canonical
> `sku`로 넘겨 resolve-or-create 했고, 그 둘은 다른 키 공간이라 어긋나면 **번호로 이름 붙은 상품을
> 만들어 냈다**(`91`·`94`·`170` — 세 번호 전부 `channel_products`에 실재하는 리스팅이었다). 정확
> 일치 경로(`ChannelProductRef`)로 바꾸고 backfill 한 뒤 **canonical Demo Org 5건이 실제 상품에
> 귀속**되고 나머지는 **정직하게 무귀속**이 됐다. 그래서 grounded 증명은 이제 `VERIFY_FIXTURE`가
> 아니라 **실제 REAL Cafe24 미답변 문의**에서 수행된다(같은 문서 §6).
>
> 다만 **상한은 여전히 낮고, 이유가 바뀌었다**: board 6 게시글은 `product_no`를 거의 담지 않는다
> (`cafe24_community_articles` board 6 **905행 중 0행** 보유). 남은 3,307건은 코드로 귀속되지 않는다.

### 8.3 승인 바인딩 — 실제 confirm

`execution-enabled=false`(기본값)에서 `confirm-publish` 1회:

```
phase=ACTION_PENDING  executionStatus=ACTION_PENDING  category=PENDING
approval: version=1 · fingerprint=b34991d0… · seller_account ✓ · channel ✓
          target_external_id=VERIFY-11618-2 · action_kind=POST_INQUIRY_REPLY
marketplace 요청 0 (어댑터 미등록 → fail closed)
```

**라이브 DB에 이미 있던 것 하나.** 2026-08-20에 REAL Cafe24 문의(`cafe24:b6:a284`)에 대해 만들어진
`ACTION_PENDING` 승인이 하나 남아 있고, V66 이전이라 **target 스냅샷이 없다**. 새 gate에서 이것은
`NO_TARGET_SNAPSHOT`으로 **거부**된다 — 확인할 수 없는 승인은 신뢰하지 않는다. 이 안전 성질에는 이미
실제 대상이 있다.

pre-send 거부 9종의 라이브 증명은 execution을 켜야 하고, 그것은 실제 Coupang 호출이므로 **하지 않았다**.
오프라인에서 9개 테스트가 각각 승인과 dispatch 사이에서 **한 가지만** 움직이고 아무것도 보내지지 않음을
단정한다(`InquiryPreSendCheckTest`).

### 8.4 정리

증명을 위해 만든 work item 2건과 거기 딸린 승인·의도·실행·초안·인용·감사 행을 **전부 삭제**했다. 특히
`ACTION_PENDING` 승인은 남겨두면 나중에 execution이 켜질 때 **저절로 dispatch될 수 있는 장전된 상태**다.
삭제 후 잔여 0 확인. REAL 데이터 변경 0, NAVER schedule 3종 `enabled=false` 유지.

## 9. LIVE_WRITE_NOT_RUN — 그리고 무엇이 있어야 실행할 수 있는가

**실제 marketplace WRITE는 실행하지 않았다.** 안전한 test inquiry가 없다.

- COUPANG만 `DIRECT_API`인데, canonical Demo Org의 Coupang REAL 문의 11건은 **전부 이미 답변됐고**
  work item이 없다. 새 gate가 `ALREADY_ANSWERED`로 거부하는 것이 정확히 이 경우다.
- 남은 Coupang 문의는 `DEMO_SEED`/`VERIFY_FIXTURE`이고, 그 `external_id`(`VERIFY-11618-2`)는 **쿠팡에
  존재하지 않는다**. 보내면 실패하고, 그 실패는 아무것도 증명하지 못한다.
- CAFE24는 큐 전부를 갖고 있지만 transport가 `NEEDS_VERIFICATION`이다.
- **실제 고객 문의를 임의로 골라 답변하지 않는다.**

실행하려면 필요한 것: (a) 판매자가 소유한 Coupang 계정의, (b) **답변해도 되는 실제 미답변 문의**를 판매자가
지목하고, (c) `sellerops.inquiry.publish.execution-enabled=true`와 자격 증명, (d) 그 문의 하나 · 그 초안
version/hash 하나에 대한 **명시 승인 1회**. 예상 marketplace WRITE는 **정확히 1회**이며, rollback은 없다 —
등록된 답변은 취소되지 않는다. 그래서 승인은 draft hash에 묶이고, 전송 직전에 다시 확인한다.

## 10. 남은 blocker

1. **Cafe24 문의 3,425건의 상품 귀속 0** — 라이브 grounded 초안의 유일한 장애물. (스키마 결정은 이번
   패키지 범위 밖)
2. **문의 work queue에 synthetic 필터가 없다** — 지금은 합성 문의에 work item이 하나도 없어 잠재적이지만,
   생기면 판매자의 REAL 큐에 섞인다. provenance 계약(`docs/demo_org_and_channel_knowledge_v1.md`)과 어긋난다.
3. **Coupang 답변 어댑터는 라이브 미실행** — 구현됐고 증명되지 않았다.
4. `POST /knowledge/sources`에 잘못된 `sourceType`을 주면 **500**(400이어야 함).
5. `/reviews` 칩 과다 · `/products` 페이지네이션 부재.

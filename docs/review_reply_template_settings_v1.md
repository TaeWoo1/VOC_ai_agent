# Review Reply Template Settings v1

**2026-09-02 · closure 2026-09-03 · `feat/proactive-operations-agent-v1` · marketplace 호출 0 · WRITE 0 ·
모델 호출 0**

리뷰 답변 초안이 **코드에 박힌 문구**에서 시작하던 것을, 회사가 자기 말투로 정할 수 있게 만든다.
새 AI drafting architecture가 아니고, 새 taxonomy도 아니다 — 이미 있던 분류를 **org 설정값으로
끌어올린 최소 변경**이다.

---

## 1. 기존 구조 감사 — 7종이다, 6종이 아니다

`RuleBasedReviewReplyProvider`가 실제로 갖고 있던 것:

| # | category | 선택 방법 | 낱말 |
|---|---|---|---|
| 1 | `positive_reply` | **별점 ≥ 4** (낱말보다 먼저) | — |
| 2 | `quality_reply` | 낱말 1순위 | 불량 · 하자 · 깨짐 · 파손 · 터짐 · 고장 · 품질 |
| 3 | `delivery_reply` | 낱말 2순위 | 배송 · 택배 · 발송 · 도착 · 출고 · 지연 |
| 4 | `packaging_reply` | 낱말 3순위 | 포장 · 박스 · 완충 |
| 5 | `product_info_reply` | 낱말 4순위 | 설명 · 사양 · 스펙 · 사진 · 상이 · 다릅 · 달라요 |
| 6 | `pricing_reply` | 낱말 5순위 | 가격 · 비싸 · 할인 · 가성비 |
| 7 | `general_reply` | fallback | — |

**정정**: 직전 preflight 보고서가 「키워드 6종」이라고 적은 것은 부정확했다. 키워드 규칙은 **5개**이고
전체 category는 **7개**다. 이 문서를 쓰면서 enum을 옮길 때 `pricing_reply`를 한 번 빠뜨렸고,
`ReviewReplyTemplateDefaultsTest`를 쓰다가 잡았다 — 그 테스트가 존재하는 이유가 정확히 그것이다.

선택 규칙은 **바뀌지 않았다**: 별점이 낱말을 이긴다(★5 「배송 빨라요」에 사과문을 보내지 않기 위해),
낱말은 선언 순서대로 첫 hit이 이기고, 아무것도 안 맞으면 fallback. 별점이 없는 리뷰는 낱말 경로.

---

## 2. org override — 두 층이고 세 번째는 없다

`ReviewReplyTemplateKey`(enum, 7 member)가 category · 낱말 · 순서 · **기본 문구**를 갖고,
`ReviewReplyTemplateService.bodyFor(orgId, key)`가 org override 또는 기본값을 돌려준다.

* **V89 `review_reply_template`** — `(org_id, template_key)` 부분 유니크, 행은 **override일 때만** 존재.
  백필 0, 가입 시 생성 0. **행이 없는 것이 정상 상태**이고 그때 답은 제품이 출고한 그 문구다.
* **기본값 복원 = DELETE**. 기본 문구를 다시 써 넣으면 화면에서는 똑같아 보이지만 그 org는
  이후 제품이 문구를 고쳐도 따라오지 않는다 — 고르지도 않은 문장을 영구히 얼린 셈이 된다.
* v1에 **없는 것**: 상품별 · 계정별 · 채널별 override, 조건식, 우선순위 컬럼, 템플릿 언어.
  각각이 「아무도 명세하지 않은 우선순위를 해결하겠다」는 약속이고, 파일럿이 요구한 적이 없다.
  `ReviewReplyTemplateFenceTest`가 service·entity에서 `productId`/`sellerAccountId`/`channelCode`를
  **이름으로** 금지한다.

**provider는 선택을 그대로 들고 있고**, 달라진 것은 body를 어디서 가져오는가 하나다.
`ObjectProvider`로 optional 주입이라 template 저장이 없는 context에서도 생성되고 — 그때는
테이블이 생기기 전과 **같은 바이트**를 낸다(`aProviderWithNoStorageAndAnOrgWithNoRowAgree`).

---

## 3. style layer라는 것을 구조로 고정한다

**template은 「어떻게 말하는가」이고 「무엇이 사실인가」가 아니다.** `ReviewReplyTemplateFenceTest`가
template 패키지 5개 파일에서 이름으로 금지한다:

* 사실 출처 — `KnowledgeRetriever` · `ProductKnowledge` · `OrgKnowledge` · `AnswerMemory` ·
  `OrderFact` · `ProductRepository` · `InquiryRepository` · `ReviewRepository`
* 모델 seam — `AgentLlm` · `OpenAi` · `ChatModel` · `prompt`
* **보간 문법** — `{{` · `%s"` · `${`. template은 **문장 전체**이지 사실을 끼워 넣는 슬롯이 아니다.
* 승인 계약 — `ReviewReplyDraft` · `ReviewReplyApproval` · `ReviewReplyFingerprint` ·
  `ReviewReplySubmissionRef` · `contentFingerprint`

향후 Grounded Review Drafting은 이 층과 **합성**되지, 이 층을 **통해** 도착하지 않는다.
이번 패키지에서 grounding architecture는 **0**이다.

## 4. provenance — 계약은 그대로

override에서 온 문구는 `providerVersion`이 **`templates-v1+org`**로 보고된다(기본은 `templates-v1`).
그것은 suggestion **view**에만 실리고 저장되지 않으며 아무것도 바인딩하지 않는다.
초안 version · `content_fingerprint` · `review-reply-v1` · 승인 · execution binding은 **무변경**이고,
판매자가 초안을 고치면 기존 append-only 흐름 그대로다. **APPROVED head만** execution binding에 쓰인다.

## 5. 화면 — `/settings/review-templates`

「리뷰 답변 문구」. 유형별로 **한국어 이름 · 언제 쓰는지 한 줄 · 트리거 낱말 · 텍스트 상자 ·
저장 · 기본값 복원**. `positive_reply` 같은 **내부 key는 화면에 0회** 노출되고
(`ReviewReplyTemplates.test.tsx`가 렌더된 전체 텍스트에서 7개 key와 `provider`/`prompt`/`RULE_BASED`를
검사한다), 이름은 `lib/reviewReplyTemplates.ts`가 소유하며 이름 없는 category는 **raw로 그리지 않고
아예 렌더하지 않는다**. 순서는 backend가 보낸 순서 = 제품이 실제로 판단하는 순서다.

맨 위 3줄이 이 화면의 계약을 판매자 말로 적는다 — 「말투와 표현만 정합니다. 배송일·환불·교환 같은
약속은 문구가 대신 정하지 않습니다」 · 「저장하면 **다음에 만드는 초안부터** 반영됩니다.
이미 승인한 답변은 그대로입니다」.

`저장`은 내용이 바뀌었을 때만, `기본값 복원`은 직접 정한 문구가 있을 때만 활성화된다 — 기본값과
같은 내용을 override로 써 넣는 경로를 화면에서 막는다.

## 6. 검증

**단위·구조**: backend **3,662** / 실패 0 (신규 `ReviewReplyTemplateServiceTest` ·
`ReviewReplyTemplateDefaultsTest` · `ReviewReplyTemplateFenceTest`), frontend **2,667** / 225 files /
실패 0 · typecheck clean.

**라이브(로컬 스택 재기동, V89 적용 62ms, ERROR/WARN 0)** — 마켓플레이스 0 · 모델 0:

| | 결과 |
|---|---|
| A 설정 전 | 7종 전부 `customized=false`, 문구 = 출고 기본값 |
| B `c329471c` 제안 (전) | `positive_reply` · 기본 문구 · `providerVersion=templates-v1` |
| C 저장 | 200, `customized=true` |
| D `c329471c` 제안 (후) | org 문구 · `providerVersion=templates-v1+org` · **초안 head v1 무변경**(fp `700b7924…`) |
| F org B (제품 signup) | `customized=false` · 기본값 · **org A 문구 안 보임** |
| G org B 저장 후 org A | **org B 문구 안 보임** |
| H v2 생성 | `PUT …/reply/draft` baseVersion 1 → **v2** fp `7482a92e…` |
| I append-only | v1 `700b7924…` **그대로**, 승인 0 · ref 6(전부 pre-V86 사용 불가) · execution 0 |
| J validation | 공백 400 · 4000바이트 초과 400 · 알 수 없는 유형 400, 행 0 |
| K 기본값 복원 | 행 삭제 · `customized=false` · 미설정 유형 복원도 200 |

**브라우저 1440 / 1366 / 1152** — 내부 key 노출 **0** · AA 위반 **0** · 가로 스크롤 0 · 콘솔 오류 0 ·
off-host 0. 7개 패널 전부 렌더(제목 8 = 안내 1 + 유형 7, textarea 7).

disposable QA org는 `tools/dev/org-cleanup.sh --confirm`으로 제거(연결 계정 0).

## 7. 남긴 것 / 보고

* **Demo Org의 `positive_reply` override는 남아 있다** — QA에서 설정한 값이고
  「안녕하세요, 고객님. 저희 제품을 이용해 주셔서 감사합니다. 남겨주신 후기 잘 읽었습니다.」이다.
  product-owner가 화면에서 고치거나 [기본값 복원] 한 번으로 되돌릴 수 있다.
* **이미 승인된 초안에 대한 라이브 무변경 관측은 없다** — 이 org에 승인된 리뷰 답변이 하나도 없다.
  구조로는 fence 테스트가 승인 계약 타입을 이름으로 금지하고, 관측으로는 override 저장 후
  초안 head의 version·fingerprint가 바뀌지 않았다.
* **★4 리뷰의 오답 자체는 이 패키지가 고치지 않는다.** 별점이 낱말을 이기는 규칙 때문에
  `c329471c`(★4 + 접착 불만)는 여전히 「칭찬 리뷰」 문구로 시작하고, 판매자가 고쳐 쓴다.
  그것이 provider가 문서화한 tradeoff이고, 바꾸려면 선택 규칙을 바꿔야 하므로 하지 않았다.
* 이번 패키지에서 **grounded AI drafting · planner/model · 승인/write architecture ·
  NAVER Guided Reply execution driver 무변경.**

---

## 8. Closure (2026-09-03) — selection 우선순위 뒤집기

**product-owner 결정**: 「명백한 불만이 있는 ★4 리뷰가 `positive_reply`로 가는 것」을 고친다.
새 taxonomy·AI classifier **0**, 기존 7종 deterministic selector 안에서만.

### 8-1. 바뀐 것은 rating을 묻는 위치 하나

```
before   rating >= 4 → POSITIVE ; else 낱말 5종(선언 순서) ; else GENERAL
after    낱말 5종(선언 순서) ; else rating >= 4 → POSITIVE ; else GENERAL
```

**낱말 목록과 그 사이 우선순위는 한 글자도 바뀌지 않았다**(`keywordsAndOrderAreUnchanged`).
enum 선언 순서도 새 결정 순서로 옮겨 화면 순서 = 규칙 순서가 계속 참이다
(불량·배송·포장·설명·가격 → 칭찬 → 그 밖).

### 8-2. 대가를 재서 적는다 — 1,153건 중 1,098건이 ★5다

이 저장소의 실제 NAVER 코퍼스 **4,455행**에 두 규칙을 돌린 결과:

| | |
|---|---|
| 판정이 그대로 | 3,302 |
| **`positive_reply`에서 이동** | **1,153** — delivery 896 · pricing 117 · quality 77 · product_info 48 · packaging 15 |
| 그중 별점 | **★5 1,098** · ★4 55 |

즉 이 변경이 실제로 움직이는 것은 대부분 **「배송 빨라요」류 칭찬**이고, 겨냥한 ★4 불만은 55건이다.
낱말 표는 「배송 빨라요」와 「배송 늦어요」를 구분할 수 없고, **이 클래스는 구분하려고 시도하지 않는다** —
거기서 감정을 판정하는 것이 곧 이 provider가 「아니라고 정의된」 AI다.

그래서 **지렛대는 판매자의 것**이고 그것이 이 패키지가 만든 바로 그것이다: 칭찬이 대부분인 회사는
배송 템플릿을 양쪽으로 읽히는 문구로 바꾼다. reviewnary 기본값이 **fallback**이고 org template이
**주 경로**라는 제품 방향이 이 결정을 감당 가능하게 만드는 유일한 이유다.

테스트가 이 대가에 이름을 붙여 고정한다 — `praiseThatNamesATopicWordIsAnsweredAboutTheTopic`,
`aNamedIssueOutranksTheStarEvenOnAPraisingReview`. **안전 테스트를 약화한 것이 아니라 뒤집은 것**이고,
뒤집은 이유를 테스트 자신이 적는다.

### 8-3. `c329471c`는 움직이지 않았다 — 요청과 다른 결과

closure 요구사항은 「target `c329471c`가 `positive_reply`가 아니라 실제 내용에 맞는 issue category로
선택되는지 회귀 테스트로 고정」이었다. **그렇게 되지 않는다**:

이 리뷰의 불만(부착이 유지되지 않아 고객이 직접 붙였다)은 다섯 목록의 **어떤 낱말도 쓰지 않는다**
— 불량·하자·깨짐·파손·터짐·고장·품질 0, 배송 계열 0, 포장 계열 0, 설명 계열 0, 가격 계열 0.
issue signal이 없으므로 rating이 결정하고 ★4는 여전히 `POSITIVE`다. 라이브 확인:
`category=positive_reply`.

**추측으로 낱말을 더하지 않았다.** 「떨어」·「붙」을 quality 목록에 넣으면 target은 옮겨가지만 그것은
분류 데이터를 발명하는 일이고, 이 저장소의 assumption rule이 금지하는 종류의 결정이다 ⇒
**product-owner 결정으로 올린다**. 오늘 코드 없이 가능한 답은 판매자가 「칭찬 리뷰」 문구를
양쪽으로 읽히게 바꾸는 것이고, §8-5가 실제로 그렇게 했다.

한계는 테스트로 고정했다 — `aComplaintInWordsNobodyListedIsNotSeenAsAnIssue`(합성 본문, 고객 문장 아님).

### 8-4. 뒤집기가 실제로 작동하는 것도 라이브로 확인

Demo Org의 실제 ★4 리뷰 둘(`b1ec4c4e` · `c60b3df1`, 품질 낱말 보유) — 이전 규칙이라면
`positive_reply`였을 것이 지금 **`quality_reply`**로 판정되고 「상품에 문제가 있어 불편을 드린 점…」에서
시작한다.

### 8-5. org template → new draft 정상 경로

판매자가 설정 화면에서 「칭찬 리뷰」 문구를 바꾸고(`PUT /api/review-reply-templates/positive_reply`),
같은 리뷰의 새 초안을 만들면 **그 문구가 출발 문구**가 된다:

| | |
|---|---|
| 저장한 문구 | 「…남겨주신 후기 **하나하나 확인하고 있습니다**.」 |
| 새 초안의 시작 문구(suggestion) | **바이트 동일** · `providerVersion=templates-v1+org` |
| 저장된 새 초안 | **v3** fp `44627df4…` (출발 문구 + 판매자가 이 리뷰에 더한 두 문장) |
| 기존 버전 | v1 `700b7924…` · v2 `7482a92e…` **무변경** |
| 승인 · execution | **0 · 0** — 승인하지 않았다 |

### 8-6. 검증

backend **3,666** · frontend **2,667** / 225 files · 실패 0 · typecheck clean.
브라우저 1440/1366/1152 — 내부 key 노출 0 · **AA 위반 0** · 가로 스크롤 0 · 콘솔 오류 0 · off-host 0,
패널 순서가 새 결정 순서(불량·파손 → 배송 → 포장 → 상품 설명 → 가격 → 칭찬 → 그 밖).
마이그레이션 **0**(V89 그대로) · 마켓플레이스 **0** · 모델 **0**.

### 8-7. 화면 문구도 규칙을 따라 고쳤다

「칭찬 리뷰」의 설명이 **거짓이 됐으므로** 바꿨다 — 「아쉬운 점이 함께 적혀 있어도 별점이 높으면 이
문구입니다」 → **「별점이 4~5점이고 위 유형의 낱말이 없는 리뷰에 씁니다. 낱말이 하나라도 있으면 별점이
높아도 그 유형의 문구를 씁니다.」** 「그 밖의 리뷰」도 같은 이유로 한 줄 고쳤다.
새 컴포넌트·새 색·visual system 변경 **0**.

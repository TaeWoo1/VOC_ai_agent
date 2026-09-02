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

## 8. Closure (2026-09-03) — precedence를 뒤집었다가, 재서, 되돌렸다

Template Settings v1은 이 절로 **freeze**된다. 아래는 그 마지막 라운드의 기록이다.

### 8-1. 뒤집었다

product-owner 결정으로 selection을 `낱말 5종 → rating>=4 POSITIVE → GENERAL`로 바꿨다.
겨냥한 것은 「명백한 불만이 있는 ★4 리뷰가 칭찬 문구로 시작하는 것」이었다.

### 8-2. 쟀다 — 1,153건 중 ★5가 1,098건

실제 NAVER 코퍼스 **4,455행**에 두 규칙을 돌린 결과:

| | |
|---|---|
| 판정 그대로 | 3,302 |
| `positive_reply`에서 이동 | **1,153** — delivery 896 · pricing 117 · quality 77 · product_info 48 · packaging 15 |
| 그중 별점 | **★5 1,098** · ★4 55 |

즉 실제로 움직인 것은 대부분 **「배송 빨라요」류 칭찬**이었고, 겨냥한 ★4 불만은 55건이었다.
그리고 target `c329471c`는 불만이 다섯 목록의 **어떤 낱말도 쓰지 않아** 여전히 `positive_reply`였다 —
바꾸려던 것은 안 바뀌고, 안 바꾸려던 것이 1,098건 바뀌었다.

### 8-3. 되돌렸다 — 이유는 구조적이다

```
복원   rating >= 4 → POSITIVE ; else 낱말 5종(선언 순서) ; else GENERAL
```

**이 낱말들은 topic을 감지하지 polarity를 감지하지 않는다.** 「배송 빨라요」와 「배송 늦어요」는 이 표에
같은 단어다. 그것을 가릴 수 있는 것이 생기기 전에는 topic 낱말이 별점을 이겨서는 안 된다 — 그리고 여기에
감정 heuristic을 넣는 것이 곧 이 provider가 「아니라고 정의된」 AI다. 낱말 목록·새 classifier·polarity
heuristic **0**.

### 8-4. 대신 고친 것: `positive_reply`는 「칭찬」이 아니다

되돌리면 ★4 불만은 다시 이 문구로 시작한다. 그래서 **그 문구가 축하하지 않게** 했다.

* **이름** — 「칭찬 리뷰」 → **「별점 4~5점 기본 문구」**. 제품은 칭찬인지 불만인지 모른다(별점과 topic
  낱말만 본다); 「칭찬」이라고 부르는 것은 아무도 하지 않은 판정을 판매자에게 약속하는 일이다.
  `reviewReplyTemplates.test.ts`가 어떤 이름에도 「칭찬」이 없음을 고정한다.
* **설명** — 「별점이 4~5점인 리뷰에 씁니다. 아래 유형의 낱말이 있어도 별점이 높으면 이 문구를 씁니다.」
  (규칙 그대로. 「그 밖의 리뷰」도 같은 이유로 한 줄 고쳤다.)
* **기본 문구** — 「좋은 후기를 남겨주셔서 진심으로 감사합니다. 앞으로도 만족하실 수 있도록
  노력하겠습니다.」 → **「저희 제품을 이용해 주셔서 감사합니다. 남겨주신 후기 잘 읽었습니다.」**
  감사는 하되 고객이 만족했다고 **단정하지 않고** 아무것도 약속하지 않는다. 판매자는 이제 **틀린 문장을
  지우는 대신 중립적인 문장을 고쳐 쓴다**. `ReviewReplyTemplateDefaultsTest`의 리터럴이 같은 커밋에서
  함께 움직였다 — 그 테스트가 존재하는 이유가 「reword를 아무도 안 읽은 diff가 아니라 결정으로 만드는 것」이다.

부수로 **provenance를 행 기준으로** 고쳤다: 기본값과 **같은 문구**를 저장한 회사도 그 문구를 고른 것이므로
`templates-v1+org`로 보고한다(이전에는 문자열 비교라 `templates-v1`이라고 답했다). 읽기 횟수는 그대로 1회.

### 8-5. 회귀 — 라이브

| | 결과 |
|---|---|
| ★5 + 「배송」 (실제 리뷰 `710852f0`) | **`positive_reply`** — 사과문 아님 |
| ★≤2 + 「배송」 (실제 리뷰 `4e923596`) | **`delivery_reply`** — 「받아보시기까지 불편을 드린 점 사과드립니다」 |
| **`c329471c` ★4** | **`positive_reply`** · `templates-v1+org` · 시작 문구 = org override |
| `c329471c` 초안 | **v3 `44627df4…` 유지** — v1 `700b7924…` · v2 `7482a92e…` 무변경, 재생성 0 |
| 승인 · execution | **0 · 0** |
| org override · 기본값 fallback | override 1행 유지, 나머지 6종 `customized=false` |

backend **3,666** · frontend **2,667** / 225 files · 실패 0 · typecheck clean.
브라우저 1440/1366/1152 — 내부 key 노출 0 · **AA 위반 0** · 가로 스크롤 0 · 콘솔 오류 0 · off-host 0,
패널 순서 = 결정 순서(별점 4~5점 기본 문구 → 불량·파손 → 배송 → 포장 → 상품 설명 → 가격 → 그 밖).
마이그레이션 **0** · 마켓플레이스 **0** · 모델 **0**.

### 8-6. FREEZE

**유지**: org override · 7 categories · save/reset/default fallback · org isolation ·
next-draft application · validation · approval/version/fingerprint immutability.

**추가하지 않는다**: configurable trigger words · product/channel/account override · custom category ·
interpolation/template DSL · AI classifier · polarity heuristic · grounded drafting.

**열린 채로 남는 것 하나** — ★4 불만을 낱말로 알아보는 문제는 이 층에서 풀 수 없다. 오늘의 답은
중립 기본 문구 + 판매자 편집이고, 진짜 답은 polarity를 아는 층(Grounded Review Drafting)이며 그것은
이 패키지가 만들지 않는다.

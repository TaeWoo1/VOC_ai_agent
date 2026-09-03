# Retrieval Runtime Closure v1

**2026-09-03 · `frontend/` + `backend/` · 마이그레이션 0 · 마켓플레이스 호출 0 · WRITE 0 · 승인 0**

Knowledge Retrieval Quality v2는 **PASS**다. 이 패키지는 recall을 더 올리지 않는다 — F5(질문 의도 재진술 +
거절 전용 근거 판정)를 **판매자가 쓰는 제품에서 일관되고 반복 가능하게** 만든다. threshold · scorer ·
candidate ladder · 프롬프트 · 모델 · 세 lane의 구조는 **전부 그대로**다.

## 0. 왜 지금 이것인가 — holdout이 이름 붙인 성질

114 벤치마크와 44 holdout은 recall/wrong-source/부재 정확도에서 F5를 확정했다. 같은 holdout이 **품질이
아닌 결함 하나**를 관측했다: 「화장품 냉장고에 넣어도 되나요?」가 채점 pass에서는 근거 없음이었고 반복
2회에서는 GROUNDED였으며, 「몇 방울이나 쓰는 게 맞아요?」는 정확히 그 반대였다.

원인은 threshold가 아니라 **성질**이다. v1의 검색은 결정론이었고 — `KnowledgeRetriever`의 docblock이
「인용이 장식이 아니라 근거가 되는 전제」라고 적어 둔 그것 — F5는 세 단계 중 **둘이 매 검색마다 새로
이루어지는 모델 호출**이다. 총점은 거의 움직이지 않지만(한 질문이 다른 질문과 자리를 바꾼다)
**「같은 리뷰를 두 번 열면 같은 근거가 보인다」는 보장이 사라졌다.**

이 패키지는 그 보장을 **캐시가 아니라 구조로** 되돌린다: 근거는 초안 버전이 쓰이는 순간 고정되고,
다시 여는 것은 **다시 판정하는 것이 아니라 다시 읽는 것**이다.

## 1. 저장된 Draft Version의 evidence는 immutable

### 감사 — 대부분 이미 참이었다

| 읽기 경로 | 초안 본문 | 근거 | authorKind | answerBasis |
|---|---|---|---|---|
| 문의 상세 (`InquiryProposalService.detail`) | 저장 행 ✅ | `inquiry_draft_evidence` ✅ | ✅ | ✅ (V82) |
| 리뷰 답변 작업 (`ReviewReplyService.view`) | 저장 행 ✅ | `review_draft_evidence` ✅ | ✅ | **❌** |

두 읽기 경로 어느 쪽도 **retrieval을 다시 돌리지 않았다** — `InquiryEvidenceRetriever`를 이름으로도
알지 못한다. 즉 §1의 본체는 이미 서 있었고, 없던 것은 **리뷰 lane의 answer basis 한 칸**과
**그 성질을 고정하는 테스트**였다.

### 결함: 리뷰 lane의 basis는 브라우저 세션 안에서만 살아 있었다

`review_reply_draft.answer_basis`는 Grounded Review Drafting v1부터 채워지고 있었고 **읽는 코드가
없었다**. `ReviewReplyDraftView`는 「이 표는 provenance를 들지 않는다」고 적어 둔 채(그 문장은 이 컬럼이
생기면서 낡았다) 값을 버렸고, `ReviewReplyPrepView`는 `draftAuthorKind`와 `draftEvidence`만 실었다.
프론트는 「근거 있음 / 기본 문구」를 `result`(그 세션의 생성 결과)에서만 렌더했다 ⇒ **새로고침하면
초안과 인용은 남고 「이 문장이 회사의 지식으로 쓰였는가」만 사라진다.** 판매자가 고객에게 보낼 문장에
대해 가장 알아야 하는 사실이 그것이다.

수정: `ReviewReplyPrepView`에 `draftAnswerBasis` · `draftAnswerBasisNote` 두 칸. 문장은
**`ReviewDraftComposer.basisNoteOf(basis, hasEvidence)` 하나**가 정하고 생성 경로와 읽기 경로가 그것을
공유한다 — 같은 사실의 두 렌더링이 갈라질 자리를 만들지 않는다. `null`은 세 번째 진술(「기록되지
않았다」)이고 그때 화면은 아무 말도 하지 않는다.

**다시 계산하지 않고 다시 읽는다**: 「이 초안은 근거가 있었나」를 재계산하려면 retrieval을 다시 돌려야
하고, 그 retrieval의 두 단계는 매번 새로 모델을 부른다. 저장된 답을 읽는 것이 유일하게 정직한 방법이다.

### 구조 테스트 — `RetrievalRuntimeClosureTest`

* **retrieval을 부를 수 있는 파일은 셋뿐**: `InquiryDraftComposer` · `ReviewDraftComposer`(둘 다 초안
  버전을 **쓴다**) · `InquiryKnowledgeCoverageService`(§4).
* **두 판매자 읽기 경로는 retriever를 이름으로도 갖지 않고**, 저장된 인용을 읽는다.
* 생성 중간 산출물(재진술 · 판정)을 아는 파일 셋은 `Repository` · `@Entity` · `save(` · `EntityManager`를
  **하나도** 갖지 않는다.

## 2. 새 retrieval은 새 draft generation일 때만 — invalidation/reuse 경계

기존 구조를 감사해서 **가장 자연스러운 경계**를 잡았다. 새 표도, 새 버전 컬럼도, 새 invalidation
프레임워크도 만들지 않았다.

| 무엇이 바뀌었나 | 무엇이 다시 일어나나 | 어떻게 알아채나 |
|---|---|---|
| 아무것도 (다시 열기) | **아무것도** — 저장 행과 인용 행을 읽는다 | 읽기 경로에 retriever가 없다 (구조) |
| 판매자가 「다시 준비하기」 | 새 초안 버전 · 새 인용 행 · **같은 근거** | 질문·문단이 같으면 memo 적중 |
| 리뷰/문의 본문 | 새 초안(다른 질문) | 질문이 memo 키의 일부 |
| 관련 Knowledge (수정·추가·은퇴) | 바뀐 문단의 임베딩 + 그 lane의 판정 | **문단 텍스트가 키의 일부** |
| 모델 (embedding · intent · judge) | 전부 | 모델 이름이 키의 일부 |
| 차원 수 | 임베딩 | `knowledge_embedding`의 PK이자 memo 키 |

**핵심은 「무엇을 무효화할까」를 묻지 않는 것이다.** 세 키가 전부 **내용**이라 낡은 답이 존재할 수 없다 —
문서를 고치면 다른 해시고, 은퇴시키면 candidate 목록에서 빠지고, 되돌리면 예전 키로 적중한다.
버전 컬럼을 두 chunk 표와 answer memory 행에 걸쳐 손으로 맞출 필요가 없다.

## 3. 동일 input + 동일 knowledge snapshot에서의 재사용

### 감사 — 한 초안이 같은 문장을 여섯 번 샀다

한 grounded 초안은 **세 lane**(상품 지식 · 운영 정책 · 과거 답변)을 **한 질문**으로 검색하고, v2부터는
그 질문의 **두 표현**(고객 문장 + 재진술)으로 검색한다. 그런데

* `KnowledgeEmbeddingService.questionVector`는 **캐시가 없었다** ⇒ lane마다 두 표현을 새로 임베딩,
* `KnowledgeEvidenceEligibility`는 **memo가 아예 없었다** ⇒ lane마다 판정을 새로 구매,
* `KnowledgeQuestionIntent`만 5분 TTL memo를 갖고 있었다(그래서 재진술 자체는 이미 1회였다).

틀린 것은 하나도 없었다. **한 번 이상 지불한 것이 전부다.**

### 구현 — `SearchMemo`, 시계가 아니라 내용으로 옳다

`SearchMemo<V>` 하나(≈100줄)를 세 문이 공유한다. 각 caller가 **답이 실제로 의존하는 것**으로 키를 만든다:

* **재진술**: `sha256(intent 모델 + 질문)`
* **질문 벡터**: `sha256(org + embedding 모델 + 차원 + 문장)` — DB 표에는 **넣지 않는다**(그 표는 판매자
  문단의 content-addressed 캐시이고, 고객 질문 행을 넣는 것이 v1이 거부한 「고객 표현의 두 번째 사본」이다)
* **근거 판정**: `sha256(judge 모델 + 질문 + 순서대로 이어붙인 문단 텍스트)` — 이것이 곧
  「**동일 input + 동일 knowledge snapshot**」의 정의다

**5분은 임의 캐시 수명이 아니라 retention이다.** 정확성은 키가 준다(무한 보관해도 답은 여전히 옳다).
5분인 이유는 이 답들이 **고객 표현에서 파생된 사본**이고 이 저장소는 그 사본을 하나만 갖는다는
쪽이다 — 잊는 것이 성질이다. 두 축(5분 · 200개) 모두 유계이고, 프로세스 재시작은 전부 잃고 1회를 낸다.
그리고 **null도 답이다**: 「벤더가 거절했다」와 「이 문장은 아무것도 묻지 않는다」는 caller가 같게
처리하므로, 방금 거절한 벤더에게 세 lane이 다시 묻는 것이 바로 이 memo가 없애는 왕복이다.

**제품의 일관성은 memo에서 오지 않는다** — §1이 그 자리다. memo는 한 단위의 일이 같은 문장을 세 번 사지
않게 할 뿐이다.

## 4. 생성 중간 산출물은 factual evidence가 되지 않는다 — 그리고 두 결함

v2의 규칙은 그대로다: `DraftEvidenceView`의 모든 인용은 판매자 원본 source(`source_id`/`chunk_id`)를
가리키고, 발췌는 표시 시점에 그 문서에서 읽어 온다. **재사용을 더하면서 그것을 지켰다** — 재진술 ·
질문 벡터 · 판정은 여전히 어디에도 저장되지 않고 유일한 보관 장소가 유계 in-memory memo다(구조 테스트).

### 결함 A — 판매자 자신의 검색이 모델의 거절을 받고 있었다

`eligibility.filter`는 `semantics != null`만 보고 돌았다. 즉 **판매자가 자기 지식 라이브러리에
「반품 조건」을 쳤을 때**, 그리고 **Agent가 `search_org_knowledge`로 이 회사 정책을 읽을 때**, 거절 전용
모델이 **판매자 자신의 문서 중 무엇을 볼 수 있는지** 정하고 있었다. 이것은 이 capability가 측정된
문제(wrong-source 인용)와 **다른 종류의 실패**이고, 그것으로 도울 수 없는 실패다 — 판매자가 쓴 글을
쓴 사람에게 숨긴다.

수정: 판정도 **`RetrievalQuery.customerWritten()`으로 게이트**한다(intent가 처음부터 그랬던 그
게이트). 세 call site 전부가 그 술어를 묻는 것을 구조 테스트가 이름으로 고정한다. F5의 측정 대상 —
고객이 쓴 리뷰·문의 — 은 그대로 판정된다.

### 결함 B — 「모델을 쓰지 않는 진단」이 백로그를 모델로 훑고 있었다

`InquiryKnowledgeCoverageService`는 자기 docblock에 **「touching no marketplace and no model」**이라고
적어 두고, 두 라우트가 모두 화면이 쓰는 `retrieve(orgId, inquiry)` 오버로드로 흘러가 있었다. 결과:

1. 주문 사실을 **`EXACT_ALLOWED`**로 읽는다 ⇒ 인증된 GET 하나가 결합된 문의마다 마켓플레이스 요청 1회.
   (이것을 막으려고 존재하는 `STORED_ONLY` 오버로드는 docblock이 그 위험을 정확히 적어 둔 채
   **caller 0**이 돼 있었다.)
2. v2 capability가 켜지면 **행마다** 재진술 1회 + 판정 최대 2회 ⇒ 상한 없는 백로그에 대한 모델 sweep.

수정: 진단은 `measured()` 하나를 지난다 — `STORED_ONLY` + `RetrievalQuery.of`(customer-written 아님).
**진단은 읽지, 쓰지 않는다.** lexical scorer · 부재 게이트 · topic 표 · 캐시된 문단 벡터는 production이
쓰는 그것이고, 보고서는 자기가 무엇을 측정했는지 말한다(`CoverageReport.retrieval =
STORED_FACTS_NO_PER_QUESTION_MODEL`) — 그 숫자를 배포 형상의 숫자로 읽으면 production이 실제로 닿는
범위를 **과소평가**하기 때문이다.

## 5. semantic retrieval capability의 production 사용 조건 (실제 코드 기준 감사)

### 5-1. 벤더로 나가는 고객 텍스트

| capability | 나가는 것 | 나가지 않는 것 |
|---|---|---|
| `knowledge.embedding` (7번째) | 판매자 문단(내용 주소 캐시, org별 1회) + **고객 질문 문장** + 그 재진술 | org·상품·주문·식별자·지시문 |
| `knowledge.intent` (8번째) | **고객 문장 하나** | 문단 · 식별자 (세 개 중 가장 좁다) |
| `knowledge.eligibility` (9번째) | **고객 문장 + 순위에 오른 판매자 문단(위치로만)** | source id · chunk id · 상품 · org · 작성자명 (셋 중 가장 넓다) |

payload floor는 세 `*PayloadFloorTest`가 **직렬화된 바이트로** 단언한다.

### 5-2. 현재 redaction 경계 — lane마다 다르다

* **리뷰 lane**: `VocPreviewSanitizer.redactFullBody`를 지난 본문이 composer로 들어가고, 그래서
  벤더로도 그것이 나간다.
* **문의 lane**: `MarkupText.toPlainText(title/body)`뿐 — **redaction 없다.**

두 번째는 이 패키지가 만든 노출이 아니다(초안 capability가 이미 같은 텍스트를 보낸다). 다만
**세 retrieval capability는 caller가 한 redaction을 그대로 물려받는다**는 것이 사실이고, 문의 본문의
주문번호·주소를 벤더에 보내지 않기로 한다면 그것은 초안 품질을 바꾸는 **product-owner 결정**이다
(`InquiryOrderBinding`이 존재하는 이유가 채널이 지목한 주문이 질문의 요지이기 때문이다). **고치지 않고
보고한다.**

### 5-3. 실패 fallback — 전부 fail-soft, 전부 이전 동작으로

| 실패 | 결과 |
|---|---|
| embedding capability off / 벤더 무응답 / 문단 하나라도 벡터 없음 / corpus > 64문장 | `forQuestion` → **null** ⇒ lexical scorer가 v1 그대로 답한다 (「절반만 읽고 내린 부재는 절반에 대한 부재다」) |
| intent off / 벤더 거절 / 「아무것도 묻지 않는다」 | 재진술 없음 ⇒ **고객의 말 그대로** 검색 |
| judge off / 벤더 거절 / 침묵 / 문단 6개 초과 | hits **그대로** — 이 capability는 더할 수 없다 |
| 초안 모델 off / 예산 소진 / 거절 | 템플릿 floor + 운영 문장 (근거는 인용되지 않는다) |

### 5-4. 비용 · 예산 귀속

**감사 결과: 세 capability는 로그를 한 줄도 남기지 않았다.** 검색마다 벤더에 닿는데
「semantic retrieval이 이 판매자에게 얼마인가」는 배포가 자기 로그로 답할 수 없는 질문이었다.

수정(작은 운영 연결, 새 subsystem 0): 기존 `AgentLlmCallMetrics`를 재사용해 **메타데이터 전용** 한 줄씩.

```
knowledge_embedding  orgId=… kind=PASSAGE|QUESTION texts=N answered=… ms=… inTok=… outTok=… reasoningTok=…
knowledge_intent     orgId=… restated=…            ms=… inTok=… outTok=… reasoningTok=…
knowledge_eligibility orgId=… passages=N answered=… ms=… inTok=… outTok=… reasoningTok=…
```

문장도, 재진술도, 문단도 로그에 없다. `PASSAGE`와 `QUESTION`을 **나눠** 보고하는 이유는 경제가 다르기
때문이다 — 문단은 org당 1회 사서 DB에 영구 보관하고, 질문은 검색 1회분이며 저장되지 않는다. 둘을 합친
숫자는 「이 라이브러리를 색인하는 비용」도 「검색 한 번의 비용」도 아니다.

**남은 결정 — 세 capability는 여전히 판매자의 일일 AI 예산(`AgentUsageKind.DRAFT`) 밖이다.** v2가 올린
그 product-owner 결정은 그대로이고, 이 패키지는 예산에 넣지 않았다(넣는 것은 판매자가 볼 숫자의 의미를
바꾸는 제품 결정이다). 바뀐 것은 **이제 그 결정을 데이터로 할 수 있다**는 것뿐이다.

### 5-5. pilot org에서 켜는 방법 — 그리고 침묵하던 함정

배포 파일 셋(`.env.example` · `deploy/pilot/pilot.env.example` · `docker-compose.yml`)은
capability당 **세 이름**을 통과시킨다: `..._ENABLED` · `..._ORG_IDS` · `..._API_KEY`
(모델 이름은 일부러 제외 — `${K:-}`는 컨테이너에서 빈 문자열이 되어 설정된 모델을 지운다,
Pilot Runtime Foundation v1 §3).

**함정**: 세 capability는 자기 allow-list를 직접 읽고 있었고, plan·draft·judge는
`AgentCapabilityAccess`(Pilot Readiness Closure v1 §2)에 물어보고 있었다. 그래서 파일럿 호스트가
`SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS`로 돌면서 `..._INTENT_ENABLED=true` + 키를 갖고 있으면
**아무 조직에도 닿지 않는다** — 그리고 기동 검증은 항의하지 않는다(scope가 ALLOW_LIST가 아니므로 빈
목록이 정상이다). 즉 **켜져 있고, 키가 있고, 아무 일도 하지 않고, 아무 말도 하지 않는 스위치**였다.

수정: 세 문이 조직 질문을 **한 곳에** 묻는다. flag · key · 명시 목록은 여전히 각자의 것이고
(부분집합 운용 가능), **정책은 조직 질문만, 넓히는 방향으로만** 움직인다 — `ALLOW_LIST`(기본)에서는
바이트 단위로 예전과 동일하고, 키 없는·플래그 없는 capability는 어떤 scope에서도 모두에게 꺼져 있다.

기동 검증은 실측했다(§6의 baseline boot): 네 capability를 켠 채 키 없이 띄우면
`PilotConfigValidator`가 네 이름을 대며 기동을 거부한다.

**기본값은 전부 OFF**이고 그것은 바뀌지 않았다.

## 6. 성능 — 측정

### 6-1. 모델 왕복 횟수 (실측, 두 arm)

「몇 번 나가는가」는 이 코드의 성질이므로 **결정론적으로** 재고 커밋한다(`RetrievalRuntimeCostTest`):
세 lane · 실제 DB · Spring이 조립하는 그 문들 · 벤더만 카운터로 바꿈. **arm 비교는 같은 fixture로
d956b920 worktree에서 한 번 더 돌려** 얻었다(그 트리에는 같은 카운터만 심었고 다른 변경은 없다).

| path | before (`d956b920`) | after | |
|---|---|---|---|
| **cold generation** | 임베딩 **6** · 재진술 1 · 판정 2 | 임베딩 **4** · 재진술 1 · 판정 2 | 질문의 두 표현을 lane마다 사던 것이 한 번으로 |
| **같은 draft 다시 열기** | **0** (읽기 경로에 retriever 없음) | **0** | 캐시가 아니라 구조 — 이제 테스트가 고정 |
| **regenerate (상태 동일)** | 임베딩 **4** · 판정 **2** | **0 · 0 · 0** | 벤더에 전혀 닿지 않는다 |
| **Knowledge 수정 후 regenerate** | 임베딩 **5** · 판정 **2** | 임베딩 **1** · 판정 **1** | 바뀐 문단만, 바뀐 lane만 |

세 경로 합계 왕복: **22 → 9 (−59%)**. 그리고 regenerate가 0이라는 것은 비용 이야기만이 아니다 —
**§0이 이름 붙인 비결정성이 그 경로에서 사라진다**(같은 질문 · 같은 문단 ⇒ 같은 판정).

부수로 고정한 것: 두 번째 질문은 자기 두 표현만 사고 **코퍼스는 org당 한 번만** 임베딩된다(그 캐시는
표에 있으므로 프로세스를 넘긴다).

### 6-2. 지연 — 절반은 실측, 절반은 이 세션에서 측정 불가

로컬 스택(HEAD jar · 실제 Postgres · 일회용 DB · 세 capability OFF)에서 네 경로를 실행해 **모델 왕복이
없을 때의 지연**을 쟀다. 대상은 GROUNDED로 착지하는 리뷰다:

| path | 실측 (모델 왕복 0) | 모델 호출 |
|---|---|---|
| cold generation | **17 ms** | 0 |
| **같은 draft 다시 열기** | **8 ms** | **0** |
| regenerate | **14 ms** | 0 |
| Knowledge 수정 후 | **14 ms** | 0 |

같은 실행에서 §1이 **라이브로 확인됐다**: 다시 열기가 `draftAnswerBasis = GROUNDED`를 돌려주고
(수정 전에는 그 칸이 없었다) retrieval도 모델도 0이다.

**벤더 왕복이 포함된 wall-clock은 이 세션에서 재지 못했다.** `backend/.env.local`의 키는 운영자의 셸
변수를 참조하고 그 변수가 이 환경에 없다 ⇒ 라이브 벤더 호출 0. 그래서 지연의 벤더 성분은 §6-1의
**실측 횟수**와 holdout이 실측한 왕복 비용(재진술 1회 ≈ +2.2s, 판정 ≈ +1.3s/turn)의 곱으로만 말할 수
있고, 그것은 **유도값이지 측정값이 아니다**. 정직하게 그렇게 적는다. 다시 재려면 키가 필요하다.

## 7. 무엇을 하지 않았나

Knowledge model · retrieval architecture(threshold · scorer · candidate ladder · 프롬프트 · 모델) ·
browser execution · 승인 경계 · Template Settings는 **재설계하지 않았다**. 새 표 0 · 마이그레이션 0 ·
새 capability 0 · 새 cache subsystem 0. 벤치마크 114와 소진된 holdout 44는 **새 parameter 선택에 다시
쓰지 않았다** — 이 패키지는 parameter를 하나도 움직이지 않는다.

## 8. 고치지 않고 보고하는 것

* **문의 lane의 벤더 payload는 redaction을 지나지 않는다** (§5-2). 초안 capability가 이미 그렇고,
  바꾸는 것은 초안 품질을 바꾸는 product-owner 결정이다.
* **세 capability는 판매자 일일 AI 예산 밖이다** (§5-4). 이제 로그로 잴 수 있고, 넣을지는 결정이다.
* **경계선 비결정성은 regenerate 경로에서만 사라진다** (§6-1). *다른* 두 질문은 여전히 각자 모델 호출을
  하고, 그 둘 사이의 상대 순서는 이 패키지가 고정하지 않는다.
* **`answer_basis`가 없는 과거 버전은 아무것도 주장하지 않는다** — 백필하지 않았다(마이그레이션이 쓴
  값은 나중에 관측된 값과 구별할 수 없다).
* **`memory` lane의 판정 memo는 라이브 관측이 없다** — 이 세션의 일회용 org에는 answer memory 행이 0이다.
* **인용 행이 붙은 GROUNDED 초안의 라이브 관측이 없다** — 인용은 모델이 쓴 버전에만 기록되고 이
  세션은 벤더 키가 없다(테스트와 v1의 라이브 기록이 그 경로를 든다).

## 9. 검증

* backend **3,768** tests · 실패 0 · frontend **2,720** tests / 230 files · 실패 0 · typecheck clean
* 계약이 바뀌어 다시 쓴 테스트 **1건**: `KnowledgeQuestionIntentPayloadFloorTest`의 source scan이
  주석을 제거한다 — 이웃 두 capability가 이 capability의 docblock을 memo 규칙과 로그 규칙 때문에
  **가리키기** 때문이고, `AgentDraftBoundaryTest`가 같은 이유로 같은 일을 이미 한다(「자기 설명 때문에
  실패하는 guard는 고쳐지지 않고 삭제된다」). 성질은 **코드**에 대한 것이고 약화되지 않았다 —
  같은 테스트가 `SearchMemo`의 존재를 새로 단언한다.
* 새 테스트: `RetrievalRuntimeClosureTest`(4) · `RetrievalRuntimeCostTest`(2) ·
  `SearchMemoTest`(4) · `KnowledgeRetrievalReuseTest`(4) · `KnowledgeCapabilityAccessTest`(3)
* 라이브: 일회용 Postgres DB(`sellerops_rrc_measure`, 실행 후 삭제) · 운영자의 로컬 DB 무접촉 ·
  제품 자신의 signup으로 만든 일회용 org · 실제 판매자 데이터 0 · **마켓플레이스 호출 0 · WRITE 0 ·
  승인 0 · 모델 호출 0 · 마이그레이션 0** ⇒ `docs/evidence/INDEX.md` 행 없음

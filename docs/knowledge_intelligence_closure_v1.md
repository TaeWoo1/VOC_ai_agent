# Knowledge & Intelligence Closure v1 — Customer Operations Manager Demo v1 · Q2

> 작성 2026-09-18. 앞 단계: `docs/knowledge_spine_v1.md`(Q1). 제품 목표는
> `docs/responsibility_runtime_v1.md` §26 — **Customer Operations Manager Demo v1**.
>
> 이 패키지의 질문: **Reviewnary가 판매자를 아는 직원처럼 굴 수 있는가.** 모르면 묻고, 가르쳐 준 것을 기억하고,
> Case 판단과 초안이 서로 어긋나지 않아야 한다.
>
> 마켓플레이스 호출 **0** · WRITE **0** · 승인 **0** · 전송 **0** · 마이그레이션 **1**(V111).

## 1. 하나의 검색 — 조사자와 초안이 다른 답을 가질 수 없게

Q1의 Spine은 읽기 경로였고, 초안·조사자는 각자 검색했다. 그 결과가 `INVESTIGATOR_RETRIEVAL_GAP`이다: 같은 문의에
대해 조사자의 `searchKnowledge`는 0을 돌려주고 초안은 판매자 문장 2건으로 GROUNDED 초안을 썼다(§25-6).

이제 **검색은 하나**다.

```
InquiryKnowledgeAssessor          ← 문의 draft 와 Case 조사자가 함께 읽는 판정
  └ KnowledgeSpineService.retrieveForInquiry / retrieveForProduct   ← 유일한 retrieval
      ├ InquiryEvidenceRetriever  ← 근거 lane(상품 지식·운영 기준·과거 답변) 그대로. scorer·임계·semantic 무변경
      └ Spine adapters            ← 판매자 지침 · 리뷰 판단 · 승인된 리뷰 답글 · 채널 상품 속성 (context)
```

- `InquiryDraftComposer`는 규격 판정·검색·basis를 직접 하지 않고 **assessor의 판정을 읽는다**. `ReviewDraftComposer`와
  `CaseInvestigationTools`도 같은 Spine 호출을 쓴다. 구조 테스트가 이것을 고정한다 —
  **lane을 도는 파일은 둘**(Spine · coverage 진단), **Spine에 묻는 파일은 셋**(assessor · 리뷰 초안 · 조사자)
  (`RetrievalRuntimeClosureTest`).
- 조사자 context는 이제 `[basis]`(답변 근거 있음/규격 확인/부족) · `[e*]` 근거 · `[g*]` 판매자 지침·채널 속성 ·
  `[x*]` 지식 충돌로 구성되고, 각 줄은 **권한과 provenance와 기준 날짜**를 달고 간다. prompt `v3`.
- **entry id는 모델로 나가지 않는다**(payload floor 테스트). Case에는 어떤 지식을 보고 어떤 것을 인용했는지
  `knowledge_used`(id·라벨만, 지식 본문 없음)로 남고, 화면은 본문을 원천에서 다시 읽는다.
- Q1의 spine 자체 lexical 검색은 **삭제**했다. 병렬 retrieval을 하나 더 두지 않는다.

### 1-1. Authority와 충돌

`KnowledgeConflict`는 **같은 주제에 대해 서로 다른 수치**를 말하는 두 근거만 잡는다(같은 단위, 겹치지 않는 값,
공통 topic). 이기는 쪽은 권한이 높은 쪽, 같으면 최신. 진 쪽은 **초안이 쓰는 근거에서 빠지고** 삭제되지는 않으며,
조사자와 Case 화면에 충돌로 보인다. 보수적으로: 충돌 때문에 **유일한 현재 근거가 사라지지는 않는다**(그러면 GROUNDED가
뒤집힌다), 그리고 충돌이 있으면 `CaseDecisionGuard`가 `KNOWLEDGE_CONFLICT`로 판매자 결정을 요구한다.

## 2. Teach Loop — 모를 때 묻고, 한 번 배우면 다시 묻지 않는다

```
NO_ANSWER_BASIS → Case에 「부족한 정보」(고객이 쓴 명사) → [정보 알려주기] → 판매자 문장 저장
 → 같은 Case 재조사 + 재초안 → 근거 있는 초안. 다음 비슷한 Case는 묻지 않는다.
```

- **부족한 것의 이름은 고객의 명사다.** 규격 분류기가 낱말을 대면 그것을, 아니면 질문의 남은 topic 낱말을 쓴다
  (`InquiryKnowledgeAssessor#subjectOf`). 지어내지 않는다 — 두 출처 모두 고객이 쓴 단어다.
- 저장은 **기존 writer**(`KnowledgeCandidateService#teach`)를 지난다. 새 지식 writer를 만들지 않았다
  (`KnowledgeWriteFenceTest`의 세 writer 목록 불변). 저장된 것은 `SELLER_ENTERED_KNOWLEDGE`이고, 범위는 판매자가
  고른다(상품 없으면 회사 전체만). 초안 경로가 이미 접수함에 올린 ask가 있으면 **같은 source로 닫는다**.
- 재실행은 **런타임이 쓰는 그 메서드**다: `OperationsCaseProcessor#recordInvestigation`·`#recordPrepared`.
  가르친 Case는 처음부터 지식이 있었던 Case와 같은 모양이 된다.
- **판매자 입력 경로는 `operationscase` 밖에 있다**(`knowledge/teach`). 그 패키지의 안전 펜스(지식·정책 writer 0,
  GET 전용 컨트롤러, 승인 경계 불가침)는 그대로 유지된다 — 책임 런타임은 여전히 스스로 지식을 쓰지 않는다.

### 2-A. Past Answer Prefill v1 (2026-09-19) — 이미 한 답을 빈 칸으로 다시 묻지 않는다

**결함.** 과거 답변 lane이 판매자의 예전 답을 찾아도 Case는 빈 [정보 입력]으로 다시 물었다. 묻는 판정은 상품·운영
기준 두 lane만 보고(`markGap`·`KnowledgeGapView.of`), `NO_ANSWER_BASIS` 화면은 찾은 과거 답변을 근거 목록에서도
버렸다. 측정(Demo Org 과거 답변 23건 · 합성 질문 42 · 로컬 읽기 전용): 현재 lexical은 **같은 질문을 그대로 넣어도
7/21**, 바꿔 쓴 질문은 **5/25**만 찾는다 — 찾은 것조차 판매자에게 닿지 않았다.

**바꾼 것 — 승격이 아니라 시작 문장.** 「과거 답변 하나만으로는 근거가 될 수 없다」(2026-08-26)는 **그대로다**:
basis·모델 호출 여부·gap 적재·Knowledge Inbox는 한 글자도 바뀌지 않는다.

- `InquiryKnowledgeAssessor`가 `NO_ANSWER_BASIS`이고 **현재 근거 passage가 0개**일 때만, 과거 답변 lane이 찾은 첫
  답변의 **id**를 gap에 싣는다(`KnowledgeGapView.precedentMemoryId`). 조사 경로와 초안 경로가 같은 assessor를 읽으므로
  둘 다 같은 id를 낸다(`CaseKnowledgeGap.precedentMemoryId`).
- Case에는 **id만** 저장된다. 화면을 열 때 원본(`answer_memory`)에서 다시 읽고 펜스를 다시 확인한다 — 같은 조직 ·
  다른 상품에 묶인 답변 아님 · 이 문의 자신의 답변 아님 · 빈 본문 아님(`CaseKnowledgeService#prefill`). 하나라도
  어긋나면 예전처럼 빈 칸이다.
- 화면(`TeachCard`)은 입력칸을 그 답변으로 **미리 채우고**, 「예전에 비슷한 문의에 이렇게 답하셨습니다…」와
  `과거 답변 · {강도} · {날짜}`를 보인다. 부족한 정보 문장은 그대로 서 있다 — 여전히 묻는 것이다.
- 판매자가 **그대로 또는 고쳐서** 저장하면 기존 Teach 경로(`KnowledgeCandidateService#teach`,
  `SELLER_ENTERED_KNOWLEDGE`) → 같은 Case 재조사·재초안. 근거가 되는 것은 판매자가 확인한 지식이고 과거 답변 행은
  바뀌지 않는다. `KNOWLEDGE_TAUGHT` 이벤트는 `precedentMemoryId`와 `precedentUnchanged`(boolean)만 남긴다 — 텍스트 0.
- 과거 답변이 없으면 **지금과 같다**(빈 칸, 조사 지식에서 온 「과거 답변 불러오기」 보조 버튼 유지). 미리 채움이 있을
  때만 그 버튼을 숨긴다(같은 일을 하는 컨트롤 두 개).
- **하지 않은 것**: 검색 범위 확대(리스팅 → 제품군/회사), F5 semantic 활성화, lexical 조정. 그래서 이 변경이 발동하는
  빈도는 여전히 위의 lexical 적중률에 묶여 있다.

**브라우저 증명(`apr-7c3e91d4`, `QA_REPLAY_PROVEN`, 2026-09-19).** Demo Org 복제 DB에서 과거 NAVER 상품 문의 1건(「…투명한 부분과
아래쪽 보라색 부분은 어떻게 분리하나요?」, 과거 답변 `17dd221a`)을 오늘 도착한 문의로 다시 넣었다. 판정 `NO_ANSWER_BASIS`
(상품 `ABSENT` · 운영기준 `NO_RELEVANT_EVIDENCE` · 근거는 과거 답변뿐) → Case [정보 입력]이 그 답변으로 채워져 열림 → 판매자가
고쳐 저장 → `KNOWLEDGE_TAUGHT`(`precedentUnchanged=false`) → 재조사 → **GROUNDED 초안**(근거 상품 정보 1 · 과거 답변 1).
모델 3 · 마켓플레이스 0 · WRITE 0 · evidence `docs/evidence/INDEX.md`. 이 증명이 드러낸 것 넷:

- **고쳐 쓴 문장만 GROUNDED에 닿았다.** 사전 점검(모델 0)에서 인사말만 지운 답변을 저장하면 상품 lane은
  `NO_RELEVANT_EVIDENCE`에 머문다 — 과거 답변은 **저장된 질문 서명**(「제품의 부분과 부분은」) 덕에 잡혔고, Teach로 만든 지식에는
  그 서명이 없다. 증명은 판매자가 대상(「투명한 부분과 아래쪽 보라색 부분은」)을 넣어 고친 문장으로 했다. **고치지 않고 보고.**
- **부족한 정보의 명사가 「기존」**이었다(`subjectOf`가 질문의 첫 남은 낱말을 고른다) — 화면·Teach 제목(「기존 안내」)에 그대로
  나온다. 기존 동작이고 **고치지 않고 보고.**
- **화면의 Teach 호출이 8초에 포기했다** — 서버는 ~17초에 저장·재조사·재초안을 끝냈는데 화면은 실패를 말했고, 다시 누르면 같은
  지식이 두 번 저장될 자리였다. `teachOperationsCase`가 `2 × MODEL_TIMEOUT_MS`를 갖게 고쳤고(`apiClient.caseTeach.test.ts`),
  고친 뒤의 브라우저 재증명은 **새 승인이 필요해 실행하지 않았다.**
- 미리 채워진 과거 답변은 **이 질문의 원래 답**이다(같은 질문이 다시 온 경우). 상품 지식이 없으면서 **다른** 과거 답변이
  lexical로 잡히는 역사적 문의는 Demo Org에 없었다.

테스트: `KnowledgeIntelligenceClosureTest`(과거 답변만 → basis 불변·모델 0·두 경로 같은 id · 미리 채움을 고쳐 저장 →
GROUNDED·근거는 판매자 지식·메모리 불변 · 과거 답변 없음 → null · 현재 근거 있음 → null · 표시 시 펜스 · 옛 JSON 호환),
`OperationsCase.test.tsx`(미리 채움 표시·고쳐 저장·그대로 한 번에 저장·axe 0). 구현 커밋 자체는 마켓플레이스 0 ·
모델 0 · 마이그레이션 0이고, evidence 행은 위의 브라우저 증명 하나다.

## 3. 판매자 정정 → 기억 (「다음에도 참고」)

- 초안을 **실제로 고쳤을 때**(공백 차이가 아니라 내용이 달라졌을 때)와 추천을 다르게 판단했을 때, 판매자가 명시적으로
  「다음에도 참고」를 누르면 `seller_guidance` 한 줄이 남는다(V111).
- 그 줄은 **판매자의 문장 + 질문의 topic signature**(고객 문장 사본 없음)이고, Spine에서
  `RECENT_SELLER_DECISION` 권한의 **context**로 검색된다. 초안 프롬프트에는 `[판매자 지침]`으로 들어가 처리 방향과
  말투를 알려 주지만 **사실의 근거가 되지 못한다**(프롬프트 v9의 한 줄).
- **규칙·정책·임계값은 자동으로 바뀌지 않는다.** 정정은 다음 판단이 보는 맥락이지 제품이 믿는 규칙이 아니다.

## 4. Case 화면 (`/customer-operations/cases/:caseId`)

무슨 일이 있었나 · Reviewnary가 확인한 것(도구별 결과 수) · **사용한 회사 지식**(권한 · provenance · 기준 날짜 ·
판단에 사용 여부) · 제안과 판매자 확인이 필요한 이유 · 부족한 정보와 [정보 알려주기] · 준비된 답변(근거 접기 ·
고쳐 쓰기 · 다음에도 참고) · 「다르게 처리해야 해요」. 홈의 「내 결정 필요」 행이 이 화면으로 들어온다.

**이 화면은 아무것도 보내지 않는다.** 고객에게 등록하는 일은 문의 화면이 계속 소유하고, 링크 하나로 간다.

## 5. Inquiry Quality Set v1 (`contracts/inquiry-quality/v1/cases.json`)

합성 판매자 코퍼스(운영 기준 6 · 상품 3 · 상품 지식 7 · 과거 답변 2 · 판매자 지침 1) 위의 **문의 36건**. 축은 따로
센다 — 검색 적중 · 다른 상품/다른 정책 사용 · 답변 근거 판정 · 부족한 것의 이름 · (라이브) 근거 없는 주장 ·
초안 유무. 우선순위는 정확성 > grounding > 행동 적절성 > 완결성 > 말투이고, **말투는 평가하지 않는다**.

### 5-1. 결정론 축 (모델 0, CI에서 항상 실행)

| 축 | 결과 |
|---|---|
| 검색 적중 | **25/27 (0.93)** |
| 다른 상품 지식 사용 | **0** |
| 다른 정책 사용 | **1** (Q27) |
| 답변 근거 판정 정확 | **32/36 (0.89)** |
| 근거 없는데 GROUNDED(false grounding) | **3** (Q20 항균 · Q21 해외 · Q22 대량) |
| 부족한 것의 이름 | 실제 gap 6건 **6/6** |

**남은 결함 둘은 lexical lane의 admission이다** — 「택배 상자가 눌려서 부러진 채로 왔어요」가 교환 기준 대신 배송
기준을 집고(Q27), 회사가 아무것도 써 두지 않은 질문이 낱말 하나를 공유하는 규칙 때문에 GROUNDED가 된다(Q20·Q21·Q22).
이 패키지는 recall을 손대지 않기로 했으므로 **고치지 않고 측정값을 못으로 박았다**(늘어나면 빨개진다).
semantic lane이 켜진 배포에서는 이 셋의 모양이 달라지며, 그 측정은 `knowledge_retrieval_quality_v2.md`가 소유한다.

**첫 측정이 라벨 넷을 고쳤다**: Q26은 Answer Memory 항목의 제목을, Q33은 「밝기 최저 단계」가 코퍼스에 있으므로
grounded로 고쳤고(지어낸 단계 수는 `mustNotClaim`), Q29·Q31의 기대 명사는 고객이 실제로 쓴 낱말로 바꿨다. 라벨이
제품 계약과 다른 뜻을 담고 있었기 때문이고, 그 정정은 파일에 기록돼 있다.

### 5-2. 라이브 축 (실제 초안 모델 · `gpt-5-2025-08-07`)

| 축 | 결과 |
|---|---|
| 초안을 써야 할 때 썼는가 | **26/27** (Q16은 근거를 못 찾아 거절 — 위의 lexical miss) |
| 근거 없는데 초안을 썼는가 | **3/9이 씀** (Q20·Q21·Q22 — §5-1의 false grounding 셋) |
| **코퍼스에 없는 주장** | **0** |
| 코퍼스의 수치를 실제로 답에 담았는가 | **24/25** (Q02 제주도 「하루」 누락) |

**중요한 것은 셋째 줄이다.** 근거가 잘못 잡힌 셋에서도 모델은 모르는 사실(항균·해외배송·대량할인)을 **지어내지
않았다** — 「확인 후 안내」 쪽으로 썼다. 즉 오늘의 위험은 「거짓을 말한다」가 아니라 「판매자에게 물어봤어야 할 것을
묻지 않고 넘어간다」이고, 그 원인은 모델이 아니라 lexical admission이다.

## 6. Review Disposition Quality v1

기존 라벨 코퍼스(`contracts/review-eval/naver/v2`, 220건 중 UNCERTAIN 2건 제외 **218건**)를 **현재 규칙 + 에이전트
경로**에 그대로 통과시켰다. 읽기 전용 SELECT 1회 · 화면에는 수치만.

### 6-1. 규칙 경로 (모델 0)

| | |
|---|---|
| 사람 라벨 | 확인 필요 64 · 지켜보기 58 · 참고 96 |
| 규칙 판정 | AUTO_RESOLVED 114 · MONITORING 91 · 조사로 넘김 13 |
| **오탐 자동 종결(FALSE AUTO_RESOLVED)** | **18 — 전부 사람이 「확인 필요」라고 한 리뷰** |
| 확인 필요인데 MONITORING | 33 |

**이것이 이 평가가 존재하는 이유다.** 규칙은 별점의 순수 함수(`ReviewTriageRules.tier`)이고, 별점이 높은 불만을
구조적으로 볼 수 없다(`review_triage_contract_v1.md`가 이미 그렇게 적었다). 자동 종결률을 올리는 튜닝은 하지 않았고
임계값도 건드리지 않았다 — 이 패키지는 그 수를 **드러내는** 것까지다.

### 6-2. 에이전트 경로 (실제 모델 · 일회용 clone DB)

규칙이 넘긴 11건(라벨된 rule-investigate 13건 중 합성 2건은 실데이터 필터가 제외)을 실제 조사자로 돌렸다.

| | |
|---|---|
| 조사 결과 | CONCLUDED 11/11 |
| 에이전트 판정 | **NEEDS_DECISION 11** (AUTO_RESOLVED 0 · MONITORING 0) |
| guard 적용 | 0 — 모델 스스로 판매자에게 남겼다 |
| **오탐 자동 종결** | **0** |

즉 오늘 오탐 자동 종결은 **전부 규칙에서 나오고 에이전트에서는 나오지 않았다**(이 표본에서).

## 7. 안전 성질 (변경 0)

마켓플레이스 호출 · 승인 · 전송 · Agent tool WRITE는 이 패키지에서 한 줄도 바뀌지 않았다. 새로 추가된 쓰기는 셋뿐이고
전부 **판매자의 명시적 누름**이다: 지식 저장(기존 writer), 초안 버전 저장(기존 승인 경계), 지침 한 줄. Case의 status는
여전히 reconciler의 것이다.

## 8. 측정·테스트 요약

- backend **4,328 통과 · 실패 0 · 건너뜀 42**(Q1 마감 4,316 + 이 패키지 12) · frontend **252 files / 3,015 통과**
- frontend typecheck clean · Case 화면 테스트 5건
- 라이브 모델 호출: 리뷰 조사 **11회**(실제 고객 리뷰 · 일회용 clone DB) + 문의 초안 **26회**(합성 코퍼스)
- 마켓플레이스 호출 **0** ⇒ `docs/evidence/INDEX.md` 행 없음
- clone DB `sellerops_review_quality`는 평가용 일회용이며 dev `sellerops`는 **읽기 전용 SELECT** 외 무접촉

### 8-1. 계약이 바뀌어 다시 쓴 테스트 (안전 테스트 약화 0)

- `RetrievalIntentScopeTest` — 고객 문장을 들고 검색하는 파일이 둘에서 **넷**이 됐다(assessor · 조사자가 추가).
  성질("customer-written을 주장하는 쪽은 실제로 고객 문장을 들고 있다")은 그대로이고 목록만 늘었다.
- `RetrievalRuntimeClosureTest` — 「lane을 도는 파일」과 「Spine에 묻는 파일」 **두 목록으로 갈라져 단언이 늘었다**.
- `CaseInvestigationPayloadFloorTest` · `OperationsCaseProcessorTest` — 조사 도구가 지식 서비스 둘 대신 assessor와
  Spine을 받는다. floor 테스트에는 **권한·provenance·기준 날짜·충돌이 나가고 entry id는 나가지 않는다**는 단언이 추가됐다.
- `KnowledgeSpineTest` — Spine이 retrieval을 소유하게 되어 하네스가 실제 retriever를 조립한다.

## 9. 남은 것 (고치지 않고 보고)

- lexical admission 둘(§5-1). semantic lane이 켜진 배포에서의 같은 세트 측정은 하지 않았다.
- 채널 상품 속성(`product_facts`)은 **context**이지 grounding이 아니다 — 두께를 채널만 알고 판매자가 쓰지 않았으면
  여전히 판매자에게 묻는다(Q25).
- Teach Loop는 **문의**에만 있다. 리뷰 Case의 지식 공백은 화면에 이름이 없다.
- 리뷰 에이전트 표본은 **11건**이다. 규칙이 넘기는 수가 그것뿐이라 이 코퍼스에서 더 늘릴 수 없다.
- Case 화면은 데모 품질의 최소 구성이다(홈 재설계·지식 관리 UI는 이 패키지 밖).

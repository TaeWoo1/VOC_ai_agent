# Knowledge Retrieval Quality v2

2026-09-03 · HEAD `fb5f39b5` · backend only · **마켓플레이스 호출 0 · WRITE 0 · 승인 0 · 마이그레이션 0**

v1이 방향을 증명했다(lexical 38.9% → semantic 86.1%). v2는 **그 숫자가 정직한지 먼저 확인하고**, 일반적인
semantic RAG가 어디까지 올라가는지 arm별로 측정한 뒤, 품질 대비 복잡도가 합리적인 최소 조합만 채택한다.
Source / Canonical Knowledge / Answer Memory / Style · PRODUCT·ORG scope · provenance · active · 문서 import ·
evidence contract는 **그대로**다. GraphRAG · ontology · vector DB는 이번 범위가 아니고, 아래 §10이 그 판단을
다시 잰다.

---

## 1. 확장한 benchmark

**46 → 114 질문.** v1의 46개는 **그 임계값을 고르는 데 쓰인 집합**이었고, 넓히자 v1이 보고한 숫자가 6.5pp
높게 읽혔음이 드러났다 — 이것이 확장의 첫 번째 소득이다.

| | v1 (46) | v2 (114) |
|---|---|---|
| 라이브러리 | 4 (몰딩·매트·선풍기·회사정책 + 2 변형) | **7** (+ 원두 · 가죽 · **다른 회사** 정책 · **종합몰 18 문서**) |
| 답변 가능 / 부재 정답 | 36 / 10 | **93 / 21** |
| 범주 | A~K | A~K + **L 오타** · **M 짧은 표현** · **N 간접 불만** |
| semantic v1 실측 | 86.1% | **79.6%** |

범주: A 판매자 어휘 그대로 · B 자연어 확장 · C 띄어쓰기/활용 · D 표현 차이 · E 정책 · F 배송 ·
**G 무관한 문서가 많은 라이브러리(18개)** · H 부재가 정답(칭찬) · I 가깝지만 답이 아닌 이웃 · J 규격 토큰 ·
K 문서 하나뿐인 회사 · **L 오타**(두깨·몆일·싸이즈·마춰요·베터리) · **M 한두 낱말**(보관? · 사이즈 · 소음) ·
**N 질문하지 않는 불만**(생각보다 무거워서… · 카페 맛이 안 나요 · 자꾸 드르륵 소리가 납니다).

다른 회사(`orgB`)는 값이 **반대**다 — 반품 배송비 무료 · 교환 없음 · 3만원 무료배송. 한 회사의 정책을
외운 retriever가 통과할 수 없다. 종합몰(`wide`)은 다른 모든 라이브러리의 문서를 한 회사에 모아 18개로
만든 noise arm이다.

지표 셋을 **함께** 본다: Recall@4 · wrong-source(정답 문서가 아닌 것을 돌려줌) · no-evidence precision
(부재가 정답인데 인용을 만듦). recall만 보면 전부 돌려주는 retriever가 이긴다.

---

## 2. arm별 결과 (114 질문, 동일 fixture · 동일 gate · 동일 cap)

| arm | recall | top1-wrong | any-wrong | no-evidence |
|---|---|---|---|---|
| LEXICAL (v1 이전) | 41.9% | 2.2% | 6.5% | 85.7% |
| **A · semantic v1 (control)** | **79.6%** | 1.1% | 1.1% | 76.2% |
| B · + passage 요약 표현 | 80.6% | 0.0% | 1.1% | 76.2% |
| C1 · query intent만 | 90.3% | 1.1% | 3.2% | 90.5% |
| C2 · 원문 + query intent | **93.5%** | 0.0% | 2.2% | 85.7% |
| D · + synthetic question 색인 | 74.2% | 2.2% | 3.2% | 71.4% |
| F1 · intent + synthetic | 88.2% | 0.0% | 3.2% | 71.4% |
| F2 · synthetic + 요약 | 77.4% | 2.2% | 2.2% | 71.4% |
| E · v1 + eligibility | 79.6% | 0.0% | **0.0%** | **100%** |
| **F5 · 원문+intent + eligibility (채택)** | **92.5%** | **0.0%** | **0.0%** | **100%** |
| F6 · intent만 + eligibility | 89.2% | 1.1% | 1.1% | 100% |

**읽는 법 넷.**

1. **query intent가 유일한 큰 recall 지렛대다** (+13.9pp). 그리고 recall만 올린 것이 아니라 **부재 정확도도
   같이 올렸다**(C1 90.5%) — 다른 어떤 arm도 두 가지를 함께 올리지 못했다. 고치는 것은 정확히 L(3/6→6/6) ·
   N(4/7→6/7) · D(7/11→10/11) · G(9/11→11/11), 즉 **고객이 쓰는 말과 판매자가 쓴 말이 다른** 범주다.
2. **synthetic question 색인은 해롭다.** 「이 문단을 필요로 하는 고객은 이렇게 물을 것이다」를 문단마다
   생성해 함께 색인하면 recall 79.6→74.2, 부재 정확도 76.2→71.4로 **양쪽 다 떨어진다.** 생성된 질문은
   문단이 답하지 않는 이웃 질문과도 가깝고, 그래서 corpus 전체의 유사도 바닥을 올려 leave-one-out margin을
   무너뜨린다. v1이 lexical union을 기각한 것과 같은 모양이다.
3. **passage 요약 표현은 소음**(+1.0pp). 문장 단위 비교가 이미 v1에서 하던 일을 다시 한다.
4. **eligibility는 없애는 종류가 다르다.** recall을 하나도 사지 못하지만(E는 79.6% 그대로) wrong-source와
   false evidence를 **전부** 지운다. 그래서 C2와 짝지으면 C2가 새로 만든 오류 2건이 사라지고 92.5/0/0/100이
   된다 — recall 1건을 내주고 두 지표를 완성한다.

**함께 측정하고 기각한 것 하나 더 — 부재 게이트의 모양.** v1의 leave-one-out margin은 「두 문서가 모두
답할 때」 무너진다(A8 「반품 배송비」에서 `b-return`과 `b-noexchange`가 나란히 가까워 margin이 0.10 아래).
band 밖 문단으로만 평균을 내는 cluster-aware 변형을 만들어 재 봤다: control은 79.6→82.8로 오르지만
부재 정확도 76.2→**71.4**, any-wrong 1.1→**3.2**이고, 채택 조합에서는 92.5/0/0/**100** → 87.1/1.1/1.1/90.5로
**전면 후퇴**한다. ⇒ **v1의 게이트를 그대로 둔다.**

---

## 3. 최종 선택

**F5 = 원문 + 검색 의도(query intent) 두 표현 · 문장 단위 · v1 게이트 · 랭킹 후 evidence eligibility.**

- 새 capability **둘**, 둘 다 **기본값 OFF**: `sellerops.knowledge.intent.*`(8번째) ·
  `sellerops.knowledge.eligibility.*`(9번째).
- **C2 단독은 채택하지 않았다.** recall 1건이 더 높지만 any-wrong 2.2% · 부재 정확도 85.7%로, v1이 세운
  「wrong-source 0」 보증을 유지할 수 없다. 안전 테스트를 약화시켜 얻는 recall은 이 제품의 교환 조건이
  아니다.
- 기각: synthetic question 색인 · passage 요약 · hybrid(v1에서 이미) · 게이트 모양 변경.
- 새 vector DB · Graph DB · 새 테이블 · 마이그레이션 **0**.

---

## 4. query → retrieval → evidence 전체 흐름

```
고객 문장 (리뷰 · 문의)
  └ RetrievalQuery.ofCustomer(...)              ← customerWritten = true (판매자 검색창은 false)
      └ lane이 후보를 만든다                     ← scope · variant · active · 상품 결합: 전부 여기서 끝난다
          └ KnowledgeSemanticSearch.forQuestion
              ├ 문단 문장 임베딩 (content-address 캐시, org 단위)
              ├ 고객 문장 임베딩
              └ customerWritten이면 KnowledgeQuestionIntent  ← ★ 8번째 capability
                    「자꾸 붕 뜨는데요」→「제품이 사용 중 들뜨거나 고정되지 않는 문제」
                    두 표현 중 가까운 쪽이 그 문단의 점수가 된다
          └ KnowledgeRetriever.rank(...)         ← v1 게이트 그대로: LOO margin · band 0.90 · solo 0.25
          └ KnowledgeTopic.applicable / remedyApplicable   ← 거절 전용 (v1)
          └ KnowledgeEvidenceEligibility.filter  ← ★ 9번째 capability, 거절 전용, ≤6 문단
      └ RetrievalOutcome (FOUND · ABSENT · NO_RELEVANT_EVIDENCE · NOT_APPLICABLE)
      └ 인용은 언제나 판매자가 쓴 원문 passage
```

**불변식 넷.** ① semantic lane은 lane이 만든 후보 목록만 본다(scope 재판정 0 — 구조 테스트가
repository·`findAll`·`isActive`를 이름으로 막는다). ② intent와 judge는 **아무것도 추가하지 못한다** —
intent는 같은 질문의 두 번째 표현이고, judge는 이미 랭크된 문단을 지우기만 한다. ③ 실패는 전부 이전
동작이다: capability off · 벤더 무응답 · 문단 초과 · 의견 없음 ⇒ scorer가 남긴 그대로. ④ 판매자가 쓴
질문은 intent를 사지 않는다(자기 어휘를 쓰고 있으므로 그 값이 0이다).

---

## 5. 판매자 지식이 들어오는 경로 (감사 결과 — 변경 0)

| # | 경로 | 산출물 | 승격 방식 |
|---|---|---|---|
| 1 | 구조화 에디터 직접 등록 | PRODUCT/ORG Knowledge, `SELLER_ENTERED_KNOWLEDGE` | 즉시 (판매자가 쓴 글) |
| 2 | 공식 자료 업로드(매뉴얼·FAQ·정책) | 같은 표, 문서 원문 + provenance 보존 | 판매자는 **chunk를 승인하지 않는다** — 자료 종류 · PRODUCT/ORG 범위 · 현재 쓰는 자료인지만 확인 |
| 3 | 연결된 상품의 공식 상품 정보 | `SELLER_AUTHORED_CHANNEL_CONTENT` | 채널이 돌려준 판매자 자신의 글 |
| 4 | Knowledge Candidate | 반복 답변에서 **결정론적으로**(모델 0) 추출 | **판매자 확인 후에만** Canonical |
| 5 | 과거 문의 답변 | Answer Memory | **자동으로 Canonical이 되지 않는다** |
| 6 | 과거 리뷰 답글 | (미획득) | 같은 규율 |

Chat 자유문장은 fingerprint에 묶인 「저장하고 계속」 뒤에만 1번 경로로 들어간다. 이번 패키지가 이 표에
더한 것도 뺀 것도 **없다**.

---

## 6. 생성된 retrieval 표현과 factual evidence의 경계

**채택한 조합은 생성물을 하나도 저장하지 않는다** — 그리고 그것이 이 절의 답이 짧은 이유다.

- **query intent**는 고객 문장의 **파생 사본**이라 표도 컬럼도 만들지 않았다. 임베딩에 쓰이고 버려지며,
  같은 초안이 세 lane을 도는 동안만 메모리에 5분 남는다(`KnowledgeQuestionIntent`, 상한 200). 화면에
  나가지 않고, 인용되지 않고, `KnowledgeAuthorship`을 얻지 않는다. 구조 테스트가 이 클래스에
  `Repository`·`@Entity`·`save(`가 없음과, production에서 이것을 아는 파일이 셋뿐임을 고정한다.
- **eligibility judge**의 출력은 **boolean 하나**다. 문단을 고쳐 쓰지 않고, 답변을 쓰지 않고, 지운 이유를
  판매자 문장으로 만들지도 않는다.
- **저장되었을 뻔한 유일한 생성물은 synthetic question이었고, 측정이 그것을 기각했다.** 채택했다면 판매자
  문서 옆에 「모델이 쓴 예상 질문」이 영속했을 것이고, `AI_EXTRACTED_FROM_SELLER_IMAGE`가 지금 지키고 있는
  「생산자 0」 규율을 한 번 더 세웠어야 했다. 그럴 필요가 없어졌다.

⇒ Grounded Draft의 factual basis와 판매자 화면의 인용은 **언제나 원본 source**이고, 그 사실을 지키기 위해
새로 도입한 장치는 **0**이다.

---

## 7. Grounded Draft before / after (라이브)

일회용 QA org(제품 자신의 signup) · 리뷰는 파일 업로드 · 지식은 판매자 CRUD 10건 · 실제 판매자 데이터 0 ·
**승인 0 · 실행 0 · 마켓플레이스 0**. 같은 커밋 · 같은 코퍼스 · 플래그만 다름.

| 리뷰 | v1 (embedding만) | **v2 (intent + judge)** |
|---|---|---|
| ★5 「너무 좋아요 만족합니다」 | NO_ANSWER_BASIS | NO_ANSWER_BASIS ✔ |
| ★3 **「잘떨어지네요 자꾸 들떠요」** | **NO_ANSWER_BASIS** | **GROUNDED · 부착 방법 안내** |
| ★3 「겨울이라 그런지 잘 안 붙네요」 | GROUNDED · 부착 방법 안내 | 동일 |
| ★2 「배송이 너무 느려서 실망했습니다」 | GROUNDED · 배송 안내 | 동일 |
| ★2 「두께가 생각보다 얇아 아쉬웠습니다」 | GROUNDED · 규격 안내 | GROUNDED · 규격 안내 + 교환 안내 |
| ★2 **「한 번 썼는데 눌어붙었어요」** | **GROUNDED · 반품과 환불 안내** ← 틀린 근거 | **NO_ANSWER_BASIS** |
| ★5 「…식기세척기에 넣어도 되나요?」 | GROUNDED · 세척 방법 | 동일 |

「잘떨어지네요 자꾸 들떠요」는 **v1이 「여전히 실패한다」고 보고한 바로 그 문장**이고, 이제 판매자 자신의
부착 안내(「…한쪽 끝이 들뜰 수 있습니다 … 양면 보조 테이프를 30cm 간격으로」)를 인용한다.

**두 capability를 분리해 한 번 더 돌렸고, 벤치마크의 이야기가 라이브에서 그대로 재현됐다** (intent ON /
judge OFF):

| 리뷰 | intent만 | intent + judge |
|---|---|---|
| 잘떨어지네요 | GROUNDED · 부착 방법 + **반품과 환불** | 부착 방법 **하나** |
| 눌어붙었어요 | GROUNDED · **반품과 환불** | NO_ANSWER_BASIS |
| 식기세척기 | GROUNDED · 세척 방법 + **A/S 안내** | 세척 방법 **하나** |

즉 **intent는 recall과 wrong-source를 함께 올리고, judge가 그중 틀린 쪽만 걷어낸다.** 둘은 짝이지 선택지가
아니다.

---

## 8. latency / cost / 운영 영향

**측정.** 초안 모델을 부르지 않는 turn(`NO_ANSWER_BASIS`)이 순수 검색 시간이다.

| | v1 | intent만 | intent + judge |
|---|---|---|---|
| 검색만 하는 turn | **374 / 380 ms** | 2,115 ms | **1,883 / 2,780 ms** |
| 초안까지 가는 turn | 5.7 – 13.4 s | 10.1 – 16.6 s | 10.3 – 25.6 s |

- **intent는 질문당 1회**다 — 한 초안이 세 lane(상품·정책·과거답변)을 같은 문장으로 돌기 때문에 5분 메모가
  없으면 3회가 된다. 메모는 속도가 아니라 **같은 문장에 세 번 돈을 내지 않기 위한** 것이다.
- **judge는 문단을 실제로 찾은 lane에서만** 돌고 문단 6개가 상한이다. 아무것도 못 찾은 검색은 **0원**이다.
- 벡터: QA org 10개 문서 → **39행 / 156 KB**. 다른 org **0행**. content-address라 수정은 새 해시, 되돌리기는
  캐시 적중, 은퇴는 후보 목록에서 빠지므로 표를 건드리지 않는다(v1 그대로).
- **세 capability 모두 판매자의 일일 AI 예산에 청구되지 않는다.** v1이 embedding에 대해 올린 product-owner
  결정이 이제 셋이 됐고, 그중 둘은 **검색당 LLM 왕복**이라 금액이 v1보다 크다.

---

## 9. 여전히 실패하는 유형

- **「한 번 썼는데 눌어붙었어요」** — judge가 틀린 근거(반품 정책)를 걷어낸 것은 옳지만, 옳은 문단
  (「직화나 인덕션 위에 바로 올리면 눌어붙어 변형됩니다」)은 **애초에 검색되지 않았다.** 확인: 같은
  라이브러리에 「인덕션에 올렸더니 눌어붙었어요」는 FOUND, 「한 번 썼는데 눌어붙었어요」는
  NO_RELEVANT_EVIDENCE. 원인은 그 문장의 restatement가 열·가열기구 축을 세우지 못한 것이다(벤치마크 N6도
  전 arm 실패).
- **A8/E8류 — 두 문서가 모두 답하는 질문**에서 leave-one-out margin이 무너진다. §2가 잰 대안은 더 나빴다.
- **E7 「하자가 있는데 배송비는 제가 내야 하나요?」** — 질문은 SHIPPING, 문서 제목은 「교환 안내」라
  `KnowledgeTopic`이 구조적으로 거절한다. 어떤 arm도 고칠 수 없고, 고치려면 topic 축을 손대야 한다.
- **「두께가 생각보다 얇아 아쉬웠습니다」에 교환 안내가 함께 붙는다**(judge가 유지). 7일 내 교환은 이
  불만에 판매자가 실제로 안내할 내용이지만, 「규격을 묻는 질문」으로 읽으면 과한 근거다 — **제품 판단**으로
  남긴다.
- 여전히 없는 것: polarity(「배송 빨라요」와 「배송 늦어요」는 topic 축에서 같은 단어), 첫 검색의 cold
  임베딩(v1 2.7s), 그리고 이제 그 위에 **검색당 LLM 왕복 1~2회**.

---

## 10. Graph / ontology는 아직 필요하지 않다

이번에 실패한 것들을 원인별로 세면 **관계형 multi-hop이 원인인 것은 0건**이다. 실패는 (a) 구어체와 공식
문장의 의미 거리 — intent가 대부분 닫았다, (b) 한 문단이 다른 문단과 구별되지 않는 corpus 모양 — 게이트
문제, (c) 선언된 topic 축의 경직성 — 닫힌 표의 문제, (d) polarity 부재다. 「A의 부품 B는 C 정책을 따른다」
같은 **연결을 따라가야 답이 나오는** 질문은 벤치마크 114개 중 하나도 아니었고, 라이브 7건에도 없었다.
검색은 여전히 상품 하나 / 회사 하나로 경계지어져 실측 4~26행이며, 그 크기에서 필요한 구조적 filtering은
`org · product · scope · source type · provenance · active · canonical/memory · memory strength`가 이미 전부
하고 있다. **재검토 조건**: 실패 원인 분류에 multi-hop이 유의미하게 나타날 때.

---

## 11. production에서 켜기 위해 남은 결정

1. **세 capability의 비용을 누가 무는가.** embedding · intent · eligibility 모두 판매자 일일 AI 예산 밖이다.
   v1은 이것을 product-owner 결정으로 올렸고 v2는 검색당 LLM 왕복 두 번을 더했다.
2. **지연을 받아들일 것인가.** 초안 turn이 6~13초 → 10~26초. 판매자가 기다리는 화면이다.
3. **벤더로 나가는 것의 폭.** intent = 고객 문장 하나. eligibility = **고객 문장 + 판매자 문단**이 한
   요청에(세 capability 중 가장 넓다). 각자 자기 flag·자기 key라 셋 중 어느 조합이든 켤 수 있다 —
   embedding만 켜면 v1과 바이트 단위로 같고, embedding+intent는 §7의 가운데 열이며, 셋 다 켜야 §2의
   92.5/0/0/100이다.
4. **모델.** 두 새 capability의 기본값은 `gpt-5-2025-08-07`(벤더가 deprecated로 표시한 스냅샷 — 다른
   다섯과 같은 상태). 교체는 여전히 product-owner 결정이다.
5. **파일럿 org 지정.** 셋 다 `enabled-org-ids`를 요구하고, 비어 있으면 `PilotConfigValidator`가 기동을
   거부한다(v1의 §4 규칙 그대로 적용됨).

---

## 부록 — 검증

- backend **3,749 tests · 실패 0**. 벤치마크는 CI에서 **벤더를 부르지 않는다**(벡터 293개 · intent 102개 ·
  eligibility 108건이 checked-in 캐시). 기각된 arm의 캐시는 **넣지 않았다** — 기각한다는 것이 그 뜻이다.
- `RetrievalBenchmarkTest`의 회귀 기준을 올렸다: recall ≥ **0.90**, any-wrong **0**, no-evidence 정확도
  **1.0**, lexical 대비 **+0.45**, 질문 수 ≥ 110.
- overfit 점검(실측): 이번 QA org/product id **0건**, 이번 벤치마크·QA 문장 **0건**, 「매트」·「원두」·
  「가죽」·「눌어붙」·「들뜨」 **0건**. 「몰딩」·「실리콘」·「선바로」·「떨어지」가 남는 파일 13개는 전수
  확인 결과 **전부 주석/javadoc**(과거 사건 기록)과 `MockDataSeeder`(데모 시드 데이터)이며, **검색 규칙이
  키로 삼는 문자열은 하나도 없다.** 두 새 프롬프트는 문법적 지시뿐이고 동의어 사전이 없다(테스트가 낱말
  목록으로 확인).
- 라이브 QA는 일회용 org 하나에서만 이루어졌고 다른 org의 `knowledge_embedding` 행 **0**, 승인 **0**,
  실행 **0**, 마이그레이션 **0** ⇒ evidence 행 없음.
